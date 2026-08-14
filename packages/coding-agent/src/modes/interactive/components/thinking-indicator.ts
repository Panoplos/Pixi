import { Container, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/**
 * Formats a wall-clock duration as a short human string, e.g. `3.4s` or `1m 05s`.
 */
export function formatThinkingDuration(ms: number): string {
	const s = ms / 1000;
	if (s < 60) {
		return `${s.toFixed(1)}s`;
	}
	const m = Math.floor(s / 60);
	const rest = Math.round(s % 60);
	return `${m}m ${String(rest).padStart(2, "0")}s`;
}

/**
 * A single persistent in-place entry that shows `Thinking...` while the model is
 * reasoning and flips to `Thought for Ns` once the thinking run completes.
 *
 * It is added to the chat during live streaming and survives the round, so the
 * timed label remains readable after the turn ends. It is never rendered on a
 * restored session (rebuild skips thinking entirely).
 */
export class ThinkingIndicatorComponent extends Container {
	private outputPad: number;
	private label: Text;
	private activeLabel: string;

	constructor(label = "Thinking...", outputPad = 1) {
		super();
		this.outputPad = outputPad;
		this.activeLabel = label;
		this.label = new Text(theme.italic(theme.fg("thinkingText", label)), this.outputPad, 0);
		this.addChild(this.label);
	}

	setActive(): void {
		this.label.setText(theme.italic(theme.fg("thinkingText", this.activeLabel)));
		this.invalidate();
	}

	setDone(durationMs: number): void {
		this.label.setText(theme.italic(theme.fg("thinkingText", `Thought for ${formatThinkingDuration(durationMs)}`)));
		this.invalidate();
	}
}
