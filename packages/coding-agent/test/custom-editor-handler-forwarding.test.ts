import type { TUI } from "@earendil-works/pi-tui";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { EditorFactory } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

type SwapContext = {
	editorComponentFactory: unknown;
	editor: CustomEditor;
	defaultEditor: CustomEditor;
	editorContainer: Container;
	autocompleteProvider: undefined;
	keybindings: KeybindingsManager;
	activeStatusIndicator: undefined;
	activeWorkingIndicatorEmbedded: boolean;
	statusContainer: Container;
	ui: TUI;
	disposeActiveSelector(): void;
	updateBashModeChrome(): void;
};

/**
 * Extension editors replace the default one at session start. Expand mode's section navigation lives on the default
 * editor, so the swap has to hand it over (#regression: Ctrl+O expanded, Cmd+Up did nothing with OptChat installed).
 */
describe("editor swap keeps app handlers", () => {
	it("forwards expand mode navigation to an extension editor", () => {
		initTheme("dark");
		const keybindings = KeybindingsManager.create();
		const tui = { requestRender: vi.fn(), setFocus: vi.fn(), terminal: { rows: 20 } } as unknown as TUI;
		const defaultEditor = new CustomEditor(tui, getEditorTheme(), keybindings);
		const navigated: number[] = [];
		defaultEditor.onNavigateVertical = (direction) => {
			navigated.push(direction);
			return true;
		};

		const context: SwapContext = {
			editorComponentFactory: undefined,
			editor: defaultEditor,
			defaultEditor,
			editorContainer: new Container(),
			autocompleteProvider: undefined,
			keybindings,
			activeStatusIndicator: undefined,
			activeWorkingIndicatorEmbedded: false,
			statusContainer: new Container(),
			ui: tui,
			disposeActiveSelector: vi.fn(),
			updateBashModeChrome: vi.fn(),
		};

		// OptChat's editor: a CustomEditor subclass that takes bare arrows for its own bar.
		const factory: EditorFactory = (ui, theme, keys) => {
			class ExtensionEditor extends CustomEditor {
				override handleInput(data: string) {
					if (data === "\x1b[B") return;
					super.handleInput(data);
				}
			}
			return new ExtensionEditor(ui, theme, keys);
		};

		const setCustomEditorComponent = (
			InteractiveMode.prototype as unknown as {
				setCustomEditorComponent(this: SwapContext, factory: EditorFactory): void;
			}
		).setCustomEditorComponent;
		setCustomEditorComponent.call(context, factory);
		expect(context.editor).not.toBe(defaultEditor);

		// Cmd+down reaches the section navigation even though the extension editor swallows plain down.
		context.editor.handleInput("\x1b[B");
		context.editor.handleInput("\x1b[1;9B");
		expect(navigated).toEqual([1]);
	});
});
