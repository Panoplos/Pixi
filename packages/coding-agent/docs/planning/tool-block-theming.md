# Tool Block Theming (Phase A: colors)

Status: implemented (Phase A colors); Phase B formatting pending

## Implemented (Phase A)

- New dedicated `toolBodyBg` background token (defaults to the footer model
  grey: `gray`/`#808080` dark, `mediumGray`/`#6c6c6c` light). Added to
  `ThemeBg`/`OptionalThemeBg`, schema + `theme-schema.json`, `bgColorKeys`,
  fallback, dark.json, light.json, docs/themes.md.
- Per-tool/state background selection in `ToolExecutionComponent`
  (`toolBlockBackground` + module-level `toolBlockStyle`):
  - write/edit: transparent on pending+success, `toolErrorBg` on error
  - read/bash: transparent on pending, `toolBodyBg` on success, `toolErrorBg`
    on error
  - other tools: unchanged (pending/success/error state backgrounds)
- `edit` self-shell header: transparent on pending+success, `toolErrorBg` on
  error.
- Text color: unchanged in Phase A (read keeps syntax theme; write/edit white
  text deferred to Phase B formatting).
- Tests: `test/tool-execution-component.test.ts` added a per-tool background
  suite (31 passing total).

Goal: change per-tool block **background** and **text** colors in the tool
execution display (the `ToolExecutionComponent` blocks rendered by the tool
activity sections and standalone write/edit).

## Current behavior (baseline)

- All default-shell tools (`bash`/`read`/`write`) render inside a
  `contentBox` (`Box(1, 1, bgFn)`) whose `bgFn` is chosen in
  `ToolExecutionComponent.updateDisplay` by state:
  - `isPartial` -> `toolPendingBg`
  - `result.isError` -> `toolErrorBg`
  - else -> `toolSuccessBg` (this is the khaki-green the user dislikes)
- `edit` uses `renderShell: "self"` and colors its own header via
  `getEditHeaderBg` (`toolPendingBg`/`toolSuccessBg`/`toolErrorBg`).
- Call/result text colors come from each tool's `renderCall`/`renderResult`
  using `toolTitle`/`toolOutput` and the syntax-highlight theme.

## Target colors (per tool)

`write`/`edit`:
- pending: **transparent** background
- success: **transparent** background, body text **white**
- error: keep the current failure background (`toolErrorBg`) and error styling
- (added/deleted rows get their own background highlight — see Phase B)

`read`/`bash`:
- pending: **transparent**
- success: **fixed grey** background (dedicated token, see below), body text
  mostly white
- error: keep the current failure background (`toolErrorBg`)

`read` output text: keep the language-specific syntax highlight theme applied
(i.e. read body is NOT forced white; syntax tokens remain).

All other tools / non-aggregate paths: unchanged (state-based
`toolPendingBg`/`toolSuccessBg`/`toolErrorBg` behavior stays).

## Decisions (confirmed)

1. **Dedicated token** for the success grey — do NOT reuse `footerModel`
   directly. Add a new theme background token, e.g. `toolBodyBg`, defaulting to
   the same value as the footer model/effort grey (currently `#9E9E9E`) so it
   stays themeable independently. Wiring: add to `ThemeBg` union, the JSON
   schema (`ThemeJsonSchema.colors`), `bgColorKeys` in `createTheme`, dark.json,
   light.json, and `<theme>.bg("toolBodyBg", ...)`.
2. **State-based, retained** for read/bash: pending transparent, success grey,
   error = current `toolErrorBg`. (Not a single fixed color across all states.)
3. **Diff backgrounds** (dark red/green for removed/added rows) are Phase B; the
   existing `toolDiffAdded`/`toolDiffRemoved` are currently TEXT colors and stay
   that way — Phase B repurposes the row highlight to background + white text.

## Proposed approach (Phase A)

- `ToolExecutionComponent.updateDisplay` picks `bgFn` with tool-awareness:
  - map `toolName` via a small helper `toolBlockStyle(toolName)` returning one
    of `"transparent" | "body" | "default"`:
    - `write`/`edit` -> transparent (except error -> `toolErrorBg`)
    - `read`/`bash` -> body: pending transparent / success `toolBodyBg` /
      error `toolErrorBg`
    - everything else -> current default
  - For "self"-shell tools (`edit`), update its header `setBgFn` selection the
    same way (success -> transparent for write/edit).
- Add the dedicated `toolBodyBg` token (token + schema + types + builtin theme
  JSON + fallback).
- White text: for write/edit success body, set the call/result body text to
  white; for bash success the command/title white. `read` keeps syntax theme.
  Exact text-color handling decided per renderer (see below).
- Keep aggregate (section), standalone write/edit, and non-aggregate paths all
  going through the same `ToolExecutionComponent` so the change is uniform.

## Touchpoints

- `src/modes/interactive/components/tool-execution.ts` — `updateDisplay` bg
  selection, per-tool style helper.
- `src/modes/interactive/components/tool-activity-summary.ts` — forwards tool
  name + state to executions (no change expected).
- `src/modes/interactive/theme/theme.ts` — add `toolBodyBg` to `ThemeBg`, schema
  colors, `bgColorKeys`, types.
- `src/modes/interactive/theme/dark.json`, `light.json` — add `toolBodyBg`
  (default = footer-model grey `#9E9E9E`).
- `src/core/tools/{bash,read,write,edit}.ts` — adjust `renderCall`/`renderResult`
  text colors for white where required.
- Docs: `docs/themes.md` (new token), `docs/planning/tool-block-formatting.md`
  (Phase B reference).

## Tests

- Update/add `tool-execution`-level tests asserting per-tool background choice
  (transparent for write/edit, `toolBodyBg` for read/bash success) and white
  text where applicable. Add a theme test that `toolBodyBg` resolves and is
  themeable.
- Keep `tool-activity-summary.test.ts`, `assistant-message.test.ts`, 4167
  regression green.

## Verification

- `npm run build` + `npm run check` (mind pre-existing `packages/ai` errors).
- Manual: exercise write/edit/read/bash in a live session and confirm
  backgrounds per the table above.
