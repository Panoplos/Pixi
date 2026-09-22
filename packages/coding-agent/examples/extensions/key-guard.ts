// key-guard — masks secret material before it enters the model context.
//
// Intercepts two entry paths:
//   1. tool_result  — every model-driven tool result (bash, read, custom tools)
//   2. input        — user messages (pasted commands, keys)
//
// Detection layers:
//   a. Exact values from ~/.pi/agent/auth.json (provider keys) — zero false positives.
//   b. High-confidence token shapes (AWS, Google, OpenAI, GitHub, Slack, JWT, ...).
//   c. Keyword-anchored assignments (api_key = "...", "token": "...", Bearer ...).
//
// Masked values keep a 4-char prefix for debuggability. Values loaded once at
// session start; rotate keys => restart pi (or /reload).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MASK = (s: string) => `${s.slice(0, 4)}…[REDACTED]`;

// Token-shape patterns: prefix-anchored, high confidence.
const SHAPES: RegExp[] = [
	/\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google
	/\bsk-(?:proj-|svcacct-|admin-|None-)?[A-Za-z0-9_-]{20,}\b/g, // OpenAI-style
	/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
	/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
	/\bglpat-[A-Za-z0-9_-]{20,}\b/g, // GitLab
	/\bnpm_[A-Za-z0-9]{30,}\b/g, // npm
	/\b[sr]k_live_[A-Za-z0-9]{20,}\b/g, // Stripe
	/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, // SendGrid
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM blocks
	/\bBearer\s+[A-Za-z0-9_\-.=+/]{16,}/g, // Authorization headers
];

// Keyword-anchored assignments: api_key=..., "secret": "...", password: ... .
// Value charset stops at quotes/backslashes, so escaped JSON is handled too.
const ASSIGNMENT =
	/\b(api[_-]?key|secret|token|password|passwd|credential|access[_-]?token|auth[_-]?token)\b(\\?["']?)?\s*\\?[:=]\\?\s*\\?["']?([A-Za-z0-9_\-.+/=]{16,})/gi;

export function loadAuthSecrets(authPath?: string): string[] {
	try {
		const raw = JSON.parse(
			readFileSync(
				authPath ??
					join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "", ".pi", "agent"), "auth.json"),
				"utf8",
			),
		) as unknown;
		const out: string[] = [];
		const walk = (node: unknown): void => {
			if (!node || typeof node !== "object") return;
			for (const [k, v] of Object.entries(node)) {
				if (
					typeof v === "string" &&
					/^(key|token|secret|api_?key)$/i.test(k) &&
					v.length >= 16 &&
					/^[A-Za-z0-9_-]+$/.test(v)
				) {
					out.push(v);
				} else {
					walk(v);
				}
			}
		};
		walk(raw);
		return out;
	} catch {
		return [];
	}
}

export function maskSecrets(text: string, known: string[]): string {
	let out = text;
	for (const s of [...known].sort((a, b) => b.length - a.length)) {
		if (out.includes(s)) out = out.split(s).join(MASK(s));
	}
	for (const rx of SHAPES) {
		out = out.replace(rx, (m) => MASK(m));
	}
	out = out.replace(
		ASSIGNMENT,
		(m, _keyword: string, _quote: string, value: string) => m.slice(0, m.length - value.length) + MASK(value),
	);
	return out;
}

export default function keyGuard(pi: ExtensionAPI) {
	const known = loadAuthSecrets();
	let notified = false;

	const guard = (
		text: string,
		ctx: { ui?: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	): string => {
		const masked = maskSecrets(text, known);
		if (masked !== text && !notified) {
			notified = true;
			// display-only; ui may be absent in headless modes
			try {
				ctx.ui?.notify("key-guard: masked secret material before it entered context", "warning");
			} catch {
				/* ignore */
			}
		}
		return masked;
	};

	pi.on("tool_result", async (event, ctx) => {
		let changed = false;
		const content = event.content.map((block) => {
			if (block.type !== "text") return block;
			const text = guard(block.text, ctx);
			if (text === block.text) return block;
			changed = true;
			return { ...block, text };
		});
		return changed ? { content } : undefined;
	});

	pi.on("input", async (event, ctx) => {
		const text = guard(event.text, ctx);
		return text === event.text ? undefined : { action: "transform", text };
	});
}
