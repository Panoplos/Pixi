import type { Model, OpenAICompletionsCompat, ThinkingLevelMap } from "../types.ts";

export const DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai";
export const DEEPINFRA_MODELS_URL = `${DEEPINFRA_BASE_URL}/models`;

const DEEPINFRA_COMPAT = {
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

function parseDeepInfraChatModel(raw: unknown): Model<"openai-completions"> | undefined {
	if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return undefined;
	const metadata = isRecord(raw.metadata) ? raw.metadata : {};
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter((tag): tag is string => typeof tag === "string")
		: [];
	if (!tags.includes("chat")) return undefined;

	const pricing = isRecord(metadata.pricing) ? metadata.pricing : {};
	const input = round4(finiteNumber(pricing.input_tokens, 0));
	const reasoning = tags.includes("reasoning");
	const hasVision = tags.includes("vision") || tags.includes("vlm");
	const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : undefined;

	return {
		id: raw.id,
		name: name ?? raw.id.split("/").pop() ?? raw.id,
		api: "openai-completions",
		baseUrl: DEEPINFRA_BASE_URL,
		provider: "deepinfra",
		reasoning,
		...(reasoning ? { thinkingLevelMap: REASONING_THINKING_LEVEL_MAP } : {}),
		input: hasVision ? ["text", "image"] : ["text"],
		cost: {
			input,
			output: round4(finiteNumber(pricing.output_tokens, 0)),
			cacheRead: round4(finiteNumber(pricing.cache_read_tokens, input)),
			cacheWrite: 0,
		},
		contextWindow: finiteNumber(metadata.context_length, 128_000),
		maxTokens: finiteNumber(metadata.max_tokens, 4096),
		compat: DEEPINFRA_COMPAT,
	};
}

/** Map DeepInfra's public `/v1/openai/models` payload to chat-capable pi models. */
export function parseDeepInfraChatModels(value: unknown): Model<"openai-completions">[] {
	if (!isRecord(value) || !Array.isArray(value.data)) return [];
	const models: Model<"openai-completions">[] = [];
	for (const raw of value.data) {
		const model = parseDeepInfraChatModel(raw);
		if (model) models.push(model);
	}
	return models;
}

/** DeepInfra's public catalog requires no API key. Only chat models are included. */
export async function fetchDeepInfraChatModels(signal?: AbortSignal): Promise<Model<"openai-completions">[]> {
	const response = await fetch(DEEPINFRA_MODELS_URL, { signal });
	if (!response.ok) throw new Error(`DeepInfra API returned ${response.status}`);
	return parseDeepInfraChatModels(await response.json());
}
