import { Container, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { ToolActivitySummaryComponent } from "../src/modes/interactive/components/tool-activity-summary.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const getExpandableBlocks = (
	InteractiveMode.prototype as unknown as {
		getExpandableBlocks(): (ToolActivitySummaryComponent | ToolExecutionComponent)[];
	}
).getExpandableBlocks;

describe("expand Up/Down navigation includes write/edit blocks", () => {
	test("getExpandableBlocks returns aggregate sections plus standalone write blocks", () => {
		initTheme("dark");
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const chatContainer = new Container();

		const section = new ToolActivitySummaryComponent(
			{ createExecution: () => undefined as never, expanded: false },
			ui,
		);
		const writeBlock = new ToolExecutionComponent(
			"write",
			"write-1",
			{ path: "x" },
			{},
			undefined,
			ui,
			process.cwd(),
		);
		chatContainer.addChild(section);
		chatContainer.addChild(writeBlock);

		const blocks = getExpandableBlocks.call({ chatContainer });

		expect(blocks).toEqual([section, writeBlock]);
	});
});
