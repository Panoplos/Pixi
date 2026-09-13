import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { Editor, type EditorTheme } from "../src/components/editor.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const editorTheme: EditorTheme = {
	borderColor: (text) => text,
	selectList: {
		selectedPrefix: (text) => text,
		selectedText: (text) => text,
		description: (text) => text,
		scrollInfo: (text) => text,
		noMatch: (text) => text,
	},
	// Marker wrapper makes the muted ghost substring easy to assert on.
	ghost: (text) => `«${text}»`,
};

const SUGGESTION = "run the tests";

function createEditor(): { editor: Editor; terminal: VirtualTerminal } {
	const terminal = new VirtualTerminal(80, 24);
	const tui = new TuiAltScreen(terminal);
	const editor = new Editor(tui, editorTheme);
	tui.addChild(editor);
	return { editor, terminal };
}

function rendered(editor: Editor): string {
	return editor.render(80).join("\n");
}

function drainFill(editor: Editor): void {
	for (let i = 0; i < 50; i++) {
		mock.timers.tick(30);
		if (editor.getText() === SUGGESTION) break;
	}
}

describe("Editor ghost suggestion", () => {
	it("Right arrow accepts the suggestion like Tab, including mid-fill", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			editor.setGhostSuggestion(SUGGESTION);

			editor.handleInput("\x1b[C"); // right arrow starts the fill
			mock.timers.tick(30);
			assert.notEqual(editor.getText(), "");
			editor.handleInput("\x1b[C"); // again mid-fill: completes instantly
			assert.equal(editor.getText(), SUGGESTION);
			mock.timers.tick(10_000);
			assert.equal(editor.getText(), SUGGESTION, "no further growth after completion");

			// With the hint pending and no fill running, right arrow starts it too.
			const editor2 = createEditor().editor;
			editor2.setGhostSuggestion(SUGGESTION);
			editor2.handleInput("x"); // typed text hides the hint
			editor2.handleInput("\x1b[C"); // cursor right with text: normal movement, no fill
			assert.equal(editor2.getText(), "x");
		} finally {
			mock.timers.reset();
		}
	});

	it("renders the pending suggestion as muted ghost text after the cursor", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion(SUGGESTION);
		assert.equal(editor.getGhostSuggestion(), SUGGESTION);

		const output = rendered(editor);
		assert.ok(output.includes(`«${SUGGESTION.slice(1)}»`), output);
		assert.ok(
			output.includes(`\x1b[7m${SUGGESTION[0]}\x1b[0m«${SUGGESTION.slice(1)}»`),
			`first ghost character should sit under the contrasted cursor: ${output}`,
		);
		assert.ok(!output.includes("\x1b[7m \x1b[0m"), `no empty cursor cell should precede the ghost: ${output}`);
	});

	it("typing supersedes the suggestion, and deleting back to empty shows it again", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion(SUGGESTION);

		editor.handleInput("x");
		assert.equal(editor.getText(), "x");
		assert.equal(editor.getGhostSuggestion(), SUGGESTION, "suggestion stays pending");
		assert.ok(!rendered(editor).includes("«"), rendered(editor));

		editor.handleInput("\x7f"); // backspace back to empty
		assert.equal(editor.getText(), "");
		const output = rendered(editor);
		assert.ok(output.includes(`«${SUGGESTION.slice(1)}»`), `ghost returns on empty: ${output}`);
	});

	it("Tab streams the suggestion in word by word, then the hint stays pending", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			const seen: string[] = [];
			editor.onChange = (text) => seen.push(text);
			editor.setGhostSuggestion(SUGGESTION);

			editor.handleInput("\t");
			assert.equal(editor.getText(), "", "nothing before the first tick");
			drainFill(editor);

			assert.equal(editor.getText(), SUGGESTION);
			assert.ok(seen.includes("run "), seen.join(","));
			assert.ok(seen.includes("run the "), seen.join(","));
			assert.ok(seen[seen.length - 1] === SUGGESTION, seen.join(","));
			assert.equal(editor.getGhostSuggestion(), SUGGESTION, "hint remains pending after the fill");

			// Delete the filled text back to empty: the full hint reappears.
			for (let i = 0; i < SUGGESTION.length; i++) {
				editor.handleInput("\x7f");
			}
			assert.equal(editor.getText(), "");
			assert.ok(rendered(editor).includes(`«${SUGGESTION.slice(1)}»`), rendered(editor));
		} finally {
			mock.timers.reset();
		}
	});

	it("Tab again mid-fill completes the fill instantly", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			const suggestion = "a ".repeat(40).trim();
			editor.setGhostSuggestion(suggestion);

			editor.handleInput("\t");
			mock.timers.tick(30);
			mock.timers.tick(30);
			const afterTwoTicks = editor.getText();
			assert.notEqual(afterTwoTicks, "");

			editor.handleInput("\t");
			assert.equal(editor.getText(), suggestion);
			assert.equal(editor.getGhostSuggestion(), suggestion);

			mock.timers.tick(10_000);
			assert.equal(editor.getText(), suggestion, "no further growth after completion");
		} finally {
			mock.timers.reset();
		}
	});

	it("a keypress mid-fill keeps the typed prefix and keeps the hint pending", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			editor.setGhostSuggestion("one two three four");
			editor.handleInput("\t");
			mock.timers.tick(30);
			const firstChunk = editor.getText();
			assert.notEqual(firstChunk, "");

			editor.handleInput("X");
			assert.equal(editor.getText(), `${firstChunk}X`);

			mock.timers.tick(10_000);
			assert.equal(editor.getText(), `${firstChunk}X`, "no further growth after user takes over");
		} finally {
			mock.timers.reset();
		}
	});

	it("undo after the fill restores an empty editor", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			editor.setGhostSuggestion(SUGGESTION);
			editor.handleInput("\t");
			drainFill(editor);
			assert.equal(editor.getText(), SUGGESTION);

			editor.handleInput("\x1f"); // tui.editor.undo (ctrl+-)
			assert.equal(editor.getText(), "");
		} finally {
			mock.timers.reset();
		}
	});

	it("clearGhostSuggestion removes the hint without touching typed text", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion(SUGGESTION);
		editor.handleInput("x");
		editor.setGhostSuggestion("a new suggestion");
		assert.equal(editor.getText(), "x");
		editor.clearGhostSuggestion();
		assert.equal(editor.getGhostSuggestion(), undefined);
		assert.equal(editor.getText(), "x");
		assert.ok(!rendered(editor).includes("«"), rendered(editor));
	});
});
