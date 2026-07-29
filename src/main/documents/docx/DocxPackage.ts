import JSZip from 'jszip';
import type { DocxBlock, DocxBlockType } from '@shared/documents';

/**
 * Structured read/write over a .docx package.
 *
 * Editing works by string surgery on the exact byte ranges of `<w:t>` text
 * nodes inside `word/document.xml`. That is deliberate: parsing OOXML into a
 * tree and re-serialising it rewrites every byte of the document, and any
 * imperfection in the round-trip silently damages parts of the file the user
 * never touched. Replacing only the text ranges leaves headers, footers,
 * styles, numbering, images, comments and revision marks byte-identical.
 *
 * The trade this makes, stated plainly in the UI: replacing a paragraph's text
 * puts the whole new string into that paragraph's first run and empties the
 * rest, so paragraph-level formatting survives but formatting that changed
 * mid-paragraph (one bold word) collapses to the first run's formatting.
 */

const DOCUMENT_PART = 'word/document.xml';

interface TextRange {
  /** Offsets into the whole document.xml string. */
  readonly openTagStart: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly closeTagEnd: number;
  /** True for `<w:t/>`, which has no content range to overwrite. */
  readonly selfClosing: boolean;
}

interface ParagraphRange {
  readonly start: number;
  readonly end: number;
  readonly inTable: boolean;
}

export interface ParsedDocx {
  readonly blocks: DocxBlock[];
  readonly wordCount: number;
}

export class DocxPackage {
  private constructor(
    private readonly zip: JSZip,
    private xml: string
  ) {}

  static async open(bytes: Buffer): Promise<DocxPackage> {
    const zip = await JSZip.loadAsync(bytes);
    const part = zip.file(DOCUMENT_PART);
    if (!part) {
      throw new Error(
        'This file is a zip archive but has no word/document.xml, so it is not a Word document.'
      );
    }
    return new DocxPackage(zip, await part.async('string'));
  }

  parse(): ParsedDocx {
    const paragraphs = scanParagraphs(this.xml);
    const blocks: DocxBlock[] = [];
    let wordCount = 0;

    paragraphs.forEach((paragraph, index) => {
      const inner = this.xml.slice(paragraph.start, paragraph.end);
      const text = readParagraphText(inner);
      const style = matchAttribute(inner, 'w:pStyle');
      const outlineLevel = matchAttribute(inner, 'w:outlineLvl');
      const numbered = inner.includes('<w:numPr');
      const { type, level } = classify(style, outlineLevel, numbered);

      if (text.trim()) wordCount += text.trim().split(/\s+/).length;

      blocks.push({
        index,
        type,
        level,
        text,
        style,
        inTable: paragraph.inTable
      });
    });

    return { blocks, wordCount };
  }

  /**
   * Applies text edits addressed by paragraph index. Edits are written from the
   * end of the document backwards so earlier offsets stay valid.
   */
  applyTextEdits(edits: readonly { index: number; text: string }[]): void {
    if (edits.length === 0) return;

    const paragraphs = scanParagraphs(this.xml);
    const ordered = [...edits]
      .filter((edit) => edit.index >= 0 && edit.index < paragraphs.length)
      .sort((a, b) => b.index - a.index);

    for (const edit of ordered) {
      const paragraph = paragraphs[edit.index];
      const inner = this.xml.slice(paragraph.start, paragraph.end);
      const runs = scanTextRanges(inner);

      if (runs.length === 0) {
        this.xml = insertRunBeforeClose(this.xml, paragraph, edit.text);
        continue;
      }

      // Backwards within the paragraph too, for the same offset reason.
      for (let i = runs.length - 1; i >= 1; i -= 1) {
        this.xml = writeRun(this.xml, paragraph.start, runs[i], '');
      }
      this.xml = writeRun(this.xml, paragraph.start, runs[0], edit.text);
    }
  }

  async toBuffer(): Promise<Buffer> {
    this.zip.file(DOCUMENT_PART, this.xml);
    return this.zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }
}

/* ── XML scanning ────────────────────────────────────────────────────── */

/**
 * Depth-aware scan for `<w:p>` elements. A regex cannot be used here: text
 * boxes legitimately nest a `<w:p>` inside another, and a non-greedy match
 * would close the outer paragraph at the inner `</w:p>` and shift every
 * subsequent index by one.
 */
const scanParagraphs = (xml: string): ParagraphRange[] => {
  const paragraphs: ParagraphRange[] = [];
  const openStack: number[] = [];
  let tableDepth = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const next = xml.indexOf('<', cursor);
    if (next === -1) break;
    const close = xml.indexOf('>', next);
    if (close === -1) break;

    const tag = xml.slice(next, close + 1);
    const selfClosing = tag.endsWith('/>');

    if (tag.startsWith('<w:tbl') && isTag(tag, 'w:tbl') && !selfClosing) tableDepth += 1;
    else if (tag.startsWith('</w:tbl') && isTag(tag, '/w:tbl')) tableDepth = Math.max(0, tableDepth - 1);
    else if (isTag(tag, 'w:p') && !selfClosing) openStack.push(next);
    else if (isTag(tag, 'w:p') && selfClosing) {
      // An empty paragraph: `<w:p/>`. Still addressable, still editable.
      paragraphs.push({ start: next, end: close + 1, inTable: tableDepth > 0 });
    } else if (isTag(tag, '/w:p')) {
      const start = openStack.pop();
      if (start !== undefined) {
        paragraphs.push({ start, end: close + 1, inTable: tableDepth > 0 });
      }
    }

    cursor = close + 1;
  }

  // Nested paragraphs close first, so restore document order before indexing.
  return paragraphs.sort((a, b) => a.start - b.start);
};

