/**
 * `pixi-rpc` subcommands that address a session already serving RPC on its socket:
 * `send` hands it one message, `list` shows which sessions are listening.
 *
 * The connection carries only this command; the session keeps running afterwards.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSessionsDir } from "../../config.ts";
import { isRpcServing, listRpcEndpoints, type RpcEndpoint } from "./discovery.ts";
import { connectRpcClient, type RpcClient } from "./rpc-client.ts";

/** Entry type OptChat writes to record the profile a session belongs to. */
const PROFILE_ENTRY = "optchat.profile";

const USAGE = `Usage: pixi-rpc <command>

Commands:
  send [--session-id <id> | --profile <name>] [--timeout <secs>] <message>
      Send one message to a running session and stream its reply.
  list
      Sessions serving RPC, with their OptChat profile.

Without a command, pixi-rpc runs a session in RPC mode and speaks JSON lines on stdin.

send options:
  --session-id <id>   Session id, unique id prefix, or socket path (default: newest serving)
  --profile <name>    OptChat profile of the session to send to (--optchat-profile also works)
  --timeout <secs>    Stop waiting for the session to settle (default: 600)
`;

export interface RpcCliOutput {
	out(text: string): void;
	err(text: string): void;
}

export async function runRpcCli(argv: string[], io: RpcCliOutput): Promise<number> {
	const [command, ...rest] = argv;
	switch (command) {
		case "send":
			return send(rest, io);
		case "list":
			return list(io);
		default:
			io.out(USAGE);
			return command === "help" || command === "--help" || command === "-h" ? 0 : 1;
	}
}

async function send(argv: string[], io: RpcCliOutput): Promise<number> {
	let target: string | undefined;
	let profile: string | undefined;
	let timeoutMs = 600_000;
	const words: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--") {
			words.push(...argv.slice(i + 1));
			break;
		}
		if (arg === "--session-id" || arg === "--session") {
			target = argv[++i];
			if (!target) {
				io.err("--session-id needs a session id.\n");
				return 1;
			}
		} else if (arg === "--profile" || arg === "--optchat-profile") {
			profile = argv[++i];
			if (!profile) {
				io.err(`${arg} needs a profile name.\n`);
				return 1;
			}
		} else if (arg === "--timeout") {
			const seconds = Number(argv[++i]);
			if (!Number.isFinite(seconds) || seconds <= 0) {
				io.err("--timeout needs a positive number of seconds.\n");
				return 1;
			}
			timeoutMs = seconds * 1000;
		} else if (arg.startsWith("-")) {
			io.err(`Unknown option: ${arg}\n\n${USAGE}`);
			return 1;
		} else {
			words.push(arg);
		}
	}

	if (target && profile) {
		io.err("Pick one of --session-id and --profile.\n");
		return 1;
	}

	const message = words.join(" ").trim();
	if (message.length === 0) {
		io.err(USAGE);
		return 1;
	}

	let client: RpcClient;
	try {
		client = await connectRpcClient(profile === undefined ? target : await socketForProfile(profile));
	} catch (error) {
		io.err(`${errorText(error)}\n`);
		return 1;
	}

	let streamed = false;
	const unsubscribe = client.onEvent((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			streamed = true;
			io.out(event.assistantMessageEvent.delta);
		}
	});

	try {
		// A busy session queues the message as a follow-up instead of rejecting it.
		if ((await client.prompt(message, undefined, "followUp")) !== "handled") {
			await client.waitForIdle(timeoutMs);
		}
		if (streamed) io.out("\n");
		return 0;
	} catch (error) {
		io.err(`${errorText(error)}\n`);
		return 1;
	} finally {
		unsubscribe();
		await client.stop();
	}
}

/** The socket of the serving session on OptChat profile `name`. */
async function socketForProfile(name: string): Promise<string> {
	const live = await servingEndpoints();
	const matches = live.filter((endpoint) => profileOf(endpoint.sessionId) === name);
	if (matches.length === 1) return matches[0].path;
	if (matches.length > 1) {
		throw new Error(
			`Profile "${name}" is on ${matches.length} sessions: ${matches.map((m) => m.sessionId).join(", ")}`,
		);
	}
	const known = live.map((endpoint) => `${endpoint.sessionId}  ${profileOf(endpoint.sessionId) ?? "-"}`);
	throw new Error(`No session is on profile "${name}". Serving: ${known.length === 0 ? "none" : known.join(", ")}`);
}

/** Sessions whose socket answers right now. */
async function servingEndpoints(): Promise<RpcEndpoint[]> {
	const serving = await Promise.all(
		listRpcEndpoints().map(async (endpoint) => ((await isRpcServing(endpoint.path)) ? endpoint : null)),
	);
	return serving.filter((endpoint) => endpoint !== null);
}

async function list(io: RpcCliOutput): Promise<number> {
	const live = await servingEndpoints();
	if (live.length === 0) {
		io.out("No session is serving RPC.\n");
		return 0;
	}

	const rows = live.map((endpoint) => ({
		id: endpoint.sessionId,
		profile: profileOf(endpoint.sessionId) ?? "-",
	}));
	const width = Math.max(...rows.map((row) => row.id.length));
	for (const row of rows) io.out(`${row.id.padEnd(width)}  ${row.profile}\n`);
	return 0;
}

/** The OptChat profile a session belongs to, from the last binding entry in its file. */
function profileOf(sessionId: string): string | undefined {
	const file = sessionFile(sessionId);
	if (!file) return undefined;

	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}

	for (const line of text.split("\n").reverse()) {
		if (!line.includes(PROFILE_ENTRY)) continue;
		try {
			const entry = JSON.parse(line) as { customType?: string; data?: { name?: unknown } };
			if (entry.customType === PROFILE_ENTRY && typeof entry.data?.name === "string") return entry.data.name;
		} catch {
			// A torn last line is not a binding.
		}
	}
	return undefined;
}

/** Session files are named `<timestamp>_<session id>.jsonl` under one directory per project. */
function sessionFile(sessionId: string): string | undefined {
	const root = getSessionsDir();
	const suffix = `${sessionId}.jsonl`;
	let dirs: string[];
	try {
		dirs = readdirSync(root);
	} catch {
		return undefined;
	}
	for (const dir of dirs) {
		try {
			const name = readdirSync(join(root, dir)).find((file) => file.endsWith(suffix));
			if (name) return join(root, dir, name);
		} catch {
			// Not a directory; the sessions root also holds files.
		}
	}
	return undefined;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
