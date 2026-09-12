import assert from "node:assert";
import { test } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { Container } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * The editor sits in a fixed dock below a transcript scroll view, not inside it.
 * A drag on the editor's second text row must be owned by the editor, even though
 * the editor is a plain child of a container that has no layout box of its own.
 */
async function createDock() {
	const terminal = new VirtualTerminal(40, 12);
	const tui = new TuiAltScreen(terminal);
	const editor = new Editor(tui, defaultEditorTheme, { paddingX: 2, prefix: "❯ " });
	editor.setText("first line\nsecond line");
	const editorContainer = new Container();
	editorContainer.addChild(editor);
	const transcript = new ScrollView(new Text("history\nmore", 0, 0), { primary: true });
	const dock = new VStack([
		{ component: new Text("status", 0, 0), shrink: 1 },
		{ component: editorContainer, shrink: 1, minSize: 3 },
		{ component: new Text("footer", 0, 0), shrink: 1 },
	]);
	const root = new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]);
	tui.setLayoutRoot(root);
	tui.setFocus(editor);
	tui.start();
	await terminal.waitForRender();
	return { terminal, tui, editor };
}

test("a drag inside the docked editor selects editor text and delete removes it", async () => {
	const { terminal, tui, editor } = await createDock();

	// The editor's container sits at row 7; its second text row is screen row 10.
	terminal.sendInput("\x1b[<0;5;10M");
	terminal.sendInput("\x1b[<32;11;10M");
	terminal.sendInput("\x1b[<0;11;10m");
	await terminal.waitForRender();

	assert.deepStrictEqual((editor as unknown as { selection: unknown }).selection, {
		start: { line: 1, col: 0 },
		end: { line: 1, col: 7 },
	});

	terminal.sendInput("\x1b[3~");
	await terminal.waitForRender();
	assert.strictEqual(editor.getText(), "first line\nline");

	tui.stop();
});
