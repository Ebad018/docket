import type { InlineRun, PortableBlock, PortableDocument } from '@shared/portable';

/**
 * Builds the print document the PDF renderer typesets.
 *
 * This deliberately does not reuse Docket's own interface styling. The output
 * leaves the application and lands in someone else's inbox, so it should look
 * like a document, not like a screenshot of a tool. Serif body, generous
 * measure, hairline table rules, real page geometry.
 */
export const buildPrintHtml = (document: PortableDocument): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(document.title)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm 18mm; }

  html { font-size: 11pt; }
  body {
    margin: 0;
    font-family: Cambria, Georgia, 'Times New Roman', serif;
    line-height: 1.55;
    color: #16181a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: 'Segoe UI', Calibri, system-ui, sans-serif;
    font-weight: 600;
    line-height: 1.25;
    color: #0c0d0f;
    margin: 1.4em 0 0.45em;
    break-after: avoid;
    page-break-after: avoid;
  }
  h1 { font-size: 1.9rem; margin-top: 0; padding-bottom: 0.3em; border-bottom: 1px solid #c9ccc4; }
  h2 { font-size: 1.45rem; }
  h3 { font-size: 1.2rem; }
  h4, h5, h6 { font-size: 1rem; letter-spacing: 0.02em; }

  p { margin: 0 0 0.8em; orphans: 3; widows: 3; }

  ul, ol { margin: 0 0 0.8em; padding-left: 1.5em; }
  li { margin-bottom: 0.2em; }

  blockquote {
    margin: 0 0 0.9em;
    padding: 0.1em 0 0.1em 1em;
    border-left: 2px solid #c9ccc4;
    color: #45484c;
    font-style: italic;
  }

  pre {
    margin: 0 0 0.9em;
    padding: 0.7em 0.9em;
    background: #f4f4ef;
    border: 1px solid #dcdcd4;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 0.86rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    break-inside: avoid;
  }
  code {
    font-family: Consolas, 'Courier New', monospace;
    font-size: 0.88em;
    background: #f4f4ef;
    padding: 0.05em 0.3em;
    border: 1px solid #e4e4dc;
  }
  pre code { background: none; border: none; padding: 0; font-size: inherit; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1em;
    font-size: 0.86rem;
    font-family: 'Segoe UI', Calibri, system-ui, sans-serif;
  }
  th, td {
    border: 0.5pt solid #b9bcb4;
    padding: 0.35em 0.55em;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eeefe9; font-weight: 600; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  hr { border: none; border-top: 1px solid #c9ccc4; margin: 1.6em 0; }

  a { color: #0b5fa5; }

  .label {
    font-family: 'Segoe UI', Calibri, system-ui, sans-serif;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5a5d55;
    margin: 1.8em 0 0.5em;
    break-after: avoid;
    page-break-after: avoid;
  }
  .label:first-child { margin-top: 0; }

  .pagebreak { break-before: page; page-break-before: always; height: 0; }

  .task { list-style: none; margin-left: -1.2em; }
  .task > .box { font-family: 'Segoe UI Symbol', sans-serif; margin-right: 0.35em; }
</style>
</head>
<body>
${document.blocks.map(renderBlock).join('\n')}
</body>
</html>`;

const renderBlock = (block: PortableBlock): string => {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${inline(block.runs)}</h${block.level}>`;

    case 'paragraph': {
      const body = inline(block.runs);
      return body.trim() ? `<p>${body}</p>` : '';
    }

    case 'quote':
      return `<blockquote>${inline(block.runs)}</blockquote>`;

    case 'label':
      return `<p class="label">${escapeHtml(block.text)}</p>`;

    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map((item) => {
          const box =
            item.checked === undefined
              ? ''
              : `<span class="box">${item.checked ? '☒' : '☐'}</span>`;
          const className = item.checked === undefined ? '' : ' class="task"';
          return `<li${className}>${box}${inline(item.runs)}</li>`;
        })
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }

    case 'code':
      return `<pre><code>${escapeHtml(block.code)}</code></pre>`;

    case 'table':
      return renderTable(block);

    case 'rule':
      return '<hr>';

    case 'pageBreak':
      return '<div class="pagebreak"></div>';
  }
};

const renderTable = (block: Extract<PortableBlock, { type: 'table' }>): string => {
  const width = Math.max(block.head?.length ?? 0, ...block.rows.map((r) => r.length), 1);

  const cells = (
    row: readonly (readonly InlineRun[])[],
    tag: 'th' | 'td'
  ): string =>
    Array.from({ length: width }, (_, index) => {
      const align = block.align[index];
      const style = align && align !== 'left' ? ` style="text-align:${align}"` : '';
      return `<${tag}${style}>${inline(row[index] ?? [])}</${tag}>`;
    }).join('');

  const head = block.head ? `<thead><tr>${cells(block.head, 'th')}</tr></thead>` : '';
  const body = block.rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
};

const inline = (runs: readonly InlineRun[]): string =>
  runs
    .map((run) => {
      if (!run.text) return '';
      let html = escapeHtml(run.text).replace(/\n/g, '<br>');
      if (run.code) html = `<code>${html}</code>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.strike) html = `<del>${html}</del>`;
      if (run.href && isSafeHref(run.href)) {
        html = `<a href="${escapeHtml(run.href)}">${html}</a>`;
      }
      return html;
    })
    .join('');

/** The print page is loaded into a real renderer, so a hostile href in a
 *  converted document must not become a live javascript: link. */
const isSafeHref = (href: string): boolean =>
  /^(https?:|mailto:|tel:|#)/i.test(href.trim());

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
