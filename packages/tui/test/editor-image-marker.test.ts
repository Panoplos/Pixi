import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import type { TUI } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function createTestTUI(cols = 80, rows = 24): TUI {
	return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

/** Create a temp image file; removed by the returned cleanup function. */
function tempImage(): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "pi-image-marker-"));
	const path = join(dir, "img.png");
	writeFileSync(path, "png");
	return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("Editor image markers", () => {
	it("inserts an [Image N] marker and tracks the attachment", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		editor.setText("hello ");
		const { path, cleanup } = tempImage();
		try {
			const id = editor.insertImageMarker(path);
			assert.strictEqual(id, 1);
			assert.strictEqual(editor.getText(), "hello [Image 1]");
			assert.deepStrictEqual(editor.getImageAttachments(), [{ id: 1, path }]);
		} finally {
			cleanup();
		}
	});

	it("moves the cursor across the marker as a single unit", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const { path, cleanup } = tempImage();
		try {
			editor.insertImageMarker(path);
			assert.strictEqual(editor.getText(), "[Image 1]");
			// Cursor sits after the 9-char marker; one Left must land at column 0.
			editor.handleInput("\x1b[D");
			assert.strictEqual(editor.getCursor().col, 0);
			editor.handleInput("\x1b[C");
			assert.strictEqual(editor.getCursor().col, "[Image 1]".length);
		} finally {
			cleanup();
		}
	});

	it("backspace deletes the whole marker and fires onImagesDeleted", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const deleted: number[][] = [];
		editor.onImagesDeleted = (ids) => deleted.push(ids);
		const { path, cleanup } = tempImage();
		try {
			const id = editor.insertImageMarker(path);
			editor.handleInput("\x7f"); // backspace
			assert.strictEqual(editor.getText(), "");
			assert.deepStrictEqual(deleted, [[id]]);
			assert.deepStrictEqual(editor.getImageAttachments(), []);
		} finally {
			cleanup();
		}
	});

	it("forward delete removes the whole marker and fires onImagesDeleted", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const deleted: number[][] = [];
		editor.onImagesDeleted = (ids) => deleted.push(ids);
		const { path, cleanup } = tempImage();
		try {
			editor.insertImageMarker(path);
			editor.handleInput("\x1b[H"); // home
			editor.handleInput("\x1b[3~"); // delete
			assert.strictEqual(editor.getText(), "");
			assert.strictEqual(deleted.length, 1);
			assert.strictEqual(editor.getImageAttachments().length, 0);
		} finally {
			cleanup();
		}
	});

	it("assigns fresh marker IDs so re-pasted markers never collide", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const { path, cleanup } = tempImage();
		try {
			const first = editor.insertImageMarker(path);
			const second = editor.insertImageMarker(path);
			assert.notStrictEqual(first, second);
			assert.strictEqual(editor.getImageAttachments().length, 2);
		} finally {
			cleanup();
		}
	});

	it("clearImages drops attachments without firing deletion callbacks", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		let fired = 0;
		editor.onImagesDeleted = () => fired++;
		const { path, cleanup } = tempImage();
		try {
			editor.insertImageMarker(path);
			editor.clearImages();
			assert.strictEqual(fired, 0);
			assert.deepStrictEqual(editor.getImageAttachments(), []);
		} finally {
			cleanup();
		}
	});

	it("undoing insertion removes the attachment with the marker", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const deleted: number[][] = [];
		editor.onImagesDeleted = (ids) => deleted.push(ids);
		const { path, cleanup } = tempImage();
		try {
			const id = editor.insertImageMarker(path);
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
			assert.deepStrictEqual(editor.getImageAttachments(), []);
			assert.deepStrictEqual(deleted, [[id]]);
		} finally {
			cleanup();
		}
	});

	for (const [name, keys] of [
		["delete to line start", ["\x15"]], // Ctrl+U
		["delete to line end", ["\x1b[H", "\x0b"]], // Home, Ctrl+K
		["delete word backward", ["\x17"]], // Ctrl+W
		["delete word forward", ["\x1b[H", "\x1bd"]], // Home, Alt+D
	] as const) {
		it(`${name} removes the attachment with the marker`, () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const deleted: number[][] = [];
			editor.onImagesDeleted = (ids) => deleted.push(ids);
			const { path, cleanup } = tempImage();
			try {
				const id = editor.insertImageMarker(path);
				for (const key of keys) editor.handleInput(key);
				assert.strictEqual(editor.getText(), "");
				assert.deepStrictEqual(editor.getImageAttachments(), []);
				assert.deepStrictEqual(deleted, [[id]]);
			} finally {
				cleanup();
			}
		});
	}

	it("returns attachments in marker position order", () => {
		const editor = new Editor(createTestTUI(), defaultEditorTheme);
		const first = tempImage();
		const second = tempImage();
		try {
			const firstId = editor.insertImageMarker(first.path);
			editor.handleInput("\x1b[H"); // Home
			const secondId = editor.insertImageMarker(second.path);
			assert.strictEqual(editor.getText(), `[Image ${secondId}][Image ${firstId}]`);
			assert.deepStrictEqual(editor.getImageAttachments(), [
				{ id: secondId, path: second.path },
				{ id: firstId, path: first.path },
			]);
		} finally {
			first.cleanup();
			second.cleanup();
		}
	});
});
