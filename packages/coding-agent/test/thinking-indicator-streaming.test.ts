import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import type { WorkingIndicatorOptions } from "../src/core/extensions/index.ts";
import type { StatusIndicator } from "../src/modes/interactive/components/status-indicator.ts";
import type { ToolActivitySummaryComponent } from "../src/modes/interactive/components/tool-activity-summary.ts";
import type { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type Ctx = {
	chatContainer: Container;
	streamingComponent?: { updateContent(m: unknown, s: boolean): void; removeChild?(): void };
	streamingMessage?: unknown;
	hideThinkingBlock: boolean;
	thinkingStartMs: number | undefined;
	thinkingStreamActive: boolean;
	outputPad: number;
	hiddenThinkingLabel: string;
	statusContainer: Container;
	activeStatusIndicator: StatusIndicator | undefined;
	workingVisible: boolean;
	workingMessage: string | undefined;
	workingIndicatorOptions: WorkingIndicatorOptions | undefined;
	thinkingIndicatorOptions: WorkingIndicatorOptions | undefined;
	defaultWorkingMessage: string;
	ui: TUI;
	isInitialized: boolean;
	footer: { invalidate(): void };
	pendingTools: Map<string, ToolExecutionComponent>;
	sectionByToolCall: Map<string, ToolActivitySummaryComponent>;
	standaloneToolCall: Map<string, ToolExecutionComponent>;
	isStandaloneTool(n: string): boolean;
	finalizeActiveToolSection(): void;
	getOrCreateActiveToolSection(): ToolActivitySummaryComponent;
	createStandaloneToolExecution(n: string, id: string, a: unknown): ToolExecutionComponent;
	finalizeThinkingIndicator(): void;
	showStatusIndicator(indicator: StatusIndicator): void;
	activeWorkingIndicatorEmbedded: boolean;
	setEditorWorkingStatusIndicator(indicator: StatusIndicator | undefined): boolean;
};

function makeCtx(): Ctx {
	return {
		chatContainer: new Container(),
		hideThinkingBlock: true,
		thinkingStartMs: undefined,
		thinkingStreamActive: false,
		outputPad: 1,
		hiddenThinkingLabel: "Thinking",
		statusContainer: new Container(),
		activeStatusIndicator: undefined,
		workingVisible: true,
		workingMessage: undefined,
		workingIndicatorOptions: undefined,
		thinkingIndicatorOptions: undefined,
		defaultWorkingMessage: "Working...",
		ui: { requestRender: vi.fn() } as unknown as TUI,
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		pendingTools: new Map(),
		sectionByToolCall: new Map(),
		standaloneToolCall: new Map(),
		isStandaloneTool: () => false,
		finalizeActiveToolSection: () => {},
		getOrCreateActiveToolSection: () =>
			({ addOrUpdateTool: () => ({}) as ToolExecutionComponent }) as unknown as ToolActivitySummaryComponent,
		createStandaloneToolExecution: () => new Text("x", 0, 0) as unknown as ToolExecutionComponent,
		finalizeThinkingIndicator: (InteractiveMode.prototype as unknown as { finalizeThinkingIndicator(): void })
			.finalizeThinkingIndicator,
		activeWorkingIndicatorEmbedded: false,
		setEditorWorkingStatusIndicator: () => false,
		showStatusIndicator: (
			InteractiveMode.prototype as unknown as { showStatusIndicator(indicator: StatusIndicator): void }
		).showStatusIndicator,
	};
}

function ev(e: AssistantMessageEvent): AgentSessionEvent {
	return {
		type: "message_update",
		message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
		assistantMessageEvent: e,
	} as unknown as AgentSessionEvent;
}

const render = (c: Container): string => stripAnsi(c.render(120).join("\n"));

const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent(e: AgentSessionEvent): Promise<void> })
	.handleEvent;

describe("thinking indicator streaming", () => {
	test("moves active thinking to status and appends its completed duration", async () => {
		initTheme("dark");
		const ctx = makeCtx();
		ctx.streamingComponent = { updateContent: vi.fn() };

		await handleEvent.call(ctx, ev({ type: "thinking_start", contentIndex: 0, partial: {} as never }));
		expect(render(ctx.chatContainer)).not.toContain("Thinking...");
		expect(render(ctx.statusContainer)).toContain("◐ Thinking");
		expect(render(ctx.statusContainer)).not.toContain("Thinking...");

		await handleEvent.call(ctx, ev({ type: "thinking_end", contentIndex: 0, content: "hmm", partial: {} as never }));
		expect(render(ctx.chatContainer)).toContain("Thought for");
		expect(render(ctx.statusContainer)).toContain("Working...");
		ctx.activeStatusIndicator?.dispose();
	});

	test("flips to Thought for Ns when visible text streams without a thinking_end marker", async () => {
		initTheme("dark");
		const ctx = makeCtx();
		ctx.streamingComponent = { updateContent: vi.fn() };

		await handleEvent.call(ctx, ev({ type: "thinking_start", contentIndex: 0, partial: {} as never }));
		expect(render(ctx.statusContainer)).toContain("◐ Thinking");
		expect(render(ctx.statusContainer)).not.toContain("Thinking...");

		await handleEvent.call(
			ctx,
			ev({ type: "text_start", contentIndex: 0, partial: { content: [{ type: "text", text: "" }] } } as never),
		);
		const after = render(ctx.chatContainer);
		expect(after).not.toContain("Thinking...");
		expect(after).toContain("Thought for");
		expect(render(ctx.statusContainer)).toContain("Working...");
		ctx.activeStatusIndicator?.dispose();
	});

	test("visible text closes the active tool section but thinking does not", async () => {
		initTheme("dark");
		const ctx = makeCtx();
		ctx.streamingComponent = { updateContent: vi.fn() };
		ctx.finalizeActiveToolSection = vi.fn();

		await handleEvent.call(ctx, ev({ type: "thinking_start", contentIndex: 0, partial: {} as never }));
		await handleEvent.call(
			ctx,
			ev({ type: "thinking_end", contentIndex: 0, content: "hidden reasoning", partial: {} as never }),
		);
		expect(ctx.finalizeActiveToolSection).not.toHaveBeenCalled();

		await handleEvent.call(
			ctx,
			ev({ type: "text_delta", contentIndex: 0, delta: "Visible commentary", partial: {} as never }),
		);
		expect(ctx.finalizeActiveToolSection).toHaveBeenCalledOnce();
		ctx.activeStatusIndicator?.dispose();
	});
});
