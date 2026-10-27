/**
 * RPC command dispatch, independent of where the JSON arrives.
 *
 * RPC mode reads commands from stdin. An interactive session reads them from a
 * socket instead. Both hand each command to this function, so the two modes drive
 * the session through exactly the same paths.
 */

import type { AgentSession } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type { RpcCommand, RpcResponse, RpcSessionState, RpcSlashCommand } from "./rpc-types.ts";

/**
 * What a command runs against. `session` must be read per command: a command can
 * replace the session, and the caller re-reads it afterwards.
 */
export interface RpcCommandDeps {
	readonly session: AgentSession;
	readonly runtimeHost: AgentSessionRuntime;
	/** Called after a command replaced the session so subscriptions can follow. */
	rebindSession(): Promise<void>;
}

export function rpcSuccess<T extends RpcCommand["type"]>(
	id: string | undefined,
	command: T,
	data?: object | null,
): RpcResponse {
	if (data === undefined) {
		return { id, type: "response", command, success: true } as RpcResponse;
	}
	return { id, type: "response", command, success: true, data } as RpcResponse;
}

export function rpcError(id: string | undefined, command: string, message: string): RpcResponse {
	return { id, type: "response", command, success: false, error: message };
}

/**
 * Run one command and return its response.
 *
 * Returns undefined for commands that answer through `output` later (a prompt
 * reports its disposition during preflight) or not at all.
 */
