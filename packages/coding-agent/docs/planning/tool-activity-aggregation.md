# Tool / System-Call Aggregate View

Status: planned (not implemented)

Feature: replace the per-tool-call boxes with a live-updating, expandable
aggregate summary of tool and shell (system) activity during a turn, so a chain
of actions collapses into a single compact section instead of many stacked boxes.

## Goal behavior

While the agent works on a turn, consecutive tool calls with no assistant
commentary between them collapse into one contained section whose summary line
updates live as the actions chain:

```
Committed 9be7da6, read 1 file, ran 3 shell commands
```

If the agent emits visible text (commentary) between tool calls, the current
section is finalized and a new one starts after the commentary:

```
Committed 9be7da6, read 1 file

Now I will ...                       <- commentary splits the sections

Ran 3 shell commands
```

Each section is a single contained, multi-line block. By default only the
one-line summary is visible; the full tool outputs are hidden until the user
expands the section (see Expand mode).

## Current architecture (baseline)

Every tool call gets its own `ToolExecutionComponent` box appended directly to
`chatContainer` (`packages/coding-agent/src/modes/interactive/components/tool-execution.ts`),
driven by session events in `interactive-mode.ts`:

- `message_start` / `message_update` / `message_end` stream an
  `AssistantMessageComponent`; each `toolCall` in the message content gets a
  fresh `ToolExecutionComponent` (`interactive-mode.ts`, message_update branch,
  ~line 3164, and 3238).
- `tool_execution_start` / `update` / `end` locate the matching component via
  `pendingTools` (keyed by `toolCallId`) and feed it args / result as it runs
  (~line 3226-3260).
- On session load / compaction rebuild, `renderSessionItems` (~line 3474)
  reconstructs the same per-tool boxes by replaying stored assistant messages
  and `toolResult`s.

`AssistantMessageComponent` (`components/assistant-message.ts`) renders the
text/thinking of each assistant message; the tool boxes sit alongside it in the
chat container.

## Design decisions (confirmed)

1. **Replace via Expand mode.** The aggregate view replaces the per-tool boxes.
   `Ctrl+o` puts the TUI into expand mode: the immediately-last aggregate
   section is expanded. `Up` / `Down` expand the previous / next aggregate
   section in history.
2. **Live.** The summary line updates as each tool call completes (running
   per-tool counts/details), not only when the group is finalized.
3. **Contained multi-line sections.** Each aggregate is one contained section;
   it may be multi-line when expanded. Collapsed, only the one-line summary is
   shown. Sections are hidden until expanded.
4. **Grouping rule: split on commentary.** Any visible assistant text splits the
   current section. Consecutive tool calls with no text between them share a
   section.
