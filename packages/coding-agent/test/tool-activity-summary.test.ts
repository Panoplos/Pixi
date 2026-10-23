import { type AssistantMessage, fauxAssistantMessage, fauxThinking } from "@earendil-works/pi-ai";
import { resetCapabilitiesCache, setCapabilities, setKeybindings } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { type ActivityToolCall, extractCommitHash, summarizeSection } from "../src/core/tool-activity-summary.ts";
import { ToolActivitySummaryComponent } from "../src/modes/interactive/components/tool-activity-summary.ts";
import type { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function call(id: string, toolName: string, args: Record<string, unknown> = {}): ActivityToolCall {
	return { toolName, toolCallId: id, args };
}

beforeAll(() => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	setKeybindings(new KeybindingsManager());
});

afterAll(() => resetCapabilitiesCache());

describe("InteractiveMode restored activity boundaries", () => {
	function render(message: AssistantMessage) {
		const finalizeActiveToolSection = vi.fn();
		const context = {
			pendingTools: new Map<string, ToolExecutionComponent>(),
			sectionByToolCall: new Map<string, ToolActivitySummaryComponent>(),
			standaloneToolCall: new Map<string, ToolExecutionComponent>(),
			finalizeActiveToolSection,
			maybeShowAssistantDiagnostics: () => {},
			settingsManager: { getShowCacheMissNotices: () => false },
			sessionManager: { getEntries: () => [] },
			addMessageToChat: () => {},
			ui: { requestRender: () => {} },
		};
		const renderSessionItems = (
			InteractiveMode.prototype as unknown as {
				renderSessionItems(this: typeof context, items: readonly AssistantMessage[]): void;
			}
		).renderSessionItems;

		renderSessionItems.call(context, [message]);
		return finalizeActiveToolSection;
	}

	it("splits on thinking but not on visible text", () => {
		expect(render(fauxAssistantMessage("Visible commentary"))).toHaveBeenCalledTimes(1);
		expect(render(fauxAssistantMessage(fauxThinking("Hidden reasoning")))).toHaveBeenCalledTimes(2);
	});
});

describe("InteractiveMode live activity boundaries", () => {
	it("does not close the aggregate again when a standalone tool is repeated in cumulative stream data", async () => {
		const finalizeActiveToolSection = vi.fn();
		const standaloneToolCall = new Map<string, ToolExecutionComponent>();
		const execution = {
			updateArgs: vi.fn(),
			setExpanded: vi.fn(),
			updateResult: vi.fn(),
			markExecutionStarted: vi.fn(),
			setArgsComplete: vi.fn(),
		} as unknown as ToolExecutionComponent;
		const context = {
			isInitialized: true,
			streamingComponent: { updateContent: vi.fn() },
			streamingMessage: undefined,
			hideThinkingBlock: true,
			thinkingStartMs: undefined,
			thinkingStreamActive: false,
			workingVisible: false,
			pendingTools: new Map<string, ToolExecutionComponent>(),
			sectionByToolCall: new Map<string, ToolActivitySummaryComponent>(),
			standaloneToolCall,
			finalizeActiveToolSection,
			isStandaloneTool: (name: string) => name === "write",
			createStandaloneToolExecution: (_name: string, id: string) => {
				standaloneToolCall.set(id, execution);
				return execution;
			},
			getOrCreateActiveToolSection: vi.fn(),
			footer: { invalidate: vi.fn() },
			programStatus: { handleEvent: vi.fn() },
			ui: { requestRender: vi.fn() },
		};
		const handleEvent = (
			InteractiveMode.prototype as unknown as { handleEvent(this: typeof context, event: unknown): Promise<void> }
		).handleEvent;
		const message = {
			role: "assistant",
			content: [{ type: "toolCall", name: "write", id: "write-1", arguments: { path: "a.ts" } }],
		};

		await handleEvent.call(context, { type: "message_update", message });
		await handleEvent.call(context, { type: "message_update", message });

		expect(finalizeActiveToolSection).toHaveBeenCalledOnce();
	});
});