export async function handleRpcCommand(
	command: RpcCommand,
	deps: RpcCommandDeps,
	output: (response: RpcResponse) => void,
): Promise<RpcResponse | undefined> {
	const id = command.id;
	const session = deps.session;
	const runtimeHost = deps.runtimeHost;
	const rebindSession = () => deps.rebindSession();
	const success = rpcSuccess;
	const error = rpcError;

	switch (command.type) {
		// =================================================================
		// Prompting
		// =================================================================

		case "prompt": {
			// Start prompt handling immediately, but emit the authoritative response only after
			// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
			let preflightSucceeded = false;
			void session
				.prompt(command.message, {
					images: command.images,
					streamingBehavior: command.streamingBehavior,
					source: "rpc",
					preflightResult: (disposition) => {
						preflightSucceeded = true;
						output(success(id, "prompt", { disposition }));
					},
				})
				.catch((e) => {
					if (!preflightSucceeded) {
						output(error(id, "prompt", e.message));
					}
				});
			return undefined;
		}

		case "steer": {
			const disposition = await session.steer(command.message, command.images, { source: "rpc" });
			return success(id, "steer", { disposition });
		}

		case "follow_up": {
			const disposition = await session.followUp(command.message, command.images, { source: "rpc" });
			return success(id, "follow_up", { disposition });
		}

		case "abort": {
			await session.abort();
			return success(id, "abort");
		}

		case "clear_queue": {
			return success(id, "clear_queue", session.clearQueue());
		}

		case "new_session": {
			const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
			const result = await runtimeHost.newSession(options);
			if (!result.cancelled) {
				await rebindSession();
			}
			return success(id, "new_session", result);
		}

		// =================================================================
		// State
		// =================================================================

		case "get_state": {
			const state: RpcSessionState = {
				model: session.model,
				thinkingLevel: session.thinkingLevel,
				isStreaming: session.isStreaming,
				isCompacting: session.isCompacting,
				steeringMode: session.steeringMode,
				followUpMode: session.followUpMode,
				sessionFile: session.sessionFile,
				sessionId: session.sessionId,
				sessionName: session.sessionName,
				autoCompactionEnabled: session.autoCompactionEnabled,
				messageCount: session.messages.length,
				pendingMessageCount: session.pendingMessageCount,
			};
			return success(id, "get_state", state);
		}

		// =================================================================
		// Model
		// =================================================================

		case "set_model": {
			const models = session.modelRuntime.getAvailableSnapshot();
			const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
			if (!model) {
				return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
			}
			await session.setModel(model);
			return success(id, "set_model", model);
		}

		case "cycle_model": {
			const result = await session.cycleModel();
			if (!result) {
				return success(id, "cycle_model", null);
			}
			return success(id, "cycle_model", result);
		}

		case "get_available_models": {
			const models = session.modelRuntime.getAvailableSnapshot();
			return success(id, "get_available_models", { models });
		}

		// =================================================================
		// Thinking
		// =================================================================

		case "set_thinking_level": {
			session.setThinkingLevel(command.level);
			return success(id, "set_thinking_level");
		}

		case "cycle_thinking_level": {
			const level = session.cycleThinkingLevel();
			if (!level) {
				return success(id, "cycle_thinking_level", null);
			}
			return success(id, "cycle_thinking_level", { level });
		}

		case "get_available_thinking_levels": {
			const levels = session.getAvailableThinkingLevels();
			return success(id, "get_available_thinking_levels", { levels });
		}

		// =================================================================
		// Queue Modes
		// =================================================================

		case "set_steering_mode": {
			session.setSteeringMode(command.mode);
			return success(id, "set_steering_mode");
		}

		case "set_follow_up_mode": {
			session.setFollowUpMode(command.mode);
			return success(id, "set_follow_up_mode");
		}

		// =================================================================
		// Compaction
		// =================================================================

		case "compact": {
			const result = await session.compact(command.customInstructions);
			return success(id, "compact", result);
		}

		case "set_auto_compaction": {
			session.setAutoCompactionEnabled(command.enabled);
			return success(id, "set_auto_compaction");
		}

		// =================================================================
		// Retry
		// =================================================================

		case "set_auto_retry": {
			session.setAutoRetryEnabled(command.enabled);
			return success(id, "set_auto_retry");
		}

		case "abort_retry": {
			session.abortRetry();
			return success(id, "abort_retry");
		}

		// =================================================================
		// Bash
		// =================================================================

		case "bash": {
			const eventResult = await session.extensionRunner.emitUserBash({
				type: "user_bash",
				command: command.command,
				excludeFromContext: command.excludeFromContext ?? false,
				cwd: session.sessionManager.getCwd(),
			});

			if (eventResult?.result) {
				session.recordBashResult(command.command, eventResult.result, {
					excludeFromContext: command.excludeFromContext,
				});
				return success(id, "bash", eventResult.result);
			}

			const result = await session.executeBash(command.command, undefined, {
				excludeFromContext: command.excludeFromContext,
				id,
				operations: eventResult?.operations,
			});
			return success(id, "bash", result);
		}

		case "abort_bash": {
			session.abortBash();
			return success(id, "abort_bash");
		}

		// =================================================================
		// Session
		// =================================================================

		case "get_session_stats": {
			const stats = session.getSessionStats();
			return success(id, "get_session_stats", stats);
		}

		case "export_html": {
			const path = await session.exportToHtml(command.outputPath);
			return success(id, "export_html", { path });
		}

		case "switch_session": {
			const result = await runtimeHost.switchSession(command.sessionPath);
			if (!result.cancelled) {
				await rebindSession();
			}
			return success(id, "switch_session", result);
		}

		case "fork": {
			const result = await runtimeHost.fork(command.entryId);
			if (!result.cancelled) {
				await rebindSession();
			}
			return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
		}

		case "clone": {
			const leafId = session.sessionManager.getLeafId();
			if (!leafId) {
				return error(id, "clone", "Cannot clone session: no current entry selected");
			}
			const result = await runtimeHost.fork(leafId, { position: "at" });
			if (!result.cancelled) {
				await rebindSession();
			}
			return success(id, "clone", { cancelled: result.cancelled });
		}

		case "get_fork_messages": {
			const messages = session.getUserMessagesForForking();
			return success(id, "get_fork_messages", { messages });
		}

		case "get_entries": {
			const sessionManager = session.sessionManager;
			let entries = sessionManager.getEntries();
			if (command.since !== undefined) {
				const sinceIndex = entries.findIndex((e) => e.id === command.since);
				if (sinceIndex === -1) {
					return error(id, "get_entries", `Entry not found: ${command.since}`);
				}
				entries = entries.slice(sinceIndex + 1);
			}
			return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
		}

		case "get_tree": {
			const sessionManager = session.sessionManager;
			return success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
		}

		case "get_last_assistant_text": {
			const text = session.getLastAssistantText();
			return success(id, "get_last_assistant_text", { text });
		}

		case "set_session_name": {
			const name = command.name.trim();
			if (!name) {
				return error(id, "set_session_name", "Session name cannot be empty");
			}
			session.setSessionName(name);
			return success(id, "set_session_name");
		}

		// =================================================================
		// Messages
		// =================================================================

		case "get_messages": {
			return success(id, "get_messages", { messages: session.messages });
		}

		// =================================================================
		// Commands (available for invocation via prompt)
		// =================================================================

		case "get_commands": {
			const commands: RpcSlashCommand[] = [];

			for (const command of session.extensionRunner.getRegisteredCommands()) {
				commands.push({
					name: command.invocationName,
					description: command.description,
					source: "extension",
					sourceInfo: command.sourceInfo,
				});
			}

			for (const template of session.promptTemplates) {
				commands.push({
					name: template.name,
					description: template.description,
					source: "prompt",
					sourceInfo: template.sourceInfo,
				});
			}

			for (const skill of session.resourceLoader.getSkills().skills) {
				commands.push({
					name: `skill:${skill.name}`,
					description: skill.description,
					source: "skill",
					sourceInfo: skill.sourceInfo,
				});
			}

			return success(id, "get_commands", { commands });
		}

		default: {
			const unknownCommand = command as { type: string };
			return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
		}
	}
}
