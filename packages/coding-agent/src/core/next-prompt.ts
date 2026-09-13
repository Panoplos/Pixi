import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type Api, type Context, contentText, type Model, uuidv7 } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "./model-runtime.ts";

/**
 * Suggested next user message ("ghost text"): after a turn finishes, ask the
 * model what the user would plausibly type next and show it as muted inline
 * text in the empty editor. Tab streams it into the input.
 */

/** Hard cap on a suggestion; ghost text stays scannable and one keypress long. */
export const SUGGESTION_MAX_LENGTH = 100;

const ASSISTANT_SNIPPET_MAX_CHARS = 1200;
const USER_SNIPPET_MAX_CHARS = 400;
const SUGGESTION_MAX_TOKENS = 64;

/** Sentinel the model is told to reply with when nothing sensible follows. */
const NONE_SENTINEL = "none";

export interface NextPromptSuggesterDeps {
	modelRuntime: Pick<ModelRuntime, "completeSimple">;
	model: Model<Api>;
}

export interface NextPromptInput {
	/** Text of the assistant's just-finished response. */
	assistantText: string;
	/** Text of the user's message that started the turn, if any. */
	userText?: string;
}

export function extractNextPromptInput(messages: readonly AgentMessage[]): NextPromptInput | undefined {
	// Custom agent messages (e.g. bash echo) carry no LLM content; skip them.
	const textOf = (message: AgentMessage): string =>
		"content" in message ? contentText(message.content, "").trim() : "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		const assistantText = textOf(message);
		if (!assistantText) continue;
		for (let j = i - 1; j >= 0; j--) {
			if (messages[j].role !== "user") continue;
			const userText = textOf(messages[j]);
			return { assistantText, userText: userText || undefined };
		}
		return { assistantText };
	}
	return undefined;
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function buildNextPromptContext(input: NextPromptInput): Context {
	const sections = [
		"The assistant (an interactive coding agent) just finished its response.",
		"Suggest the user's next message: what they would plausibly type next.",
		"Reply with exactly one line, under 100 characters, plain text, no quotes, no markdown.",
		"Do not restate what the assistant did. If no meaningful next step exists, reply exactly: NONE",
		"",
		"<assistant_response>",
		clip(input.assistantText, ASSISTANT_SNIPPET_MAX_CHARS),
		"</assistant_response>",
	];
	if (input.userText) {
		sections.push(
			"",
			"<previous_user_message>",
			clip(input.userText, USER_SNIPPET_MAX_CHARS),
			"</previous_user_message>",
		);
	}
	return {
		messages: [{ role: "user", content: sections.join("\n"), timestamp: Date.now() }],
	};
}

/**
 * Normalize a model reply into a usable suggestion: one line, unwrapped,
 * capped at `maxLength` on a word boundary. Returns undefined when the reply
 * is empty, the NONE sentinel, or otherwise unusable.
 */
export function sanitizeSuggestion(raw: string, maxLength = SUGGESTION_MAX_LENGTH): string | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;

	// One line: skip code-fence markers rather than treating them as the text.
	const line = trimmed
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part.length > 0 && !part.startsWith("```"));
	if (!line) return undefined;

	let text = line;
	// Strip one matching pair of wrapping quotes or backticks.
	if (
		text.length >= 2 &&
		((text.startsWith('"') && text.endsWith('"')) ||
			(text.startsWith("'") && text.endsWith("'")) ||
			(text.startsWith("`") && text.endsWith("`")))
	) {
		text = text.slice(1, -1).trim();
	}
	if (!text) return undefined;
	if (text.toLowerCase() === NONE_SENTINEL || /^none[.\s]*$/i.test(text)) return undefined;

	text = text.replace(/\s+/g, " ");
	if (text.length <= maxLength) return text;

	// Too long: cut at the last word boundary inside the cap.
	const cut = text.slice(0, maxLength);
	const spaceIndex = cut.lastIndexOf(" ");
	return spaceIndex >= 20 ? cut.slice(0, spaceIndex) : undefined;
}

/**
 * Ask the model for the user's likely next message. Rejects (throws) on
 * provider/auth errors; callers treat failures as "no suggestion".
 */
export async function suggestNextPrompt(
	deps: NextPromptSuggesterDeps,
	input: NextPromptInput,
	signal: AbortSignal,
): Promise<string | undefined> {
	const message = await deps.modelRuntime.completeSimple(deps.model, buildNextPromptContext(input), {
		maxTokens: SUGGESTION_MAX_TOKENS,
		signal,
		// One-off call: never pay for cache writes, and use a fresh routing
		// session so this request never shares or churns the live session's
		// provider-side prompt cache entries (same policy as compaction calls).
		cacheRetention: "none",
		sessionId: uuidv7(),
	});
	return sanitizeSuggestion(contentText(message.content, ""));
}
