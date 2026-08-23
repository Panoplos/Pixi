import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type Ctx = {
	chatContainer: Container;
	ui: TUI;
	renderer: unknown;
	toastStatusSpacer?: unknown;
	toastStatusText?: { setText(m: string): void } | undefined;
	toastStatusTimer?: ReturnType<typeof setTimeout>;
	showStatusToast(m: string): void;
};

function makeCtx(): Ctx {
	return {
		chatContainer: new Container(),
		ui: { requestRender: vi.fn() } as unknown as TUI,
		renderer: {}, // not a TuiAltScreen -> regular-mode toast path
		showStatusToast: (InteractiveMode.prototype as unknown as { showStatusToast(m: string): void }).showStatusToast,
	};
}

const flashToast = (InteractiveMode.prototype as unknown as { flashToast(m: string): void }).flashToast;

describe("flashToast expand status", () => {
	afterEach(() => vi.useRealTimers());

	test("replaces the previous toast in regular mode instead of stacking", () => {
		vi.useFakeTimers();
		initTheme("dark");
		const ctx = makeCtx();
		flashToast.call(ctx, "Expand mode: 1/5 (Up/Down to navigate)");
		flashToast.call(ctx, "Expand mode: 2/5");
		flashToast.call(ctx, "Expand mode: 3/5");
		expect(ctx.chatContainer.children.filter((c) => c instanceof Text)).toHaveLength(1);
		expect(ctx.chatContainer.children.length).toBe(2); // spacer + text
		vi.advanceTimersByTime(3000);
		expect(ctx.chatContainer.children).toHaveLength(0);
	});
});
