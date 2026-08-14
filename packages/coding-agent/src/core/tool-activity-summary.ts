/**
 * Pure, UI-independent helpers for the aggregate tool-activity view.
 *
 * An assistant turn is flattened into an ordered stream of `text` and
 * `toolCall` units (in message order). Consecutive `toolCall` units form one
 * "section"; commentary `text` never finalizes a section (it shares it), so a
 * narrated run of tool calls collapses into a single summary. Sections are
 * derived only, never stored, so the live stream and a rebuilt session always
 * produce the same grouping.
 */

import type { ToolName } from "./tools/index.ts";

export interface ActivityToolCall {
	toolName: string;
	toolCallId: string;
	/** Parsed tool arguments (e.g. `{ command }`, `{ path }`). */
	args: Record<string, unknown>;
}

export type ActivityUnit = { kind: "text"; text: string } | { kind: "toolCall"; toolCall: ActivityToolCall };

export interface ActivitySection {
	/** Tool calls in this section, in first-appearance order. */
	toolCalls: ActivityToolCall[];
}

/** Tools that must not be folded into an aggregate group (they show standalone). */
const STANDALONE_TOOLS = new Set(["write", "edit"]);

/** Group the units of one turn into tool-activity sections. */
export function splitActivitySections(units: ActivityUnit[]): ActivitySection[] {
	const sections: ActivitySection[] = [];
	let current: ActivityToolCall[] = [];
	for (const unit of units) {
		if (unit.kind !== "toolCall") continue; // commentary never splits; it shares the section.
		if (STANDALONE_TOOLS.has(unit.toolCall.toolName)) {
			// write/edit are never folded into a group: close the open section and
			// emit each one as its own standalone section.
			if (current.length > 0) {
				sections.push({ toolCalls: current });
				current = [];
			}
			sections.push({ toolCalls: [unit.toolCall] });
		} else {
			current.push(unit.toolCall);
		}
	}
	if (current.length > 0) {
		sections.push({ toolCalls: current });
	}
	return sections;
}

function plural(count: number, singular: string): string {
	return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

const GIT_COMMIT_RE = /git\s+commit/;

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
function bashSegments(calls: ActivityToolCall[], resultOf: (id: string) => string | undefined): string[] {
	const commits = calls.filter((c) => GIT_COMMIT_RE.test(String(c.args.command ?? "")));
	if (commits.length === 0) {
		return [`ran ${plural(calls.length, "shell command")}`];
	}
	const segments = commits.map((c) => {
		const hash = extractCommitHash(resultOf(c.toolCallId));
		return hash ? `Committed ${hash}` : "Committed";
	});
	const other = calls.length - commits.length;
	if (other > 0) {
		segments.push(`ran ${plural(other, "shell command")}`);
	}
	return segments;
}

/**
 * Custom per-tool phrase generator. Return a sentence fragment for `count`
 * calls of `toolName` (e.g. via tool args/result) or `undefined` to fall back
 * to the built-in default phrase. Used later to let extensions customize their
 * own summary text.
 */
export type ToolPhraseOverride = (
	toolName: string,
	count: number,
	calls: ActivityToolCall[],
	resultOf: (id: string) => string | undefined,
) => string | undefined;

export interface SummarizeSectionOptions {
	/** toolCallId -> raw text result, used to refine phrases (e.g. git commit hash). */
	results?: Readonly<Record<string, string>>;
	/** Optional custom per-tool phrase generator. */
	overridePhrase?: ToolPhraseOverride;
}

function builtinSegments(
	toolName: string,
	count: number,
	calls: ActivityToolCall[],
	resultOf: (id: string) => string | undefined,
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
 * `ran N <toolName>`; `overridePhrase` wins for its matching tool name.
 */
export function summarizeSection(toolCalls: ActivityToolCall[], options: SummarizeSectionOptions = {}): string {
	if (toolCalls.length === 0) return "";

	const resultOf = (id: string): string | undefined => options.results?.[id];

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
		const override = options.overridePhrase?.(name, calls.length, calls, resultOf);
		if (override !== undefined) {
			segments.push(override);
		} else {
			const built = builtinSegments(name, calls.length, calls, resultOf);
			segments.push(...(built ?? [`ran ${plural(calls.length, name)}`]));
		}
	}
	return segments.join(", ");
}
