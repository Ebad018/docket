import { join } from 'node:path';
import { app } from 'electron';
import { DocumentHandlerRegistry } from './documents/DocumentHandlerRegistry';
import { MarkdownHandler } from './documents/MarkdownHandler';
import { DocxHandler } from './documents/DocxHandler';
import { XlsxHandler } from './documents/XlsxHandler';
import { PdfHandler } from './documents/PdfHandler';
import { SqliteRecentFilesRepository } from './recents/SqliteRecentFilesRepository';
import { DocumentRendererRegistry } from './export/DocumentRenderer';
import { MarkdownRenderer } from './export/MarkdownRenderer';
import { DocxRenderer } from './export/DocxRenderer';
import { PdfRenderer } from './export/PdfRenderer';
import { ExportService } from './export/ExportService';
import { DocumentService } from './services/DocumentService';
import { RecentFilesService } from './services/RecentFilesService';
import { SampleLibrary } from './services/SampleLibrary';

/**
 * The composition root: the only file that names concrete implementations.
 *
 * Adding a fifth format is one import and one `.register(...)` line here, plus
 * the handler itself and a viewer in the renderer. Nothing already written gets
 * touched — that is the whole point of the registry.
 */
export interface Application {
  readonly documents: DocumentService;
  readonly recents: RecentFilesService;
  readonly samples: SampleLibrary;
  readonly exports: ExportService;
  readonly registry: DocumentHandlerRegistry;
  dispose(): Promise<void>;
}

export const compose = (): Application => {
  const registry = new DocumentHandlerRegistry()
    .register(new MarkdownHandler())
    .register(new DocxHandler())
    .register(new XlsxHandler())
    .register(new PdfHandler());

  // Conversion targets. Sources are registered on the renderer side, because
  // extraction needs the loaded payload and the user's unsaved draft.
  const renderers = new DocumentRendererRegistry()
    .register(new MarkdownRenderer())
    .register(new DocxRenderer())
    .register(new PdfRenderer());

  const repository = new SqliteRecentFilesRepository(
    join(app.getPath('userData'), 'listing.sqlite')
  );

  return {
    registry,
    documents: new DocumentService(registry, repository),
    recents: new RecentFilesService(repository),
    samples: new SampleLibrary(join(app.getPath('documents'), 'Docket Samples')),
    exports: new ExportService(renderers),
    dispose: () => repository.close()
  };
};
