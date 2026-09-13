import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test } from "vitest";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import { writeRenderers } from "../src/core/tools/renderers/write.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function renderContext(lastComponent: Component | undefined, argsComplete: boolean): ToolRenderContext {
	return {
		args: undefined,
		toolCallId: "write-1",
		invalidate: () => {},
		lastComponent,
		state: undefined,
		cwd: process.cwd(),
		executionStarted: false,
		argsComplete,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
	};
}

describe("write renderer highlight cache", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders with unchanged args reuse the same cache object", () => {
		const args = { file_path: "/tmp/sample.ts", content: "const value = 1;\n".repeat(200) };
		const first = writeRenderers.renderCall!(args, theme, renderContext(undefined, true));
		const second = writeRenderers.renderCall!(args, theme, renderContext(first, true));
		expect((second as { cache?: unknown }).cache).toBe((first as { cache?: unknown }).cache);
	});

	test("changed args rebuild the cache for the new content", () => {
		const first = writeRenderers.renderCall!(
			{ file_path: "/tmp/sample.ts", content: "const value = 1;\n".repeat(200) },
			theme,
			renderContext(undefined, true),
		);
		const second = writeRenderers.renderCall!(
			{ file_path: "/tmp/sample.ts", content: "const delta = 2;\n" },
			theme,
			renderContext(first, true),
		);
		expect((second as { cache?: { rawContent: string } }).cache?.rawContent).toBe("const delta = 2;\n");
	});
});
