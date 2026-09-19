import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { BITDEER_MODELS } from "./bitdeer.models.ts";
import { BITDEER_BASE_URL, fetchBitdeerChatModels } from "./bitdeer-catalog.ts";

export function bitdeerProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "bitdeer",
		name: "Bitdeer",
		baseUrl: BITDEER_BASE_URL,
		auth: { apiKey: envApiKeyAuth("Bitdeer API key", ["BITDEER_API_KEY"]) },
		models: Object.values(BITDEER_MODELS),
		fetchModels: ({ credential, signal }) =>
			fetchBitdeerChatModels({
				apiKey: credential?.type === "api_key" ? credential.key : undefined,
				signal,
			}),
		api: openAICompletionsApi(),
	});
}
