import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const SUPER_UP = "\x1b[1;9A";
const SUPER_DOWN = "\x1b[1;9B";
const SHIFT_UP = "\x1b[1;2A";
const SHIFT_DOWN = "\x1b[1;2B";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

function editor() {
	initTheme("dark");
	const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
	return new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
}

describe("expand mode navigation keys", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("navigates sections with plain arrows, Cmd+arrows and shift+arrows", () => {
		const input = editor();
		const moves: number[] = [];
		input.onNavigateVertical = (direction) => {
			moves.push(direction);
			return true;
		};

		for (const key of [UP, DOWN, SUPER_UP, SUPER_DOWN, SHIFT_UP, SHIFT_DOWN]) input.handleInput(key);

		expect(moves).toEqual([-1, 1, -1, 1, -1, 1]);
	});

	it("keeps Cmd+arrows for sections when an extension takes the plain arrows", () => {
		// OptChat's navigation bar consumes a bare down arrow while its own editor owns the input line.
		class ExtensionEditor extends CustomEditor {
			override handleInput(data: string) {
				if (data === DOWN) return;
				super.handleInput(data);
			}
		}
		initTheme("dark");
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const input = new ExtensionEditor(tui, getEditorTheme(), KeybindingsManager.create());
		const moves: number[] = [];
		input.onNavigateVertical = (direction) => {
			moves.push(direction);
			return true;
		};

		input.handleInput(DOWN);
		input.handleInput(SUPER_DOWN);

		expect(moves).toEqual([1]);
	});

	it("leaves Cmd+arrows to the editor when expand mode is not active", () => {
		const input = editor();
		input.setText("hello");
		input.onNavigateVertical = () => false;

		input.handleInput(SUPER_UP);

		// Nothing consumed it, so the editor keeps the text and the cursor unmoved.
		expect(input.getText()).toBe("hello");
	});
});
