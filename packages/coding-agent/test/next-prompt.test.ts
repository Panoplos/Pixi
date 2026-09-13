import { describe, expect, it } from "vitest";
import {
	buildNextPromptContext,
	extractNextPromptInput,
	SUGGESTION_MAX_LENGTH,
	sanitizeSuggestion,
} from "../src/core/next-prompt.ts";

describe("sanitizeSuggestion", () => {
	it("passes through a clean one-liner", () => {
		expect(sanitizeSuggestion("run the tests")).toBe("run the tests");
	});

	it("takes the first meaningful line and collapses its whitespace", () => {
		expect(sanitizeSuggestion("run the tests\n\nsecond line")).toBe("run the tests");
		expect(sanitizeSuggestion("run  the\n\ttests")).toBe("run the");
	});

	it("ignores code fence wrappers", () => {
		expect(sanitizeSuggestion("```\nrun the tests\n```")).toBe("run the tests");
	});

	it("strips one pair of wrapping quotes", () => {
		expect(sanitizeSuggestion('"run the tests"')).toBe("run the tests");
		expect(sanitizeSuggestion("`run the tests`")).toBe("run the tests");
	});

	it("rejects empties and the NONE sentinel", () => {
		expect(sanitizeSuggestion("")).toBeUndefined();
		expect(sanitizeSuggestion("      ")).toBeUndefined();
		expect(sanitizeSuggestion("NONE")).toBeUndefined();
		expect(sanitizeSuggestion("none.")).toBeUndefined();
	});

	it("collapses internal whitespace runs", () => {
		expect(sanitizeSuggestion("run the   tests")).toBe("run the tests");
	});

	it("cuts over-long suggestions at a word boundary and rejects hopeless overruns", () => {
		const long =
			"please run the full test suite, fix each failing test one at a time, and rerun the suite to confirm everything passes";
		const result = sanitizeSuggestion(long);
		expect(result).toBe(
			"please run the full test suite, fix each failing test one at a time, and rerun the suite to confirm",
		);
		expect((result ?? "").length).toBeLessThanOrEqual(SUGGESTION_MAX_LENGTH);

		const oneWord = "a".repeat(SUGGESTION_MAX_LENGTH + 10);
		expect(sanitizeSuggestion(oneWord)).toBeUndefined();
	});
});

describe("extractNextPromptInput", () => {
	// Assistant messages in AgentMessage carry provider metadata fields that are
	// irrelevant to content extraction; test literals only need role + content.
	const textMessage = (text: string, timestamp: number): Parameters<typeof extractNextPromptInput>[0][number] =>
		({ role: "assistant", content: [{ type: "text", text }], timestamp }) as never;

	it("takes the last assistant text and the user turn before it", () => {
		const input = extractNextPromptInput([
			{ role: "user", content: "first turn", timestamp: 0 },
			textMessage("did the first thing", 1),
			{ role: "user", content: "second turn", timestamp: 2 },
			textMessage("did the second thing", 3),
		]);
		expect(input).toEqual({ assistantText: "did the second thing", userText: "second turn" });
	});

	it("skips assistant messages without text and contentless custom messages", () => {
		const input = extractNextPromptInput([
			{ role: "user", content: "go", timestamp: 0 },
			{ type: "bash_execution", command: "ls" } as never,
			textMessage("", 1),
			textMessage("the real reply", 2),
		] as never[] as Parameters<typeof extractNextPromptInput>[0]);
		expect(input).toEqual({ assistantText: "the real reply", userText: "go" });
	});

	it("returns undefined with no assistant text at all", () => {
		expect(extractNextPromptInput([{ role: "user", content: "hi", timestamp: 0 }])).toBeUndefined();
	});
});

describe("buildNextPromptContext", () => {
	it("instructions come first, variable content after", () => {
		const context = buildNextPromptContext({ assistantText: "the response", userText: "the ask" });
		const message = context.messages[0];
		const content = typeof message.content === "string" ? message.content : "";
		const head = content.slice(0, content.indexOf("<assistant_response>"));
		expect(head).toContain("under 100 characters");
		expect(content).toContain("<assistant_response>\nthe response\n</assistant_response>");
		expect(content).toContain("<previous_user_message>\nthe ask\n</previous_user_message>");
	});

	it("omits the previous-user section when unavailable and clips long snippets", () => {
		const context = buildNextPromptContext({ assistantText: "x".repeat(5000) });
		const content = context.messages[0].content as string;
		expect(content).not.toContain("previous_user_message>");
		expect(content).toContain("…");
		expect((content.match(/x/) ?? []).length).toBeLessThan(5000);
	});
});
