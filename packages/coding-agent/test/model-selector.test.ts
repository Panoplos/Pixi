import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ModelSelectorComponent, modelLab } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

describe("modelLab", () => {
	it("uses the <lab>/ prefix of the id, falling back to the provider", () => {
		expect(modelLab({ id: "deepseek-ai/DeepSeek-V4-Pro-0813", provider: "deepinfra" } as never)).toBe("deepseek-ai");
		expect(modelLab({ id: "meta-llama/Llama-3.3", provider: "deepinfra" } as never)).toBe("meta-llama");
		expect(modelLab({ id: "deepseek-chat", provider: "deepseek" } as never)).toBe("deepseek");
	});
});

describe("model selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("lists every catalog that failed to refresh", async () => {
		harness = await createHarness();
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: new Map([
				["openai", new Error("unavailable")],
				["anthropic", new Error("unavailable")],
			]),
		});

		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel(),
			harness.settingsManager,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		await vi.waitFor(() => {
			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("Could not refresh 2 model catalogs (openai, anthropic); showing cached models.");
		});
	});

	it("keeps each lab contiguous while putting the current model first", () => {
		type SortItem = {
			provider: string;
			id: string;
			model: { provider: string; id: string };
			lab: string;
		};
		const current = { provider: "host", id: "zoo/current" };
		const items = [
			{ provider: "host", id: "zoo/other", model: { provider: "host", id: "zoo/other" }, lab: "zoo" },
			{ provider: "host", id: "alpha/model", model: { provider: "host", id: "alpha/model" }, lab: "alpha" },
			{ provider: "host", id: "zoo/current", model: current, lab: "zoo" },
		];
		const sortModels = (
			ModelSelectorComponent.prototype as unknown as {
				sortModels(this: { currentModel: typeof current }, models: SortItem[]): SortItem[];
			}
		).sortModels;

		const sorted = sortModels.call({ currentModel: current }, items);
		expect(sorted.map(({ id }) => id)).toEqual(["zoo/current", "zoo/other", "alpha/model"]);
	});
});
