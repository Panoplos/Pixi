import { defineProvider } from "../define.ts";

export default defineProvider({
	// Models arrive fully formed from Bitdeer's key-gated catalog plus the measured seed list.
	id: "bitdeer",
	models: (ctx) => ctx.sources.bitdeer,
});
