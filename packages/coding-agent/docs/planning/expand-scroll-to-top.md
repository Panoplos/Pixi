# Expand-Mode Scroll-to-Top

Status: implemented (rebuilt into local dist).

Note: it does **not** "pin". After scrolling to a section's top, the user can
still scroll normally.

Feature: when the user enters expand mode (`Ctrl+o`) or navigates with
`Up`/`Down`, scroll the expanded aggregate section so its top lines up with the
top of the transcript viewport.

## Current behavior (baseline)

Expand-mode navigation already exists (Ctrl+o toggles, Up/Down navigate via
`CustomEditor.onNavigateVertical` -> `InteractiveMode.navigateExpand`, which
sets the expanded section via `applyExpandFocus`). It changes which section is
expanded but did not move the scroll position, so a focused/expanded section
could be off-screen.

The transcript is a single `TuiLayouts.ScrollView` (`interactive-mode.ts`,
`transcriptScrollView`) over the whole `documentContainer` (header +
`loadedResourcesContainer` + `chatContainer`), configured with `follow: "end"`.
Aggregate sections (`ToolActivitySummaryComponent`) are children of
`chatContainer`.

The `ScrollView` API (`packages/tui/src/components/scroll-view.ts`):
- `scrollTo(scrollTop, options)` — programmatic scroll; options can
  disable follow at the content end.
- `scrollToStart()` / `scrollToEnd()`.
- `get scrollTop`, `viewportHeight`, `isFollowingEnd`.

## Design

When expand mode focuses a section (on entering and on each Up/Down move):
1. Expand the section (already done by `applyExpandFocus`).
2. Measure the section's vertical offset within `documentContainer` at the
   current width (`contentOffsetOf`, a render-height walk).
3. Call `transcriptScrollView.scrollTo(sectionTop)`.

It does **not** pin: `ScrollView.scrollTo` to a non-end offset sets
`followingEnd = false`, so the user can still scroll the content normally after
it is scrolled to the top. Only when the focused section is the last one (and
thus scrolled to the content end) does follow-end re-engage, which is desired
(there is nowhere above to pin to).

## Measuring the section's content offset

Chosen approach: a cumulative render-height walk (`contentOffsetOf`) over
`documentContainer`'s descendants, summing `render(width).length` of each
preceding sibling until the target section is found. Robust to wrapping and to
the expanded state of siblings; runs once per expand/focus.

## Phases

1. Measure approach chosen: render-height walk (`contentOffsetOf`).
2. Add `scrollFocusedSectionToTop()` and call it from `applyExpandFocus`
   (covers Ctrl+o and Up/Down). — done.
3. Confirm non-pinning scroll (no `disableFollow`: scrolling to a middle
   offset clears follow-end). — verified by probe: middle scroll =>
   `isFollowingEnd === false`; end scroll re-follows. — done.
4. Tests + `npm run check`. — probe verified offset math + non-pin; regression
   suites pass; `tsgo` clean; dist rebuilt.
