import { describe, expect, test } from "vitest";
import {
	BODY_JOINT,
	BODY_JOINT_WIDTH,
	countDiffChanges,
	DiffRowsComponent,
	parseDiffRows,
} from "../src/modes/interactive/components/diff.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("line-numbered tool diff rows (Phase B)", () => {
	test("parseDiffRows extracts kind, line number, and content", () => {
		const rows = parseDiffRows("+1 foo\n 2 bar\n-3 baz");
		expect(rows).toEqual([
			{ kind: "added", lineNum: "1", content: "foo" },
			{ kind: "context", lineNum: "2", content: "bar" },
			{ kind: "removed", lineNum: "3", content: "baz" },
		]);
	});

	test("countDiffChanges sums added/removed rows", () => {
		expect(countDiffChanges(parseDiffRows("+1 a\n-2 b\n 3 c\n+4 d"))).toEqual({ added: 2, removed: 1 });
	});

	test("DiffRowsComponent pads context rows to full width without a background", () => {
		initTheme("dark");
		const component = new DiffRowsComponent([{ kind: "context", lineNum: "1", content: "plain" }]);
		const [line] = component.render(20);
		expect(stripAnsi(line).length).toBe(20);
		expect(line).not.toContain(theme.getBgAnsi("toolDiffAddedBg"));
		expect(line).not.toContain(theme.getBgAnsi("toolDiffRemovedBg"));
	});

	test("removed rows use a full-width dark-red background with white toolDiffText", () => {
		initTheme("dark");
		const component = new DiffRowsComponent([{ kind: "removed", lineNum: "7", content: "gone" }]);
		const [line] = component.render(16);
		// background fills to the terminal width, starting after the joint indent
		expect(stripAnsi(line).length).toBe(16);
		expect(line).toContain(theme.getBgAnsi("toolDiffRemovedBg"));
		expect(line).not.toContain(theme.getBgAnsi("toolDiffAddedBg"));
		expect(line).toContain(theme.getFgAnsi("toolDiffText"));
	});

	test("added rows use a full-width dark-green background with white toolDiffText", () => {
		initTheme("dark");
		const component = new DiffRowsComponent([{ kind: "added", lineNum: "8", content: "new" }]);
		const [line] = component.render(16);
		expect(stripAnsi(line).length).toBe(16);
		expect(line).toContain(theme.getBgAnsi("toolDiffAddedBg"));
		expect(line).not.toContain(theme.getBgAnsi("toolDiffRemovedBg"));
		expect(line).toContain(theme.getFgAnsi("toolDiffText"));
	});

	test("rows align under the BODY_JOINT indent (has the joint width of spaces before content)", () => {
		initTheme("dark");
		const component = new DiffRowsComponent([{ kind: "context", lineNum: "1", content: "x" }]);
		const [line] = component.render(10);
		const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
		expect(stripped.startsWith(" ".repeat(BODY_JOINT_WIDTH))).toBe(true);
		expect(BODY_JOINT).toBe("└ ");
	});
});
