import type { Model, OpenAICompletionsCompat, ThinkingLevelMap } from "../types.ts";

export const INCO_BASE_URL = "https://api.inco.ai/v1";
export const INCO_MODELS_URL = `${INCO_BASE_URL}/models`;

const INCO_COMPAT = {
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

/** Strip serving-tier suffixes (":fast") so tier ids resolve to the seeded base model. */
function baseModelId(id: string): string {
	return id.split(":")[0] ?? id;
}

function displayName(id: string): string {
	const base = id.split(":")[0] ?? id;
	return base
		.split(/[-_/]/g)
		.filter((part) => part.length > 0)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function incoModel(input: {
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
		baseUrl: INCO_BASE_URL,
		provider: "inco",
		reasoning: input.reasoning,
		...(input.reasoning ? { thinkingLevelMap: REASONING_THINKING_LEVEL_MAP } : {}),
		input: input.input,
		cost: input.cost,
		contextWindow: input.contextWindow,
		maxTokens: input.maxTokens,
		compat: INCO_COMPAT,
	};
}

/** Documented launch catalog. Used when generate-models has no API key and as metadata for live IDs. */
export function getIncoSeedModels(): Model<"openai-completions">[] {
	return [
		incoModel({
			id: "deepseek-v4.1-flash:fast",
			name: "DeepSeek V4.1 Flash",
			reasoning: true,
			input: ["text"],
			cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		}),
		incoModel({
			id: "glm-5.3",
			name: "GLM-5.3",
			reasoning: true,
			input: ["text"],
			cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 131_072,
		}),
		incoModel({
			id: "glm-5.3-flash",
			name: "GLM-5.3-Flash",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 131_072,
		}),
		incoModel({
			id: "kimi-k3",
			name: "Kimi K3",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 131_072,
		}),
		incoModel({
			id: "minimax-m3",
			name: "MiniMax M3",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
			contextWindow: 1_048_576,
			maxTokens: 512_000,
		}),
	];
}

function seedById(): Map<string, Model<"openai-completions">> {
	return new Map(getIncoSeedModels().map((model) => [model.id, model]));
}

function parseIncoChatModel(
	raw: unknown,
	known: Map<string, Model<"openai-completions">>,
): Model<"openai-completions"> | undefined {
	if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return undefined;
	// Tier suffixes (e.g. "glm-5.3-flash:fast") are the same underlying model as the
	// seeded base id, and the live catalog exposes no metadata to override it with.
	const knownModel = known.get(raw.id) ?? known.get(baseModelId(raw.id));
	if (knownModel) {
		const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : knownModel.name;
		return { ...knownModel, id: raw.id, name };
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

	return incoModel({
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

/** Map Inco's `/v1/models` payload to chat-capable pi models. */
export function parseIncoChatModels(value: unknown): Model<"openai-completions">[] {
	if (!isRecord(value) || !Array.isArray(value.data)) return [];
	const known = seedById();
	const models: Model<"openai-completions">[] = [];
	for (const raw of value.data) {
		const model = parseIncoChatModel(raw, known);
		if (model) models.push(model);
	}
	return models;
}

export interface FetchIncoChatModelsOptions {
	apiKey?: string;
	signal?: AbortSignal;
}

/** Inco's model catalog requires an API key. Without one, the documented seed catalog is returned. */
export async function fetchIncoChatModels(
	options: FetchIncoChatModelsOptions = {},
): Promise<Model<"openai-completions">[]> {
	if (!options.apiKey) return getIncoSeedModels();
	const response = await fetch(INCO_MODELS_URL, {
		headers: { authorization: `Bearer ${options.apiKey}` },
		signal: options.signal,
	});
	if (!response.ok) throw new Error(`Inco API returned ${response.status}`);
	const models = parseIncoChatModels(await response.json());
	return models.length > 0 ? models : getIncoSeedModels();
}
