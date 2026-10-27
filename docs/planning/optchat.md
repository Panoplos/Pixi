# OptChat: state of the integration and how to benchmark it

## Did we fork it?

Yes, since 2026-10-27: [`Panoplos/pi-optchat`](https://github.com/Panoplos/pi-optchat), forked from upstream [`jonaslsaa/pi-optchat`](https://github.com/jonaslsaa/pi-optchat).

- Branch `local` is our work: one commit on top of upstream `2714a3f` (release 0.10.0, connected-window handoffs), rebased there 2026-10-27 from the first version on `197e17e` (0.9.2). The clone at `~/Development/pi-optchat` is on that commit, and the copy pi loads from `npm:pi-optchat` (declared in `~/.pi/agent/settings.json`) has the same `src/`. Its `package.json` still says 0.9.2; nothing reads it, and `pixi install` would restore it with the whole dir.
- Fork `main` is untouched upstream. The rebase needed one resolution: the models table in `README.md`, where 0.10.0 renamed the compactor row to include fallback handoffs.
- `docs/planning/optchat/local.patch` is the full local diff against upstream `2714a3f`, the same change as the `local` commit.
- `docs/planning/optchat/optchat-bounded-tail.patch` is the subset meant for an upstream issue: the mid-run refresh changes in `src/transcript.ts` and their tests. The overflow-passthrough hunk in `src/index.ts` is only in `local.patch`.

To rebuild the clone from scratch:

```
git clone -b local https://github.com/Panoplos/pi-optchat ~/Development/pi-optchat
cd ~/Development/pi-optchat
npm install && npx tsc --noEmit && npm test
cp src/*.ts ~/.pi/agent/npm/node_modules/pi-optchat/src/
```

Without network access to the fork, a plain clone of upstream `2714a3f` plus `git apply docs/planning/optchat/local.patch` (run from the pi repo root) gives the same tree.

A `pixi install`/npm refresh of the package dir discards the patch. Re-apply it, then check the extension still loads (`pixi --mode rpc --no-session`, expect `choose profile` in the footer's stats line and empty stderr).

## What the local patch changes

1. **Bounded tail on a mid-run refresh, with a cacheable shape.** `refreshPoint` refused to refresh while task + last step exceeded half the turn budget, and a step with several large tool results can exceed it on its own. `refreshedRun` now always cuts, keeping tool calls and images whole. The caps come from the budget alone — the task takes up to half of it, every other message an eighth — never from how many messages the step has added, so a message already sent is byte-identical in the next call and the provider's prefix cache still matches it. Before that, the per-message share was `(budget - taskKeep) / messages.length`, which re-cut every message on every call and pinned the main agent's cache hit rate to the view boundary (23% on a measured long turn, against 99% for subagents).
2. **Overflow no longer cancels compaction.** `session_before_compact` still cancels `manual` and `threshold` (memory owns the context), but returns undefined for `reason: 'overflow'`, so pi compacts and retries instead of ending the turn.
3. **The compactor and subagents follow Pi's model.** `compactor`/`subagent` are optional per profile; absent means "use the model Pi is on, at its thinking level". `/optchat model` and `/optchat agents model` list *Pi's model* as the first row to clear a pin. Previously both defaulted to hard-coded Anthropic models (Sonnet 5.5 medium / Opus 5.5 high), which is wrong on any other provider.
4. **The footer status is the profile name only.** `setStatus('stats:optchat', name)` puts the profile name in pi's stats line (`pwd · name · CHR · context`) in the accent color; `setStatus('optchat', ...)` carries only import notes (`importing`, `import paused`, `import journal invalid`). The message, pending, and agent counts are gone from the footer. This needs pi's `stats:` key support (this repo, `9e60429cf`); against stock pi, `stats:optchat` is an ordinary status key and shows the bare profile name on the status line.

Tests: 326 in the clone, 325 pass, 1 skipped; `tsc --noEmit` clean.

## What 0.10.0 brings

One feature commit on top of 0.9.2: a connected window's own agent writes its handoff as one more turn in its session, from its prompt cache, instead of the compactor re-reading the transcript with Sonnet. The closing message also tells it what it never saw (undelivered messages, unread subagent reports, stopped subagent ids), and the compactor stays as the fallback when that turn errors, times out, or returns nothing. Nothing here touches `src/transcript.ts`, so the cacheable tail above carries over unchanged.

## Benchmark intent

Compare OptChat against vanilla pi on work that already exists, without rewriting historical sessions. Useful numbers: prompt tokens per turn, cache reads, cost per turn, wall-clock, and OptChat's extra summary spend.

### Isolation

- Import is read-only on sources: `src/import/sources.ts` only opens files, and every write in `src/import/job.ts` stays under `~/.optchat/profiles/<name>/`.
- Do not resume a historical session in place. Pi appends to whatever session file it opens. Copy first:

  ```
  cp -a ~/.pi/agent/sessions /tmp/bench/sessions
  pixi --session-dir /tmp/bench/sessions --session <id> -p "<follow-up>"
  ```

- OptChat arm: import the same conversation into a profile (`/optchat import` -> *Pi / OMP*), then ask the same follow-up.

### Fairness rules

- Same `--model` and `--thinking` in both arms. Leave the compactor unpinned so it uses that model; pinning it to something else changes the price list.
- Count the compactor. OptChat spends on summaries; vanilla spends on its own compaction summary. Report them as separate line items.
- Long enough to trigger compaction, otherwise the comparison never exercises the thing being measured. OptChat cancels threshold compaction, so the two arms diverge only past that point.
- Import cost is one-time setup, not a per-turn number.
- Fix model and thinking, run at least three trials, report medians. Tool calls drift between runs.

### Measurement

- `pixi --mode json` emits a per-message event carrying `usage` (`input`, `cacheRead`, `cacheWrite`, `output`, cost), so both arms can be parsed without reading prose.
- Vanilla totals: `message.usage` in the copied session JSONL.
- OptChat totals: the same, plus `~/.optchat/profiles/<name>/usage.jsonl` (main, compactor, import, subagents) and the `/optchat usage` view.
- `min(prevPrompt, prompt) - cacheRead` is what pi's footer calls cache-hit; OptChat rebuilds prompts from its view, so construe cache numbers from the raw usage fields, not that derived stat.

### Not built yet

- No harness that runs both arms and aggregates. Needs prompt extraction, N trials, JSON parsing, medians.
- No headless OptChat smoke run has been done (`pixi -p --optchat-profile <name> "..."`); the flag path exists but each run costs a live call.
- Profiles created before the follow-model patch still carry the old pinned Anthropic models. Clear them with `/optchat model` -> *Pi's model*.
