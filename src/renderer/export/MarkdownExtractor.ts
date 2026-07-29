import { Marked, type Token, type Tokens } from 'marked';
import type {
  Alignment,
  InlineRun,
  ListItem,
  PortableBlock
} from '@shared/portable';
import type { DocumentExtractor, ExtractInput } from './types';

const marked = new Marked({ gfm: true, async: false });

/** Markdown is the richest source: its token tree maps almost one-to-one onto
 *  the canonical model, so almost nothing is lost on the way out. */
export class MarkdownExtractor implements DocumentExtractor {
  readonly kind = 'markdown' as const;
  readonly options = [
    {
      id: 'includeTitle' as const,
      label: 'Add the file name as a title',
      hint: 'Only when the source has no top-level heading of its own.'
    }
  ];

  async extract({ document, draft, settings }: ExtractInput): Promise<PortableBlock[]> {
    const source =
      draft.kind === 'markdown'
        ? draft.text
        : document.payload.kind === 'markdown'
          ? document.payload.text
          : '';

    const tokens = marked.lexer(source);
    const blocks = tokens.flatMap(convertBlock);

    const hasTitle = blocks.some(
      (block) => block.type === 'heading' && block.level === 1
    );
    if (settings.includeTitle && !hasTitle) {
      const title = document.meta.fileName.replace(/\.[^.]+$/, '');
      return [{ type: 'heading', level: 1, runs: [{ text: title }] }, ...blocks];
    }
    return blocks;
  }
}

const convertBlock = (token: Token): PortableBlock[] => {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      return [
        {
          type: 'heading',
          level: Math.min(6, Math.max(1, heading.depth)) as 1 | 2 | 3 | 4 | 5 | 6,
          runs: inline(heading.tokens)
        }
      ];
    }

    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      return [{ type: 'paragraph', runs: inline(paragraph.tokens) }];
    }

    case 'text': {
      const text = token as Tokens.Text;
      const runs = text.tokens ? inline(text.tokens) : [{ text: text.text }];
      return runs.length > 0 ? [{ type: 'paragraph', runs }] : [];
    }

    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      // A quote may hold several paragraphs; flatten them into one quote block
      // separated by breaks, because the model has no nested containers.
      const inner = quote.tokens.flatMap(convertBlock);
      const runs: InlineRun[] = [];
      inner.forEach((block, index) => {
        if (index > 0) runs.push({ text: '\n' });
        if ('runs' in block) runs.push(...block.runs);
      });
      return runs.length > 0 ? [{ type: 'quote', runs }] : [];
    }

    case 'code': {
      const code = token as Tokens.Code;
      return [{ type: 'code', language: code.lang || null, code: code.text }];
    }

    case 'list': {
      const list = token as Tokens.List;
      return [{ type: 'list', ordered: Boolean(list.ordered), items: listItems(list, 0) }];
    }

    case 'table': {
      const table = token as Tokens.Table;
      return [
        {
          type: 'table',
          head: table.header.map((cell) => inline(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => inline(cell.tokens))),
          align: table.align.map((value) => (value ?? null) as Alignment | null)
        }
      ];
    }

    case 'hr':
      return [{ type: 'rule' }];

    case 'html': {
      // Raw HTML has no honest place in the model. Keep it as text rather than
      // dropping content the author wrote on purpose.
      const html = token as Tokens.HTML;
      const stripped = html.text.replace(/<[^>]*>/g, '').trim();
      return stripped ? [{ type: 'paragraph', runs: [{ text: stripped }] }] : [];
    }

    default:
      return [];
  }
};

const listItems = (list: Tokens.List, depth: number): ListItem[] =>
  list.items.flatMap((item) => {
    const runs: InlineRun[] = [];
    const nested: ListItem[] = [];

    for (const child of item.tokens ?? []) {
      if (child.type === 'list') {
        nested.push(...listItems(child as Tokens.List, depth + 1));
      } else if (child.type === 'text' || child.type === 'paragraph') {
        const textToken = child as Tokens.Text;
        if (runs.length > 0) runs.push({ text: '\n' });
        runs.push(...(textToken.tokens ? inline(textToken.tokens) : [{ text: textToken.text }]));
      }
    }

    const entry: ListItem = {
      runs,
      depth,
      ...(item.task ? { checked: Boolean(item.checked) } : {})
    };
    return [entry, ...nested];
  });

/* ── Inline ──────────────────────────────────────────────────────────── */

const inline = (tokens: readonly Token[] | undefined, carry: Partial<InlineRun> = {}): InlineRun[] => {
  if (!tokens) return [];
  const runs: InlineRun[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape': {
        const text = token as Tokens.Text;
        // Nested emphasis arrives as a text token carrying its own children.
        if ('tokens' in text && text.tokens?.length) runs.push(...inline(text.tokens, carry));
        else if (text.text) runs.push({ text: decodeEntities(text.text), ...carry });
        break;
      }
      case 'strong':
        runs.push(...inline((token as Tokens.Strong).tokens, { ...carry, bold: true }));
        break;
      case 'em':
        runs.push(...inline((token as Tokens.Em).tokens, { ...carry, italic: true }));
        break;
      case 'del':
        runs.push(...inline((token as Tokens.Del).tokens, { ...carry, strike: true }));
        break;
      case 'codespan':
        runs.push({ text: decodeEntities((token as Tokens.Codespan).text), ...carry, code: true });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        runs.push(...inline(link.tokens, { ...carry, href: link.href }));
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        // The model carries no images. Name it rather than silently dropping it.
        runs.push({ text: `[image: ${image.text || image.href}]`, ...carry, italic: true });
        break;
      }
      case 'br':
        runs.push({ text: '\n', ...carry });
        break;
      case 'html':
        break;
      default: {
        const fallback = token as { text?: string };
        if (fallback.text) runs.push({ text: decodeEntities(fallback.text), ...carry });
      }
    }
  }

  return runs.filter((run) => run.text.length > 0);
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
