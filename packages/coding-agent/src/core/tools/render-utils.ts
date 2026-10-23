import * as os from "node:os";
import { pathToFileURL } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { getCapabilities, getImageDimensions, hyperlink, imageFallback } from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../utils/ansi.ts";
import { resolvePath } from "../../utils/paths.ts";
import { sanitizeBinaryOutput } from "../../utils/shell.ts";
import type { ToolRenderContext } from "../extensions/types.ts";

export function shortenPath(path: unknown): string {
	if (typeof path !== "string") return "";
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export function linkPath(styledText: string, rawPath: string, cwd: string): string {
	if (!getCapabilities().hyperlinks) return styledText;
	const absolutePath = resolvePath(rawPath, cwd);
	return hyperlink(styledText, pathToFileURL(absolutePath).href);
}

export function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null;
}

function parseLineNumber(value: unknown): number | undefined {
	if (typeof value === "string" && value.trim() !== "") value = Number(value);
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Format finite numbers or numeric strings as a read line range, omitting malformed ranges. */
export function formatReadLineRange(offset: unknown, limit: unknown): string {
	// Strict schemas represent omitted optional arguments as null.
	if (offset == null && limit == null) return "";
	const start = offset == null ? 1 : parseLineNumber(offset);
	if (start === undefined) return "";
	if (limit == null) return `:${start}`;
	const count = parseLineNumber(limit);
	if (count === undefined) return "";
	const end = start + count - 1;
	return `:${start}${end ? `-${end}` : ""}`;
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

export function getTextOutput(
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } | undefined,
	showImages: boolean,
): string {
	if (!result) return "";

	const textBlocks = result.content.filter((c) => c.type === "text");
	const imageBlocks = result.content.filter((c) => c.type === "image");

	let output = textBlocks.map((c) => sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "")).join("\n");

	const caps = getCapabilities();
	if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
		const imageIndicators = imageBlocks
			.map((img) => {
				const mimeType = img.mimeType ?? "image/unknown";
				const dims =
					img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
				return imageFallback(mimeType, dims);
			})
			.join("\n");
		output = output ? `${output}\n${imageIndicators}` : imageIndicators;
	}

	return output;
}

export type ToolRenderResultLike<TDetails> = {
	content: (TextContent | ImageContent)[];
	details: TDetails;
};

const COLLAPSED_ARGS_CHARS = 100;

/**
 * Generic tool call header: the title followed by the arguments. Collapsed, they are `key=value`
 * pairs on the title line, cut to {@link COLLAPSED_ARGS_CHARS}. Expanded, each is a `key: value`
 * line below the title, with strings shown raw and continuation lines indented.
 */
