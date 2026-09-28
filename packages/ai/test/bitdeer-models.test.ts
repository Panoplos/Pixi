import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { bitdeerProvider } from "../src/providers/bitdeer.ts";
import {
	BITDEER_MODELS_URL,
	BITDEER_SITE_LIST_URL,
	getBitdeerSeedModels,
	parseBitdeerChatModels,
} from "../src/providers/bitdeer-catalog.ts";

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
		// Seed limits/prices are measured values from Bitdeer's site API, not vendor reference numbers.
		expect(models[0]).toMatchObject({
			contextWindow: 1_048_576,
			maxTokens: 393_216,
			cost: { input: 15, output: 120 },
		});
	});

	it("marks models that cannot disable reasoning with an unrepresentable off level", () => {
		const byId = new Map(getBitdeerSeedModels().map((model) => [model.id, model]));
		// Measured on the live endpoint: GLM-5.3/Flash and Kimi-K3 400 on reasoning_effort "none".
		expect(byId.get("zai-org/GLM-5.3-Flash")?.thinkingLevelMap).toEqual({ off: null });
		expect(byId.get("moonshotai/Kimi-K3")?.thinkingLevelMap).toEqual({ off: null });
		expect(byId.get("deepseek-ai/DeepSeek-V4.1-Flash")?.thinkingLevelMap).toEqual({ off: "none" });
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
			const url = String(input);
			if (url === BITDEER_MODELS_URL) {
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-bitdeer-test");
				return new Response(JSON.stringify({ data: [{ id: "moonshotai/Kimi-K3", name: "Kimi K3" }] }), {
					status: 200,
				});
			}
			if (url === BITDEER_SITE_LIST_URL) {
				return new Response(JSON.stringify({ models: [{ modelId: "mdl-kimi", name: "moonshotai/Kimi-K3" }] }), {
					status: 200,
				});
			}
			return new Response(
				JSON.stringify({
					maxContextLen: 300_000,
					maxOutputTokens: 40_000,
					inputPrice: 12.5,
					outputPrice: 50,
					cachedInputPrice: 1.25,
					canDisableReasoning: true,
					tags: [{ tagId: "image-to-text" }],
				}),
				{ status: 200 },
			);
		});

		const credentials = new InMemoryCredentialStore();
		await credentials.modify("bitdeer", async () => ({ type: "api_key", key: "sk-bitdeer-test" }));
		const modelsStore = new InMemoryModelsStore();
		const models = createModels({ credentials, modelsStore });
		models.setProvider(bitdeerProvider());

		expect(models.getModel("bitdeer", "moonshotai/Kimi-K3")).toMatchObject({
			cost: { input: 266, output: 1330, cacheRead: 27.55, cacheWrite: 0 },
			contextWindow: 262_144,
			maxTokens: 1_048_576,
		});
		expect((await models.refresh({ providers: ["bitdeer"] })).errors.size).toBe(0);
		// Live site metadata replaces the seeded limits and pricing.
		expect(models.getModel("bitdeer", "moonshotai/Kimi-K3")).toMatchObject({
			name: "Kimi K3",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 300_000,
			maxTokens: 40_000,
			cost: { input: 12.5, output: 50, cacheRead: 1.25, cacheWrite: 0 },
			thinkingLevelMap: { off: "none" },
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
