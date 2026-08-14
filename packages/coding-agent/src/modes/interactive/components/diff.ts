import type { Component } from "@earendil-works/pi-tui";
import * as Diff from "diff";
import { theme } from "../theme/theme.ts";

/**
 * Parse diff line to extract prefix, line number, and content.
 * Format: "+123 content" or "-123 content" or " 123 content" or "     ..."
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const match = line.match(/^([+-\s])(\s*\d*)\s(.*)$/);
	if (!match) return null;
	return { prefix: match[1], lineNum: match[2], content: match[3] };
}

/**
 * Replace tabs with spaces for consistent rendering.
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/**
 * Compute word-level diff and render with inverse on changed parts.
 * Uses diffWords which groups whitespace with adjacent words for cleaner highlighting.
 * Strips leading whitespace from inverse to avoid highlighting indentation.
 */
function renderIntraLineDiff(oldContent: string, newContent: string): { removedLine: string; addedLine: string } {
	const wordDiff = Diff.diffWords(oldContent, newContent);

	let removedLine = "";
	let addedLine = "";
	let isFirstRemoved = true;
	let isFirstAdded = true;

	for (const part of wordDiff) {
		if (part.removed) {
			let value = part.value;
			// Strip leading whitespace from the first removed part
			if (isFirstRemoved) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				removedLine += leadingWs;
				isFirstRemoved = false;
			}
			if (value) {
				removedLine += theme.inverse(value);
			}
		} else if (part.added) {
			let value = part.value;
			// Strip leading whitespace from the first added part
			if (isFirstAdded) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				addedLine += leadingWs;
				isFirstAdded = false;
			}
			if (value) {
				addedLine += theme.inverse(value);
			}
		} else {
			removedLine += part.value;
			addedLine += part.value;
		}
	}

	return { removedLine, addedLine };
}

export interface RenderDiffOptions {
	/** File path (unused, kept for API compatibility) */
	filePath?: string;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim/gray
 * - Removed lines: red, with inverse on changed tokens
 * - Added lines: green, with inverse on changed tokens
 */
export function renderDiff(diffText: string, _options: RenderDiffOptions = {}): string {
	const lines = diffText.split("\n");
	const result: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const parsed = parseDiffLine(line);

		if (!parsed) {
			result.push(theme.fg("toolDiffContext", line));
			i++;
			continue;
		}

		if (parsed.prefix === "-") {
			// Collect consecutive removed lines
			const removedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "-") break;
				removedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			// Collect consecutive added lines
			const addedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "+") break;
				addedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			// Only do intra-line diffing when there's exactly one removed and one added line
			// (indicating a single line modification). Otherwise, show lines as-is.
			if (removedLines.length === 1 && addedLines.length === 1) {
				const removed = removedLines[0];
				const added = addedLines[0];

				const { removedLine, addedLine } = renderIntraLineDiff(
					replaceTabs(removed.content),
					replaceTabs(added.content),
				);

				result.push(theme.fg("toolDiffRemoved", `-${removed.lineNum} ${removedLine}`));
				result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${addedLine}`));
			} else {
				// Show all removed lines first, then all added lines
				for (const removed of removedLines) {
					result.push(theme.fg("toolDiffRemoved", `-${removed.lineNum} ${replaceTabs(removed.content)}`));
				}
				for (const added of addedLines) {
					result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${replaceTabs(added.content)}`));
				}
			}
		} else if (parsed.prefix === "+") {
			// Standalone added line
			result.push(theme.fg("toolDiffAdded", `+${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		} else {
			// Context line
			result.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		}
	}

	return result.join("\n");
}

// ============================================================================
// Line-numbered diff rows with full-width background highlighting
// ============================================================================

export type DiffRowKind = "context" | "removed" | "added";

export interface DiffRow {
	kind: DiffRowKind;
	/** Right-aligned line number string (already padded by the diff generator). */
	lineNum: string;
	content: string;
}

/**
 * Parse a generated diff string (lines like `+1 foo`, `-1 bar`, ` 1 baz`) into
 * a flat, ordered list of rows. Skip/hint lines (e.g. ` ...`) become context rows.
 */
export function parseDiffRows(diffText: string): DiffRow[] {
	const rows: DiffRow[] = [];
	for (const line of diffText.split("\n")) {
		const parsed = parseDiffLine(line);
		if (!parsed) {
			continue;
		}
		const kind: DiffRowKind = parsed.prefix === "+" ? "added" : parsed.prefix === "-" ? "removed" : "context";
		rows.push({ kind, lineNum: parsed.lineNum.trim(), content: parsed.content });
	}
	return rows;
}

export function countDiffChanges(rows: DiffRow[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const row of rows) {
		if (row.kind === "added") added++;
		else if (row.kind === "removed") removed++;
	}
	return { added, removed };
}

/** Column width of the `└ ` joint prefix (joint + space). */
export const BODY_JOINT = "└ ";
export const BODY_JOINT_WIDTH = 2;

/**
 * Width-aware component that renders each diff row. Context rows use the diff
 * text color; removed/added rows use a full-width dark-red/dark-green
 * background (starting at the line-number column) with white (`toolDiffText`)
 * text. Pads every rendered line to `width`.
 */
export class DiffRowsComponent implements Component {
	private rows: DiffRow[];

	constructor(rows: DiffRow[]) {
		this.rows = rows;
	}

	setRows(rows: DiffRow[]): void {
		this.rows = rows;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const numWidth = Math.max(1, ...this.rows.map((r) => r.lineNum.length));
		const bgRegion = Math.max(1, width - BODY_JOINT_WIDTH);
		const indent = " ".repeat(BODY_JOINT_WIDTH);
		const visibleLen = (s: string): number => s.replace(/\x1b\[[0-9;]*m/g, "").length;

		for (const row of this.rows) {
			const num = row.lineNum.padStart(numWidth, " ");
			const sep = row.kind === "context" ? "  " : row.kind === "removed" ? " -" : " +";
			const body = `${num}${sep}${replaceTabs(row.content)}`;
			if (row.kind === "context") {
				const styled = theme.fg("toolDiffContext", body);
				lines.push(indent + styled + " ".repeat(Math.max(0, width - BODY_JOINT_WIDTH - visibleLen(styled))));
			} else {
				const bg = row.kind === "removed" ? "toolDiffRemovedBg" : "toolDiffAddedBg";
				const styled = theme.fg("toolDiffText", body);
				const pad = Math.max(0, bgRegion - visibleLen(styled));
				lines.push(indent + theme.bg(bg, styled + " ".repeat(pad)));
			}
		}
		return lines;
	}
}
