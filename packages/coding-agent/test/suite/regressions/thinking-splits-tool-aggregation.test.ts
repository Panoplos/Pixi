import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import { ToolActivitySummaryComponent } from "../../../src/modes/interactive/components/tool-activity-summary.ts";
import type { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";

// Regression test: thinking between tool rounds must split the aggregate
// section, so tool calls before and after a thinking block are summarized
// separately instead of accumulating into one total.

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

type RenderSessionItems = (
	this: RenderSessionContextThis,
	items: AgentMessage[],
	options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type RenderSessionContextThis = {
	pendingTools: Map<string, ToolExecutionComponent>;
	hideThinkingBlock: boolean;
	outputPad: number;
	thinkingLabel: string;
	thinkingStreamActive: boolean;
	chatContainer: Container;
	sectionByToolCall: Map<string, ToolActivitySummaryComponent>;
	standaloneToolCall: Map<string, ToolExecutionComponent>;
	activeToolSection: ToolActivitySummaryComponent | undefined;
	footer: { invalidate(): void };
	ui: TUI;
	settingsManager: {
		getShowImages(): boolean;
		getImageWidthCells(): number;
		getShowCacheMissNotices(): boolean;
		getCodeBlockIndent(): number;
	};
	sessionManager: { getCwd(): string; getEntries(): SessionEntry[] };
	session: { retryAttempt: number; modelRegistry: { find(provider: string, modelId: string): undefined } };
	toolOutputExpanded: boolean;
	isInitialized: boolean;
	updateEditorBorderColor(): void;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	getMarkdownTransformers(): unknown[];
	getRegisteredToolDefinition(toolName: string): undefined;
	maybeShowAssistantDiagnostics(message: AssistantMessage): void;
	addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
	finalizeActiveToolSection(): void;
	getOrCreateActiveToolSection(): ToolActivitySummaryComponent;
	updateExpandHints(): void;
	getAggregateSections(): ToolActivitySummaryComponent[];
	isStandaloneTool(name: string): boolean;
	createToolExecution(name: string, id: string, args: unknown): ToolExecutionComponent;
	renderSessionItems: RenderSessionItems;
};

type RenderSessionEntries = (
	this: RenderSessionContextThis,
	entries: SessionEntry[],
	options?: { updateFooter?: boolean; populateHistory?: boolean },
) => void;

type HandleEvent = (this: RenderSessionContextThis, event: AgentSessionEvent) => Promise<void>;

function createFakeInteractiveModeThis(): RenderSessionContextThis {
	const chatContainer = new Container();
	return {
		pendingTools: new Map<string, ToolExecutionComponent>(),
		chatContainer,
		sectionByToolCall: new Map<string, ToolActivitySummaryComponent>(),
		standaloneToolCall: new Map<string, ToolExecutionComponent>(),
		activeToolSection: undefined,
		footer: { invalidate: vi.fn() },
		ui: { requestRender: vi.fn() } as unknown as TUI,
		settingsManager: {
			getShowImages: () => false,
			getImageWidthCells: () => 60,
			getShowCacheMissNotices: () => false,
			getCodeBlockIndent: () => 2,
		},
		hideThinkingBlock: false,
		outputPad: 1,
		thinkingLabel: "Thinking",
		thinkingStreamActive: false,
		getMarkdownThemeWithSettings: (
			InteractiveMode.prototype as unknown as { getMarkdownThemeWithSettings(): MarkdownTheme }
		).getMarkdownThemeWithSettings,
		getMarkdownTransformers: () => [],
		sessionManager: { getCwd: () => process.cwd(), getEntries: () => [] },
		session: { retryAttempt: 0, modelRegistry: { find: () => undefined } },
		toolOutputExpanded: false,
		isInitialized: true,
		updateEditorBorderColor: vi.fn(),
		getRegisteredToolDefinition: (_toolName: string) => undefined,
		finalizeActiveToolSection: (InteractiveMode.prototype as unknown as { finalizeActiveToolSection(): void })
			.finalizeActiveToolSection,
		getOrCreateActiveToolSection: (
			InteractiveMode.prototype as unknown as {
				getOrCreateActiveToolSection(): ToolActivitySummaryComponent;
			}
		).getOrCreateActiveToolSection,
		updateExpandHints: (InteractiveMode.prototype as unknown as { updateExpandHints(): void }).updateExpandHints,
		getAggregateSections: (
			InteractiveMode.prototype as unknown as {
				getAggregateSections(): ToolActivitySummaryComponent[];
			}
		).getAggregateSections,
		isStandaloneTool: (InteractiveMode.prototype as unknown as { isStandaloneTool(name: string): boolean })
			.isStandaloneTool,
		createToolExecution: (
			InteractiveMode.prototype as unknown as {
				createToolExecution(name: string, id: string, args: unknown): ToolExecutionComponent;
			}
		).createToolExecution,
		maybeShowAssistantDiagnostics: vi.fn(),
		renderSessionItems: (InteractiveMode.prototype as unknown as { renderSessionItems: RenderSessionItems })
			.renderSessionItems,
		addMessageToChat(message: AgentMessage) {
			chatContainer.addChild(new Text(message.role, 0, 0));
		},
	};
}

let callCounter = 0;

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: EMPTY_USAGE,
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function createThinkingThenToolCallMessage(toolCallId: string): AssistantMessage {
	return createAssistantMessage([
		{ type: "thinking", thinking: `reasoning for ${toolCallId}` },
		{
			type: "toolCall",
			id: toolCallId,
			name: "bash",
			arguments: { command: "echo hi" },
		},
	]);
}

function createToolResultMessage(toolCallId: string, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function createSessionEntries(messages: AgentMessage[]): SessionEntry[] {
	let parentId: string | null = null;
	return messages.map((message, index) => {
		const entry: SessionEntry = {
			type: "message",
			id: `entry-${index}`,
			parentId,
			timestamp: new Date().toISOString(),
			message,
		};
		parentId = entry.id;
		return entry;
	});
}

function aggregateSummaries(container: Container): string[] {
	const summaries: string[] = [];
	for (const child of container.children) {
		if (child instanceof ToolActivitySummaryComponent) {
			child.setExpanded(false);
			summaries.push(stripAnsi(child.render(120).join("\n")));
		}
	}
	return summaries;
}

describe("tool aggregation splits on thinking", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("replay: two thinking-then-tool rounds render two separate sections", () => {
		const fakeThis = createFakeInteractiveModeThis();
		const renderSessionEntries = (
			InteractiveMode.prototype as unknown as { renderSessionEntries: RenderSessionEntries }
		).renderSessionEntries;

		renderSessionEntries.call(
			fakeThis,
			createSessionEntries([
				createThinkingThenToolCallMessage(`call-${++callCounter}`),
				createToolResultMessage(`call-${callCounter}`, "one"),
				createThinkingThenToolCallMessage(`call-${++callCounter}`),
				createToolResultMessage(`call-${callCounter}`, "two"),
			]),
		);

		const summaries = aggregateSummaries(fakeThis.chatContainer);
		expect(summaries.length).toBe(2);
		for (const summary of summaries) {
			expect(summary).toContain("ran 1 shell command");
			expect(summary).not.toContain("ran 2 shell commands");
		}
	});

	test("live: thinking_start between tool rounds finalizes the active section", async () => {
		const fakeThis = createFakeInteractiveModeThis();
		const handleEvent = (InteractiveMode.prototype as unknown as { handleEvent: HandleEvent }).handleEvent;

		const id1 = `live-${++callCounter}`;
		const id2 = `live-${++callCounter}`;

		// First round: assistant message with thinking + tool call, then its result.
		await handleEvent.call(fakeThis, {
			type: "message_start",
			message: createAssistantMessage([]),
		} as AgentSessionEvent);
		await handleEvent.call(fakeThis, {
			type: "message_update",
			message: createAssistantMessage([
				{ type: "thinking", thinking: "first" },
				{ type: "toolCall", id: id1, name: "bash", arguments: { command: "echo one" } },
			]),
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 1,
				id: id1,
				name: "bash",
				partial: createAssistantMessage([]),
			},
		} as unknown as AgentSessionEvent);
		await handleEvent.call(fakeThis, {
			type: "tool_execution_end",
			toolCallId: id1,
			toolName: "bash",
			result: { content: [{ type: "text", text: "one" }], details: undefined },
			isError: false,
		} as AgentSessionEvent);

		// Second round starts: thinking begins again before any tool call.
		await handleEvent.call(fakeThis, {
			type: "message_start",
			message: createAssistantMessage([]),
		} as AgentSessionEvent);
		await handleEvent.call(fakeThis, {
			type: "message_update",
			message: createAssistantMessage([{ type: "thinking", thinking: "second" }]),
			assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: createAssistantMessage([]) },
		} as unknown as AgentSessionEvent);

		// The thinking_start must have finalized the first section; the new tool
		// call must open a fresh one.
		await handleEvent.call(fakeThis, {
			type: "message_update",
			message: createAssistantMessage([
				{ type: "thinking", thinking: "second" },
				{ type: "toolCall", id: id2, name: "bash", arguments: { command: "echo two" } },
			]),
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 1,
				id: id2,
				name: "bash",
				partial: createAssistantMessage([]),
			},
		} as unknown as AgentSessionEvent);

		const sections = fakeThis.getAggregateSections();
		expect(sections.length).toBe(2);
		expect(sections[0]).not.toBe(sections[1]);
	});
});
