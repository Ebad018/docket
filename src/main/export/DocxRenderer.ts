import JSZip from 'jszip';
import type {
  Alignment,
  InlineRun,
  PortableBlock,
  PortableDocument
} from '@shared/portable';
import type { DocumentRenderer } from './DocumentRenderer';

/**
 * Writes a real .docx package: styles, list numbering, tables and working
 * hyperlinks. Nothing here goes through a template — the package is assembled
 * part by part so the output opens in Word with a proper style tree rather
 * than a wall of directly-formatted runs.
 */
export class DocxRenderer implements DocumentRenderer {
  readonly target = 'docx' as const;
  readonly extension = 'docx';

  async render(document: PortableDocument): Promise<Buffer> {
    const links = new LinkTable();
    const body = document.blocks.map((block) => renderBlock(block, links)).join('');

    const documentXml = `${XML_DECLARATION}
<w:document ${NAMESPACES}><w:body>${body}${SECTION}</w:body></w:document>`;

    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('word/_rels/document.xml.rels', links.toRelsXml());
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', STYLES);
    zip.file('word/numbering.xml', NUMBERING);
    zip.file('docProps/core.xml', coreProperties(document));
    zip.file('docProps/app.xml', APP_PROPERTIES);

    return zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }
}

/* ── Relationship bookkeeping for hyperlinks ─────────────────────────── */

class LinkTable {
  private readonly entries = new Map<string, string>();

  idFor(href: string): string {
    const existing = this.entries.get(href);
    if (existing) return existing;
    const id = `rIdLink${this.entries.size + 1}`;
    this.entries.set(href, id);
    return id;
  }

  toRelsXml(): string {
    const links = [...this.entries]
      .map(
        ([href, id]) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${attribute(
            href
          )}" TargetMode="External"/>`
      )
      .join('');

    return `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${links}</Relationships>`;
  }
}

/* ── Block rendering ─────────────────────────────────────────────────── */

const renderBlock = (block: PortableBlock, links: LinkTable): string => {
  switch (block.type) {
    case 'heading':
      return paragraph(runs(block.runs, links), { style: `Heading${block.level}` });

    case 'paragraph':
      return paragraph(runs(block.runs, links));

    case 'quote':
      return paragraph(runs(block.runs, links), { style: 'Quote' });

    case 'label':
      return paragraph(runs([{ text: block.text, bold: true }], links), {
        style: 'DocketLabel'
      });

    case 'list':
      return block.items
        .map((item) =>
          paragraph(
            [
              ...(item.checked === undefined
                ? []
                : runs([{ text: item.checked ? '☒ ' : '☐ ' }], links)),
              ...runs(item.runs, links)
            ].join(''),
            {
              style: 'ListParagraph',
              numbering: { id: block.ordered ? 2 : 1, level: Math.min(item.depth, 4) }
            }
          )
        )
        .join('');

    case 'code':
      return block.code
        .split('\n')
        .map((line) =>
          paragraph(
            `<w:r><w:t xml:space="preserve">${text(line || ' ')}</w:t></w:r>`,
            { style: 'DocketCode' }
          )
        )
        .join('');

    case 'table':
      return renderTable(block, links);

    case 'rule':
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B0B0B0"/></w:pBdr><w:spacing w:before="240" w:after="240"/></w:pPr></w:p>`;

    case 'pageBreak':
      return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }
};

interface ParagraphOptions {
  readonly style?: string;
  readonly numbering?: { id: number; level: number };
  readonly alignment?: Alignment | null;
}

