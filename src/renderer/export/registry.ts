import { DocumentExtractorRegistry } from './types';
import { MarkdownExtractor } from './MarkdownExtractor';
import { DocxExtractor } from './DocxExtractor';
import { XlsxExtractor } from './XlsxExtractor';
import { PdfExtractor } from './PdfExtractor';

/** One line per source format, mirroring the handler and viewer registries. */
export const extractorRegistry = new DocumentExtractorRegistry()
  .register(new MarkdownExtractor())
  .register(new DocxExtractor())
  .register(new XlsxExtractor())
  .register(new PdfExtractor());
