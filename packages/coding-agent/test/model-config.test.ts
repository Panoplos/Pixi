import { describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { parseTokenCount } from "../src/modes/interactive/components/model-config-selectors.ts";

describe("parseTokenCount", () => {
	it("parses plain integers", () => {
		expect(parseTokenCount("160000")).toBe(160000);
		expect(parseTokenCount("2000")).toBe(2000);
	});

	it("strips commas, dots, and whitespace", () => {
		expect(parseTokenCount("160,000")).toBe(160000);
		expect(parseTokenCount("160.000")).toBe(160000);
		expect(parseTokenCount("160 000")).toBe(160000);
		expect(parseTokenCount(" 160,000 ")).toBe(160000);
	});

	it("supports k and m shorthand (case-insensitive)", () => {
		expect(parseTokenCount("160k")).toBe(160000);
		expect(parseTokenCount("160K")).toBe(160000);
		expect(parseTokenCount("2M")).toBe(2_000_000);
	});

	it("treats a dot as a decimal point only in the k/m shorthand case", () => {
		expect(parseTokenCount("1.5k")).toBe(1500);
		expect(parseTokenCount("1.05k")).toBe(1050);
		expect(parseTokenCount("2.75m")).toBe(2_750_000);
	});

	it("rejects non-numeric input", () => {
		expect(parseTokenCount("abc")).toBeUndefined();
		expect(parseTokenCount("")).toBeUndefined();
		expect(parseTokenCount("16 0x")).toBeUndefined();
	});
});

describe("per-model context settings", () => {
	it("round-trips maxContext and compactionBoundary, and clears on undefined", () => {
		const sm = SettingsManager.inMemory();
		sm.setModelContextSettings("deepinfra", "deepseek-ai/Pro", { maxContext: 200000, compactionBoundary: 160000 });
		expect(sm.getModelContextSettings("deepinfra", "deepseek-ai/Pro")).toEqual({
			maxContext: 200000,
			compactionBoundary: 160000,
		});

		sm.setModelContextSettings("deepinfra", "deepseek-ai/Pro", { maxContext: undefined });
		expect(sm.getModelContextSettings("deepinfra", "deepseek-ai/Pro")).toEqual({ compactionBoundary: 160000 });

		sm.setModelContextSettings("deepinfra", "deepseek-ai/Pro", { compactionBoundary: undefined });
		expect(sm.getModelContextSettings("deepinfra", "deepseek-ai/Pro")).toEqual({});
	});
});
