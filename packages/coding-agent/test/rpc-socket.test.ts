import { mkdirSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { RpcCommandDeps } from "../src/modes/rpc/commands.ts";
import { findRpcSocket, listRpcEndpoints, rpcSocketPath } from "../src/modes/rpc/discovery.ts";
import { connectRpcClient } from "../src/modes/rpc/rpc-client.ts";
import { type RpcSocketServer, startRpcSocketServer } from "../src/modes/rpc/socket-server.ts";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "./suite/harness.ts";

interface Wire {
	type: string;
	id?: string;
	command?: string;
	success?: boolean;
	error?: string;
	data?: Record<string, unknown>;
}

function connect(path: string) {
	const socket = net.connect(path);
	const records: Wire[] = [];
	let buffer = "";

	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		buffer += chunk;
		let index = buffer.indexOf("\n");
		while (index !== -1) {
			records.push(JSON.parse(buffer.slice(0, index)) as Wire);
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
		}
	});

	return {
		send: (command: object) => socket.write(`${JSON.stringify(command)}\n`),
		/** Resolve with the first record matching `match`, including records already received. */
		async waitFor(match: (record: Wire) => boolean): Promise<Wire> {
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				const found = records.find(match);
				if (found) return found;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			throw new Error(`No matching record. Received: ${JSON.stringify(records)}`);
		},
		close: () => socket.destroy(),
	};
}

describe("RPC socket server", () => {
	let harness: Harness;
	let server: RpcSocketServer;
	let path: string;

	beforeEach(async () => {
		harness = await createHarness();
		path = join(tmpdir(), `pixi-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
		const deps: RpcCommandDeps = {
			get session() {
				return harness.session;
			},
			// The commands below never replace the session, so the runtime host stays untouched.
			runtimeHost: {} as AgentSessionRuntime,
			rebindSession: async () => {},
		};
		server = await startRpcSocketServer({ path, deps });
	});

	afterEach(() => {
		server.close();
		harness.cleanup();
	});

	it("answers a command with the session state", async () => {
		const client = connect(path);
		client.send({ id: "1", type: "get_state" });

		const response = await client.waitFor((record) => record.id === "1");
		expect(response).toMatchObject({ type: "response", command: "get_state", success: true });
		expect(response.data).toMatchObject({
			isStreaming: false,
			sessionId: harness.session.sessionId,
			messageCount: 0,
		});

		client.close();
	});

	it("streams the events of a prompt to the socket", async () => {
		harness.setResponses([fauxAssistantMessage("hello from the socket")]);
		const client = connect(path);
		client.send({ id: "1", type: "prompt", message: "say hello" });

		const response = await client.waitFor((record) => record.id === "1");
		expect(response).toMatchObject({ command: "prompt", success: true });
		expect(response.data).toEqual({ disposition: "started" });

		await client.waitFor((record) => record.type === "agent_settled");
		expect(getUserTexts(harness)).toEqual(["say hello"]);
		expect(getAssistantTexts(harness)).toEqual(["hello from the socket"]);

		client.close();
	});

	it("drives the session through RpcClient", async () => {
		harness.setResponses([fauxAssistantMessage("ported to the socket")]);

		const client = await connectRpcClient(path);
		expect((await client.getState()).isStreaming).toBe(false);

		const events = await client.promptAndWait("say hello");
		expect(events.map((event) => event.type)).toContain("agent_settled");
		expect(getAssistantTexts(harness)).toEqual(["ported to the socket"]);

		await client.stop();
		// Stopping a client closes its connection, not the session it was talking to.
		const next = await connectRpcClient(path);
		expect((await next.getState()).sessionId).toBe(harness.session.sessionId);
		await next.stop();
	});

	it("reports an unknown command without dropping the connection", async () => {
		const client = connect(path);
		client.send({ id: "1", type: "nope" });
		const failed = await client.waitFor((record) => record.id === "1");
		expect(failed).toMatchObject({ success: false, error: "Unknown command: nope" });

		// A second subscription on the same connection is what the TUI's rebind does.
		server.resubscribe();
		client.send({ id: "2", type: "get_state" });
		expect(await client.waitFor((record) => record.id === "2")).toMatchObject({ success: true });

		client.close();
	});
});

describe("RPC discovery", () => {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	let harness: Harness;
	let agentDir: string;
	let servers: RpcSocketServer[];

	const startOn = async (path: string) => {
		const deps: RpcCommandDeps = {
			get session() {
				return harness.session;
			},
			runtimeHost: {} as AgentSessionRuntime,
			rebindSession: async () => {},
		};
		const server = await startRpcSocketServer({ path, deps });
		servers.push(server);
		return server;
	};

	beforeEach(async () => {
		harness = await createHarness();
		agentDir = join(tmpdir(), `pixi-rpc-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		servers = [];
	});

	afterEach(() => {
		for (const server of servers) server.close();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		harness.cleanup();
	});

	it("finds the session by id prefix and by default", async () => {
		const sessionId = harness.session.sessionId;
		await startOn(rpcSocketPath(sessionId));

		expect(listRpcEndpoints()).toEqual([{ sessionId, path: rpcSocketPath(sessionId) }]);
		expect(await findRpcSocket(sessionId.slice(0, 8))).toBe(rpcSocketPath(sessionId));

		const client = await connectRpcClient();
		expect((await client.getState()).sessionId).toBe(sessionId);
		await client.stop();
	});

	it("skips a socket left behind by a crashed session", async () => {
		const sessionId = harness.session.sessionId;
		await startOn(rpcSocketPath(sessionId));
		// Newer than the live socket, and nothing is listening on it.
		const stalePath = rpcSocketPath("aaaaaaaa-dead-0000-0000-000000000000");
		mkdirSync(join(agentDir, "rpc"), { recursive: true });
		writeFileSync(stalePath, "");

		expect(listRpcEndpoints().map((endpoint) => endpoint.sessionId)).toContain(
			"aaaaaaaa-dead-0000-0000-000000000000",
		);
		expect(await findRpcSocket()).toBe(rpcSocketPath(sessionId));
	});

	it("reports an unknown or ambiguous target", async () => {
		const first = "bbbbbbbb-0000-0000-0000-000000000001";
		const second = "bbbbbbbb-0000-0000-0000-000000000002";
		await startOn(rpcSocketPath(first));
		await startOn(rpcSocketPath(second));

		await expect(findRpcSocket("cccc")).rejects.toThrow(/No session matches "cccc"/);
		await expect(findRpcSocket("bbbbbbbb")).rejects.toThrow(/matches 2 sessions/);
	});
});
