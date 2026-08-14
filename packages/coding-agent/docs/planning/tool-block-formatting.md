# Tool Block Formatting (Phase B: header + diff layout)

Status: implemented

## Implemented (Phase B)

- Headers reformatted to `[bold]Tool[/bold](specifier)` for bash/read/write/edit
  (`bash` multi-line commands indent under the `Bash(` header; read keeps its
  compact skill/docs classification).
- Tool bodies use a `└ ` joint prefix (`BODY_JOINT`) with continuation lines
  aligned to the first character after the joint (`BODY_JOINT_WIDTH` inheritance)
  for bash/read/write output.
- `write` bytes keep the language syntax theme and now show line numbers.
- `edit` reworked: header, a `└ Added/Removed N lines (and Removed N lines)`
  summary line, and a line-numbered diff where removed/added rows use a
  full-width dark-red/dark-green background (`toolDiffRemovedBg`/`toolDiffAddedBg`)
  starting at the line-number column with white `toolDiffText`. Implemented via
  a new width-aware `DiffRowsComponent` (`parseDiffRows`/`countDiffChanges`).
- New theme tokens: `toolDiffText`, `toolDiffAddedBg`, `toolDiffRemovedBg`.
- Tests: `test/diff-rows.test.ts` (6); per-tool background suite in
  `tool-execution-component.test.ts`. Full `./test.sh` green.

Goal: restructure the visual layout of each tool block: a bold header line, a
`└`-prefixed body with aligned continuation, multi-line bash commands, and a
new line-numbered edit diff with added/removed counts and full-width
dark-red/dark-green background highlights.

## Target layout

Header (bold tool name, then the specifier in parens):

```
[bold]Bash[/bold](<multi-line command with proper line breaks>)
[bold]Write[/bold](<file path>)
[bold]Edit[/bold](<file path>)
[bold]Read[/bold](<file path>)
```

Body prefixed with `└`, continuation lines aligned to it:

```
[bold]Bash[/bold](ls -la
  && grep foo)
  └ value1
    value2
    value3        <- aligned under the └ column
```

Edit expanded diff:

```
[bold]Edit[/bold](src/foo.ts)
  └ Added/Removed [bold]4[/bold] lines (and Removed [bold]2[/bold] lines)
     N(N+)  existing line
     N(N+)  -removed line            [dark-red bg -> end of screen]
     N(N+)  +added line              [dark-green bg -> end of screen]
```

## Corrections captured (from user)

- Text inside write/edit is **white**, except the added/deleted rows which get a
  **background** color (dark green for added, dark red for removed) that starts
  at the first line-number character and extends to the end of the screen.
- Read output text is **not** forced white — the existing language-specific
  syntax highlight theme stays applied to read body.
- The current `toolDiffAdded`/`toolDiffRemoved` tokens color the diff **text**.
  Phase B changes the +/- rows to a **background** color with **white text** in
  both cases (dark red for removed, dark green for added).

## Key design points

- Background highlight on +/- rows starts at the first **line-number** column
  and extends to the right edge of the terminal (full-width fill), not just
  under the text. The `└`/line-number prefix is part of the highlighted span.
- Context rows (unchanged) get no highlight; their text uses default body color.
- The edit summary line: `Added/Removed N lines (and Removed N lines)` — count
  of added (and, when >0, removed) rows in the rendered diff.

## Proposed approach (Phase B)

1. **Header formatting** per tool renderer (`renderCall`):
   - bash: emit a `[bold]Bash[/bold]` label then `( <command> )` with the
     command laid out multi-line with real line breaks (command already carries
     newlines).
   - write: `[bold]Write[/bold]( <path> )`.
   - edit: `[bold]Edit[/bold]( <path> )`.
   - read: `[bold]Read[/bold]( <path> )` (compact-call classification preserved).
2. **Body indent/alignment**: a shared `└` run-in helper that emits the `└` +
   space once and aligns every subsequent line to the same column. Styled via a
   theme key (e.g. reuse `toolTitle`/`muted` or a new `toolBodyBranch`).
3. **Diff rewrite** (`src/modes/interactive/components/diff.ts` +
   `EditCallRenderComponent` in `src/core/tools/edit.ts`):
   - parse the unified diff into rows: `{ kind: context|removed|added, oldLine,
     newLine, content }`, carrying old/new line numbers.
   - render each row as `<oldLine>(<newLine>)` + gutter marker (` `, `-`, `+`)
     (+ content), syntax-highlighted or plain.
   - removed/added rows: set a background (`toolDiffAdded`/`toolDiffRemoved`
     repurposed as backgrounds, or new `toolDiffAddedBg`/`toolDiffRemovedBg`
     tokens) from the first line-number column through the terminal width, with
     **white** text.
   - summary line with added/removed counts.
4. Keep the live preview (compute diff on argsComplete) and result-diff path
   behaving identically.

## Decisions to confirm in Phase B

- Syntax highlight inside diff content: apply language highlight to unchanged
  and changed line content, or keep plain? (User said read keeps syntax theme;
  for edit-diff rows, decide separately.)
- Whether the `└`-indent also applies to write/edit blocks or only bash/read.
- Theme tokens: add `toolDiffAddedBg`/`toolDiffRemovedBg`, or repurpose the
  existing `toolDiffAdded`/`toolDiffRemoved` to backgrounds.

## Touchpoints

- `src/modes/interactive/components/diff.ts` — `renderDiff` rewrite (rows,
  line numbers, full-width bg highlight).
- `src/core/tools/edit.ts` — `EditCallRenderComponent` (
  `buildEditCallComponent`, preview state) to use the new diff rows + summary.
- `src/core/tools/{bash,read,write}.ts` — header formatting + `└` body.
- `src/modes/interactive/components/tool-execution.ts` — body alignment helper
  integration.
- `src/modes/interactive/theme/{theme.ts,dark.json,light.json}` — any new diff
  bg tokens.
- Tests: `diff` formatting tests, edit renderer tests, header/indent tests.

## Verification

- Build + check (mind pre-existing `packages/ai` errors).
- Live: run write/edit/read/bash; confirm headers, `└` alignment, multi-line
  bash, and the full-width dark-red/green +/- rows with white text and line
  numbers.
