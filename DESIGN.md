# Design

The visual system as built, recorded from the shipped artifact.

## World: the tabulating room

The mid-century data-processing floor, rendered through its **print artifacts**
rather than its nostalgia. Continuous fanfold listing paper with alternating
green bars and punched tractor strips down both margins; machine gray-green
console steel for chrome; manila card-stock tabs carrying a three-letter stock
code per format; black impact type for data and a grotesk for controls; red,
amber and green annunciator lamps as the only colour that carries state.

The thesis this refuses: the file-manager arrangement every document viewer
ships — a folder tree beside a preview pane. The way back to a document is
*when you last had it open*, so the record of work is the navigation model and
gets the whole viewport.

## Themes

Two, both authentic to the world, neither a default.

| | Dark — *the night shift* | Light — *the lit machine room* |
|---|---|---|
| Console | near-black olive steel | enamel gray-green |
| Listing stock | carbon-copy bands | fresh green-bar paper |
| Chosen because | the daily-driver scene is a dim office with the screen the brightest thing in it | full-light desk work |

Dark ships as the default. `data-theme="light"` on `<html>` switches; the
preference persists in `localStorage` under `docket.theme`.

## Colour

Strategy: **Restrained** — neutrals plus one accent, which is the floor for
Operate surfaces and the right call for a tool the user stares at all day.

- **Accent** (`--accent`, the annunciator red-orange) is used for the primary
  action, the current selection, and the active-tab rule. Never decoration.
- **Lamps** (`--lamp-red` / `--lamp-amber` / `--lamp-green`) carry state only:
  unsaved / writing / saved. They appear as 7px discs with a matched glow.
- **Manila** and the three sibling stock colours are *material*, not accent:
  they tint the format tab in the listing and nothing else.
- Secondary text is tinted from the ground's hue, never neutral gray.

`--ink-faint` in both themes is set to clear 4.5:1 against `--console-deep`. It
was measured, not eyeballed; do not darken it without re-checking.

## Type

Two families with strict roles — the split is data versus chrome, not display
versus body.

- **Azeret Mono Variable** (`--face-data`): the listing, all numbers, file
  paths, cell values, code, the status readout, column headings, headings in
  prose. Impact-printer register.
- **Archivo Variable** (`--face-chrome`): controls, labels, buttons, prose body.

Both are bundled via `@fontsource-variable`, because the application must work
with no network.

Fixed rem scale, ratio ≈1.15, 11px → 28px. No fluid clamp sizing: users view at
a consistent DPI, and a heading that shrinks inside a pane looks worse, not
better. Prose measure is capped at 72ch; data tables run as wide as they need.

## Layout and rhythm

Everything is a multiple of 4px. The listing row is 34px so a 1440×920 window
prints 22 lines without scrolling.

```
┌──────────────────────────────────────────────┐ 38px  title bar + deck tabs
├──────────────────────────────────────────────┤       job strip / viewer toolbar
│  ▌            fanfold or document        ▐   │ 1fr   tractor · content · tractor
├──────────────────────────────────────────────┤ 26px  status readout
└──────────────────────────────────────────────┘
```

The shell is a three-row grid; the middle row is `minmax(0, 1fr)` so viewers
own their own scrolling and never push the status line off-screen.

The green banding is painted on the **stock**, not per row — a repeating
gradient on `.listing__body` — so the bars carry on past the last entry and the
sheet reads as continuous paper rather than as a table that ran out.

## Components

Every interactive element ships default, hover, focus-visible, active, disabled
and (where it applies) pressed. Buttons are square-cut: no radius anywhere in
the application. One button shape, one field shape, one icon style.

Icons are drawn on a 16-unit grid, 1.5 stroke, **butt caps and mitre joins** —
engraved console legends, not a general-purpose rounded icon set.

Refused by construction: cards as page structure, rounded panels, gradients,
gradient text, glass, coloured left-borders above 1px, sparklines standing in
for content.

## Motion

150–250 ms on state transitions, exponential ease-out from an already-visible
default. One authored moment, not scattered effects:

**`platen-advance`** — a freshly opened file prints onto the listing. The row
wipes in via `clip-path` with a 6px platen lift. Toasts and the palette use the
same wipe, because the machine prints; it does not fade.

`prefers-reduced-motion: reduce` zeroes every duration token, which disables the
skeleton feed animation too.

## The convert bay

A 320px panel on the right of the workbench, not a modal. Choosing a target and
setting run options needs neither interruption nor protected focus, and the
document stays visible beside it — which is the point, since the panel reports
what will come out of that document.

It reads as **stock, not console**: a 3px manila edge along its header is the
only place that colour appears outside the listing's format tabs, and it marks
the panel as a job ticket clipped to the machine rather than part of it.

Rules it follows:

- Target buttons carry the same card-stock chips as the listing, so a format
  looks identical everywhere in the application.
- The output tally updates live as options change. A panel that only tells you
  what happened after you commit is a dialog wearing a panel's clothes.
- Caveats sit next to the control they qualify — the PDF inference note, the
  unsaved-edit warning with its Save button — never in a tooltip.
- Focus lands on the panel itself, not on its Close button. Escape closes it.

## Accessibility

- Full keyboard operation. Command palette on `Ctrl K`; every frequent action
  has a shortcut and appears there.
- Visible focus everywhere (`:focus-visible`, 2px accent, 1px offset).
- Sortable column headings carry `aria-sort`; the grid carries `aria-rowcount`
  / `aria-colcount`; the palette is a real `listbox` with `aria-selected`.
- Body and placeholder text ≥4.5:1 in both themes.
- Unsaved state is announced, not only shown as a coloured lamp.

## Extending

A fifth format needs a handler in `src/main/composition.ts`, a viewer in
`src/renderer/viewers/registry.ts`, and — to take part in conversion — an
extractor in `src/renderer/export/registry.ts` and, if it is also a target, a
renderer back in `composition.ts`.

Give it a stock code of three characters or fewer and a `--listing__stock--*`
colour drawn from the card-stock family: muted, mid-value, legible under
`--manila-ink`, and distinct from the four already in use at a glance across a
34px row.
