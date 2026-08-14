import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
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
	activeThinkingIndicator: unknown;
	thinkingStartMs: number | undefined;
	outputPad: number;
	hiddenThinkingLabel: string;
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
};

function makeCtx(): Ctx {
	return {
		chatContainer: new Container(),
		hideThinkingBlock: true,
		activeThinkingIndicator: undefined,
		thinkingStartMs: undefined,
		outputPad: 1,
		hiddenThinkingLabel: "Thinking...",
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
	};
}

function ev(e: AssistantMessageEvent): AgentSessionEvent {
	return {
		type: "message_update",
		message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
		assistantMessageEvent: e,
	} as unknown as AgentSessionEvent;
}

const renderChat = (c: Container): string => stripAnsi(c.render(120).join("\n"));

const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent(e: AgentSessionEvent): Promise<void> })
	.handleEvent;

describe("thinking indicator live flip", () => {
	test("flips Thinking... to Thought for before text streams", async () => {
		initTheme("dark");
		const ctx = makeCtx();
		ctx.streamingComponent = { updateContent: vi.fn() };

		await handleEvent.call(ctx, ev({ type: "thinking_start", contentIndex: 0, partial: {} as never }));
		expect(renderChat(ctx.chatContainer)).toContain("Thinking...");

		await handleEvent.call(ctx, ev({ type: "thinking_end", contentIndex: 0, content: "hmm", partial: {} as never }));
		const after = renderChat(ctx.chatContainer);
		expect(after).not.toContain("Thinking...");
		expect(after).toContain("Thought for");
	});

	test("flips to Thought for Ns when visible text streams without a thinking_end marker", async () => {
		initTheme("dark");
		const ctx = makeCtx();
		ctx.streamingComponent = { updateContent: vi.fn() };

		await handleEvent.call(ctx, ev({ type: "thinking_start", contentIndex: 0, partial: {} as never }));
		expect(renderChat(ctx.chatContainer)).toContain("Thinking...");

		await handleEvent.call(
			ctx,
			ev({ type: "text_start", contentIndex: 0, partial: { content: [{ type: "text", text: "" }] } } as never),
		);
		const after = renderChat(ctx.chatContainer);
		expect(after).not.toContain("Thinking...");
		expect(after).toContain("Thought for");
	});
});
