import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import type {
  DocumentMeta,
  DocumentPatch,
  OpenDocument,
  SaveResult
} from '@shared/documents';
import { DocumentError, isWritable } from '../documents/DocumentHandler';
import type { DocumentHandlerRegistry } from '../documents/DocumentHandlerRegistry';
import type { RecentFilesRepository } from '../recents/RecentFilesRepository';

/**
 * The one place that knows opening a document and remembering it are two
 * different jobs. It orchestrates a reader and a repository, both injected as
 * interfaces, and owns neither.
 */
export class DocumentService {
  constructor(
    private readonly registry: DocumentHandlerRegistry,
    private readonly recents: RecentFilesRepository
  ) {}

  async open(filePath: string): Promise<OpenDocument> {
    const handler = this.registry.resolve(filePath);
    const meta = await this.describe(filePath);
    const payload = await handler.read(filePath);

    await this.recents.recordOpen({
      filePath: meta.filePath,
      fileName: meta.fileName,
      folder: meta.folder,
      kind: handler.kind,
      sizeBytes: meta.sizeBytes,
      openedAt: new Date().toISOString()
    });

    return { meta, capabilities: handler.capabilities, payload };
  }

  async save(filePath: string, patch: DocumentPatch): Promise<SaveResult> {
    const handler = this.registry.resolve(filePath);
    if (!isWritable(handler)) {
      throw new DocumentError(
        'write-failed',
        `${handler.capabilities.label} files open read-only in Docket.`,
        handler.capabilities.editingNote
      );
    }
    await handler.write(filePath, patch);
    const meta = await this.describe(filePath);
    return { filePath, sizeBytes: meta.sizeBytes, savedAt: new Date().toISOString() };
  }

  async describe(filePath: string): Promise<DocumentMeta> {
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      throw new DocumentError('not-found', `${filePath} is no longer on disk.`);
    }
    if (stats.isDirectory()) {
      throw new DocumentError('read-failed', `${filePath} is a folder, not a document.`);
    }
    return {
      filePath,
      fileName: basename(filePath),
      folder: dirname(filePath),
      extension: extname(filePath).replace(/^\./, '').toLowerCase(),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  }

  formats() {
    return this.registry.handlers().map((handler) => ({
      kind: handler.kind,
      extensions: [...handler.extensions],
      capabilities: handler.capabilities,
      writable: isWritable(handler)
    }));
  }

  dialogFilters() {
    return this.registry.dialogFilters();
  }
}
