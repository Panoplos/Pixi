/**
 * Destructive Tool Guard Extension
 *
 * Port of the Codex/Claude PreToolUse destructive-command hook. When a
 * potentially destructive command is detected, the guard:
 *   1. Asks the active model for a one-line justification.
 *   2. Shows that reason to the user as part of the approval dialog.
 *   3. Runs the command only if the user approves.
 *
 * Demonstrates blocking tool calls via the tool_call event and combining
 * a side LLM call (ctx.model + ctx.modelRegistry.complete) with ctx.ui.confirm.
 */

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DESTRUCTIVE_PATTERNS: Array<[string, RegExp]> = [
	["rm", /(^|[;&|()]\s*|\b(?:sudo|doas|xargs)\s+)rm\s+/],
	["rmdir", /(^|[;&|()]\s*|\b(?:sudo|doas|xargs)\s+)rmdir\s+/],
	["mv", /(^|[;&|()]\s*|\b(?:sudo|doas|xargs)\s+)mv\s+/],
	["cp/copy", /(^|[;&|()]\s*|\b(?:sudo|doas|xargs)\s+)(cp|copy|ditto)\s+/],
	["rsync/scp", /(^|[;&|()]\s*|\b(?:sudo|doas|xargs)\s+)(rsync|scp)\s+/],
	["git reset", /(^|[;&|()]\s*)git\s+reset\s+(--hard|--merge|--keep)\b/],
	["git clean", /(^|[;&|()]\s*)git\s+clean\s+.*(?:-[^\s]*[fdxX]|--force)/],
	["git force", /(^|[;&|()]\s*)git\s+(push|fetch|branch|tag)\s+.*(--force|--force-with-lease|-f)\b/],
	["git delete", /(^|[;&|()]\s*)git\s+(push|branch|tag)\s+.*(--delete|-d|-D)\b/],
	["git worktree remove", /(^|[;&|()]\s*)git\s+worktree\s+(remove|prune)\b/],
	["git checkout file", /(^|[;&|()]\s*)git\s+(checkout|restore)\s+.*(--worktree|--staged|--source|\s--\s)/],
	["chmod/chown recursive", /(^|[;&|()]\s*|\b(?:sudo|doas)\s+)(chmod|chown|chgrp)\s+.*(?:-[^\s]*R|--recursive)\b/],
	["filesystem wipe", /(^|[;&|()]\s*|\b(?:sudo|doas)\s+)(mkfs|diskutil\s+erase|dd\s+).*\b/],
	["find delete", /(^|[;&|()]\s*)find\s+.*\s-delete\b/],
	["prune", /(^|[;&|()]\s*)(docker|podman|npm|pnpm|yarn|bun)\s+.*\bprune\b/],
	["redirection truncate", /(^|[;&|()]\s*)(truncate\s+-s\s+0|:\s*>\s*|>\|)/],
];

const REASON_SYSTEM_PROMPT = `You are a safety justification assistant running before a shell command executes.
A command the environment flagged as potentially destructive is about to run. Write a SHORT, neutral
one or two sentence justification for why this command is being issued — what it accomplishes in the
current task and, if applicable, why it is expected/safe. Do not speculate about malice. If there is no
reasonable justification, say "No clear justification provided." Output plain text only, no markdown.`;

/** Reason shown when the justification call is unavailable or times out. */
function reasonFor(label: string): string {
	return `Blocked potentially destructive Bash command (${label}). Ask the user for explicit confirmation or use a safer non-destructive command.`;
}

/**
 * Ask the active model for a one-line justification of the command.
 * Falls back to the static reason string if no model / completion is available.
 */
async function solicitReason(cmd: string, ctx: ExtensionContext): Promise<string> {
	const { model, modelRegistry: registry } = ctx;
	if (!model) return "";

	try {
		const userMessage: UserMessage = {
			role: "user",
			content: [{ type: "text", text: `Command about to run:\n${cmd}\n\nWhy is this command necessary?` }],
			timestamp: Date.now(),
		};
		const response: AssistantMessage = await registry.complete(
			model,
			{ systemPrompt: REASON_SYSTEM_PROMPT, messages: [userMessage] },
			// Reasoning models can take a while; keep the approval dialog snappy.
			{ signal: AbortSignal.timeout(15000) },
		);
		if (response.stopReason === "aborted") return "";
		return response.content
			.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
	} catch {
		return "";
	}
}

/** Confirm dialog body: model justification (if any), the command, and the prompt. */
function buildDialogBody(opts: { reason?: string; command?: string }): string {
	const lines: string[] = [];
	if (opts.reason && opts.reason.length > 0) {
		lines.push(`Reason: ${opts.reason}`);
	}
	if (opts.command && opts.command.length > 0) {
		lines.push(`Command: ${opts.command}`);
	}
	lines.push("—", "Run it?");
	return lines.join("\n\n");
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const cmd = String(event.input?.command ?? "");
			if (!cmd) return;

			const haystack = cmd.trim().split(/\s+/).join(" ");

			for (const [label, pattern] of DESTRUCTIVE_PATTERNS) {
				if (!pattern.test(haystack)) continue;

				const fallback = reasonFor(label);
				const reason = (await solicitReason(cmd, ctx)) || fallback;
				const allowed = await ctx.ui.confirm(
					`⚠ Destructive ${label} command`,
					buildDialogBody({ reason, command: cmd }),
				);
				return allowed ? undefined : { block: true, reason: fallback };
			}
			return;
		}

		// apply_patch-style delete hunks — explicit file removals.
		if (event.toolName === "apply_patch") {
			const content =
				typeof event.input?.content === "string" ? event.input.content : String(event.input?.command ?? "");
			if (/^(\*\*\* Delete File:\s+.*)$/m.test(content)) {
				const fallback =
					"Blocked destructive apply_patch operation: file deletion. Ask the user before deleting files.";
				const reason = (await solicitReason(content, ctx)) || fallback;
				const allowed = await ctx.ui.confirm(
					"⚠ Destructive file deletion",
					buildDialogBody({ reason, command: content.split("\n")[0] ?? content }),
				);
				return allowed ? undefined : { block: true, reason: fallback };
			}
		}
	});
}
