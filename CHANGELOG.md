# Changelog

Docket follows [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- **PATCH** (`1.0.0` → `1.0.1`) — bug fixes only. Nothing new, nothing removed.
- **MINOR** (`1.0.0` → `1.1.0`) — new functionality that does not break anything
  already working. Existing documents still open, existing settings still apply.
- **MAJOR** (`1.0.0` → `2.0.0`) — a change that could break an existing user:
  a removed format, a file written in an incompatible way, a listing database
  that older versions can no longer read.

When a release contains both a fix and a feature, the larger bump wins — a
release with one new feature and six fixes is a MINOR, not a PATCH.

---

## 1.1.1

### Fixed

- **The window could barely be dragged.** The title bar declared itself a drag
  region, but the document tab strip inside it declared `no-drag` and stretched
  across the whole middle — so only the 115px block under the wordmark actually
  moved the window, 8% of the bar. The strip now carries the drag region and
  only the tabs themselves opt out, and a dedicated 76px grip sits before the
  window controls so there is always somewhere to grab even with every tab
  filled. Roughly 70% of the bar is draggable now, and double-clicking it
  maximises as Windows expects.
- **Enough open documents pushed the window controls off-screen.** The shell's
  grid had no explicit column, so the single implicit one was `auto` and sized
  itself to max-content: with nine tabs open the title bar grew wider than the
  window, carrying minimise, maximise and close past the right edge. The grid
  column is now bounded to the viewport.

---

## 1.1.0

Windows shell integration. Docket can now be opened from Explorer.

### Added

- **File associations.** Installing registers `.md`, `.markdown`, `.mdown`,
  `.mkd`, `.docx`, `.xlsx`, `.xlsm` and `.pdf`, so Docket appears in Explorer's
  *Open with* menu for all of them.
- **Settings → Default apps entry.** Docket registers a `Capabilities` block, so
  Windows lists it as one application owning all four formats and every one can
  be assigned in a single place.
- **Explorer document icons**, one per format, colour-matched to the listing's
  format tabs. Generated from the same source as the application icon by
  `npm run icons`.
- **Command palette entry** — *Make Docket the default for .md, .docx, .xlsx and
  .pdf…* — which opens Windows Settings at Docket's own page.

### Fixed

- **The Markdown editor was destroyed by the Split/Preview toggle.** Switching to
  Preview unmounted the editor pane, taking CodeMirror's DOM with it, and the
  effect that builds the editor is keyed on the document rather than the mode —
  so it never re-ran and switching back to Split gave a permanently blank source
  pane. Both panes now stay mounted, which also preserves undo history, cursor
  and scroll position across switches.
- The status-line readout blanked permanently when the already-active document
  tab was clicked.
- Long folder paths in the command palette pushed the file name off-screen.
- Status-line readings ran together into each other on long documents.
- Word documents using the built-in **Title** and **Subtitle** styles rendered
  them as ordinary paragraphs. The style map was being silently rejected —
  mammoth accepts only single quotes in its selectors.
- Sheet names now convert to real headings rather than bold paragraphs.
- Table cells containing a pipe no longer break the Markdown table around them.

### Changed

- Replaced electron-builder's `fileAssociations` with an explicit NSIS include.
  Its macro never wrote `OpenWithProgids` — the key that actually populates
  *Open with* — and derived the ProgID from the human-readable association name,
  which would have produced a ProgID containing spaces.

### Known limitation

Docket does not make itself the default handler, because on Windows no
application can. The `UserChoice` key recording your default has been
hash-protected since Windows 8; an application that writes it is overridden.
Choosing a default remains one deliberate action, taken once.

---

## 1.0.0

First release. A Windows desktop document workshop.

### Added

- **Four formats, read and written.** Markdown (full source editing), Word
  (paragraph text, preserving the rest of the package byte-for-byte), Excel
  (cells and formulas, with live calculation of about forty functions), PDF
  (highlights, notes, page rotate/reorder/delete as real annotation objects).
- **The listing** — a persistent record of every document opened, with name,
  folder, format, size, open count and timestamp, stored in SQLite. It is the
  application's home surface and its whole navigation model.
- **Conversion** between formats: any document to Markdown, Word or PDF, routed
  through one canonical intermediate rather than an N×M matrix of converters.
- Command palette, keyboard-first navigation, tabs for multiple open documents,
  light and dark themes.
- Local only: no account, no network, no telemetry.
