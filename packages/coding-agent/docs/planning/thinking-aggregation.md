# Thinking Aggregation ("Thought for N seconds")

Status: implemented

Feature: live thinking timing. While thinking is hidden, show `Thinking...` on
the `thinking_start` stream marker and flip it in place to `Thought for 4.2s` /
`Thought for 1m 05s` when `thinking_end` arrives. The timed line is a persistent
in-place entry that survives the round. Restored sessions show no thinking at
all. (Supersedes the earlier "aggregate N Thinking labels" idea — each thinking
run times itself rather than being summed into one line.)

## Current behavior (baseline)

`AssistantMessageComponent.updateContent` (`components/assistant-message.ts`)
renders each run of contiguous `thinking` content blocks. When the user has
thinking hidden (`hideThinkingBlock`, toggle with `app.thinking.toggle`), each
run renders one static `Text(hiddenThinkingLabel)` = `Thinking...`
(`assistant-message.ts`, the `hideThinkingBlock` branch). Thinking is rendered
per assistant message, so a turn that streams many `thinking` blocks produces
many `Thinking...` labels.

Findings that shape the design:

- `AssistantMessage` has **no duration field** for thinking; its only timestamp
  is `message.timestamp` (Unix ms) for the whole message
  (`packages/ai/src/types.ts`, `AssistantMessage`). `ThinkingContent` has no
  timestamp either.
- **A start/end marker exists**: providers emit `thinking_start` and `thinking_end`
  (`AssistantMessageEvent`, `packages/ai/src/types.ts`). These flow to the TUI
  inside every `message_update` as `event.assistantMessageEvent` (typed
  `AssistantMessageEvent`) — no forwarding needed. The markers carry no
  timestamps, so we still stamp wall-clock at receipt, but we clue off the exact
  interval rather than inferring from content presence.
- The coding-agent session drives each tool round as its own agent run
  (`agent.prompt()` + repeated `agent.continue()`), so a turn can contain many
  assistant messages, each potentially carrying `thinking`.

## Design decisions (confirmed)

1. **Contiguous thinking RUN** — NOT the whole user<->assistant round. Aggregate
   a maximal run of consecutive thinking-bearing assistant messages into one
   timed line, placed **in-place where the run occurred in the action/message
   history** (interlaced), not as a single line at the bottom of the turn. A run
   is broken only by a user turn or a non-thinking assistant message (usually
   the final answer). Reasoning: with option-2 aggregation the run's tool calls
   already fold into one section, so its `Thinking...` labels read as
   consecutive; that run is what gets one `Thought for Ns` line.
2. **Duration source = marker-paired wall-clock** — on each `thinking_start`
   record `now`; on each `thinking_end` add `now - start` to that run's running
   total. Total = actual time in thinking states across the run, excluding
   tool-run time between rounds.
3. **Static rendering** — a static text line, in-place in the history
   (mirroring how `ToolActivitySummaryComponent` sits in the chat), replacing
   the run's aggregated hidden `Thinking...` labels. No expand/click behavior.

Data (transcript, 523 assistant msgs): thinking is bundled with a tool call in
~175+131 messages; pure thinking-only is ~2; max consecutive thinking-bearing
run is 20. So there are effectively no interleaved preambles between thinking
blocks to worry about — text, when present, shares the message with the thinking.

Note (rebuild parity): the streaming markers are NOT persisted (only the final
`AssistantMessage` with `ThinkingContent` is saved), so wall-clock duration can't
be reconstructed on a restored session. The timed summary is a live-only render;
rebuild parity for the line is an open item (see below).

## Proposed approach

- Add a `ThinkingSummaryComponent` (or reuse `AssistantMessageComponent` with a
  factoring-out of the thinking label) that renders one `Thought for Ns|m`
  line. Formatting helper: `<d<60 ? `${d.toFixed(1)}s` : `${m}m ${s}s``).
- In `interactive-mode.ts`, track a per-run thinking total and a run-open flag:
  - on `message_update` with `event.assistantMessageEvent.type === "thinking_start"`,
    open the run if not already open and record `now`;
  - on `"thinking_end"`, add `now - start` to the open run's total;
  - a user turn or a non-thinking assistant message closes the run: render the
    aggregated `Thought for ...` line in-place, reset the total and open flag.
- Because thinking is usually bundled with a tool call (the label precedes a
  section), the aggregation must span across the tool-section boundaries, so it
  is driven from `interactive-mode.ts` (which owns message/turn lifecycle), not
  from a single `AssistantMessageComponent`.

## Phases

1. Pure helper: format duration (`seconds`/`minutes`), unit tests
   (`core/thinking-summary.ts`, `test/thinking-summary.test.ts`).
2. `ThinkingSummaryComponent` rendering.
3. Wire the group open/close timing in `interactive-mode.ts` (live event path)
   + the rebuild path so a restored session shows the same single timed entry.
4. Expandable recap (if chosen) + keybind/docs.
5. Tests + `npm run check` (note pre-existing `packages/ai` blockers).

## Open items

- Rebuild parity: the streaming markers aren't persisted, so duration can't be
  computed on a restored session. **Resolution (agreed):** on resume show an
  untimed aggregate line ("Thought" without a time) — wall-clock time is a
  runtime-only feature.
- Whether the timed summary should be hidden when thinking is shown (not
  hidden); probably yes — only replace the hidden `Thinking...` labels.
- How the run's `Thought for Ns` line coexists with the tool-activity section
  (both are in-place; they render as separate in-place entries adjacent to each
  other).
