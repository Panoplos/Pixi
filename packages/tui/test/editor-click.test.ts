import assert from "node:assert";
import { test } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { Container, CURSOR_MARKER } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

async function createEditor(text: string, columns = 16, rows = 6) {
	const terminal = new VirtualTerminal(columns, rows);
	const tui = new TuiAltScreen(terminal);
	const editor = new Editor(tui, defaultEditorTheme, { paddingX: 2, prefix: "❯ " });
	editor.setText(text);
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	tui.setLayoutRoot(editorContainer);
	tui.setFocus(editor);
	tui.start();
	await terminal.waitForRender();
	return { terminal, tui, editor };
}

function drag(terminal: VirtualTerminal, startX: number, startY: number, endX: number, endY: number): void {
	terminal.sendInput(`\x1b[<0;${startX};${startY}M`);
	terminal.sendInput(`\x1b[<32;${endX};${endY}M`);
	terminal.sendInput(`\x1b[<0;${endX};${endY}m`);
}

test("mouse clicks move the editor cursor and selected text can be edited", async () => {
	const { terminal, tui, editor } = await createEditor("hello 🙂 world");

	terminal.sendInput("\x1b[<0;12;2M");
	terminal.sendInput("\x1b[<0;12;2m");
	assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

	terminal.sendInput("\x1b[<0;7;3M");
	terminal.sendInput("\x1b[<0;7;3m");
	assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

	terminal.sendInput("\x1b[<0;1;1M");
	terminal.sendInput("\x1b[<0;1;1m");
	assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

	terminal.sendInput("\x1b[<0;5;3M");
	terminal.sendInput("\x1b[<32;7;3M");
	terminal.sendInput("\x1b[<0;7;3m");
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "hello 🙂 ld");

	editor.setText("hello 🙂 world");
	await terminal.waitForRender();
	terminal.sendInput("\x1b[<0;5;2M");
	terminal.sendInput("\x1b[<32;9;2M");
	terminal.sendInput("\x1b[<0;9;2m");
	terminal.sendInput("\x1b[3~");
	assert.strictEqual(editor.getText(), " 🙂 world");

	editor.setText("hello 🙂 world");
	await terminal.waitForRender();
	terminal.sendInput("\x1b[<0;5;3M");
	terminal.sendInput("\x1b[<32;9;3M");
	terminal.sendInput("\x1b[<0;9;3m");
	terminal.sendInput("X");
	terminal.sendInput("Y");
	assert.strictEqual(editor.getText(), "hello 🙂 XY");
	terminal.sendInput("\x1b[45;5u");
	assert.strictEqual(editor.getText(), "hello 🙂 world");

	tui.stop();
});

test("global shortcuts clear editor-owned selections", async () => {
	const { terminal, tui, editor } = await createEditor("hello 🙂 world");
	drag(terminal, 5, 3, 9, 3);
	terminal.sendInput("\x1b[102;6u");
	terminal.sendInput("\x1b");
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "hello 🙂 worl");
	tui.stop();
});

test("completed editor selections survive terminal focus changes", async () => {
	const { terminal, tui, editor } = await createEditor("hello 🙂 world");
	drag(terminal, 5, 3, 9, 3);
	terminal.sendInput("\x1b[O");
	terminal.sendInput("\x1b[I");
	terminal.sendInput("\x1b[97;1:3u");
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "hello 🙂 ");
	tui.stop();
});

test("reverse multi-line and triple-click line selections can be deleted", async () => {
	const { terminal, tui, editor } = await createEditor("alpha\nbeta");
	drag(terminal, 7, 3, 6, 2);
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "aa");

	editor.setText("hello");
	await terminal.waitForRender();
	for (let click = 0; click < 3; click++) {
		terminal.sendInput("\x1b[<0;7;2M");
		terminal.sendInput("\x1b[<0;7;2m");
	}
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "");
	tui.stop();
});

test("deleting a selected paste marker removes its registry entry", async () => {
	const { terminal, tui, editor } = await createEditor("");
	const paste = "x".repeat(1001);
	editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
	await terminal.waitForRender();
	drag(terminal, 5, 2, 5, 4);
	terminal.sendInput("\x7f");
	assert.strictEqual(editor.getText(), "");

	editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
	assert.strictEqual(editor.getText(), "[paste #1 1001 chars]");
	tui.stop();
});

test("owned selection highlight stops at the editor's text instead of the row edge", async () => {
	const { terminal, tui } = await createEditor("one\ntwo");
	drag(terminal, 7, 2, 7, 3);
	await terminal.waitForRender();
	const viewport = terminal.getViewport();
	const textStart = viewport[2].indexOf("two");
	const textEnd = textStart + "two".length;
	const dragCell = 7 - 1; // the 1-based screen column the drag pressed and released on
	assert.deepStrictEqual(terminal.getInverseColumnRanges(1), [{ start: dragCell, end: textEnd }]);
	assert.deepStrictEqual(terminal.getInverseColumnRanges(2), [{ start: textStart, end: textEnd }]);
	tui.stop();
});

test("selection carries the cursor visuals: no reverse block while held", async () => {
	const { terminal, tui, editor } = await createEditor("hello 🙂 world");
	drag(terminal, 5, 3, 9, 3);
	const rows = editor.render(16);
	assert.ok(
		rows.some((row) => row.includes(CURSOR_MARKER)),
		`hardware cursor marker should still be emitted: ${JSON.stringify(rows)}`,
	);
	assert.ok(
		!rows.some((row) => row.includes("\x1b[7md\x1b[0m") || row.includes("\x1b[7m \x1b[0m")),
		`no reverse cursor block while a selection is held: ${JSON.stringify(rows)}`,
	);
	editor.clearSelection();
	const cleared = editor.render(16);
	assert.ok(
		cleared.some((row) => row.includes("\x1b[7m \x1b[0m")),
		`block cursor returns to the insertion point after the selection clears: ${JSON.stringify(cleared)}`,
	);
	tui.stop();
});
