/**
 * Formats a wall-clock duration as a short human string, e.g. `3.4s` or `1m 05s`.
 */
export function formatThinkingDuration(ms: number): string {
	const s = ms / 1000;
	if (s < 60) {
		return `${s.toFixed(1)}s`;
	}
	const totalSeconds = Math.round(s);
	const m = Math.floor(totalSeconds / 60);
	const rest = totalSeconds % 60;
	return `${m}m ${String(rest).padStart(2, "0")}s`;
}