describe("summarizeSection", () => {
	it("renders built-in tools with plurals, preserving order", () => {
		expect(
			summarizeSection([call("1", "read", {}), call("2", "read", {}), call("3", "bash", { command: "pwd" })]),
		).toBe("read 2 files, ran 1 shell command");
	});

	it("uses singular for a single file", () => {
		expect(summarizeSection([call("1", "read", {})])).toBe("read 1 file");
	});

	it("falls back to ran N <tool> for extension tools", () => {
		expect(summarizeSection([call("1", "my-extension-tool", {})])).toBe("ran 1 my-extension-tool");
	});

	it("detects git commit and extracts the hash from the result", () => {
		const calls = [call("gc", "bash", { command: "git commit -m fix" })];
		const phrase = summarizeSection(calls, {
			results: { gc: { isError: false, isPartial: false, commitHash: "9be7da6" } },
		});
		expect(phrase).toBe("Committed 9be7da6");
	});

	it("does not claim a pending commit succeeded", () => {
		expect(summarizeSection([call("gc", "bash", { command: "git commit -am wip" })])).toBe("ran 1 shell command");
	});

	it("reports a failed commit", () => {
		expect(
			summarizeSection([call("gc", "bash", { command: "git commit -am wip" })], {
				results: { gc: { isError: true, isPartial: false } },
			}),
		).toBe("commit failed");
	});

	it("mixes commit with other tools", () => {
		const calls = [
			call("gc", "bash", { command: "git commit -m fix" }),
			call("sh", "bash", { command: "sh build.sh" }),
			call("r", "read", {}),
		];
		const phrase = summarizeSection(calls, {
			results: { gc: { isError: false, isPartial: false, commitHash: "9be7da6" } },
		});
		expect(phrase).toBe("Committed 9be7da6, ran 1 shell command, read 1 file");
	});

	it("does not mistake arguments containing git commit for a commit command", () => {
		expect(summarizeSection([call("gc", "bash", { command: "echo 'git commit'" })])).toBe("ran 1 shell command");
	});

	it("returns empty for an empty section", () => {
		expect(summarizeSection([])).toBe("");
	});
});

describe("extractCommitHash", () => {
	it("prefers the bracket [branch hash] style", () => {
		expect(extractCommitHash("[main 9be7da6] fix\n")).toBe("9be7da6");
	});

	it("falls back to any hex token", () => {
		expect(extractCommitHash("Created commit abcdef1.")).toBe("abcdef1");
	});

	it("returns undefined without a hash", () => {
		expect(extractCommitHash("nothing here")).toBeUndefined();
		expect(extractCommitHash(undefined)).toBeUndefined();
	});
});

describe("ToolActivitySummaryComponent.addOrUpdateTool", () => {
	function createHarness() {
		initTheme("dark");
		type FakeExec = {
			toolName: string;
			toolCallId: string;
			args: unknown;
			updateArgs: (next: unknown) => void;
			setExpanded: () => void;
			updateResult: () => void;
			markExecutionStarted: () => void;
			setArgsComplete: () => void;
		};
		const executions: FakeExec[] = [];
		const section = new ToolActivitySummaryComponent(
			{
				createExecution: (name, id, args) => {
					const exec: FakeExec = {
						toolName: name,
						toolCallId: id,
						args,
						updateArgs: vi.fn((next: unknown) => {
							exec.args = next;
						}),
						setExpanded: vi.fn(),
						updateResult: vi.fn(),
						markExecutionStarted: vi.fn(),
						setArgsComplete: vi.fn(),
					};
					executions.push(exec);
					return exec as unknown as ToolExecutionComponent;
				},
			},
			{ requestRender: () => {} } as never,
		);
		return { section, executions };
	}

	it("reuses the execution and refreshes its args on later calls", () => {
		const { section, executions } = createHarness();

		// First call: streaming, partial/empty args.
		section.addOrUpdateTool("bash", "tool-1", { command: "" });
		expect(executions).toHaveLength(1);
		const exec = executions[0];
		expect(exec.args).toEqual({ command: "" });

		// Second call: finalized args. Must update the SAME execution, not create a new one.
		section.addOrUpdateTool("bash", "tool-1", { command: "ls -la" });
		expect(executions).toHaveLength(1);
		expect(exec.updateArgs).toHaveBeenCalledWith({ command: "ls -la" });
		expect(exec.args).toEqual({ command: "ls -la" });
	});
});

