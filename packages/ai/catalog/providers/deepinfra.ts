import { defineProvider } from "../define.ts";

export default defineProvider({
	// Models arrive fully formed from DeepInfra's public catalog.
	id: "deepinfra",
	models: (ctx) => ctx.sources.deepinfra,
});
