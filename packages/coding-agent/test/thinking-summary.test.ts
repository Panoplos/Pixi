import { describe, expect, it } from "vitest";
import { formatThinkingDuration } from "../src/modes/interactive/components/thinking-indicator.ts";

describe("formatThinkingDuration", () => {
	it("formats sub-minute durations as seconds", () => {
		expect(formatThinkingDuration(0)).toBe("0.0s");
		expect(formatThinkingDuration(3200)).toBe("3.2s");
		expect(formatThinkingDuration(59_999)).toBe("60.0s");
	});

	it("formats minute-plus durations as m ss", () => {
		expect(formatThinkingDuration(60_000)).toBe("1m 00s");
		expect(formatThinkingDuration(65_400)).toBe("1m 05s");
		expect(formatThinkingDuration(119_999)).toBe("2m 00s");
		expect(formatThinkingDuration(125_000)).toBe("2m 05s");
	});
});
