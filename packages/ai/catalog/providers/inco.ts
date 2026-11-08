import { defineProvider } from "../define.ts";

export default defineProvider({
	// Models arrive fully formed from Inco's key-gated catalog plus the documented seed list.
	id: "inco",
	models: (ctx) => ctx.sources.inco,
});
