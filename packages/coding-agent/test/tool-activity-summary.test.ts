import { describe, expect, it, vi } from "vitest";
import {
	type ActivityToolCall,
	type ActivityUnit,
	extractCommitHash,
	splitActivitySections,
	summarizeSection,
	type ToolPhraseOverride,
} from "../src/core/tool-activity-summary.ts";
import { ToolActivitySummaryComponent } from "../src/modes/interactive/components/tool-activity-summary.ts";
import type { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function call(id: string, toolName: string, args: Record<string, unknown> = {}): ActivityToolCall {
	return { toolName, toolCallId: id, args };
}

function text(text: string): ActivityUnit {
	return { kind: "text", text };
}

function tc(c: ActivityToolCall): ActivityUnit {
	return { kind: "toolCall", toolCall: c };
}

describe("splitActivitySections", () => {
	it("groups consecutive tool calls into one section", () => {
		const sections = splitActivitySections([
			tc(call("1", "bash", { command: "ls" })),
			tc(call("2", "read", {})),
			tc(call("3", "bash", { command: "pwd" })),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].toolCalls.map((c) => c.toolCallId)).toEqual(["1", "2", "3"]);
	});

	it("does not split on commentary text (tool calls share one section)", () => {
		const sections = splitActivitySections([
			tc(call("1", "bash", { command: "ls" })),
			text("Now I will check the file."),
			tc(call("2", "read", {})),
		]);
		expect(sections).toHaveLength(1);
		expect(sections[0].toolCalls.map((c) => c.toolCallId)).toEqual(["1", "2"]);
	});

	it("ignores leading and trailing text", () => {
		const sections = splitActivitySections([text("Starting."), tc(call("1", "read", {})), text("Done.")]);
		expect(sections).toHaveLength(1);
		expect(sections[0].toolCalls.map((c) => c.toolCallId)).toEqual(["1"]);
	});

	it("returns no sections for empty or text-only input", () => {
		expect(splitActivitySections([])).toEqual([]);
		expect(splitActivitySections([text("only commentary")])).toEqual([]);
	});

	it("preserves order across tool calls with interleaved text", () => {
		const sections = splitActivitySections([
			tc(call("1", "bash", { command: "a" })),
			text("x"),
			tc(call("2", "bash", { command: "b" })),
			tc(call("3", "bash", { command: "c" })),
		]);
		expect(sections.map((s) => s.toolCalls.map((c) => c.toolCallId))).toEqual([["1", "2", "3"]]);
	});

	it("emits each write/edit as its own standalone section", () => {
		const sections = splitActivitySections([
			tc(call("1", "read", {})),
			tc(call("2", "write", {})),
			tc(call("3", "edit", {})),
			tc(call("4", "read", {})),
		]);
		expect(sections.map((s) => s.toolCalls.map((c) => c.toolCallId))).toEqual([["1"], ["2"], ["3"], ["4"]]);
	});

	it("keeps consecutive writes separate from each other", () => {
		const sections = splitActivitySections([
			tc(call("1", "write", { path: "a" })),
			tc(call("2", "write", { path: "b" })),
			text("x"),
			tc(call("3", "bash", { command: "pwd" })),
		]);
		expect(sections.map((s) => s.toolCalls.map((c) => c.toolCallId))).toEqual([["1"], ["2"], ["3"]]);
	});

	it("does not split on non-write/edit tools", () => {
		const sections = splitActivitySections([
			tc(call("1", "read", {})),
			tc(call("2", "bash", { command: "pwd" })),
			tc(call("3", "grep", {})),
		]);
		expect(sections.map((s) => s.toolCalls.map((c) => c.toolCallId))).toEqual([["1", "2", "3"]]);
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
			results: { gc: "[main 9be7da6] fix\n 1 file changed, 1 insertion(+)\n" },
		});
		expect(phrase).toBe("Committed 9be7da6");
	});

	it("renders git commit without a hash when the result is unknown", () => {
		expect(summarizeSection([call("gc", "bash", { command: "git commit -am wip" })])).toBe("Committed");
	});

	it("mixes commit with other tools", () => {
		const calls = [
			call("gc", "bash", { command: "git commit -m fix" }),
			call("sh", "bash", { command: "sh build.sh" }),
			call("r", "read", {}),
		];
		const phrase = summarizeSection(calls, {
			results: { gc: "[main 9be7da6] fix\n" },
		});
		expect(phrase).toBe("Committed 9be7da6, ran 1 shell command, read 1 file");
	});

	it("wins with a custom override phrase", () => {
		const override: ToolPhraseOverride = (name, count) =>
			name === "my-ext" ? `${count} custom thing(s)` : undefined;
		expect(summarizeSection([call("1", "my-ext", {})], { overridePhrase: override })).toBe("1 custom thing(s)");
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

	it("appends the hard-coded grey hint with a bold ctrl+o", () => {
		const section = sectionHarness();
		section.addOrUpdateTool("bash", "tool-1", { command: "ls" });
		section.setCollapseHint("(ctrl+o to expand)");

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
});
