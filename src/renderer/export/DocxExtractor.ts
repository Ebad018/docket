import type {
  Alignment,
  InlineRun,
  ListItem,
  PortableBlock
} from '@shared/portable';
import { sanitiseHtml } from '@/lib/markdown';
import type { DocumentExtractor, ExtractInput } from './types';

/**
 * Extracts from the rendered view rather than from the paragraph outline.
 *
 * The outline is a flat list of addressable paragraphs — it is what makes Word
 * editing possible, but it deliberately excludes tables and carries no
 * emphasis. The rendered HTML has both, so converting from it keeps tables,
 * bold, italic, links and list nesting that the outline would throw away.
 *
 * The cost: unsaved outline edits are not in the rendered view. The export bay
 * says so and offers to save first, rather than quietly exporting stale text.
 */
export class DocxExtractor implements DocumentExtractor {
  readonly kind = 'docx' as const;
  readonly options = [
    { id: 'includeTitle' as const, label: 'Add the file name as a title' }
  ];

  async extract({ document, settings }: ExtractInput): Promise<PortableBlock[]> {
    if (document.payload.kind !== 'docx') return [];
    const { html, blocks: outline } = document.payload;

    const blocks = html ? fromHtml(html) : fromOutline(outline);

    const hasTitle = blocks.some((block) => block.type === 'heading' && block.level === 1);
    if (settings.includeTitle && !hasTitle) {
      const title = document.meta.fileName.replace(/\.[^.]+$/, '');
      return [{ type: 'heading', level: 1, runs: [{ text: title }] }, ...blocks];
    }
    return blocks;
  }
}

/* ── From the rendered view ──────────────────────────────────────────── */

const fromHtml = (html: string): PortableBlock[] => {
  const host = document.createElement('div');
  // Same allow-list the read view goes through. A .docx is untrusted input,
  // and this HTML is about to be walked and re-emitted.
  host.innerHTML = sanitiseHtml(html);

  const blocks: PortableBlock[] = [];
  for (const child of [...host.children]) walk(child, blocks);
  return blocks;
};

const walk = (element: Element, blocks: PortableBlock[]): void => {
  const tag = element.tagName.toLowerCase();
  const headingMatch = /^h([1-6])$/.exec(tag);

  if (headingMatch) {
    const runs = inline(element);
    if (runs.length > 0) {
      blocks.push({
        type: 'heading',
        level: Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6,
        runs
      });
    }
    return;
  }

  switch (tag) {
    case 'p': {
      const runs = inline(element);
      if (runs.length > 0) blocks.push({ type: 'paragraph', runs });
      return;
    }

    case 'blockquote': {
      const runs = inline(element);
      if (runs.length > 0) blocks.push({ type: 'quote', runs });
      return;
    }

    case 'ul':
    case 'ol': {
      const items = listItems(element, 0);
      if (items.length > 0) blocks.push({ type: 'list', ordered: tag === 'ol', items });
      return;
    }

    case 'pre':
      blocks.push({ type: 'code', language: null, code: element.textContent ?? '' });
      return;

    case 'table':
      blocks.push(table(element));
      return;

    case 'hr':
      blocks.push({ type: 'rule' });
      return;

    default:
      // A wrapper mammoth emitted; descend rather than lose what is inside it.
      for (const child of [...element.children]) walk(child, blocks);
      if (element.children.length === 0) {
        const runs = inline(element);
        if (runs.length > 0) blocks.push({ type: 'paragraph', runs });
      }
  }
};

const listItems = (list: Element, depth: number): ListItem[] =>
  [...list.children]
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .flatMap((item) => {
      const nestedLists = [...item.children].filter((child) =>
        ['ul', 'ol'].includes(child.tagName.toLowerCase())
      );

      // Read the item's own text without the nested list's text bleeding in.
      const shallow = item.cloneNode(true) as Element;
      [...shallow.children]
        .filter((child) => ['ul', 'ol'].includes(child.tagName.toLowerCase()))
        .forEach((child) => child.remove());

      const runs = inline(shallow);
      const entry: ListItem[] = runs.length > 0 ? [{ runs, depth }] : [];
      return [...entry, ...nestedLists.flatMap((nested) => listItems(nested, depth + 1))];
    });

const table = (element: Element): PortableBlock => {
  const rows = [...element.querySelectorAll('tr')];
  const cellsOf = (row: Element) =>
    [...row.children]
      .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
      .map((cell) => inline(cell));

  const firstRow = rows[0];
  const firstIsHeader =
    firstRow !== undefined &&
    [...firstRow.children].some((cell) => cell.tagName.toLowerCase() === 'th');

  const align: (Alignment | null)[] = firstRow
    ? [...firstRow.children].map((cell) => {
        const value = cell.getAttribute('align');
        return value === 'center' || value === 'right' ? value : null;
      })
    : [];

  return {
    type: 'table',
    head: firstIsHeader && firstRow ? cellsOf(firstRow) : null,
    rows: (firstIsHeader ? rows.slice(1) : rows).map(cellsOf),
    align
  };
};

const inline = (element: Element, carry: Partial<InlineRun> = {}): InlineRun[] => {
  const runs: InlineRun[] = [];

  for (const node of [...element.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) runs.push({ text, ...carry });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const child = node as Element;
    switch (child.tagName.toLowerCase()) {
      case 'strong':
      case 'b':
        runs.push(...inline(child, { ...carry, bold: true }));
        break;
      case 'em':
      case 'i':
        runs.push(...inline(child, { ...carry, italic: true }));
        break;
      case 'del':
      case 's':
        runs.push(...inline(child, { ...carry, strike: true }));
        break;
      case 'code':
        runs.push(...inline(child, { ...carry, code: true }));
        break;
      case 'a':
        runs.push(...inline(child, { ...carry, href: child.getAttribute('href') ?? undefined }));
        break;
      case 'br':
        runs.push({ text: '\n', ...carry });
        break;
      case 'img':
        runs.push({
          text: `[image: ${child.getAttribute('alt') || 'embedded'}]`,
          ...carry,
          italic: true
        });
        break;
      default:
        runs.push(...inline(child, carry));
    }
  }

  return runs.filter((run) => run.text.length > 0);
};

/* ── Fallback: the paragraph outline ─────────────────────────────────── */

const fromOutline = (
  outline: Extract<
    import('@shared/documents').DocumentPayload,
    { kind: 'docx' }
  >['blocks']
): PortableBlock[] => {
  const blocks: PortableBlock[] = [];
  let pendingList: ListItem[] = [];

  const flush = () => {
    if (pendingList.length > 0) {
      blocks.push({ type: 'list', ordered: false, items: pendingList });
      pendingList = [];
    }
  };

  for (const block of outline) {
    if (!block.text.trim()) continue;
    if (block.type === 'listItem') {
      pendingList.push({ runs: [{ text: block.text }], depth: 0 });
      continue;
    }
    flush();
    if (block.type === 'heading') {
      blocks.push({
        type: 'heading',
        level: Math.min(6, Math.max(1, block.level || 1)) as 1 | 2 | 3 | 4 | 5 | 6,
        runs: [{ text: block.text }]
      });
    } else if (block.type === 'quote') {
      blocks.push({ type: 'quote', runs: [{ text: block.text }] });
    } else {
      blocks.push({ type: 'paragraph', runs: [{ text: block.text }] });
    }
  }

  flush();
  return blocks;
};
