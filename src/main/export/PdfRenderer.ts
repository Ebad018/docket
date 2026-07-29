import { randomUUID } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { PortableDocument } from '@shared/portable';
import { buildPrintHtml } from './printHtml';
import type { DocumentRenderer } from './DocumentRenderer';

/**
 * Typesets the document with Chromium and prints it to PDF.
 *
 * The alternative — drawing text onto a page with a PDF library — means
 * hand-rolling line breaking, hyphenation, widow control, table pagination and
 * font metrics, and getting all of them slightly wrong. Chromium already does
 * that work, and it produces a PDF with a real text layer, working hyperlinks
 * and selectable text rather than a picture of a document.
 */
export class PdfRenderer implements DocumentRenderer {
  readonly target = 'pdf' as const;
  readonly extension = 'pdf';

  async render(document: PortableDocument): Promise<Buffer> {
    const scratchPath = join(app.getPath('temp'), `docket-print-${randomUUID()}.html`);
    await writeFile(scratchPath, buildPrintHtml(document), 'utf8');

    // Offscreen, isolated, and with no way back into the application: the
    // content being typeset came out of a file the user did not necessarily
    // write.
    const printer = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
        webSecurity: true
      }
    });

    printer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printer.webContents.on('will-navigate', (event) => event.preventDefault());

    try {
      await printer.loadFile(scratchPath);

      // Chromium reports the load before web fonts have settled; without this
      // the first page occasionally typesets against the fallback metrics.
      await new Promise((resolve) => setTimeout(resolve, 120));

      return await printer.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: FOOTER(document),
        margins: { top: 0.79, bottom: 0.71, left: 0.71, right: 0.71 }
      });
    } finally {
      if (!printer.isDestroyed()) printer.destroy();
      await rm(scratchPath, { force: true });
    }
  }
}

const FOOTER = (document: PortableDocument): string => `
<div style="width:100%;padding:0 18mm;font-family:'Segoe UI',Calibri,sans-serif;font-size:7pt;color:#7a7d76;display:flex;justify-content:space-between;">
  <span>${escapeHtml(document.source.fileName)}</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
