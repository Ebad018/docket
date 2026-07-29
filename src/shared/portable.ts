/**
 * The canonical document every conversion passes through.
 *
 * Converting four source formats into three targets is twelve conversions. As
 * a matrix that is twelve converters, and a fifth format would add seven more.
 * Routing everything through one intermediate makes it an extractor per source
 * and a renderer per target — four plus three today, and a fifth format costs
 * one extractor and one renderer regardless of how many formats already exist.
 *
 * The model is deliberately the intersection of what all four formats can
 * honestly express, not the union. Anything richer would promise fidelity the
 * renderers cannot keep.
 */

import type { DocumentKind } from './documents';

export interface InlineRun {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly code?: boolean;
  readonly strike?: boolean;
  readonly href?: string;
}

export type Alignment = 'left' | 'center' | 'right';

export interface ListItem {
  readonly runs: readonly InlineRun[];
  /** Nesting depth, 0-based. */
  readonly depth: number;
  /** Present only for task-list items. */
  readonly checked?: boolean;
}

export type PortableBlock =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly runs: readonly InlineRun[] }
  | { readonly type: 'paragraph'; readonly runs: readonly InlineRun[] }
  | { readonly type: 'quote'; readonly runs: readonly InlineRun[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly ListItem[] }
  | { readonly type: 'code'; readonly language: string | null; readonly code: string }
  | {
      readonly type: 'table';
      readonly head: readonly (readonly InlineRun[])[] | null;
      readonly rows: readonly (readonly (readonly InlineRun[])[])[];
      readonly align: readonly (Alignment | null)[];
    }
  | { readonly type: 'rule' }
  | { readonly type: 'pageBreak' }
  /** A small label above a section — a sheet name, a page marker. */
  | { readonly type: 'label'; readonly text: string };

export interface PortableDocument {
  readonly title: string;
  readonly blocks: readonly PortableBlock[];
  readonly source: {
    readonly kind: DocumentKind;
    readonly fileName: string;
    readonly filePath: string;
  };
  readonly generatedAt: string;
}

/** The formats a document can be converted into. */
export type ExportTarget = 'markdown' | 'pdf' | 'docx';

export interface ExportTargetDescriptor {
  readonly target: ExportTarget;
  readonly label: string;
  readonly extension: string;
  readonly stock: string;
}

export const EXPORT_TARGETS: readonly ExportTargetDescriptor[] = [
  { target: 'markdown', label: 'Markdown', extension: 'md', stock: 'MD' },
  { target: 'docx', label: 'Word', extension: 'docx', stock: 'DOC' },
  { target: 'pdf', label: 'PDF', extension: 'pdf', stock: 'PDF' }
];

/** Which source kind produces which target. A format never converts to itself —
 *  re-rendering through the intermediate would lose more than it gained, and
 *  "Save a copy" is the operation the user actually wants there. */
export const targetsFor = (kind: DocumentKind): readonly ExportTargetDescriptor[] =>
  EXPORT_TARGETS.filter((descriptor) => {
    if (kind === 'markdown') return descriptor.target !== 'markdown';
    if (kind === 'docx') return descriptor.target !== 'docx';
    if (kind === 'pdf') return descriptor.target !== 'pdf';
    return true; // A workbook has no identity target among the three.
  });

export interface ExportRequest {
  readonly document: PortableDocument;
  readonly target: ExportTarget;
  readonly suggestedName: string;
}

export interface ExportResult {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly target: ExportTarget;
}

/* ── Small helpers shared by extractors and renderers ────────────────── */

export const plain = (text: string): InlineRun[] => (text ? [{ text }] : []);

export const runsToText = (runs: readonly InlineRun[]): string =>
  runs.map((run) => run.text).join('');

export const blockToText = (block: PortableBlock): string => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return runsToText(block.runs);
    case 'list':
      return block.items.map((item) => runsToText(item.runs)).join('\n');
    case 'code':
      return block.code;
    case 'label':
      return block.text;
    case 'table':
      return [...(block.head ? [block.head] : []), ...block.rows]
        .map((row) => row.map((cell) => runsToText(cell)).join('\t'))
        .join('\n');
    default:
      return '';
  }
};

export interface DocumentTally {
  readonly blocks: number;
  readonly words: number;
  readonly tables: number;
  readonly pageBreaks: number;
}

export const tally = (document: PortableDocument): DocumentTally => {
  let words = 0;
  let tables = 0;
  let pageBreaks = 0;

  for (const block of document.blocks) {
    if (block.type === 'table') tables += 1;
    if (block.type === 'pageBreak') pageBreaks += 1;
    const text = blockToText(block).trim();
    if (text) words += text.split(/\s+/).length;
  }

  return {
    blocks: document.blocks.filter((block) => block.type !== 'pageBreak').length,
    words,
    tables,
    pageBreaks
  };
};
