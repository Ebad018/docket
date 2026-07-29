import type { InlineRun, PortableBlock, PortableDocument } from '@shared/portable';
import type { DocumentRenderer } from './DocumentRenderer';

/** Emits GitHub-flavoured Markdown. */
export class MarkdownRenderer implements DocumentRenderer {
  readonly target = 'markdown' as const;
  readonly extension = 'md';

  async render(document: PortableDocument): Promise<Buffer> {
    const parts: string[] = [];

    for (const block of document.blocks) {
      const rendered = renderBlock(block);
      if (rendered !== null) parts.push(rendered);
    }

    // One blank line between blocks, exactly one trailing newline.
    const body = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    return Buffer.from(`${body}\n`, 'utf8');
  }
}

const renderBlock = (block: PortableBlock): string | null => {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${inline(block.runs)}`;

    case 'paragraph': {
      const text = inline(block.runs);
      return text.trim() ? text : null;
    }

    case 'quote':
      return inline(block.runs)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

    case 'list':
      return block.items
        .map((item, index) => {
          const indent = '  '.repeat(item.depth);
          const marker = block.ordered ? `${index + 1}.` : '-';
          const box =
            item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] ';
          return `${indent}${marker} ${box}${inline(item.runs)}`;
        })
        .join('\n');

    case 'code': {
      // A fence must be longer than the longest backtick run inside it, or the
      // block terminates early and the rest of the document becomes code.
      const longest = Math.max(0, ...[...block.code.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      return `${fence}${block.language ?? ''}\n${block.code.replace(/\n$/, '')}\n${fence}`;
    }

    case 'table':
      return renderTable(block);

    case 'rule':
      return '---';

    case 'label':
      return `**${escapeText(block.text)}**`;

    case 'pageBreak':
      // Markdown has no page. A rule is the closest honest equivalent.
      return '---';
  }
};

const renderTable = (block: Extract<PortableBlock, { type: 'table' }>): string => {
  const width = Math.max(
    block.head?.length ?? 0,
    ...block.rows.map((row) => row.length),
    1
  );

  const head = block.head ?? Array.from({ length: width }, () => []);
  // Pipes are already escaped by the inline escaper; escaping again here would
  // emit `\\|` and break the row it was meant to protect.
  const line = (cells: readonly (readonly InlineRun[])[]): string =>
    `| ${Array.from({ length: width }, (_, index) =>
      inline(cells[index] ?? []).replace(/\n/g, ' ')
    ).join(' | ')} |`;

  const divider = `| ${Array.from({ length: width }, (_, index) => {
    switch (block.align[index]) {
      case 'center':
        return ':---:';
      case 'right':
        return '---:';
      default:
        return '---';
    }
  }).join(' | ')} |`;

  return [line(head), divider, ...block.rows.map((row) => line(row))].join('\n');
};

const inline = (runs: readonly InlineRun[]): string =>
  runs
    .map((run) => {
      if (!run.text) return '';
      // Code spans are literal: emphasis markers inside them are not markup,
      // so escaping would show backslashes in the output.
      if (run.code) {
        const longest = Math.max(0, ...[...run.text.matchAll(/`+/g)].map((m) => m[0].length));
        const fence = '`'.repeat(longest + 1);
        const pad = /^`|`$/.test(run.text) ? ' ' : '';
        return `${fence}${pad}${run.text}${pad}${fence}`;
      }

      let text = escapeText(run.text);
      if (run.bold) text = `**${text}**`;
      if (run.italic) text = `*${text}*`;
      if (run.strike) text = `~~${text}~~`;
      if (run.href) text = `[${text}](${run.href.replace(/[()]/g, encodeURIComponent)})`;
      return text;
    })
    .join('');

/**
 * Escapes only what would actually change meaning. Blanket-escaping every
 * punctuation mark is safe for the parser and awful for the reader: prose full
 * of `\#` and `\+` is the usual tell of a careless Markdown writer.
 */
const escapeText = (text: string): string =>
  text
    // Inline markers, wherever they appear.
    .replace(/([\\`*_[\]|])/g, '\\$1')
    // Block markers, but only where a line begins — mid-sentence they are
    // ordinary punctuation.
    .replace(/^(\s*)(#{1,6}\s)/gm, '$1\\$2')
    .replace(/^(\s*)([-+>])(\s)/gm, '$1\\$2$3')
    .replace(/^(\s*)(\d+)(\.\s)/gm, '$1$2\\$3');
