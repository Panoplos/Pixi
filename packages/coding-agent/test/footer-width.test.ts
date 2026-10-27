import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
}): AgentSession {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const session = {
		state: {
			messages: entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		getEffectiveContextWindow: () => 200_000,
		getAvailableThinkingLevels: () =>
			options.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"] : ["off"],
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(providerCount: number, statuses: Record<string, string> = {}): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(Object.entries(statuses)),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("combines pwd, branch, context, and model into a single status line", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1));

		const line = stripAnsi(footer.render(120)[0]);
		expect(line).toContain("/tmp/project");
		expect(line).toContain("(main)");
		expect(line).toContain("12.3%/200k");
		expect(line).toContain("test-model");
	});

	it("shows the usage an extension reports in place of the session's own", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1));

		footer.setContextUsage({ tokens: 31_457, contextWindow: 314_572, percent: 10 });
		expect(stripAnsi(footer.render(120)[0])).toContain("10.0%/315k");

		footer.setContextUsage(undefined);
		expect(stripAnsi(footer.render(120)[0])).toContain("12.3%/200k");
	});

	it("shows the RPC indicator on its own line, right-aligned under the model", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setRpcSessionId("01a17c27-1733-74b6-99f6-88d328d5526d");

		const lines = footer.render(80);
		expect(lines).toHaveLength(2);
		const indicator = stripAnsi(lines[1]);
		expect(indicator.trim()).toBe("rpc 01a17c27");
		expect(visibleWidth(lines[1])).toBeLessThanOrEqual(80);
		// Right-aligned, with the last column left free like other right-aligned footer text.
		expect(indicator.length).toBeGreaterThanOrEqual(78);
	});

	it("shares the status line with extension statuses, right-aligned", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, { optchat: "OptChat: pixi-development", ponytail: "ponytail: full" }),
		);
		footer.setRpcSessionId("01a17c27-1733-74b6-99f6-88d328d5526d");

		const lines = footer.render(100);
		expect(lines).toHaveLength(2);
		const statusLine = stripAnsi(lines[1]);
		expect(statusLine).toContain("OptChat: pixi-development");
		expect(statusLine).toContain("ponytail: full");
		expect(statusLine.trimEnd()).toMatch(/rpc 01a17c27$/);
		expect(statusLine.length).toBeGreaterThanOrEqual(98);
		expect(visibleWidth(lines[1])).toBeLessThanOrEqual(100);
	});

	it("puts stats: statuses in the stats line, not the status line", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				"stats:optchat": "pixi-development",
				optchat: "importing",
				ponytail: "ponytail: full",
			}),
		);

		const lines = footer.render(100);
		expect(lines).toHaveLength(2);
		const statsLine = stripAnsi(lines[0]);
		expect(statsLine.split(" · ")).toContain("pixi-development");
		const statusLine = stripAnsi(lines[1]);
		expect(statusLine).not.toContain("pixi-development");
		expect(statusLine).toContain("importing");
		expect(statusLine).toContain("ponytail: full");
	});

	it("truncates statuses to leave room for the RPC indicator", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1, { optchat: "x".repeat(80) }));
		footer.setRpcSessionId("01a17c27-1733-74b6-99f6-88d328d5526d");

		const lines = footer.render(40);
		expect(lines).toHaveLength(2);
		const statusLine = stripAnsi(lines[1]);
		expect(statusLine.trimEnd()).toMatch(/rpc 01a17c27$/);
		expect(visibleWidth(lines[1])).toBeLessThanOrEqual(40);
	});

	it("stays within width when the RPC indicator has no room", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setRpcSessionId("01a17c27-1733-74b6-99f6-88d328d5526d");

		for (const line of footer.render(6)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(6);
		}
	});

	it("shows the auto-compact indicator when enabled", () => {
		const session = createSession({ sessionName: "" });
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[0])).toContain("(auto)");
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		expect(stripAnsi(footer.render(120)[0])).toContain("CHR:25.0%");
	});
});
