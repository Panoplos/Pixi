import { type AssistantMessage, fauxAssistantMessage, fauxThinking } from "@earendil-works/pi-ai";
import { setKeybindings } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { type ActivityToolCall, extractCommitHash, summarizeSection } from "../src/core/tool-activity-summary.ts";
import { ToolActivitySummaryComponent } from "../src/modes/interactive/components/tool-activity-summary.ts";
import type { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function call(id: string, toolName: string, args: Record<string, unknown> = {}): ActivityToolCall {
	return { toolName, toolCallId: id, args };
}

beforeAll(() => setKeybindings(new KeybindingsManager()));

describe("InteractiveMode restored activity boundaries", () => {
	function render(message: AssistantMessage) {
		const finalizeActiveToolSection = vi.fn();
		const context = {
			pendingTools: new Map<string, ToolExecutionComponent>(),
			sectionByToolCall: new Map<string, ToolActivitySummaryComponent>(),
			standaloneToolCall: new Map<string, ToolExecutionComponent>(),
			finalizeActiveToolSection,
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

	it("splits on visible text but not hidden thinking", () => {
		expect(render(fauxAssistantMessage("Visible commentary"))).toHaveBeenCalledTimes(2);
		expect(render(fauxAssistantMessage(fauxThinking("Hidden reasoning")))).toHaveBeenCalledTimes(1);
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
		// Hint rendered in grey (muted color code).
		expect(summary).toContain("128;128;128");
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
		// Hash gets the same bold treatment as the integer counts.
		expect(summary).toContain("\u001b[1m9be7da6\u001b[22m");
	});
});
