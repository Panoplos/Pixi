import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { bitdeerProvider } from "../src/providers/bitdeer.ts";
import { BITDEER_MODELS_URL, getBitdeerSeedModels, parseBitdeerChatModels } from "../src/providers/bitdeer-catalog.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Bitdeer catalog", () => {
	it("exposes the documented launch catalog without an API key", () => {
		const models = getBitdeerSeedModels();
		expect(models.map((model) => model.id)).toEqual([
			"deepseek-ai/DeepSeek-V4.1-Flash",
			"deepseek-ai/DeepSeek-V4-Flash",
			"zai-org/GLM-5.3",
			"zai-org/GLM-5.3-Flash",
			"moonshotai/Kimi-K3",
			"Qwen/Qwen3.8-27B",
		]);
		expect(models[0]).toMatchObject({
			provider: "bitdeer",
			api: "openai-completions",
			baseUrl: "https://api-inference.bitdeer.ai/v1",
			reasoning: true,
			thinkingLevelMap: { off: "none" },
			input: ["text"],
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		});
	});

	it("keeps seeded metadata for a known live id and derives it for unknown ids", () => {
		const models = parseBitdeerChatModels({
			data: [
				{ id: "moonshotai/Kimi-K3", name: "Kimi K3" },
				{ id: "some-new-model", name: "Some New Model" },
				{ id: "vision-thing", name: "", metadata: { context_length: 32_768, max_tokens: 8_192, tags: ["vision"] } },
				{ id: "", name: "Broken" },
			],
		});

		expect(models.map((model) => model.id)).toEqual(["moonshotai/Kimi-K3", "some-new-model", "vision-thing"]);
		expect(models[1]).toMatchObject({
			name: "Some New Model",
			reasoning: true,
			input: ["text"],
			// No live pricing metadata: vendor reference numbers are not invented here.
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4096,
		});
		expect(models[2]).toMatchObject({
			input: ["text", "image"],
			contextWindow: 32_768,
			maxTokens: 8_192,
		});
	});

	it("ignores payloads that are not a Bitdeer model list", () => {
		expect(parseBitdeerChatModels(null)).toEqual([]);
		expect(parseBitdeerChatModels({ models: [] })).toEqual([]);
		expect(parseBitdeerChatModels({ data: [{ name: "no id" }] })).toEqual([]);
	});

	it("drops the embeddings, reranker, and image models the live endpoint serves", () => {
		const models = parseBitdeerChatModels({
			data: [
				{ id: "BAAI/bge-m3" },
				{ id: "BAAI/bge-reranker-v2-m3" },
				{ id: "seedream-5.0-lite" },
				{ id: "zai-org/GLM-5.3-Flash" },
			],
		});
		expect(models.map((model) => model.id)).toEqual(["zai-org/GLM-5.3-Flash"]);
	});

	it("refreshes the provider catalog from the Bitdeer models endpoint with a credential", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			expect(String(input)).toBe(BITDEER_MODELS_URL);
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-bitdeer-test");
			return new Response(JSON.stringify({ data: [{ id: "moonshotai/Kimi-K3", name: "Kimi K3" }] }), {
				status: 200,
			});
		});

		const credentials = new InMemoryCredentialStore();
		await credentials.modify("bitdeer", async () => ({ type: "api_key", key: "sk-bitdeer-test" }));
		const modelsStore = new InMemoryModelsStore();
		const models = createModels({ credentials, modelsStore });
		models.setProvider(bitdeerProvider());

		expect(models.getModel("bitdeer", "moonshotai/Kimi-K3")).toMatchObject({
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
			contextWindow: 1_048_576,
		});
		expect((await models.refresh({ providers: ["bitdeer"] })).errors.size).toBe(0);
		expect(models.getModel("bitdeer", "moonshotai/Kimi-K3")).toMatchObject({
			name: "Kimi K3",
			reasoning: true,
			input: ["text", "image"],
		});
		// The dynamic catalog replaces the refreshed list; static seed entries stay registered.
		expect((await modelsStore.read("bitdeer"))?.models.map((model) => model.id)).toEqual(["moonshotai/Kimi-K3"]);
	});

	it("falls back to the seed catalog when the live payload is unusable", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			return new Response(JSON.stringify({ data: [{ name: "no id here" }] }), { status: 200 });
		});

		const credentials = new InMemoryCredentialStore();
		await credentials.modify("bitdeer", async () => ({ type: "api_key", key: "sk-bitdeer-test" }));
		const models = createModels({ credentials, modelsStore: new InMemoryModelsStore() });
		models.setProvider(bitdeerProvider());

		expect((await models.refresh({ providers: ["bitdeer"] })).errors.size).toBe(0);
		expect(models.getModel("bitdeer", "deepseek-ai/DeepSeek-V4-Flash")).toBeDefined();
	});

	it("returns the seed catalog when refreshing without a credential", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const models = createModels({
			credentials: new InMemoryCredentialStore(),
			modelsStore: new InMemoryModelsStore(),
		});
		models.setProvider(bitdeerProvider());

		expect((await models.refresh({ providers: ["bitdeer"] })).errors.size).toBe(0);
		expect(models.getModel("bitdeer", "deepseek-ai/DeepSeek-V4-Flash")).toBeDefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