/** True when `tag` is exactly `<name ...>` and not a longer name sharing a prefix. */
const isTag = (tag: string, name: string): boolean => {
  const body = tag.slice(1, tag.endsWith('/>') ? -2 : -1);
  return body === name || body.startsWith(`${name} `) || body.startsWith(`${name}\t`) || body.startsWith(`${name}\n`);
};

const scanTextRanges = (paragraphXml: string): TextRange[] => {
  const ranges: TextRange[] = [];
  const pattern = /<w:t(\s[^>]*?)?(\/)?>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(paragraphXml)) !== null) {
    const openTagStart = match.index;
    const contentStart = match.index + match[0].length;
    if (match[2] === '/') {
      ranges.push({
        openTagStart,
        contentStart,
        contentEnd: contentStart,
        closeTagEnd: contentStart,
        selfClosing: true
      });
      continue;
    }
    const closeIndex = paragraphXml.indexOf('</w:t>', contentStart);
    if (closeIndex === -1) continue;
    ranges.push({
      openTagStart,
      contentStart,
      contentEnd: closeIndex,
      closeTagEnd: closeIndex + '</w:t>'.length,
      selfClosing: false
    });
    pattern.lastIndex = closeIndex;
  }

  return ranges;
};

const readParagraphText = (paragraphXml: string): string => {
  let text = '';
  const pattern = /<w:t(?:\s[^>]*?)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:noBreakHyphen\s*\/>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(paragraphXml)) !== null) {
    if (match[1] !== undefined) text += decodeXml(match[1]);
    else if (match[0].startsWith('<w:tab')) text += '\t';
    else if (match[0].startsWith('<w:br')) text += '\n';
    else text += '-';
  }
  return text;
};

const writeRun = (
  xml: string,
  paragraphStart: number,
  range: TextRange,
  text: string
): string => {
  const encoded = encodeXml(text);

  if (range.selfClosing) {
    const absoluteStart = paragraphStart + range.openTagStart;
    const absoluteEnd = paragraphStart + range.contentStart;
    if (!text) return xml;
    return (
      xml.slice(0, absoluteStart) +
      `<w:t xml:space="preserve">${encoded}</w:t>` +
      xml.slice(absoluteEnd)
    );
  }

  const absoluteContentStart = paragraphStart + range.contentStart;
  const absoluteContentEnd = paragraphStart + range.contentEnd;
  const absoluteTagStart = paragraphStart + range.openTagStart;

  // Leading/trailing spaces are dropped by Word unless the run preserves space.
  const openTag = xml.slice(absoluteTagStart, absoluteContentStart);
  const preservedOpenTag = openTag.includes('xml:space')
    ? openTag
    : openTag.replace(/^<w:t/, '<w:t xml:space="preserve"');

  return (
    xml.slice(0, absoluteTagStart) +
    preservedOpenTag +
    encoded +
    xml.slice(absoluteContentEnd)
  );
};

const insertRunBeforeClose = (
  xml: string,
  paragraph: ParagraphRange,
  text: string
): string => {
  if (!text) return xml;
  const run = `<w:r><w:t xml:space="preserve">${encodeXml(text)}</w:t></w:r>`;
  const inner = xml.slice(paragraph.start, paragraph.end);

  // `<w:p/>` has no close tag to insert before — expand it into a real element.
  if (inner.endsWith('/>') && !inner.includes('</w:p>')) {
    const expanded = `${inner.slice(0, -2)}>${run}</w:p>`;
    return xml.slice(0, paragraph.start) + expanded + xml.slice(paragraph.end);
  }

  const insertAt = paragraph.end - '</w:p>'.length;
  return xml.slice(0, insertAt) + run + xml.slice(insertAt);
};

const matchAttribute = (xml: string, tagName: string): string | null => {
  const pattern = new RegExp(`<${tagName}\\s[^>]*w:val="([^"]*)"`, '');
  return pattern.exec(xml)?.[1] ?? null;
};

const classify = (
  style: string | null,
  outlineLevel: string | null,
  numbered: boolean
): { type: DocxBlockType; level: number } => {
  const normalised = (style ?? '').toLowerCase().replace(/[\s_-]/g, '');

  const headingMatch = /^heading(\d)$/.exec(normalised) ?? /^h(\d)$/.exec(normalised);
  if (headingMatch) return { type: 'heading', level: Number(headingMatch[1]) };
  if (normalised === 'title') return { type: 'heading', level: 1 };
  if (normalised === 'subtitle') return { type: 'heading', level: 2 };
  if (outlineLevel !== null && Number(outlineLevel) < 9) {
    return { type: 'heading', level: Number(outlineLevel) + 1 };
  }
  if (normalised.includes('quote')) return { type: 'quote', level: 0 };
  if (numbered || normalised.includes('listparagraph')) return { type: 'listItem', level: 0 };
  return { type: 'paragraph', level: 0 };
};

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const encodeXml = (value: string): string =>
  value
    // Control characters are illegal in XML 1.0 and would produce a document
    // Word refuses to open; drop them rather than writing a broken file.
    .replace(CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // A newline inside <w:t> is collapsed to a space by Word. Close the text
    // node, emit a real break, and reopen — the run keeps its formatting.
    .replace(/\r\n|\r|\n/g, '</w:t><w:br/><w:t xml:space="preserve">')
    .replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">');
