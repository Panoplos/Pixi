import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { INCO_MODELS } from "./inco.models.ts";
import { fetchIncoChatModels, INCO_BASE_URL } from "./inco-catalog.ts";

export function incoProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "inco",
		name: "Inco",
		baseUrl: INCO_BASE_URL,
		auth: { apiKey: envApiKeyAuth("Inco API key", ["INCO_API_KEY"]) },
		models: Object.values(INCO_MODELS),
		fetchModels: ({ credential, signal }) =>
			fetchIncoChatModels({
				apiKey: credential?.type === "api_key" ? credential.key : undefined,
				signal,
			}),
		api: openAICompletionsApi(),
	});
}
