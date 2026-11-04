#!/usr/bin/env node
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { main } from "./main.ts";
import { runRpcCli } from "./modes/rpc/cli.ts";

process.title = `${APP_NAME}-rpc`;
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

const [command, ...rest] = process.argv.slice(2);

if (command === "send" || command === "list" || command === "help" || command === "-h" || command === "--help") {
	void runRpcCli([command, ...rest], {
		out: (text) => process.stdout.write(text),
		err: (text) => process.stderr.write(text),
	}).then((code) => {
		process.exitCode = code;
	});
} else {
	main(["--mode", "rpc", ...process.argv.slice(2)]);
}
