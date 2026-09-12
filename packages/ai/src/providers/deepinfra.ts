import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { DEEPINFRA_MODELS } from "./deepinfra.models.ts";
import { DEEPINFRA_BASE_URL, fetchDeepInfraChatModels } from "./deepinfra-catalog.ts";

export function deepInfraProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "deepinfra",
		name: "DeepInfra",
		baseUrl: DEEPINFRA_BASE_URL,
		auth: { apiKey: envApiKeyAuth("DeepInfra API key", ["DEEPINFRA_API_KEY"]) },
		models: Object.values(DEEPINFRA_MODELS),
		fetchModels: ({ signal }) => fetchDeepInfraChatModels(signal),
		api: openAICompletionsApi(),
	});
}
