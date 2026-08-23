/** Pure, UI-independent phrase helpers for the aggregate tool-activity view. */

import type { ToolName } from "./tools/index.ts";

export interface ActivityToolCall {
	toolName: string;
	toolCallId: string;
	/** Parsed tool arguments (e.g. `{ command }`, `{ path }`). */
	args: Record<string, unknown>;
}

function plural(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

const GIT_COMMIT_RE = /(?:^|[;\n]|&&|\|\|)\s*git\s+commit(?:\s|$)/;

export function isGitCommitCommand(command: unknown): boolean {
	return GIT_COMMIT_RE.test(String(command ?? ""));
}

/**
 * Pull a short commit hash out of a `git commit` result blob, preferring the
 * `[branch <hash>]` style and falling back to any hex token.
 */
export function extractCommitHash(result: string | undefined): string | undefined {
	if (!result) return undefined;
	const bracket = /\[\s*[^\]]*?\s([0-9a-f]{7,40})\s*\]/.exec(result);
	if (bracket) return bracket[1];
	const hex = /\b([0-9a-f]{7,40})\b/.exec(result);
	return hex?.[1];
}

/** Split commit tool calls out of a `bash` group; non-commits keep their count. */
export interface ActivityToolResult {
	isError: boolean;
	isPartial: boolean;
	commitHash?: string;
}

function bashSegments(calls: ActivityToolCall[], resultOf: (id: string) => ActivityToolResult | undefined): string[] {
	const commits = calls.filter((c) => isGitCommitCommand(c.args.command));
	if (commits.length === 0) {
		return [`ran ${plural(calls.length, "shell command")}`];
	}
	const segments = commits.map((c) => {
		const result = resultOf(c.toolCallId);
		if (!result || result.isPartial) return "ran 1 shell command";
		if (result.isError) return "commit failed";
		return result.commitHash ? `Committed ${result.commitHash}` : "Committed";
	});
	const other = calls.length - commits.length;
	if (other > 0) {
		segments.push(`ran ${plural(other, "shell command")}`);
	}
	return segments;
}

export interface SummarizeSectionOptions {
	/** Completed or partial tool state used to refine phrases such as git commits. */
	results?: Readonly<Record<string, ActivityToolResult>>;
}

function builtinSegments(
	toolName: string,
	count: number,
	calls: ActivityToolCall[],
	resultOf: (id: string) => ActivityToolResult | undefined,
): string[] | undefined {
	switch (toolName as ToolName) {
		case "read":
			return [`read ${plural(count, "file")}`];
		case "write":
			return [`wrote ${plural(count, "file")}`];
		case "edit":
			return [`edited ${plural(count, "file")}`];
		case "bash":
			return bashSegments(calls, resultOf);
		case "grep":
			return [`searched ${plural(count, "path")}`];
		case "find":
			return [`searched ${plural(count, "path")}`];
		case "ls":
			return [`listed ${plural(count, "path")}`];
		default:
			return undefined;
	}
}

/**
 * Render a section into a comma-joined summary phrase, e.g.
 * `Committed 9be7da6, read 1 file, ran 3 shell commands`. Built-in tools use
 * the built-in phrases; unknown (extension) tools fall back to
 * `ran N <toolName>`.
 */
export function summarizeSection(toolCalls: ActivityToolCall[], options: SummarizeSectionOptions = {}): string {
	if (toolCalls.length === 0) return "";

	const resultOf = (id: string): ActivityToolResult | undefined => options.results?.[id];

	// Group by tool name, preserving first-appearance order.
	const order: string[] = [];
	const grouped = new Map<string, ActivityToolCall[]>();
	for (const call of toolCalls) {
		if (!grouped.has(call.toolName)) {
			grouped.set(call.toolName, []);
			order.push(call.toolName);
		}
		grouped.get(call.toolName)!.push(call);
	}

	const segments: string[] = [];
	for (const name of order) {
		const calls = grouped.get(name)!;
		const built = builtinSegments(name, calls.length, calls, resultOf);
		segments.push(...(built ?? [`ran ${plural(calls.length, name)}`]));
	}
	return segments.join(", ");
}