const paragraph = (content: string, options: ParagraphOptions = {}): string => {
  const properties: string[] = [];
  if (options.style) properties.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.numbering) {
    properties.push(
      `<w:numPr><w:ilvl w:val="${options.numbering.level}"/><w:numId w:val="${options.numbering.id}"/></w:numPr>`
    );
  }
  if (options.alignment && options.alignment !== 'left') {
    properties.push(`<w:jc w:val="${options.alignment}"/>`);
  }

  const pPr = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${content}</w:p>`;
};

const renderTable = (
  block: Extract<PortableBlock, { type: 'table' }>,
  links: LinkTable
): string => {
  const width = Math.max(
    block.head?.length ?? 0,
    ...block.rows.map((row) => row.length),
    1
  );
  // Word lays the table out against a fixed grid; 9360 twips is the printable
  // width of A4 with the 1-inch margins set in the section properties.
  const columnWidth = Math.floor(9360 / width);
  const grid = `<w:tblGrid>${Array.from(
    { length: width },
    () => `<w:gridCol w:w="${columnWidth}"/>`
  ).join('')}</w:tblGrid>`;

  const row = (
    cells: readonly (readonly InlineRun[])[],
    header: boolean
  ): string => {
    const properties = header
      ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>'
      : '';
    const body = Array.from({ length: width }, (_, index) => {
      const shading = header ? '<w:shd w:val="clear" w:fill="EFEFEA"/>' : '';
      const content = paragraph(
        runs(
          (cells[index] ?? []).map((run) => (header ? { ...run, bold: true } : run)),
          links
        ),
        { style: 'DocketCell', alignment: block.align[index] ?? null }
      );
      return `<w:tc><w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/>${shading}</w:tcPr>${content}</w:tc>`;
    }).join('');
    return `<w:tr>${properties}${body}</w:tr>`;
  };

  const head = block.head ? row(block.head, true) : '';
  const body = block.rows.map((cells) => row(cells, false)).join('');

  return `<w:tbl><w:tblPr><w:tblStyle w:val="DocketTable"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C4C4BC"/><w:left w:val="single" w:sz="4" w:color="C4C4BC"/><w:bottom w:val="single" w:sz="4" w:color="C4C4BC"/><w:right w:val="single" w:sz="4" w:color="C4C4BC"/><w:insideH w:val="single" w:sz="4" w:color="C4C4BC"/><w:insideV w:val="single" w:sz="4" w:color="C4C4BC"/></w:tblBorders></w:tblPr>${grid}${head}${body}</w:tbl>${paragraph(
    ''
  )}`;
};

/* ── Inline rendering ────────────────────────────────────────────────── */

const runs = (list: readonly InlineRun[], links: LinkTable): string =>
  list
    .map((run) => {
      if (!run.text) return '';
      const rendered = singleRun(run);
      if (!run.href) return rendered;
      return `<w:hyperlink r:id="${links.idFor(run.href)}">${rendered}</w:hyperlink>`;
    })
    .join('');

const singleRun = (run: InlineRun): string => {
  const properties: string[] = [];
  if (run.href) properties.push('<w:rStyle w:val="Hyperlink"/>');
  if (run.code) properties.push('<w:rStyle w:val="DocketCodeChar"/>');
  if (run.bold) properties.push('<w:b/>');
  if (run.italic) properties.push('<w:i/>');
  if (run.strike) properties.push('<w:strike/>');

  const rPr = properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : '';

  // A newline inside a run is collapsed by Word; emit a real break instead.
  const body = run.text
    .split(/\r\n|\r|\n/)
    .map((line) => `<w:t xml:space="preserve">${text(line)}</w:t>`)
    .join('<w:br/>');

  return `<w:r>${rPr}${body}</w:r>`;
};

/* ── Static package parts ────────────────────────────────────────────── */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const SECTION =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

const CONTENT_TYPES = `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS = `${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const heading = (id: number, size: number, before: number, after: number): string =>
  `<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${
    id - 1
  }"/><w:spacing w:before="${before}" w:after="${after}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `${XML_DECLARATION}
<w:styles ${NAMESPACES}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(
  1,
  40,
  240,
  120
)}${heading(2, 32, 280, 120)}${heading(3, 26, 240, 100)}${heading(4, 24, 200, 80)}${heading(
  5,
  22,
  200,
  80
)}${heading(
  6,
  22,
  200,
  80
)}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="12" w:color="C4C4BC"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="4A4A44"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="DocketCode"><w:name w:val="Docket Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="360"/><w:shd w:val="clear" w:fill="F4F4EF"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="DocketCell"><w:name w:val="Docket Cell"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="DocketLabel"><w:name w:val="Docket Label"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="80"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="5A5A52"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0B5FA5"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="character" w:styleId="DocketCodeChar"><w:name w:val="Docket Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/><w:shd w:val="clear" w:fill="F4F4EF"/></w:rPr></w:style><w:style w:type="table" w:styleId="DocketTable"><w:name w:val="Docket Table"/><w:tblPr><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

const bulletLevel = (level: number): string =>
  `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${
    ['●', '○', '▪', '▫', '–'][level] ?? '–'
  }"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${
    360 * (level + 1) + 360
  }" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol" w:hint="default"/></w:rPr></w:lvl>`;

const orderedLevel = (level: number): string =>
  `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${
    ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter'][level] ?? 'decimal'
  }"/><w:lvlText w:val="%${level + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${
    360 * (level + 1) + 360
  }" w:hanging="360"/></w:pPr></w:lvl>`;

const NUMBERING = `${XML_DECLARATION}
<w:numbering ${NAMESPACES}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2, 3, 4]
  .map(bulletLevel)
  .join('')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${[
  0, 1, 2, 3, 4
]
  .map(orderedLevel)
  .join(
    ''
  )}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const APP_PROPERTIES = `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Docket</Application></Properties>`;

const coreProperties = (document: PortableDocument): string => `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${text(
  document.title
)}</dc:title><dc:description>Converted from ${text(
  document.source.fileName
)} by Docket.</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${
  document.generatedAt
}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${
  document.generatedAt
}</dcterms:modified></cp:coreProperties>`;

/* ── Escaping ────────────────────────────────────────────────────────── */

const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F]', 'g');

const text = (value: string): string =>
  value
    .replace(CONTROL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, '    ');

const attribute = (value: string): string =>
  text(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