export function formatToolCallWithArgs(title: string, args: unknown, theme: Theme, expanded: boolean): string {
	const header = theme.fg("toolTitle", theme.bold(title));
	if (args == null) return header;
	const entries =
		typeof args === "object" && !Array.isArray(args)
			? Object.entries(args)
			: ([["args", args]] as [string, unknown][]);
	if (entries.length === 0) return header;
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${replaceTabs(text).replace(/\r/g, "").split("\n").join("\n    ")}`;
		});
		return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	const preview = pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return `${header} ${theme.fg("muted", preview)}`;
}

/** Longest first, so `2>&1` wins over `2>` and `&`. */
const SHELL_OPERATORS = [
	"<<<",
	"2>&1",
	"&>>",
	"2>>",
	"&>",
	"2>",
	">>",
	"<<",
	"&&",
	"||",
	"|&",
	">&",
	"<&",
	">|",
	";;",
	"|",
	";",
	"&",
	">",
	"<",
] as const;

/** Operators after which a new simple command starts. Redirections are not here: their target is not a command. */
const SHELL_COMMAND_SEPARATORS = new Set(["&&", "||", "|&", "|", ";;", ";", "&"]);

/**
 * Color a shell command for display without a full syntax rainbow: plain text keeps the tool title
 * color, command names use the function color, and operators, redirections, and quoted strings use
 * syntax colors. It is a display highlighter, not a shell parser.
 */
export function highlightShellCommand(command: string, theme: Theme): string {
	let out = "";
	let index = 0;
	let expectCommand = true;
	const plain = (text: string): string => theme.fg("toolTitle", text);
	const operatorAt = (at: number): string | undefined =>
		SHELL_OPERATORS.find((candidate) => command.startsWith(candidate, at));

	while (index < command.length) {
		const char = command[index];

		// A `#` at a word boundary starts a comment.
		if (char === "#" && (index === 0 || /\s/.test(command[index - 1]!))) {
			const newline = command.indexOf("\n", index);
			const end = newline === -1 ? command.length : newline;
			out += theme.fg("syntaxComment", command.slice(index, end));
			index = end;
			expectCommand = true;
			continue;
		}

		if (/\s/.test(char)) {
			let end = index + 1;
			while (end < command.length && /\s/.test(command[end])) end++;
			const whitespace = command.slice(index, end);
			out += plain(whitespace);
			if (whitespace.includes("\n")) expectCommand = true;
			index = end;
			continue;
		}

		if (char === "\\") {
			const end = Math.min(index + 2, command.length);
			const escaped = command.slice(index, end);
			out += expectCommand ? theme.fg("syntaxFunction", escaped) : plain(escaped);
			// A line continuation does not end the command word.
			if (command[index + 1] !== "\n") expectCommand = false;
			index = end;
			continue;
		}

		if (char === '"' || char === "'") {
			const quote = char;
			let end = index + 1;
			while (end < command.length) {
				if (quote === '"' && command[end] === "\\") {
					end += 2;
					continue;
				}
				if (command[end] === quote) {
					end++;
					break;
				}
				end++;
			}
			out += theme.fg("syntaxString", command.slice(index, end));
			// A quoted command name ends the command word, but a quoted value after `NAME=` does not.
			if (expectCommand && command[index - 1] !== "=") expectCommand = false;
			index = end;
			continue;
		}

		const operator = operatorAt(index);
		if (operator !== undefined) {
			out += theme.fg("syntaxKeyword", operator);
			expectCommand = SHELL_COMMAND_SEPARATORS.has(operator);
			index += operator.length;
			continue;
		}

		let end = index;
		while (end < command.length) {
			const next = command[end];
			if (/\s/.test(next) || next === '"' || next === "'") break;
			if (next === "\\") {
				end += 2;
				continue;
			}
			if (operatorAt(end) !== undefined) break;
			end++;
		}
		const word = command.slice(index, end);
		const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
		if (expectCommand && !assignment) {
			out += theme.fg("syntaxFunction", word);
			expectCommand = false;
		} else {
			out += plain(word);
		}
		index = end;
	}

	return out;
}

/** Duration as `4.2s` below a minute, then `1m 30s` and `2h 3m 4s`. */
export function formatToolDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/** Renderer state of {@link startToolTimer} and {@link toolTimerText}, kept in `ToolRenderContext.state`. */
interface ToolTimerState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

/** Start the row's clock once execution starts. Call from `renderCall`. */
export function startToolTimer(context: ToolRenderContext<ToolTimerState>): void {
	const state = context.state;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}
}

/**
 * The row's timing line, from `renderResult`: `Elapsed 4.2s` while the result is partial, redrawn
 * every second, and `Took 4.2s` once it is final. Undefined when the row has no start time and no
 * recorded duration.
 */
export function toolTimerText(context: ToolRenderContext<ToolTimerState>, isPartial: boolean): string | undefined {
	const state = context.state;
	if (state.startedAt !== undefined && isPartial && !state.interval) {
		state.interval = setInterval(() => context.invalidate(), 1000);
	}
	if (!isPartial || context.isError) {
		state.endedAt ??= Date.now();
		if (state.interval) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}
	// A final result's recorded duration wins: it is monotonic and survives reloads. The renderer's own clock is the
	// fallback for live progress and for results stored without one.
	if (!isPartial && context.durationMs !== undefined) return `Took ${formatToolDuration(context.durationMs)}`;
	if (state.startedAt === undefined) return undefined;
	const endTime = state.endedAt ?? Date.now();
	return `${isPartial ? "Elapsed" : "Took"} ${formatToolDuration(endTime - state.startedAt)}`;
}

export function invalidArgText(theme: Theme): string {
	return theme.fg("error", "[invalid arg]");
}

export function renderToolPath(
	rawPath: string | null,
	theme: Theme,
	cwd: string,
	options?: { emptyFallback?: string },
): string {
	if (rawPath === null) return invalidArgText(theme);
	const value = rawPath || options?.emptyFallback;
	if (!value) return theme.fg("toolOutput", "...");
	return linkPath(theme.fg("accent", shortenPath(value)), value, cwd);
}
