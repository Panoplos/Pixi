import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

beforeEach(() => {
	allowNetwork();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DeepInfra provider catalog refresh", () => {
	it("refreshes from DeepInfra instead of the pi.dev overlay", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url === "https://api.deepinfra.com/v1/openai/models") {
				return new Response(
					JSON.stringify({
						data: [
							{
								id: "zai-org/GLM-5.3-Flash",
								name: "GLM-5.3-Flash",
								metadata: {
									context_length: 1_048_576,
									max_tokens: 131_072,
									pricing: { input_tokens: 0.075, output_tokens: 0.25, cache_read_tokens: 0.015 },
									tags: ["chat", "vision", "reasoning"],
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			if (url.includes("/api/models/providers/")) {
				return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				deepinfra: { type: "api_key", key: "test-key" },
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});

		const result = await runtime.refresh({ providers: ["deepinfra"], allowNetwork: true });
		expect(result.errors.size).toBe(0);
		expect(runtime.getModel("deepinfra", "zai-org/GLM-5.3-Flash")).toMatchObject({
			name: "GLM-5.3-Flash",
			provider: "deepinfra",
		});
		expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/models/providers/deepinfra"))).toBe(false);
		expect(fetchSpy.mock.calls.some(([url]) => String(url) === "https://api.deepinfra.com/v1/openai/models")).toBe(
			true,
		);
	});
});
