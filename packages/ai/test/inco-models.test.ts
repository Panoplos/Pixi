import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { incoProvider } from "../src/providers/inco.ts";
import {
	fetchIncoChatModels,
	getIncoSeedModels,
	INCO_MODELS_URL,
	parseIncoChatModels,
} from "../src/providers/inco-catalog.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Inco catalog", () => {
	it("seeds the documented launch models", () => {
		expect(getIncoSeedModels().map((model) => model.id)).toEqual([
			"deepseek-v4.1-flash:fast",
			"glm-5.3",
			"glm-5.3-flash",
			"kimi-k3",
			"minimax-m3",
		]);
		expect(getIncoSeedModels()[1]).toMatchObject({
			id: "glm-5.3",
			provider: "inco",
			api: "openai-completions",
			baseUrl: "https://api.inco.ai/v1",
			reasoning: true,
			thinkingLevelMap: { off: "none" },
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
	});

	it("keeps seed metadata for known live ids and maps unknown chat models", () => {
		const models = parseIncoChatModels({
			data: [
				{ id: "glm-5.3", name: "" },
				{
					id: "qwen3.8-max",
					name: "Qwen 3.8 Max",
					metadata: {
						context_length: 262_144,
						max_tokens: 65_536,
						pricing: { input_tokens: 1.2, output_tokens: 6, cache_read_tokens: 0.12 },
						tags: ["chat", "reasoning"],
					},
				},
			],
		});
		expect(models.map((model) => model.id)).toEqual(["glm-5.3", "qwen3.8-max"]);
		expect(models[0]).toMatchObject({ name: "GLM-5.3", cost: { input: 1.4, output: 4.4, cacheRead: 0.26 } });
		expect(models[1]).toMatchObject({
			name: "Qwen 3.8 Max",
			reasoning: true,
			contextWindow: 262_144,
			maxTokens: 65_536,
			cost: { input: 1.2, output: 6, cacheRead: 0.12, cacheWrite: 0 },
		});
	});

	it("returns the seed catalog when no API key is provided", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const models = await fetchIncoChatModels();
		expect(models.map((model) => model.id)).toContain("deepseek-v4.1-flash:fast");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("refreshes the provider catalog from Inco when authenticated", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			expect(String(input)).toBe(INCO_MODELS_URL);
			expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe("Bearer test-key");
			return new Response(
				JSON.stringify({
					data: [
						{ id: "glm-5.3" },
						{
							id: "glm-5.4-flash",
							metadata: {
								context_length: 1_000_000,
								max_tokens: 131_072,
								tags: ["chat", "vision", "reasoning"],
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const credentials = new InMemoryCredentialStore();
		await credentials.modify("inco", async () => ({ type: "api_key", key: "test-key" }));
		const modelsStore = new InMemoryModelsStore();
		const models = createModels({ credentials, modelsStore });
		models.setProvider(incoProvider());

		expect(models.getModel("inco", "deepseek-v4.1-flash:fast")).toBeDefined();
		expect(models.getModel("inco", "glm-5.4-flash")).toBeUndefined();

		expect((await models.refresh({ providers: ["inco"] })).errors.size).toBe(0);
		expect(models.getModel("inco", "glm-5.3")).toMatchObject({ name: "GLM-5.3" });
		expect(models.getModel("inco", "glm-5.4-flash")).toMatchObject({
			name: "Glm 5.4 Flash",
			input: ["text", "image"],
		});
		expect(models.getModel("inco", "deepseek-v4.1-flash:fast")).toBeDefined();
	});
});
