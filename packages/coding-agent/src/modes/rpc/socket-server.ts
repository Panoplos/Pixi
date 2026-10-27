/**
 * RPC over a local socket, for an interactive session.
 *
 * RPC mode owns stdin and stdout, so only the process that started it can talk to
 * it. An interactive session owns the terminal instead, so it serves the same
 * commands on a Unix socket: another program writes JSONL commands and reads
 * responses and session events without touching the TUI.
 *
 * One socket per session, `${agentDir}/rpc/<sessionId>.sock`, readable only by
 * the user who runs Pi. Every connected client receives the event stream;
 * responses go back only to the client whose line produced them.
 */

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import * as net from "node:net";
import { dirname } from "node:path";
import type { AgentSessionEvent } from "../../core/agent-session.ts";
import { toJsonEvent } from "../json-event.ts";
import type { RpcCommandDeps } from "./commands.ts";
import { handleRpcCommand, rpcError } from "./commands.ts";
import { rpcSocketPath } from "./discovery.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "./rpc-types.ts";

export interface RpcSocketServerOptions {
	/** Socket path. Defaults to the per-session path in the agent directory. */
	path?: string;
	deps: RpcCommandDeps;
	/** Reported when the socket cannot be served; the TUI keeps running either way. */
	onError?: (message: string) => void;
}

export interface RpcSocketServer {
	readonly path: string;
	/** Follow the session after a command or the TUI replaced it. */
	resubscribe(): void;
	close(): void;
}

export async function startRpcSocketServer(options: RpcSocketServerOptions): Promise<RpcSocketServer> {
	const { deps } = options;
	const path = options.path ?? rpcSocketPath(deps.session.sessionId);
	const clients = new Set<net.Socket>();

	let unsubscribe: (() => void) | undefined;
	const subscribe = () => {
		unsubscribe?.();
		unsubscribe = deps.session.subscribe((event: AgentSessionEvent) => {
			const line = serializeJsonLine(toJsonEvent(event));
			for (const client of clients) {
				client.write(line);
			}
		});
	};

	const handleLine = async (client: net.Socket, line: string) => {
		const send = (response: RpcResponse) => {
			if (!client.destroyed) {
				client.write(serializeJsonLine(response));
			}
		};

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			send(
				rpcError(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			return;
		}

		// Extension dialogs are answered in the TUI that owns the terminal, so a
		// client's answer has nothing to resolve here.
		if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
			if (parsed.type === "extension_ui_response") return void (parsed as RpcExtensionUIResponse);
		}

		try {
			const response = await handleRpcCommand(parsed as RpcCommand, deps, send);
			if (response) send(response);
		} catch (commandError: unknown) {
			send(
				rpcError(
					(parsed as RpcCommand).id,
					(parsed as RpcCommand).type,
					commandError instanceof Error ? commandError.message : String(commandError),
				),
			);
		}
	};

	const server = net.createServer((client) => {
		clients.add(client);
		client.on("close", () => clients.delete(client));
		client.on("error", () => clients.delete(client));
		const detach = attachJsonlLineReader(client, (line) => {
			void handleLine(client, line);
		});
		client.on("close", detach);
	});

	if (process.platform !== "win32") {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		// A crashed session leaves its socket behind and nothing is listening on it.
		rmSync(path, { force: true });
	}

	const listening = await new Promise<string | undefined>((resolve) => {
		server.once("error", (error: Error) => resolve(error.message));
		server.listen(path, () => resolve(undefined));
	});
	if (listening) {
		server.close();
		throw new Error(`Cannot serve RPC on ${path}: ${listening}`);
	}
	if (process.platform !== "win32") {
		chmodSync(path, 0o600);
	}

	subscribe();

	return {
		path,
		resubscribe: subscribe,
		close: () => {
			unsubscribe?.();
			unsubscribe = undefined;
			for (const client of clients) {
				client.destroy();
			}
			clients.clear();
			server.close();
			if (process.platform !== "win32") {
				rmSync(path, { force: true });
			}
		},
	};
}
