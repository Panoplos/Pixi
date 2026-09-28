import type { Model, OpenAICompletionsCompat, ThinkingLevelMap } from "../types.ts";

export const BITDEER_BASE_URL = "https://api-inference.bitdeer.ai/v1";
export const BITDEER_MODELS_URL = `${BITDEER_BASE_URL}/models`;

// Bitdeer's key-gated /v1/models endpoint serves bare ids with no metadata. The public website API
// is the only source of per-model limits (maxContextLen, maxOutputTokens) and reseller pricing.
export const BITDEER_SITE_LIST_URL = "https://www.bitdeer.ai/api/model/v1/ListModels";
const BITDEER_SITE_MODEL_URL = "https://www.bitdeer.ai/api/model/v1/GetModel";

const BITDEER_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	maxTokensField: "max_tokens",
} as const satisfies OpenAICompletionsCompat;

const REASONING_THINKING_LEVEL_MAP = { off: "none" } as const satisfies ThinkingLevelMap;
const NO_DISABLE_THINKING_LEVEL_MAP = { off: null } as const satisfies ThinkingLevelMap;

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
	/** Whether the endpoint accepts `reasoning_effort: "none"` (defaults to true). Models that
	 * cannot disable reasoning 400 on "none", so "off" must be unrepresentable for them. */
	canDisableReasoning?: boolean;
	input: ("text" | "image")[];
	cost: Model<"openai-completions">["cost"];
	contextWindow: number;
	maxTokens: number;
}): Model<"openai-completions"> {
	const canDisable = input.canDisableReasoning ?? true;
	return {
		id: input.id,
		name: input.name,
		api: "openai-completions",
		baseUrl: BITDEER_BASE_URL,
		provider: "bitdeer",
		reasoning: input.reasoning,
		...(input.reasoning
			? { thinkingLevelMap: canDisable ? REASONING_THINKING_LEVEL_MAP : NO_DISABLE_THINKING_LEVEL_MAP }
			: {}),
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

/** Chat models measured on Bitdeer's public site API (ListModels + GetModel per model). Used when
 * generate-models or refresh has no API key, and as fallback when live fetches fail. Do not substitute
 * vendor reference numbers: Bitdeer caps context (e.g. 256K for GLM-5.3/Kimi-K3) and prices at its own rates. */
export function getBitdeerSeedModels(): Model<"openai-completions">[] {
	return [
		bitdeerModel({
			id: "deepseek-ai/DeepSeek-V4.1-Flash",
			name: "DeepSeek V4.1 Flash",
			reasoning: true,
			input: ["text"],
			cost: { input: 15, output: 120, cacheRead: 0.3, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 393_216,
		}),
		bitdeerModel({
			id: "deepseek-ai/DeepSeek-V4-Flash",
			name: "DeepSeek V4 Flash",
			reasoning: true,
			input: ["text"],
			cost: { input: 14, output: 28, cacheRead: 1, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 393_216,
		}),
		bitdeerModel({
			id: "zai-org/GLM-5.3",
			name: "GLM 5.3",
			reasoning: true,
			canDisableReasoning: false,
			input: ["text"],
			cost: { input: 140, output: 440, cacheRead: 14, cacheWrite: 0 },
			contextWindow: 262_144,
			maxTokens: 131_072,
		}),
		bitdeerModel({
			id: "zai-org/GLM-5.3-Flash",
			name: "GLM 5.3 Flash",
			reasoning: true,
			canDisableReasoning: false,
			input: ["text", "image"],
			cost: { input: 7.5, output: 25, cacheRead: 1.5, cacheWrite: 0 },
			contextWindow: 262_144,
			maxTokens: 131_072,
		}),
		bitdeerModel({
			id: "moonshotai/Kimi-K3",
			name: "Kimi K3",
			reasoning: true,
			canDisableReasoning: false,
			input: ["text", "image"],
			cost: { input: 266, output: 1330, cacheRead: 27.55, cacheWrite: 0 },
			contextWindow: 262_144,
			maxTokens: 1_048_576,
		}),
		bitdeerModel({
			id: "Qwen/Qwen3.8-27B",
			name: "Qwen3.8 27B",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 40, output: 240, cacheRead: 8, cacheWrite: 0 },
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

/** Live ids can differ from site names by a dated suffix, e.g. `DeepSeek-V4-Flash` vs `DeepSeek-V4-Flash(0731)`. */
function siteModelKey(name: string): string {
	return name.split("(")[0]?.trim().toLowerCase() ?? name.toLowerCase();
}

interface BitdeerSiteModelMeta {
	contextWindow: number;
	maxTokens: number;
	cost: Model<"openai-completions">["cost"];
	hasVision: boolean;
	canDisableReasoning: boolean;
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) throw new Error(`Bitdeer site API returned ${response.status}`);
	return response.json();
}

/** Fetch per-model limits and reseller pricing from Bitdeer's public website API. */
export async function fetchBitdeerSiteModelMeta(signal?: AbortSignal): Promise<Map<string, BitdeerSiteModelMeta>> {
	const list = await postJson(BITDEER_SITE_LIST_URL, {}, signal);
	if (!isRecord(list) || !Array.isArray(list.models)) throw new Error("Unexpected Bitdeer site model list");
	const meta = new Map<string, BitdeerSiteModelMeta>();
	await Promise.all(
		list.models.map(async (raw) => {
			if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.modelId !== "string") return;
			const detail = await postJson(BITDEER_SITE_MODEL_URL, { modelId: raw.modelId }, signal);
			if (!isRecord(detail)) return;
			const tags = Array.isArray(detail.tags) ? detail.tags : [];
			meta.set(siteModelKey(raw.name), {
				contextWindow: finiteNumber(detail.maxContextLen, 0),
				maxTokens: finiteNumber(detail.maxOutputTokens, 0),
				cost: {
					input: round4(finiteNumber(detail.inputPrice, 0)),
					output: round4(finiteNumber(detail.outputPrice, 0)),
					cacheRead: round4(finiteNumber(detail.cachedInputPrice, 0)),
					cacheWrite: 0,
				},
				hasVision: tags.some((tag) => isRecord(tag) && tag.tagId === "image-to-text"),
				canDisableReasoning: detail.canDisableReasoning === true,
			});
		}),
	);
	return meta;
}

function applyBitdeerSiteMeta(models: Model<"openai-completions">[], meta: Map<string, BitdeerSiteModelMeta>): void {
	for (const model of models) {
		const site = meta.get(siteModelKey(model.id));
		if (!site) continue;
		if (site.contextWindow > 0) model.contextWindow = site.contextWindow;
		if (site.maxTokens > 0) model.maxTokens = site.maxTokens;
		if (site.cost.input > 0 || site.cost.output > 0) model.cost = site.cost;
		if (site.hasVision) model.input = ["text", "image"];
		if (model.reasoning) {
			model.thinkingLevelMap = site.canDisableReasoning ? { off: "none" } : { off: null };
		}
	}
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

/** With an API key, ids come from the key-gated `/v1/models` endpoint and limits/pricing from the
 * public site API (best effort - seeds are the fallback). Without one, the measured seed catalog is returned. */
export async function fetchBitdeerChatModels(
	options: FetchBitdeerChatModelsOptions = {},
): Promise<Model<"openai-completions">[]> {
	if (!options.apiKey) return getBitdeerSeedModels();
	const [response, siteMeta] = await Promise.all([
		fetch(BITDEER_MODELS_URL, {
			headers: { authorization: `Bearer ${options.apiKey}` },
			signal: options.signal,
		}),
		fetchBitdeerSiteModelMeta(options.signal).catch(() => undefined),
	]);
	if (!response.ok) throw new Error(`Bitdeer API returned ${response.status}`);
	const models = parseBitdeerChatModels(await response.json());
	if (models.length === 0) return getBitdeerSeedModels();
	if (siteMeta) applyBitdeerSiteMeta(models, siteMeta);
	return models;
}