describe("ToolActivitySummaryComponent hint markup", () => {
	function sectionHarness() {
		initTheme("dark");
		const section = new ToolActivitySummaryComponent(
			{
				createExecution: () =>
					({
						updateArgs: () => {},
						setExpanded: () => {},
						updateResult: () => {},
						markExecutionStarted: () => {},
						setArgsComplete: () => {},
					}) as unknown as ToolExecutionComponent,
			},
			{ requestRender: () => {} } as never,
		);
		return section;
	}

	it("appends the configured expand hint", () => {
		const section = sectionHarness();
		section.addOrUpdateTool("bash", "tool-1", { command: "ls" });
		section.setShowCollapseHint(true);

		const lines = section.render(80);
		const summary = lines[1];
		expect(summary).toContain("ctrl+o");
		expect(summary).toContain(" to expand");
		expect(summary).not.toContain("[grey]");
		expect(summary).not.toContain("[bold]");
		// Hint rendered with styling but no literal markup.
		expect(summary).toMatch(/\x1b\[/);
		expect(summary).toMatch(/ran \d+ shell command/); // phrase still present
	});

	it("styles the commit hash with the same emphasis as counts", () => {
		// theme.bold goes through chalk, which disables styling for non-TTY stdout.
		chalk.level = 1;

		const section = sectionHarness();
		section.addOrUpdateTool("bash", "gc", { command: "git commit -m fix" });
		section.updateResult("gc", {
			content: [{ type: "text", text: "[main 9be7da6] fix" }],
			isError: false,
		});
		section.addOrUpdateTool("bash", "sh", { command: "ls" });

		const lines = section.render(200);
		const summary = lines.join("\n");
		// Hash gets the same bold treatment as the integer counts, while the status word stays quiet.
		expect(summary).toContain("\u001b[1m9be7da6\u001b[22m");
		expect(summary).toContain(theme.fg("muted", "Committed"));
	});
});

describe("ToolActivitySummaryComponent running shell preview", () => {
	function sectionHarness() {
		initTheme("dark");
		return new ToolActivitySummaryComponent(
			{
				createExecution: () =>
					({
						updateArgs: () => {},
						setExpanded: () => {},
						updateResult: () => {},
						markExecutionStarted: () => {},
						setArgsComplete: () => {},
					}) as unknown as ToolExecutionComponent,
			},
			{ requestRender: () => {} } as never,
		);
	}

	it("shows summary, elapsed time, command, output tail, and hidden-line hint while running", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		try {
			const section = sectionHarness();
			section.addOrUpdateTool("bash", "sh", {
				command: "rg linter",
				summary: "Locating the linter rules",
			});
			section.updateResult(
				"sh",
				{ content: [{ type: "text", text: "one\ntwo\nthree\nfour" }], isError: false },
				true,
			);

			vi.setSystemTime(4_200);
			const lines = section.render(80).map(stripAnsi);
			const rendered = lines.join("\n");

			expect(rendered).toContain("Locating the linter rules · 4.2s");
			expect(rendered).toContain("$ rg linter");
			expect(rendered).toContain("three");
			expect(rendered).toContain("four");
			expect(rendered).not.toContain("one");
			expect(rendered).toContain("... (2 more lines, 4 total,");
			expect(rendered).toContain("ctrl+o");
			expect(rendered).not.toContain("ran 1 shell command");
			// A running block keeps a blank line between its purpose and the command.
			const header = lines.findIndex((line) => line.includes("Locating the linter rules"));
			expect(lines[header + 1]?.trim()).toBe("");
			expect(lines[header + 2]).toContain("$ rg linter");
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps a finished single command as ran 1 shell command with its duration and last output", () => {
		const section = sectionHarness();
		section.addOrUpdateTool("bash", "sh", { command: "rg linter", summary: "Locating the linter rules" });
		section.updateResult("sh", {
			content: [{ type: "text", text: "one\ntwo\nthree" }],
			isError: false,
			durationMs: 4_200,
		});

		const lines = section.render(80).map(stripAnsi);
		const rendered = lines.join("\n");
		expect(rendered).toContain("ran 1 shell command · 4.2s");
		expect(rendered).toContain("$ rg linter");
		expect(rendered).toContain("two");
		expect(rendered).toContain("three");
		expect(rendered).toContain("... (1 more lines, 3 total,");
		expect(rendered).toContain("ctrl+o");
		// The purpose label belongs to the run; a finished command shows its outcome.
		expect(rendered).not.toContain("Locating the linter rules");
		// A finished single command keeps a blank line between its title and the command.
		const header = lines.findIndex((line) => line.includes("ran 1 shell command"));
		expect(lines[header + 1]?.trim()).toBe("");
		expect(lines[header + 2]).toContain("$ rg linter");
	});

	it("renders Committed in muted in a finished commit block", () => {
		chalk.level = 1;
		const section = sectionHarness();
		section.addOrUpdateTool("bash", "gc", { command: "git commit -m fix" });
		section.updateResult("gc", {
			content: [{ type: "text", text: "[main 9be7da6] fix" }],
			isError: false,
			durationMs: 15_100,
		});

		const raw = section.render(80).join("\n");
		expect(stripAnsi(raw)).toContain("Committed 9be7da6 · 15.1s");
		expect(raw).toContain(theme.fg("muted", "Committed"));
		expect(raw).toContain(theme.fg("toolTitle", " 9be7da6"));
	});

	it("adds the cumulative runtime of several commands to the aggregate summary", () => {
		const section = sectionHarness();
		section.addOrUpdateTool("bash", "a", { command: "first command" });
		section.addOrUpdateTool("bash", "b", { command: "second command" });
		section.updateResult("a", { content: [{ type: "text", text: "a" }], isError: false, durationMs: 1_200 });
		section.updateResult("b", { content: [{ type: "text", text: "b" }], isError: false, durationMs: 2_300 });

		const rendered = stripAnsi(section.render(80).join("\n"));
		expect(rendered).toContain("ran 2 shell commands · 3.5s");
		expect(rendered).not.toContain("$ first command");
	});

	it("adds a shell command's runtime to a mixed section summary", () => {
		const section = sectionHarness();
		section.addOrUpdateTool("read", "r", { path: "README.md" });
		section.addOrUpdateTool("bash", "b", { command: "rg x" });
		section.updateResult("b", { content: [{ type: "text", text: "match" }], isError: false, durationMs: 1_500 });

		const rendered = stripAnsi(section.render(80).join("\n"));
		expect(rendered).toContain("read 1 file, ran 1 shell command · 1.5s");
	});
});
