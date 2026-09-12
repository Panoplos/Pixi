import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { deepInfraProvider } from "../src/providers/deepinfra.ts";
import { DEEPINFRA_MODELS_URL, parseDeepInfraChatModels } from "../src/providers/deepinfra-catalog.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DeepInfra catalog", () => {
	it("keeps chat models and maps reasoning, vision, empty names, and pricing", () => {
		const models = parseDeepInfraChatModels({
			data: [
				{
					id: "zai-org/GLM-5.3-Flash",
					name: "",
					metadata: {
						context_length: 1_048_576,
						max_tokens: 131_072,
						pricing: { input_tokens: 0.075, output_tokens: 0.25, cache_read_tokens: 0.015 },
						tags: ["chat", "vlm", "vision", "prompt_cache", "reasoning"],
					},
				},
				{
					id: "BAAI/bge-m3",
					metadata: { tags: ["embeddings"] },
				},
				{
					id: "meta-llama/Llama-3.3-70B-Instruct",
					name: "Llama 3.3 70B",
					metadata: {
						context_length: 131_072,
						max_tokens: 32_768,
						pricing: { input_tokens: 0.1, output_tokens: 0.3 },
						tags: ["chat"],
					},
				},
			],
		});

		expect(models.map((model) => model.id)).toEqual(["zai-org/GLM-5.3-Flash", "meta-llama/Llama-3.3-70B-Instruct"]);
		expect(models[0]).toMatchObject({
			name: "GLM-5.3-Flash",
			provider: "deepinfra",
			api: "openai-completions",
			reasoning: true,
			thinkingLevelMap: { off: "none" },
			input: ["text", "image"],
			cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 131_072,
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
		expect(models[1]).toMatchObject({
			name: "Llama 3.3 70B",
			reasoning: false,
			input: ["text"],
			cost: { input: 0.1, output: 0.3, cacheRead: 0.1, cacheWrite: 0 },
		});
		expect(models[1]?.thinkingLevelMap).toBeUndefined();
	});

	it("ignores payloads that are not a DeepInfra model list", () => {
		expect(parseDeepInfraChatModels(null)).toEqual([]);
		expect(parseDeepInfraChatModels({ models: [] })).toEqual([]);
		expect(parseDeepInfraChatModels({ data: [{ metadata: { tags: ["chat"] } }] })).toEqual([]);
	});

	it("refreshes the provider catalog from the public DeepInfra models endpoint", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			expect(String(input)).toBe(DEEPINFRA_MODELS_URL);
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "zai-org/GLM-5.3-Flash",
							name: "GLM-5.3-Flash",
							metadata: {
								context_length: 1_048_576,
								max_tokens: 131_072,
								pricing: { input_tokens: 0.075, output_tokens: 0.25, cache_read_tokens: 0.015 },
								tags: ["chat", "vision", "reasoning"],
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const credentials = new InMemoryCredentialStore();
		await credentials.modify("deepinfra", async () => ({ type: "api_key", key: "test-key" }));
		const modelsStore = new InMemoryModelsStore();
		const models = createModels({ credentials, modelsStore });
		const provider = deepInfraProvider();
		models.setProvider(provider);

		expect(models.getModel("deepinfra", "zai-org/GLM-5.2")).toBeDefined();
		expect(models.getModel("deepinfra", "zai-org/GLM-5.3-Flash")).toBeUndefined();

		expect((await models.refresh({ providers: ["deepinfra"] })).errors.size).toBe(0);
		expect(models.getModel("deepinfra", "zai-org/GLM-5.3-Flash")).toMatchObject({
			name: "GLM-5.3-Flash",
			reasoning: true,
			input: ["text", "image"],
		});
		expect(models.getModel("deepinfra", "zai-org/GLM-5.2")).toBeDefined();
		expect((await modelsStore.read("deepinfra"))?.models.map((model) => model.id)).toEqual(["zai-org/GLM-5.3-Flash"]);
	});
});
