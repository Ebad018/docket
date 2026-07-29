import { ViewerRegistry } from './types';
import { MarkdownViewer } from './MarkdownViewer';
import { DocxViewer } from './DocxViewer';
import { XlsxViewer } from './XlsxViewer';
import { PdfViewer } from './PdfViewer';

/** The renderer's composition root. One line per format, same as the main
 *  process's — a fifth format never edits a viewer that already exists. */
export const viewerRegistry = new ViewerRegistry()
  .register('markdown', MarkdownViewer)
  .register('docx', DocxViewer)
  .register('xlsx', XlsxViewer)
  .register('pdf', PdfViewer);
