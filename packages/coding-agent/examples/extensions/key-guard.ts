// key-guard — masks secret material before it enters the model context.
//
// Intercepts two entry paths:
//   1. tool_result  — every model-driven tool result (bash, read, custom tools)
//   2. input        — user messages (pasted commands, keys)
//
// Detection is delegated to `pixi-mask` (../pixi-mask, a Rust CLI): the
// gitleaks default ruleset behind a keyword prefilter, Shannon entropy gates,
// a bare high-entropy rule, a base64 decode pass, and exact values from
// ~/.pi/agent/auth.json, ~/.aws/credentials, ~/.npmrc, ~/.config/gh/hosts.yml
// and ./.env. One call per text, ~4-7 ms.
//
// If the binary is not on PATH the extension falls back to the simpler
// in-process patterns below, so it still works standalone.
//
// Masked values keep a 4-char prefix for debuggability. Values are read by the
// binary on every call; rotate keys => no restart needed on the fallback path
// only (the binary re-reads files per run either way).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BIN = process.env.PIXI_MASK_BIN ?? "pixi-mask";

const MASK = (s: string) => `${s.slice(0, 4)}…[REDACTED]`;

// Token-shape patterns: prefix-anchored, high confidence. Fallback only.
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
	/\b(hf|gsk)_[A-Za-z0-9]{30,}\b/g, // Hugging Face, Groq
	/\bxai-[A-Za-z0-9]{40,}\b/g, // xAI
	/\bdckr_pat_[A-Za-z0-9_-]{20,}\b/g, // Docker
	/\bsb[pr]_[A-Za-z0-9_-]{30,}\b/g, // Supabase
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM blocks
	/\bBearer\s+[A-Za-z0-9_\-.=+/]{20,}/g, // Authorization headers
];

// Keyword-anchored assignments: api_key=..., "secret": "...", OPENAI_API_KEY=...
// The `[\w.-]{0,50}?` prefix is what makes `OPENAI_API_KEY=` match; a `\b`
// before the keyword does not, because `_` is a word character.
const ASSIGNMENT =
	/[\w.-]{0,50}?(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|creds)[\w.-]{0,20}["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{15,}[0-9][A-Za-z0-9_\-./+=]*)/gi;

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
	out = out.replace(ASSIGNMENT, (m, value: string) => m.slice(0, m.length - value.length) + MASK(value));
	return out;
}

interface Masked {
	text: string;
	count: number;
}

/** Mask through the pixi-mask CLI. Returns undefined when it is unavailable. */
function maskWithCli(text: string): Masked | undefined {
	let res: ReturnType<typeof spawnSync>;
	try {
		res = spawnSync(BIN, ["mask", "--json"], {
			input: text,
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch {
		return undefined;
	}
	if (res.error || res.status !== 0 || typeof res.stdout !== "string" || res.stdout === "") return undefined;
	try {
		const parsed = JSON.parse(res.stdout) as { text?: unknown; findings?: unknown };
		if (typeof parsed.text !== "string") return undefined;
		return { text: parsed.text, count: Array.isArray(parsed.findings) ? parsed.findings.length : 0 };
	} catch {
		return undefined;
	}
}

export default function keyGuard(pi: ExtensionAPI) {
	const known = loadAuthSecrets();
	let notified = false;
	let cliWorks: boolean | undefined;

	const guard = (
		text: string,
		ctx: { ui?: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	): string => {
		let masked: string;
		if (cliWorks === false) {
			masked = maskSecrets(text, known);
		} else {
			const result = maskWithCli(text);
			if (result) {
				cliWorks = true;
				masked = result.text;
			} else {
				cliWorks = false;
				masked = maskSecrets(text, known);
			}
		}
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
