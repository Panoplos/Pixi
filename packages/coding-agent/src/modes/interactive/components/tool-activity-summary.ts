import { Container, Text, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import {
	type ActivityToolCall,
	type ActivityToolResult,
	extractCommitHash,
	isGitCommitCommand,
	summarizeSection,
} from "../../../core/tool-activity-summary.ts";
import { formatToolDuration, getTextOutput, highlightShellCommand, str } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";
import { BODY_JOINT, BODY_JOINT_WIDTH } from "./diff.ts";
import { keyHint } from "./keybinding-hints.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";
import { truncateToVisualLines } from "./visual-truncate.ts";

export interface ToolActivitySummaryOptions {
	/** Creates a `ToolExecutionComponent` for one tool call inside this section. */
	createExecution: (toolName: string, toolCallId: string, args: unknown) => ToolExecutionComponent;
	expanded?: boolean;
}

interface SectionCall {
	toolName: string;
	args: unknown;
	/** Latest shell output, kept to render the live preview while the command runs. */
	output?: string;
	isPartial?: boolean;
	startedAt?: number;
	endedAt?: number;
	/** Recorded final runtime of a tool call, when the result carries one. */
	durationMs?: number;
}

function isShellTool(name: string): boolean {
	return name === "bash" || name === "powershell";
}

/** Runtime of one shell call: its recorded duration, else the live or completed span. */
function shellDurationMs(call: SectionCall): number | undefined {
	if (call.durationMs !== undefined) return call.durationMs;
	if (call.startedAt === undefined) return undefined;
	return Math.max(0, (call.endedAt ?? Date.now()) - call.startedAt);
}

/**
 * One shell command: a title, the command line, and the tail of its output. A running command shows its purpose;
 * a finished one shows the aggregate phrase for its call, such as `ran 1 shell command`.
 */
function renderShellDetail(call: SectionCall, width: number, finishedTitle?: string): string[] {
	const args = (call.args ?? {}) as Record<string, unknown>;
	const titleText =
		call.isPartial === true
			? (str(args.summary) || "Running shell command").replace(/\s+/g, " ").trim()
			: (finishedTitle ?? "ran 1 shell command");
	const elapsed = shellDurationMs(call);
	let title = theme.italic(theme.fg("toolTitle", titleText));
	if (elapsed !== undefined) title += theme.italic(theme.fg("muted", ` · ${formatToolDuration(elapsed)}`));
	const lines = [truncateToWidth(title, width, "...", true), ""];

	const prompt = call.toolName === "powershell" ? "PS>" : "$";
	const command = str(args.command) ?? "";
	const commandText = command ? command.replace(/\n/g, " ").trim() : "...";
	const commandDisplay = command ? highlightShellCommand(commandText, theme) : theme.fg("toolOutput", "...");
	lines.push(
		truncateToWidth(
			`${theme.fg("muted", BODY_JOINT)}${theme.fg("toolTitle", theme.bold(`${prompt} `))}${theme.bold(commandDisplay)}`,
			width,
			"...",
			true,
		),
	);

	const output = call.output?.trimEnd();
	if (output) {
		const indentWidth = Math.min(BODY_JOINT_WIDTH + prompt.length + 1, Math.max(0, width - 1));
		const regionWidth = Math.max(1, width - indentWidth);
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");
		const preview = truncateToVisualLines(styledOutput, 2, regionWidth, 0, "end");
		const indent = " ".repeat(indentWidth);
		for (const line of preview.visualLines) lines.push(indent + line);
		if (preview.skippedCount > 0) {
			const total = preview.skippedCount + preview.visualLines.length;
			const hint = `${theme.fg("muted", `... (${preview.skippedCount} more lines, ${total} total,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
			lines.push(indent + truncateToWidth(hint, regionWidth, "...", true));
		}
	}

	return lines;
}

/**
 * A collapsible aggregate of one tool-activity section: an ordered run of tool
 * calls within one assistant phase (broken only by user turns and standalone
 * write/edit blocks). Thinking and commentary between tool calls stay inside
 * the section. Collapsed it shows a single summary line (e.g.
 * `Committed 9be7da6, read 1 file, ran 3 shell commands`); expanded it reveals
 * the full per-tool `ToolExecutionComponent`s.
 *
 * It accepts the same per-tool mutations as `ToolExecutionComponent` and routes
 * them to the matching inner execution, so callers can treat it as a drop-in
 * container over a run of tool calls.
 */
export class ToolActivitySummaryComponent extends Container {
	private readonly summaryText: Text;
	private readonly body: Container;
	private readonly createExecution: (toolName: string, toolCallId: string, args: unknown) => ToolExecutionComponent;
	private readonly calls = new Map<string, SectionCall>();
	private readonly executions = new Map<string, ToolExecutionComponent>();
	private readonly results = new Map<string, ActivityToolResult>();
	private readonly order: string[] = [];
	private expanded: boolean;
	private collapseHint = "";
	private ui: TUI;
	private runningTimer: ReturnType<typeof setInterval> | undefined;

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
		if (!this.expanded) {
			const onlyShell = this.singleShellCall();
			if (onlyShell !== undefined && (onlyShell.isPartial === true || onlyShell.output !== undefined)) {
				const id = this.order[0];
				const finished = id === undefined || onlyShell.isPartial === true ? undefined : this.phraseFor(id);
				return ["", ...renderShellDetail(onlyShell, width, finished)];
			}
			const runningShells = this.getRunningShellCalls();
			if (runningShells.length > 0) {
				const lines: string[] = [""];
				for (const call of runningShells) {
					lines.push(...renderShellDetail(call, width));
				}
				return lines;
			}
		}

		const lines: string[] = [];
		lines.push("");
		lines.push(...this.summaryText.render(width));
		if (this.expanded) {
			lines.push(...this.body.render(width));
		}
		return lines;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		for (const execution of this.executions.values()) {
			execution.setExpanded(expanded);
		}
		this.refreshSummary();
	}

	setShowCollapseHint(show: boolean): void {
		const hint = show ? keyHint("app.tools.expand", "to expand") : "";
		if (hint === this.collapseHint) return;
		this.collapseHint = hint;
		this.refreshSummary();
	}

	get isExpanded(): boolean {
		return this.expanded;
	}

	/** Number of tool calls in this section, used by callers that space multi-call blocks differently. */
	get callCount(): number {
		return this.order.length;
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
			this.calls.set(toolCallId, { ...this.calls.get(toolCallId), toolName, args });
		}
		this.refreshSummary();
		return execution;
	}

	updateResult(
		toolCallId: string,
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			isError: boolean;
			details?: unknown;
			durationMs?: number;
		},
		isPartial = false,
	): void {
		this.executions.get(toolCallId)?.updateResult(result, isPartial);
		const call = this.calls.get(toolCallId);
		if (call && isShellTool(call.toolName)) {
			call.output = getTextOutput({ content: result.content }, false);
			call.isPartial = isPartial;
			if (isPartial) {
				call.startedAt ??= Date.now();
			} else {
				call.endedAt ??= Date.now();
				if (result.durationMs !== undefined) call.durationMs = result.durationMs;
			}
		}
		if (
			call?.toolName === "bash" &&
			isGitCommitCommand((call.args as Record<string, unknown> | undefined)?.command)
		) {
			const text = result.content
				.filter((c): c is typeof c & { text: string } => c.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n");
			this.results.set(toolCallId, {
				isError: result.isError,
				isPartial,
				commitHash: isPartial || result.isError ? undefined : extractCommitHash(text),
			});
		}
		this.refreshSummary();
	}

	private getRunningShellCalls(): SectionCall[] {
		const calls: SectionCall[] = [];
		for (const id of this.order) {
			const call = this.calls.get(id);
			if (call?.isPartial === true && isShellTool(call.toolName)) calls.push(call);
		}
		return calls;
	}

	/** The one shell call of a section that has nothing else; undefined for mixed or multi-call sections. */
	private singleShellCall(): SectionCall | undefined {
		if (this.order.length !== 1) return undefined;
		const call = this.calls.get(this.order[0]!);
		return call !== undefined && isShellTool(call.toolName) ? call : undefined;
	}

	/** The aggregate phrase for one call, as if it were its own section. */
	private phraseFor(id: string): string {
		const call = this.calls.get(id);
		if (call === undefined) return "";
		const result = this.results.get(id);
		return summarizeSection(
			[{ toolName: call.toolName, toolCallId: id, args: (call.args ?? {}) as Record<string, unknown> }],
			{ results: result === undefined ? {} : { [id]: result } },
		);
	}

	/** Cumulative runtime of every shell call, for the aggregate summary of a multi-call section. */
	private shellTotalDuration(): string | undefined {
		let total = 0;
		let seen = false;
		for (const id of this.order) {
			const call = this.calls.get(id);
			if (call === undefined || !isShellTool(call.toolName)) continue;
			const duration = shellDurationMs(call);
			if (duration === undefined) continue;
			total += duration;
			seen = true;
		}
		return seen ? formatToolDuration(total) : undefined;
	}

	/** Redraw the elapsed time once a second for as long as a shell command is running. */
	private syncRunningTimer(): void {
		if (this.getRunningShellCalls().length > 0) {
			this.runningTimer ??= setInterval(() => {
				this.invalidate();
				this.ui.requestRender();
			}, 1000);
		} else if (this.runningTimer) {
			clearInterval(this.runningTimer);
			this.runningTimer = undefined;
		}
	}

	private refreshSummary(): void {
		const calls: ActivityToolCall[] = [];
		const results: Record<string, ActivityToolResult> = {};
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
		const duration = this.shellTotalDuration();
		const counts = this.boldCounts(phrase);
		const withDuration = duration === undefined ? counts : `${counts} · ${duration}`;
		const rendered =
			phrase && !this.expanded && this.collapseHint ? `${withDuration} (${this.collapseHint})` : withDuration;
		this.summaryText.setText(
			theme.fg("toolTitle", this.singleShellCall() === undefined ? rendered : theme.italic(rendered)),
		);
		this.syncRunningTimer();
		this.ui.requestRender();
	}

	/** Bold integer counts and commit hashes in an aggregate summary phrase (e.g. `read 3 files`, `Committed 9be7da6`). */
	private boldCounts(phrase: string): string {
		return phrase.replace(/\b\d+\b|\b[0-9a-f]{7,40}\b/g, (m) => theme.bold(m));
	}
}
