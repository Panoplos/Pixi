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

describe("Inco provider catalog refresh", () => {
	it("refreshes from Inco instead of the pi.dev overlay", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url === "https://api.inco.ai/v1/models") {
				return new Response(JSON.stringify({ data: [{ id: "glm-5.3" }, { id: "glm-5.4-flash" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/api/models/providers/")) {
				return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});

		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				inco: { type: "api_key", key: "sk-inco-test" },
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});

		const result = await runtime.refresh({ providers: ["inco"], allowNetwork: true });
		expect(result.errors.size).toBe(0);
		expect(runtime.getModel("inco", "glm-5.4-flash")).toMatchObject({
			provider: "inco",
		});
		expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/models/providers/inco"))).toBe(false);
		expect(fetchSpy.mock.calls.some(([url]) => String(url) === "https://api.inco.ai/v1/models")).toBe(true);
	});
});
