import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Writes one document of each supported format on first run, so the empty
 * listing has something real to open instead of a suggestion to go find a
 * file. Everything in here is authored demonstration content — the numbers are
 * invented and the sheet says so.
 */
export class SampleLibrary {
  constructor(private readonly folder: string) {}

  async ensure(): Promise<string[]> {
    await mkdir(this.folder, { recursive: true });

    const documents: [string, () => Promise<Buffer | string>][] = [
      ['Start here.md', async () => MARKDOWN_SAMPLE],
      ['Field notes.docx', () => buildDocx()],
      ['Run sheet.xlsx', () => buildXlsx()],
      ['Specimen sheet.pdf', () => buildPdf()]
    ];

    const written: string[] = [];
    for (const [name, build] of documents) {
      const path = join(this.folder, name);
      if (await exists(path)) {
        written.push(path);
        continue;
      }
      try {
        const content = await build();
        await writeFile(path, content as Buffer);
        written.push(path);
      } catch {
        // A sample that fails to generate is not worth failing a launch over.
      }
    }
    return written;
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const MARKDOWN_SAMPLE = `# Start here

Docket opens Markdown, Word, Excel and PDF in one window. This file, and the
three beside it in this folder, are sample documents Docket wrote on first run.
Edit them, break them, delete them — they are yours.

## The listing

Every file you open is written to **the listing**: its name, the folder it came
from, its format, and the moment you opened it. That is the whole navigation
model. There is no folder tree, because the way back to a document is almost
always *when you last had it open*, not where it sits on disk.

Press \`Ctrl\` \`K\` for the command palette. Press \`Ctrl\` \`O\` to open a file.

## What each format can do

| Format | Reading | Editing |
| --- | --- | --- |
| Markdown | Live preview beside the source | Full — writes the source back |
| Word | Faithful render, structured outline | Paragraph text, keeping its style |
| Excel | Sheet tabs, formulas, number formats | Cells and formulas |
| PDF | Paged render, text selection, search | Highlights, notes, page order |

## Markdown Docket understands

Tables, above. Task lists:

- [x] Open a document
- [x] Watch it appear in the listing
- [ ] Pin the ones you keep coming back to

Fenced code, with the language named:

\`\`\`ts
const handler = registry.resolve(filePath);
const document = await handler.read(filePath);
\`\`\`

> Block quotes, ~~strikethrough~~, **bold**, *italic*, \`inline code\`, and
> autolinked addresses like https://commonmark.org all render.

---

### One honest limitation

PDF text is stored as positioned glyphs, not as sentences. Rewriting it in
place reflows nothing and reliably breaks the page, so Docket does not pretend
to offer it. Highlights, notes and page order are real edits and save into the
file where any other reader will see them.
`;

/**
 * A minimal but fully valid .docx, hand-assembled. Building it directly keeps
 * the sample honest: it exercises exactly the paragraph-and-style structure the
 * Word handler reads and writes.
 */
const buildDocx = async (): Promise<Buffer> => {
  const paragraphs: string[] = [
    para('Field notes', 'Title'),
    para('A sample Word document, written by Docket on first run.', 'Subtitle'),
    para('What this file is for', 'Heading1'),
    para(
      'Docket reads a Word document twice. Once faithfully, through a renderer that keeps its headings, lists, tables and emphasis; and once structurally, as an addressable list of paragraphs. The read view is what you see. The structural view is what you edit.',
      null
    ),
    para('Try editing a paragraph', 'Heading1'),
    para(
      'Switch to the Outline pane and change this sentence. Save with Ctrl+S, then reopen the file in Word — the heading styles, page setup and everything else in the document are byte-for-byte unchanged.',
      null
    ),
    para('Reading is not the same as round-tripping', 'Heading2'),
    para(
      'Most tools that claim to edit Word files parse the document into their own model and write a new one. Everything they did not model is quietly lost. Docket edits the text ranges in place and leaves the rest of the package alone.',
      null
    ),
    para('Notes', 'Heading1'),
    para('This document is sample content. Nothing in it describes real work.', 'Quote')
  ];

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join(
    ''
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/document.xml', documentXml);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const para = (text: string, style: string | null): string => {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>
</w:styles>`;

const buildXlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Docket';

  const sheet = workbook.addWorksheet('Run sheet');
  sheet.columns = [
    { header: 'Job', key: 'job', width: 26 },
    { header: 'Deck', key: 'deck', width: 10 },
    { header: 'Cards', key: 'cards', width: 12 },
    { header: 'Rate / 1k', key: 'rate', width: 12 },
    { header: 'Minutes', key: 'minutes', width: 12 }
  ];
  sheet.getRow(1).font = { bold: true };

  const rows = [
    ['Payroll register', 'A', 4820, 1.4],
    ['Inventory reconcile', 'B', 12160, 1.1],
    ['Statement print', 'C', 7405, 0.9],
    ['Address correction', 'D', 2210, 2.3],
    ['Quarterly summary', 'E', 980, 3.1]
  ];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    sheet.addRow({ job: row[0], deck: row[1], cards: row[2], rate: row[3] });
    sheet.getCell(`E${rowNumber}`).value = { formula: `C${rowNumber}*D${rowNumber}/1000` };
    sheet.getCell(`C${rowNumber}`).numFmt = '#,##0';
    sheet.getCell(`D${rowNumber}`).numFmt = '0.0';
    sheet.getCell(`E${rowNumber}`).numFmt = '0.00';
  });

  const totalRow = rows.length + 2;
  sheet.getCell(`A${totalRow}`).value = 'Total';
  sheet.getCell(`A${totalRow}`).font = { bold: true };
  sheet.getCell(`C${totalRow}`).value = { formula: `SUM(C2:C${totalRow - 1})` };
  sheet.getCell(`C${totalRow}`).numFmt = '#,##0';
  sheet.getCell(`E${totalRow}`).value = { formula: `SUM(E2:E${totalRow - 1})` };
  sheet.getCell(`E${totalRow}`).numFmt = '0.00';
  sheet.getRow(totalRow).font = { bold: true };

  sheet.getCell(`A${totalRow + 2}`).value =
    'Sample content. These jobs, counts and rates are invented for demonstration.';
  sheet.getCell(`A${totalRow + 2}`).font = { italic: true, size: 9 };

  const notes = workbook.addWorksheet('Notes');
  notes.columns = [
    { header: 'Field', key: 'field', width: 20 },
    { header: 'Meaning', key: 'meaning', width: 62 }
  ];
  notes.getRow(1).font = { bold: true };
  notes.addRows([
    { field: 'Deck', meaning: 'Which card deck the job was fed from.' },
    { field: 'Cards', meaning: 'Records processed in the run.' },
    { field: 'Rate / 1k', meaning: 'Minutes of machine time per thousand records.' },
    { field: 'Minutes', meaning: 'Formula: Cards × Rate ÷ 1000. Edit a rate and watch it change.' }
  ]);

  workbook.calcProperties.fullCalcOnLoad = true;
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

const buildPdf = async (): Promise<Buffer> => {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Specimen sheet');
  pdf.setAuthor('Docket');

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.09, 0.1, 0.09);
  const soft = rgb(0.42, 0.44, 0.42);

  const pages: [string, string[]][] = [
    [
      'Specimen sheet',
      [
        'A sample PDF, written by Docket on first run.',
        '',
        'Select text with the mouse. Search it with Ctrl+F. Zoom with',
        'Ctrl+= and Ctrl+minus, or fit the page to the window with Ctrl+0.',
        '',
        'Drag across a line with the highlighter to mark it. Drop a note',
        'anywhere on the page. Both save into this file as real PDF',
        'annotations, which means Acrobat, Edge and Preview will show them',
        'too — they are not a private layer Docket keeps to itself.'
      ]
    ],
    [
      'Page two',
      [
        'Pages can be rotated, reordered and deleted from the page rail on',
        'the left. Nothing is written to disk until you save.',
        '',
        'What Docket will not do is rewrite the text on this page. A PDF',
        'stores text as glyphs at fixed coordinates, with no notion of a',
        'paragraph. Replacing a word does not reflow the line, and the',
        'usual result is a page that looks subtly wrong everywhere.'
      ]
    ],
    [
      'Page three',
      [
        'This page exists so reordering has somewhere to go.',
        '',
        'Try it: rotate this page, drag it above page two, and save. Then',
        'reopen the file — the order holds.'
      ]
    ]
  ];

  pages.forEach(([heading, lines]) => {
    const page = pdf.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 56, y: height - 96, width: width - 112, height: 2, color: ink });
    page.drawText(heading, { x: 56, y: height - 140, size: 28, font: bold, color: ink });

    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 56,
        y: height - 190 - index * 22,
        size: 12,
        font: regular,
        color: ink
      });
    });

    page.drawText('Sample content — Docket', {
      x: 56,
      y: 56,
      size: 9,
      font: regular,
      color: soft
    });
  });

  return Buffer.from(await pdf.save());
};
