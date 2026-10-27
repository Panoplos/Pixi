/**
 * Find the RPC socket of a session already running in a terminal.
 *
 * One socket per session lives in the agent directory, named after the session id.
 * A program can list them, address one by id or id prefix, or simply take the
 * newest session that still answers.
 */

import { readdirSync, statSync } from "node:fs";
import * as net from "node:net";
import { join } from "node:path";
import { APP_NAME, getAgentDir } from "../../config.ts";

export interface RpcEndpoint {
	sessionId: string;
	path: string;
}

const SOCKET_SUFFIX = ".sock";

/** Directory holding the sockets of the sessions served by this agent directory. */
export function rpcSocketDir(): string {
	return join(getAgentDir(), "rpc");
}

/** Where the socket for a session lives. Windows has no socket files, so use a pipe. */
export function rpcSocketPath(sessionId: string): string {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\${APP_NAME}-rpc-${sessionId}`;
	}
	return join(rpcSocketDir(), `${sessionId}${SOCKET_SUFFIX}`);
}

/**
 * Sessions with a socket, newest first.
 *
 * Reads the directory only. A session that crashed without cleaning up leaves its
 * socket file behind, so an entry is not proof that something is listening;
 * `findRpcSocket` checks that before returning one.
 */
export function listRpcEndpoints(): RpcEndpoint[] {
	if (process.platform === "win32") {
		// shortcut: named pipes are not enumerable by session id, pass a session id instead.
		return [];
	}
	let names: string[];
	try {
		names = readdirSync(rpcSocketDir());
	} catch {
		return [];
	}
	return names
		.filter((name) => name.endsWith(SOCKET_SUFFIX))
		.map((name) => {
			const path = join(rpcSocketDir(), name);
			return { sessionId: name.slice(0, -SOCKET_SUFFIX.length), path, startedAt: mtime(path) };
		})
		.sort((a, b) => b.startedAt - a.startedAt)
		.map(({ sessionId, path }) => ({ sessionId, path }));
}

function mtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

async function isServing(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect(path);
		const finish = (serving: boolean) => {
			socket.destroy();
			resolve(serving);
		};
		socket.setTimeout(300, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

/**
 * Resolve a target to a socket path.
 *
 * A path is used as given, a session id or unique id prefix selects that session,
 * and no target at all selects the newest session that still answers.
 */
export async function findRpcSocket(target?: string): Promise<string> {
	if (target) {
		if (/[\\/]/.test(target) || target.endsWith(SOCKET_SUFFIX)) return target;
		const endpoints = listRpcEndpoints();
		const matches = endpoints.filter((endpoint) => endpoint.sessionId.startsWith(target));
		if (matches.length === 1) return matches[0].path;
		if (matches.length > 1) {
			throw new Error(
				`"${target}" matches ${matches.length} sessions: ${matches.map((m) => m.sessionId).join(", ")}`,
			);
		}
		throw new Error(`No session matches "${target}". Serving: ${describe(endpoints)}`);
	}

	const endpoints = listRpcEndpoints();
	for (const endpoint of endpoints) {
		if (await isServing(endpoint.path)) return endpoint.path;
	}
	throw new Error(`No session is serving RPC. Known sockets: ${describe(endpoints)}`);
}

function describe(endpoints: RpcEndpoint[]): string {
	return endpoints.length === 0 ? "none" : endpoints.map((endpoint) => endpoint.sessionId).join(", ");
}
