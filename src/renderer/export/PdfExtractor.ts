import type { PdfAnnotation } from '@shared/documents';
import type { InlineRun, PortableBlock } from '@shared/portable';
import { pdfjs } from '@/viewers/pdf';
import type { DocumentExtractor, ExtractInput } from './types';

/**
 * Recovers prose from a PDF.
 *
 * A PDF has no paragraphs — only glyph runs at coordinates. Getting readable
 * text back out means inferring the structure that was thrown away when the
 * file was produced: grouping runs into lines by baseline, lines into
 * paragraphs by vertical gap, and promoting unusually large lines to headings.
 *
 * This is inference, and the export bay says so. It works well on ordinary
 * single-column documents and poorly on multi-column layouts, forms and
 * anything typeset as a table — which is the honest character of the problem,
 * not a shortcoming to hide.
 */
export class PdfExtractor implements DocumentExtractor {
  readonly kind = 'pdf' as const;
  readonly options = [
    { id: 'pageBreaks' as const, label: 'Keep page breaks' },
    { id: 'sheetLabels' as const, label: 'Number each page' },
    {
      id: 'includeAnnotations' as const,
      label: 'Append highlights and notes',
      hint: 'Adds a section listing every mark you have made.'
    }
  ];

  async extract({ document, draft, settings }: ExtractInput): Promise<PortableBlock[]> {
    if (document.payload.kind !== 'pdf') return [];

    const order =
      draft.kind === 'pdf'
        ? draft.pageOrder
        : Array.from({ length: document.payload.pageCount }, (_, index) => index);

    const task = pdfjs.getDocument({ data: document.payload.bytes.slice() });
    const pdf = await task.promise;

    const blocks: PortableBlock[] = [];
    try {
      for (const [position, sourceIndex] of order.entries()) {
        if (position > 0 && settings.pageBreaks) blocks.push({ type: 'pageBreak' });
        if (settings.sheetLabels) blocks.push({ type: 'label', text: `Page ${position + 1}` });

        const page = await pdf.getPage(sourceIndex + 1);
        blocks.push(...pageBlocks(await page.getTextContent(), page.getViewport({ scale: 1 }).height));
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }

    if (settings.includeAnnotations && draft.kind === 'pdf' && draft.annotations.length > 0) {
      blocks.push(...annotationSection(draft.annotations, order));
    }

    if (blocks.every((block) => block.type === 'pageBreak' || block.type === 'label')) {
      return [
        {
          type: 'paragraph',
          runs: [
            {
              text: 'This PDF has no extractable text layer. It is most likely a scan, which would need optical character recognition that Docket does not perform.',
              italic: true
            }
          ]
        }
      ];
    }

    return blocks;
  }
}

/* ── Structure inference ─────────────────────────────────────────────── */

interface Line {
  readonly text: string;
  readonly top: number;
  readonly height: number;
  readonly left: number;
}

type TextContent = Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>> extends {
  getTextContent(): Promise<infer T>;
}
  ? T
  : never;

const pageBlocks = (content: TextContent, pageHeight: number): PortableBlock[] => {
  const lines = groupIntoLines(content, pageHeight);
  if (lines.length === 0) return [];

  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const bodyHeight = heights[Math.floor(heights.length / 2)] || 12;

  const blocks: PortableBlock[] = [];
  let paragraph: string[] = [];
  let previous: Line | null = null;

  const flush = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ type: 'paragraph', runs: [{ text }] });
    paragraph = [];
  };

  for (const line of lines) {
    const isHeading = line.height > bodyHeight * 1.22 && line.text.length < 120;

    if (isHeading) {
      flush();
      blocks.push({
        type: 'heading',
        level: line.height > bodyHeight * 1.7 ? 1 : line.height > bodyHeight * 1.4 ? 2 : 3,
        runs: [{ text: line.text }]
      });
      previous = line;
      continue;
    }

    if (previous) {
      const gap = line.top - previous.top;
      // A gap noticeably wider than single leading means a new paragraph;
      // a jump backwards means a new column or block entirely.
      if (gap > bodyHeight * 1.85 || gap < 0) flush();
    }

    const last = paragraph[paragraph.length - 1];
    if (last?.endsWith('-')) {
      // Rejoin a word split across lines rather than leaving the hyphen in.
      paragraph[paragraph.length - 1] = last.slice(0, -1) + line.text;
    } else {
      paragraph.push(line.text);
    }
    previous = line;
  }

  flush();
  return blocks;
};

const groupIntoLines = (content: TextContent, pageHeight: number): Line[] => {
  interface Piece {
    text: string;
    x: number;
    y: number;
    height: number;
  }

  const pieces: Piece[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const transform = item.transform as number[];
    const height = Math.hypot(transform[2], transform[3]) || Math.abs(transform[3]) || 10;
    pieces.push({
      text: item.str,
      x: transform[4],
      // Flip to a top-down axis so "later" means "further down the page".
      y: pageHeight - transform[5],
      height
    });
  }

  pieces.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x));

  const lines: Line[] = [];
  let current: Piece[] = [];

  const commit = () => {
    if (current.length === 0) return;
    const height = Math.max(...current.map((piece) => piece.height));
    let text = '';
    let previousEnd: number | null = null;

    for (const piece of current) {
      // pdf.js emits a run per style change; insert a space only where the
      // horizontal gap says the source actually had one.
      if (previousEnd !== null && piece.x - previousEnd > height * 0.18 && !/\s$/.test(text)) {
        text += ' ';
      }
      text += piece.text;
      previousEnd = piece.x + piece.text.length * height * 0.5;
    }

    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      lines.push({
        text: trimmed,
        top: Math.min(...current.map((piece) => piece.y)),
        height,
        left: Math.min(...current.map((piece) => piece.x))
      });
    }
    current = [];
  };

  for (const piece of pieces) {
    const reference = current[0];
    if (reference && Math.abs(piece.y - reference.y) > Math.max(2, reference.height * 0.5)) {
      commit();
    }
    current.push(piece);
  }
  commit();

  return lines;
};

const annotationSection = (
  annotations: readonly PdfAnnotation[],
  order: readonly number[]
): PortableBlock[] => {
  const sorted = [...annotations].sort((a, b) => {
    const pageDelta = order.indexOf(a.page) - order.indexOf(b.page);
    return pageDelta !== 0 ? pageDelta : a.y - b.y;
  });

  return [
    { type: 'pageBreak' },
    { type: 'heading', level: 2, runs: [{ text: 'Marks' }] },
    {
      type: 'list',
      ordered: false,
      items: sorted.map((annotation) => {
        const page = order.indexOf(annotation.page) + 1;
        const runs: InlineRun[] = [
          { text: `Page ${page} · `, bold: true },
          { text: annotation.type === 'note' ? 'Note' : 'Highlight', italic: true }
        ];
        if (annotation.text.trim()) runs.push({ text: ` — ${annotation.text.trim()}` });
        return { runs, depth: 0 };
      })
    }
  ];
};
