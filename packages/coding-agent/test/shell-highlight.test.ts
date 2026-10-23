import chalk from "chalk";
import { beforeAll, describe, expect, test } from "vitest";
import { highlightShellCommand } from "../src/core/tools/render-utils.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => {
	chalk.level = 1;
	initTheme("dark");
});

describe("highlightShellCommand", () => {
	test("keeps plain text in the tool title color and colors quoted strings", () => {
		const styled = highlightShellCommand(`rg "a > b"`, theme);
		expect(styled).toContain(theme.fg("syntaxFunction", "rg"));
		expect(styled).toContain(theme.fg("syntaxString", `"a > b"`));
		// An operator inside a quoted string is part of the string.
		expect(styled).not.toContain(theme.fg("syntaxKeyword", ">"));
	});

	test("colors command names, shell operators, and redirections", () => {
		const styled = highlightShellCommand(`rg "a" && echo 'x' > out.txt`, theme);
		expect(styled).toContain(theme.fg("syntaxFunction", "rg"));
		expect(styled).toContain(theme.fg("syntaxFunction", "echo"));
		expect(styled).toContain(theme.fg("syntaxString", `"a"`));
		expect(styled).toContain(theme.fg("syntaxString", `'x'`));
		expect(styled).toContain(theme.fg("syntaxKeyword", "&&"));
		expect(styled).toContain(theme.fg("syntaxKeyword", ">"));
		expect(stripAnsi(styled)).toBe(`rg "a" && echo 'x' > out.txt`);
	});

	test("colors a redirection with its file descriptor as one operator", () => {
		const styled = highlightShellCommand("make 2>&1 | tee log", theme);
		expect(styled).toContain(theme.fg("syntaxKeyword", "2>&1"));
		expect(styled).toContain(theme.fg("syntaxKeyword", "|"));
		expect(styled).toContain(theme.fg("syntaxFunction", "make"));
		expect(styled).toContain(theme.fg("syntaxFunction", "tee"));
		expect(styled).not.toContain(theme.fg("syntaxKeyword", "2>"));
	});

	test("colors commands after separators, not assignment values", () => {
		const chained = highlightShellCommand("cd /tmp && git commit -m x", theme);
		expect(chained).toContain(theme.fg("syntaxFunction", "cd"));
		expect(chained).toContain(theme.fg("syntaxFunction", "git"));

		const assigned = highlightShellCommand(`FOO="bar" run`, theme);
		expect(assigned).toContain(theme.fg("syntaxString", `"bar"`));
		expect(assigned).toContain(theme.fg("syntaxFunction", "run"));
	});

	test("colors comments separately from commands", () => {
		const styled = highlightShellCommand("# note\necho hi", theme);
		expect(styled).toContain(theme.fg("syntaxComment", "# note"));
		expect(styled).toContain(theme.fg("syntaxFunction", "echo"));
	});

	test("colors an unclosed quote through the end", () => {
		const styled = highlightShellCommand(`echo "unfinished`, theme);
		expect(styled).toContain(theme.fg("syntaxFunction", "echo"));
		expect(styled).toContain(theme.fg("syntaxString", `"unfinished`));
	});
});