5. **Base prompt: act, don't narrate.** Add the default prompt guideline that
   the agent must issue tool calls directly without announcing/narrating them
   (mirroring the user's `APPEND_SYSTEM.md` guidance). Added to
   `buildSystemPrompt`'s always-include guidelines. Note: custom prompts bypass
   the default guidelines entirely; the narration guidance is only added to the
   default (built-in) prompt.

## Fix: per-round agent runs must not split sections

The coding-agent session drives each tool round as its own agent run:
`agent.prompt()` then `while (_handlePostAgentRun()) agent.continue()`, and every
`agent.continue()` (a `runAgentLoopContinue`) re-emits `agent_start`/`agent_end`.
Initial wiring finalized the active section on `agent_start` and `agent_end`,
which split every tool round into its own section (the "9 x ran 1 shell
command" symptom). Fix: only finalize on (a) visible text commentary and (b) a
new user turn; removed the `agent_start`/`agent_end` finalize. Verified with a
probe reproducing the per-round event pattern (3 rounds -> one section).

## Expand mode covers truncated tool output too

The existing tool renderers (read, write, bash, grep, find, ls, ...) truncate
long output and append a hint line ending in `...` + `(N more lines / N total,
ctrl+o to expand)` (e.g. `core/tools/read.ts`, `write.ts`, `bash.ts`). Today
`Ctrl+o` (`app.tools.expand` -> `expandTools` action, bound to `ctrl+o`) is a
**global** toggle: `setToolsExpanded` walks every chat child and calls
`setExpanded` on the expandable ones, revealing those truncated blocks
(`interactive-mode.ts`, `setToolsExpanded`).

New behavior: `Ctrl+o` enters **expand mode** and reveals the immediately-last
section; `Up`/`Down` move the reveal through previous/next sections. The
sections that can be revealed are the set currently reachable via
`isExpandable`/`setExpanded` (aggregate summary sections **and** the existing
truncated-output blocks inside tool execution / bash / custom components). So
`Up`/`Down` navigates across both aggregate sections and standalone truncated
blocks uniformly, and revealing a section shows its full detail / full
(truncated) output instead of the `... N more lines` preview.

This replaces the current global `Ctrl+o` toggle with per-section navigation.
Expansion state should persist across reload/compaction the same way
`toolOutputExpanded` does today.

## Grouping rule (canonical, shared by live + rebuild)

Flatten a turn into an ordered sequence of `text` and `toolCall` units (in
message order). Per the approved change, **commentary `text` never splits**: all
`toolCall` units in a turn share one section until a user turn or a standalone
`write`/`edit`. `write`/`edit` are emitted as their own standalone tool block
(never folded into a group). The same function is used (a) incrementally by the
live stream and (b) over the stored session stream on rebuild, so the persisted
and live views always agree. Grouping is derived, never stored.

Note (why commentary splits were confusing live): the model's preamble text only
renders in the transient streaming component, which is removed at `agent_end`, so
commentary briefly flashes and then disappears next to the sections — yet
`hasVisibleText`-style finalization still split on it. Removing that split also
removes the invisible-perceived fragmentation. (The old split-on-text rule and
its justification were replaced by this one.)

## New components / modules

- `components/tool-activity-summary.ts` — `ToolActivitySummaryComponent`, a
  single `chatContainer` child representing one section:
  - accumulates one group (running per-tool counts + details),
  - re-renders live as `tool_execution_start/update/end` arrive,
  - finalized on a user turn (and per standalone `write`/`edit`),
  - renders a collapsible section (summary line collapsed; full per-tool detail
    when expanded).
- `core/tool-activity-summary.ts` (pure, testable) — grouping function and the
  per-tool **phrase registry**:
  - `read` -> "read N file(s)"; `write`/`edit` -> "edited N file(s)";
  - `bash` -> "ran N shell command(s)", with special-casing so a `git commit`
    command renders "Committed <hash>";
  - extension / generic tools -> "ran N <tool>" fallback, with an optional
    override hook on `ToolDefinition` (e.g. `renderSummary?`);
  - preserves first-appearance order within a section (per the examples).
- Uses the existing `ToolExecutionComponent` renderers for the expanded detail
  view (reuse, not reimplement).

## Integration points

- **Live streaming** (`interactive-mode.ts`): route `message_update` and
  `tool_execution_*` tool-call handling into the active summary component
  instead of appending new boxes. Finalize on assistant `text` and on
  `agent_end`.
- **Rebuild / persistence** (`renderSessionItems`): replace per-tool box
  reconstruction with the grouping function over the stored message stream.
- **Expand mode + keybinds** (`keybindings.ts`): `Ctrl+o` enters expand mode and
  reveals the last section; `Up`/`Down` move the expanded section through
  history. Aggregate sections must be addressable/navigable in chat order.
- **System prompt**: see Finding below.

## Finding: system prompt does not forbid short preambles

Verified in `packages/coding-agent/src/core/system-prompt.ts`
(`buildSystemPrompt`). The default appended system prompt does **not** instruct
the model to avoid commentary / preambles before tool calls. The only relevant
guidelines are "Be concise in your responses" and "Show file paths clearly when
working with files". There is no "run tools directly / do not narrate before
tool calls" guidance.

Consequence: with "any commentary splits", models that emit short preambles
("Let me check that...") before each tool would produce many single-tool
sections, defeating the purpose.

**Resolved:** an always-include default guideline was added to
`buildSystemPrompt` mirroring the user's local `APPEND_SYSTEM.md`: issue tool
calls directly and immediately without announcing or narrating them (no "Now
let me...", "Let's...", "I'll...", "First, I'll..."). This applies to the
**default** prompt only — `customPrompt` returns early and does not receive the
default guidelines.

## Phased implementation

1. Pure core: grouping function + phrase registry + unit tests
   (`core/tool-activity-summary.ts`, `test/tool-activity-summary.test.ts`).
   **Done** — `splitActivitySections`, `summarizeSection`, `extractCommitHash`,
   `ToolPhraseOverride`; 16 unit tests passing, biome-clean.
2. `ToolActivitySummaryComponent` rendering (collapsed summary + expanded
   detail reusing `ToolExecutionComponent` renderers). **Done** —
   `components/tool-activity-summary.ts`; holds inner `ToolExecutionComponent`s
   and routes per-tool mutations through to them; collapsed shows the summary
   line, expanded shows the full inner executions (including their truncated
   `... N more lines` outputs).
3. Wire live streaming in `interactive-mode.ts` (replace per-tool append with
   the aggregator; finalize on text / `agent_end`). **Done** —
   `activeToolSection` / `sectionByToolCall` drive `message_update` and the
   `tool_execution_*` handlers; sections finalize on commentary text,
   `agent_end`, and user turns.
4. Wire `renderSessionItems` rebuild so loaded / compacted sessions render the
   same sections. **Done** — rebuild uses the same section helpers and grouping
   rule; 4167 regression test updated for the collapsed-by-default layout.
5. Expand mode: `Ctrl+o` / `Up` / `Down` keybinds + section navigation (
   covering aggregate sections **and** truncated-output blocks; see "Expand
   mode covers truncated tool output too") + expansion state persistence.
   **Done (runtime state)** — `Ctrl+o` toggles expand mode (reveals most recent
   section); `Up`/`Down` navigate via a `CustomEditor.onNavigateVertical` hook.
   Expansion state is runtime-only (not persisted across restart) and not yet
   covered by the io-suite.
6. Docs + changelog. **Done** — changelog entries under `[Unreleased] → Added`.
7. Tests: unit (grouping, phrase registry, expand navigation) +
   `packages/coding-agent/test/` suites + `npm run check`. **Partial** — grouping
   + phrase registry + 4167 + existing component tests pass; no expand-mode
   io-suite test yet, and full `npm run check` is blocked by pre-existing
   `packages/ai` model-catalog errors (missing `providers/data/*.json`).

Note: the default-prompt narration guideline is already implemented in
`core/system-prompt.ts`.

## Risks / open items

- **Custom prompts**: the narration guideline only reaches the default prompt;
  custom prompts are untouched (documented).
- **Streaming finalize timing**: a section must not be committed too early
  (more tool calls may still land) nor left dangling at `agent_end`.
- **Expansion/rebuild consistency**: expanded state should survive session
  reload/compaction the same way `toolOutputExpanded` is handled today.
- **Images / custom renderers**: expanded detail must keep the existing
  image + custom `renderResult` behavior of `ToolExecutionComponent`.
