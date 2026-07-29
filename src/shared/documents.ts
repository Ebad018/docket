/**
 * The contract every document format speaks.
 *
 * Nothing in this file knows that Markdown, Word, Excel or PDF exist. The main
 * process registers handlers against it; the renderer registers viewers against
 * it. Adding a fifth format means adding one handler and one viewer — never
 * editing a switch statement somewhere else.
 */

export type DocumentKind = 'markdown' | 'docx' | 'xlsx' | 'pdf';

/**
 * What a format can actually do, declared rather than assumed. The UI reads
 * these flags to decide which affordances to render, so a read-only format
 * never shows an editing surface that cannot honour a keystroke.
 */
export interface FormatCapabilities {
  /** Human label used in the listing's stock tab and the status line. */
  readonly label: string;
  /** Short code stamped on the manila tab, three characters or fewer. */
  readonly stock: string;
  readonly canEditText: boolean;
  readonly canEditCells: boolean;
  readonly canAnnotate: boolean;
  readonly canReorderPages: boolean;
  /** Prose shown in the editor when a surface is deliberately not editable. */
  readonly editingNote: string;
}

/* ── Per-format payloads ─────────────────────────────────────────────── */

export interface MarkdownPayload {
  readonly text: string;
}

export type DocxBlockType = 'heading' | 'paragraph' | 'listItem' | 'quote';

export interface DocxBlock {
  /** Index of the paragraph inside document.xml — the address a patch writes to. */
  readonly index: number;
  readonly type: DocxBlockType;
  readonly level: number;
  readonly text: string;
  readonly style: string | null;
  /** True when the paragraph lives inside a table and is shown but not addressable. */
  readonly inTable: boolean;
}

export interface DocxPayload {
  readonly blocks: readonly DocxBlock[];
  /** Mammoth's render, used for the faithful read view. */
  readonly html: string;
  readonly wordCount: number;
}

export type CellValue = string | number | boolean | null;

export interface Cell {
  readonly value: CellValue;
  /** Formula without the leading `=`, when the cell carries one. */
  readonly formula: string | null;
  readonly kind: 'text' | 'number' | 'boolean' | 'date' | 'formula' | 'error' | 'empty';
  readonly numberFormat: string | null;
}

export interface Sheet {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly columnWidths: readonly number[];
  readonly rows: readonly (readonly Cell[])[];
}

export interface XlsxPayload {
  readonly sheets: readonly Sheet[];
}

export interface PdfPayload {
  readonly pageCount: number;
  /** Raw file bytes; pdf.js renders these directly in the renderer. */
  readonly bytes: Uint8Array;
  readonly title: string | null;
  readonly author: string | null;
}

export type DocumentPayload =
  | ({ kind: 'markdown' } & MarkdownPayload)
  | ({ kind: 'docx' } & DocxPayload)
  | ({ kind: 'xlsx' } & XlsxPayload)
  | ({ kind: 'pdf' } & PdfPayload);

/* ── The envelope every read returns ─────────────────────────────────── */

export interface DocumentMeta {
  readonly filePath: string;
  readonly fileName: string;
  readonly folder: string;
  readonly extension: string;
  readonly sizeBytes: number;
  /** ISO 8601. */
  readonly modifiedAt: string;
}

export interface OpenDocument {
  readonly meta: DocumentMeta;
  readonly capabilities: FormatCapabilities;
  readonly payload: DocumentPayload;
}

/* ── Patches: the only way a document is written ─────────────────────── */

export interface MarkdownPatch {
  readonly kind: 'markdown';
  readonly text: string;
}

export interface DocxPatch {
  readonly kind: 'docx';
  readonly blocks: readonly { readonly index: number; readonly text: string }[];
}

export interface XlsxPatch {
  readonly kind: 'xlsx';
  readonly cells: readonly {
    readonly sheet: string;
    /** 1-based, matching the spreadsheet's own addressing. */
    readonly row: number;
    readonly column: number;
    readonly input: string;
  }[];
}

export interface PdfAnnotation {
  readonly id: string;
  readonly page: number;
  /** Fractions of page width/height, so annotations survive zoom and DPI. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly type: 'highlight' | 'note';
  readonly color: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface PdfPatch {
  readonly kind: 'pdf';
  /** Final page order, expressed as source page indices (0-based). Omitted pages are dropped. */
  readonly pageOrder: readonly number[];
  /** Clockwise degrees per source page index. */
  readonly rotations: Readonly<Record<number, number>>;
  readonly annotations: readonly PdfAnnotation[];
}

export type DocumentPatch = MarkdownPatch | DocxPatch | XlsxPatch | PdfPatch;

/* ── Recents ─────────────────────────────────────────────────────────── */

export interface RecentEntry {
  readonly id: number;
  readonly filePath: string;
  readonly fileName: string;
  readonly folder: string;
  readonly kind: DocumentKind;
  readonly sizeBytes: number;
  /** ISO 8601 — when this file was last opened *in Docket*. */
  readonly lastOpenedAt: string;
  readonly openCount: number;
  readonly pinned: boolean;
  /** False once the file has been moved or deleted on disk. */
  readonly exists: boolean;
}

export interface SaveResult {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly savedAt: string;
}
