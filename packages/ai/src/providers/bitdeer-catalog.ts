import type { Model, OpenAICompletionsCompat, ThinkingLevelMap } from "../types.ts";

export const BITDEER_BASE_URL = "https://api-inference.bitdeer.ai/v1";
export const BITDEER_MODELS_URL = `${BITDEER_BASE_URL}/models`;

const BITDEER_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
} as const satisfies OpenAICompletionsCompat;

const REASONING_THINKING_LEVEL_MAP = { off: "none" } as const satisfies ThinkingLevelMap;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function displayName(id: string): string {
	return id
		.split(/[-_/]/g)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function bitdeerModel(input: {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: Model<"openai-completions">["cost"];
	contextWindow: number;
	maxTokens: number;
}): Model<"openai-completions"> {
	return {
		id: input.id,
		name: input.name,
		api: "openai-completions",
		baseUrl: BITDEER_BASE_URL,
		provider: "bitdeer",
		reasoning: input.reasoning,
		...(input.reasoning ? { thinkingLevelMap: REASONING_THINKING_LEVEL_MAP } : {}),
		input: input.input,
		cost: input.cost,
		contextWindow: input.contextWindow,
		maxTokens: input.maxTokens,
		compat: BITDEER_COMPAT,
	};
}

/** `/v1/models` ids that are not chat models (embeddings, rerankers, image generation).
 * The payload carries no tags or metadata to filter on, so these families are matched by id. */
const NON_CHAT_ID_RE = /^BAAI\//i;

function isChatModelId(id: string): boolean {
	if (NON_CHAT_ID_RE.test(id)) return false;
	return !/^(seedream|reranker)/i.test(id.split("/").pop() ?? id);
}

/** Chat models measured on the live `/v1/models` endpoint. Used when generate-models has no API
 * key and as metadata for live IDs. Costs/context are vendor-family reference numbers from the
 * models' own upstream prices, not Bitdeer's reseller pricing - regenerate with a BITDEER_API_KEY
 * to replace them with live metadata. */
export function getBitdeerSeedModels(): Model<"openai-completions">[] {
	return [
		bitdeerModel({
			id: "deepseek-ai/DeepSeek-V4.1-Flash",
			name: "DeepSeek V4.1 Flash",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		}),
		bitdeerModel({
			id: "deepseek-ai/DeepSeek-V4-Flash",
			name: "DeepSeek V4 Flash",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		}),
		bitdeerModel({
			id: "zai-org/GLM-5.3",
			name: "GLM 5.3",
			reasoning: true,
			input: ["text"],
			cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
			contextWindow: 1_048_575,
			maxTokens: 943_717,
		}),
		bitdeerModel({
			id: "zai-org/GLM-5.3-Flash",
			name: "GLM 5.3 Flash",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 131_072,
		}),
		bitdeerModel({
			id: "moonshotai/Kimi-K3",
			name: "Kimi K3",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 131_072,
		}),
		bitdeerModel({
			id: "Qwen/Qwen3.8-27B",
			name: "Qwen3.8 27B",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.214, output: 2.55, cacheRead: 0.15, cacheWrite: 0 },
			contextWindow: 262_144,
			maxTokens: 131_072,
		}),
	];
}

function seedById(): Map<string, Model<"openai-completions">> {
	return new Map(getBitdeerSeedModels().map((model) => [model.id, model]));
}

function parseBitdeerChatModel(
	raw: unknown,
	known: Map<string, Model<"openai-completions">>,
): Model<"openai-completions"> | undefined {
	if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return undefined;
	const seed = known.get(raw.id);
	if (seed) {
		const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : seed.name;
		return { ...seed, id: raw.id, name };
	}

	const metadata = isRecord(raw.metadata) ? raw.metadata : raw;
	const pricing = isRecord(metadata.pricing) ? metadata.pricing : {};
	const inputCost = round4(finiteNumber(pricing.input_tokens, 0));
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter((tag): tag is string => typeof tag === "string")
		: [];
	const reasoning = tags.length === 0 || tags.includes("reasoning");
	const hasVision = tags.includes("vision") || tags.includes("vlm");
	const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : displayName(raw.id);

	return bitdeerModel({
		id: raw.id,
		name,
		reasoning,
		input: hasVision ? ["text", "image"] : ["text"],
		cost: {
			input: inputCost,
			output: round4(finiteNumber(pricing.output_tokens, 0)),
			cacheRead: round4(finiteNumber(pricing.cache_read_tokens, inputCost)),
			cacheWrite: 0,
		},
		contextWindow: finiteNumber(metadata.context_length ?? metadata.context_window, 128_000),
		maxTokens: finiteNumber(metadata.max_tokens, 4096),
	});
}

/** Map Bitdeer's `/v1/models` payload to chat-capable pi models. */
export function parseBitdeerChatModels(value: unknown): Model<"openai-completions">[] {
	if (!isRecord(value) || !Array.isArray(value.data)) return [];
	const known = seedById();
	const models: Model<"openai-completions">[] = [];
	for (const raw of value.data) {
		const model = parseBitdeerChatModel(raw, known);
		if (model && isChatModelId(model.id)) models.push(model);
	}
	return models;
}

export interface FetchBitdeerChatModelsOptions {
	apiKey?: string;
	signal?: AbortSignal;
}

/** Bitdeer's model catalog requires an API key. Without one, the documented seed catalog is returned. */
export async function fetchBitdeerChatModels(
	options: FetchBitdeerChatModelsOptions = {},
): Promise<Model<"openai-completions">[]> {
	if (!options.apiKey) return getBitdeerSeedModels();
	const response = await fetch(BITDEER_MODELS_URL, {
		headers: { authorization: `Bearer ${options.apiKey}` },
		signal: options.signal,
	});
	if (!response.ok) throw new Error(`Bitdeer API returned ${response.status}`);
	const models = parseBitdeerChatModels(await response.json());
	return models.length > 0 ? models : getBitdeerSeedModels();
}
