# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Web technology (Electron renderer) packaged as a Windows desktop .exe. Design language is desktop-app, not mobile-native. -->

## Users

A single power user on Windows 11 who works across mixed document formats all day: Markdown notes and READMEs, Word documents, spreadsheets, and PDFs. They are constantly returning to files they touched recently, and the friction they feel today is the hunt — remembering which folder a document lives in and which of four different applications opens it.

## Product Purpose

One desktop application that opens, reads, edits, and saves Markdown, DOCX, XLSX, and PDF, with a persistent history of every document opened — name, folder, format, and last-opened timestamp — as the application's home surface. Success is that the user stops opening Explorer to find a file and stops switching applications to read one.

## Positioning

Format-agnostic. Existing tools are either single-format editors (Typora, Word, Excel) or read-only multi-format previewers. This is one editable surface across four formats, with recency-of-work as the primary navigation model rather than folder trees.

## Operating Context

- Windows 11 desktop, offline-capable, local filesystem only. No cloud account, no sync, no telemetry.
- The user opens many files per day and returns to the same handful repeatedly. Keyboard-first navigation, a command palette, and multiple open documents at once are core to the scene, not extras.
- Files live scattered across project folders; the same filename recurs in different folders, so the folder path is load-bearing information in the recents list, not a detail.

## Capabilities and Constraints

Confirmed scope, by format:

- **Markdown (.md, .markdown):** full editing. Source editor with live preview, GFM (tables, task lists, strikethrough, autolinks), code highlighting, save back to disk.
- **DOCX:** structured editing. Render document content with heading/paragraph/list/table structure; edit text content of blocks; save back to a valid .docx. Not a full Word feature clone.
- **XLSX:** structured editing. Sheet tabs, grid, cell values and formulas, formula recalculation, save back to a valid .xlsx.
- **PDF:** view and annotate. Paged rendering, text selection, search, zoom; highlight and note annotations; page operations (rotate, delete, reorder); save back to a valid .pdf. Explicitly **not** in scope: rewriting the existing text layer in place.

Other confirmed constraints:

- Recents are populated only by files opened in the application — no background folder scanning or indexing.
- Recents persist locally (SQLite) and survive restart. Entries record path, folder, format, size, and last-opened timestamp.
- Ships as a Windows `.exe`.
- Architecture must follow SOLID: each format is an independently substitutable handler behind a shared contract, and adding a fifth format must require no edits to existing handlers.

## Brand Commitments

Working name: **Docket**. No existing logo, palette, or type commitments — the visual world is open.

## Evidence on Hand

None. No existing screenshots, users, benchmarks, or copy. All sample content in the application is authored demonstration material and must be labeled as such; no usage claims, pricing, or customer references may be invented.

## Product Principles

1. **Recency is the filesystem.** The way back to a document is when you last had it open, not where it sits on disk. The folder path is shown because names collide, not because the tree is the navigation model.
2. **One surface, four formats.** Format determines the editing affordances, never the application's identity. Switching from a spreadsheet to a PDF should feel like changing tools inside one workshop, not launching a different program.
3. **Editing is a promise about saving.** Any surface that accepts a keystroke must write a valid file of that format back to disk. Where the format cannot be safely round-tripped, the surface is read-only and says so.
4. **The keyboard is the primary input.** This is a daily driver. Every frequent action has a shortcut and lives in the command palette.
5. **Local and inert.** Nothing leaves the machine. No account, no network, no analytics.

## Accessibility & Inclusion

No user-specific requirement established. Baseline: full keyboard operability, visible focus, WCAG AA contrast on all text and controls.
