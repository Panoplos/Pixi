import type { AutocompleteProvider } from "./autocomplete.ts";
import type { Component } from "./tui.ts";

/**
 * Interface for custom editor components.
 *
 * This allows extensions to provide their own editor implementation
 * (e.g., vim mode, emacs mode, custom keybindings) while maintaining
 * compatibility with the core application.
 */
export interface EditorComponent extends Component {
	// =========================================================================
	// Core text access (required)
	// =========================================================================

	/** Get the current text content */
	getText(): string;

	/** Set the text content */
	setText(text: string): void;

	/** Handle raw terminal input (key presses, paste sequences, etc.) */
	handleInput(data: string): void;

	// =========================================================================
	// Callbacks (required)
	// =========================================================================

	/** Called when user submits (e.g., Enter key) */
	onSubmit?: (text: string) => void;

	/** Called when text changes */
	onChange?: (text: string) => void;

	/** Fired when image markers are deleted from the input (backspace, delete, selection removal). */
	onImagesDeleted?: (ids: number[]) => void;

	// =========================================================================
	// History support (optional)
	// =========================================================================

	/** Add text to history for up/down navigation */
	addToHistory?(text: string): void;

	// =========================================================================
	// Advanced text manipulation (optional)
	// =========================================================================

	/** Insert text at current cursor position */
	insertTextAtCursor?(text: string): void;

	/**
	 * Register an attached image and insert its `[Image N]` marker at the cursor.
	 * The marker is atomic for cursor movement and deletion; removing it fires
	 * `onImagesDeleted` so the host can clean up the underlying file.
	 */
	insertImageMarker?(filePath: string): number;

	/** Currently pending image attachments, ordered by marker position. */
	getImageAttachments?(): Array<{ id: number; path: string }>;

	/** Drop all pending image attachments without firing deletion callbacks. */
	clearImages?(): void;

	/**
	 * Get text with any markers expanded (e.g., paste markers).
	 * Falls back to getText() if not implemented.
	 */
	getExpandedText?(): string;

	// =========================================================================
	// Autocomplete support (optional)
	// =========================================================================

	/** Set the autocomplete provider */
	setAutocompleteProvider?(provider: AutocompleteProvider): void;

	// =========================================================================
	// Appearance (optional)
	// =========================================================================

	/** Border color function */
	borderColor?: (str: string) => string;

	/** Set horizontal padding */
	setPaddingX?(padding: number): void;

	/** Set the prompt prefix marker shown before the first input line */
	setPrefix?(prefix: string): void;

	/** Set max visible items in autocomplete dropdown */
	setAutocompleteMaxVisible?(maxVisible: number): void;

	/** Show (or hide) a suggested next message as muted ghost text after the cursor. */
	setGhostSuggestion?(text: string | undefined): void;

	/** Remove the ghost suggestion; typed or filled text is untouched. */
	clearGhostSuggestion?(): void;

	/** Current ghost suggestion, if any. */
	getGhostSuggestion?(): string | undefined;
}
