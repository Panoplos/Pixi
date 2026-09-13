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

describe("Editor ghost suggestion", () => {
	it("renders the pending suggestion as muted ghost text after the cursor", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion("run the tests");
		assert.equal(editor.getGhostSuggestion(), "run the tests");

		const output = rendered(editor);
		assert.ok(output.includes("«run the tests»"), output);
		assert.ok(output.includes("\x1b[7m \x1b[0m"), "cursor block should precede the ghost text");
	});

	it("typing supersedes the suggestion", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion("run the tests");

		editor.handleInput("x");
		assert.equal(editor.getText(), "x");
		assert.equal(editor.getGhostSuggestion(), undefined);
		assert.ok(!rendered(editor).includes("«"), rendered(editor));
	});

	it("Tab streams the suggestion into the input left to right", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			const seen: string[] = [];
			editor.onChange = (text) => seen.push(text);
			editor.setGhostSuggestion("run the tests");

			editor.handleInput("\t");
			assert.equal(editor.getText(), "", "nothing before the first tick");
			for (let i = 0; i < 30; i++) {
				mock.timers.tick(8);
				if (editor.getGhostSuggestion() === undefined) break;
			}

			assert.equal(editor.getText(), "run the tests");
			assert.equal(editor.getGhostSuggestion(), undefined);
			assert.ok(seen.includes("r"), seen.join(","));
			assert.ok(seen.includes("run t"), seen.join(","));
			assert.ok(seen[seen.length - 1] === "run the tests", seen.join(","));
		} finally {
			mock.timers.reset();
		}
	});

	it("Tab again mid-fill completes the fill instantly", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			const suggestion = "a".repeat(40);
			editor.setGhostSuggestion(suggestion);

			editor.handleInput("\t");
			mock.timers.tick(8);
			mock.timers.tick(8);
			assert.equal(editor.getText(), "aa");

			editor.handleInput("\t");
			assert.equal(editor.getText(), suggestion);
			assert.equal(editor.getGhostSuggestion(), undefined);

			mock.timers.tick(10_000);
			assert.equal(editor.getText(), suggestion, "no further growth after completion");
		} finally {
			mock.timers.reset();
		}
	});

	it("a keypress mid-fill keeps the typed prefix and drops the rest", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			editor.setGhostSuggestion("abcdefgh");
			editor.handleInput("\t");
			mock.timers.tick(8);
			mock.timers.tick(8);
			assert.equal(editor.getText(), "ab");

			editor.handleInput("X");
			assert.equal(editor.getText(), "abX");
			assert.equal(editor.getGhostSuggestion(), undefined);

			mock.timers.tick(10_000);
			assert.equal(editor.getText(), "abX", "no further growth after user takes over");
		} finally {
			mock.timers.reset();
		}
	});

	it("undo after the fill restores an empty editor", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		try {
			const { editor } = createEditor();
			editor.setGhostSuggestion("run the tests");
			editor.handleInput("\t");
			for (let i = 0; i < 30; i++) {
				mock.timers.tick(8);
				if (editor.getGhostSuggestion() === undefined) break;
			}
			assert.equal(editor.getText(), "run the tests");

			editor.handleInput("\x1f"); // tui.editor.undo (ctrl+-)
			assert.equal(editor.getText(), "");
		} finally {
			mock.timers.reset();
		}
	});

	it("clearGhostSuggestion removes the hint without touching typed text", () => {
		const { editor } = createEditor();
		editor.setGhostSuggestion("run the tests");
		editor.handleInput("x"); // typing already consumed the ghost
		editor.setGhostSuggestion("a new suggestion");
		assert.equal(editor.getText(), "x");
		editor.clearGhostSuggestion();
		assert.equal(editor.getGhostSuggestion(), undefined);
		assert.equal(editor.getText(), "x");
	});
});
