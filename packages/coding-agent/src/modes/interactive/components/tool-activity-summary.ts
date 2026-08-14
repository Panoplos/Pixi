import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { type ActivityToolCall, summarizeSection } from "../../../core/tool-activity-summary.ts";
import { theme } from "../theme/theme.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

export interface ToolActivitySummaryOptions {
	/** Creates a `ToolExecutionComponent` for one tool call inside this section. */
	createExecution: (toolName: string, toolCallId: string, args: unknown) => ToolExecutionComponent;
	expanded?: boolean;
}

/**
 * A collapsible aggregate of one tool-activity section: an ordered run of tool
 * calls with no visible commentary between them. Collapsed it shows a single
 * summary line (e.g. `Committed 9be7da6, read 1 file, ran 3 shell commands`);
 * expanded it reveals the full per-tool `ToolExecutionComponent`s.
 *
 * It accepts the same per-tool mutations as `ToolExecutionComponent` and routes
 * them to the matching inner execution, so callers can treat it as a drop-in
 * container over a run of tool calls.
 */
export class ToolActivitySummaryComponent extends Container {
	private readonly summaryText: Text;
	private readonly body: Container;
	private readonly createExecution: (toolName: string, toolCallId: string, args: unknown) => ToolExecutionComponent;
	private readonly calls = new Map<string, { toolName: string; args: unknown }>();
	private readonly executions = new Map<string, ToolExecutionComponent>();
	private readonly results = new Map<string, string>();
	private readonly order: string[] = [];
	private expanded: boolean;
	private collapseHint = "";
	private ui: TUI;

	constructor(options: ToolActivitySummaryOptions, ui: TUI) {
		super();
		this.createExecution = options.createExecution;
		this.expanded = options.expanded ?? false;
		this.ui = ui;

		this.summaryText = new Text(theme.fg("toolTitle", ""), 1, 0);
		this.body = new Container();
		this.addChild(this.summaryText);
		this.addChild(this.body);
	}

	override render(width: number): string[] {
		const lines: string[] = [];
		lines.push("");
		lines.push(...this.summaryText.render(width));
		if (this.expanded) {
			lines.push(...this.body.render(width));
		}
		return lines;
	}

	/** Tool call ids in this section, in order. */
	get toolCallIds(): string[] {
		return this.order;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		for (const execution of this.executions.values()) {
			execution.setExpanded(expanded);
		}
		this.refreshSummary();
	}

	/** Hint appended to the collapsed summary line (e.g. "(ctrl + o to expand)"). */
	setCollapseHint(hint: string): void {
		if (hint === this.collapseHint) return;
		this.collapseHint = hint;
		this.refreshSummary();
	}

	get isExpanded(): boolean {
		return this.expanded;
	}

	/** Get or create the inner execution for a tool call, returning it. */
	addOrUpdateTool(toolName: string, toolCallId: string, args: unknown): ToolExecutionComponent {
		let execution = this.executions.get(toolCallId);
		if (!execution) {
			execution = this.createExecution(toolName, toolCallId, args);
			execution.setExpanded(this.expanded);
			this.executions.set(toolCallId, execution);
			this.calls.set(toolCallId, { toolName, args });
			this.order.push(toolCallId);
			this.body.addChild(execution);
		} else {
			// Args stream in incrementally; refresh them on every update so the final
			// (complete) arguments are what get rendered (e.g. the bash command line).
			execution.updateArgs(args);
			this.calls.set(toolCallId, { toolName, args });
		}
		this.refreshSummary();
		return execution;
	}

	markExecutionStarted(toolCallId: string): void {
		this.executions.get(toolCallId)?.markExecutionStarted();
		this.refreshSummary();
	}

	setArgsComplete(toolCallId: string): void {
		this.executions.get(toolCallId)?.setArgsComplete();
		this.refreshSummary();
	}

	updateResult(
		toolCallId: string,
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			isError: boolean;
			details?: unknown;
		},
		isPartial = false,
	): void {
		this.executions.get(toolCallId)?.updateResult(result, isPartial);
		const text = result.content
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text as string)
			.join("\n");
		this.results.set(toolCallId, text);
		this.refreshSummary();
	}

	private refreshSummary(): void {
		const calls: ActivityToolCall[] = [];
		const results: Record<string, string> = {};
		for (const id of this.order) {
			const call = this.calls.get(id);
			if (!call) continue;
			calls.push({ toolName: call.toolName, toolCallId: id, args: (call.args ?? {}) as Record<string, unknown> });
			const result = this.results.get(id);
			if (result !== undefined) {
				results[id] = result;
			}
		}
		const phrase = summarizeSection(calls, { results });
		const rendered =
			phrase && !this.expanded && this.collapseHint
				? `${this.boldCounts(phrase)} (${theme.fg("muted", `${theme.bold("ctrl+o")} to expand`)})`
				: this.boldCounts(phrase ?? "");
		this.summaryText.setText(theme.fg("toolTitle", rendered));
		this.ui.requestRender();
	}

	/** Bold integer counts in an aggregate summary phrase (e.g. `read 3 files`). */
	private boldCounts(phrase: string): string {
		return phrase.replace(/\b\d+\b/g, (m) => theme.bold(m));
	}
}
