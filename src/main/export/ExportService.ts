import { writeFile, stat } from 'node:fs/promises';
import type { ExportRequest, ExportResult } from '@shared/portable';
import { DocumentError } from '../documents/DocumentHandler';
import type { DocumentRendererRegistry } from './DocumentRenderer';

/** Renders a converted document and writes it. Choosing the destination is the
 *  IPC layer's job, because only it has a window to hang a dialog on. */
export class ExportService {
  constructor(private readonly renderers: DocumentRendererRegistry) {}

  extensionFor(request: ExportRequest['target']): string {
    return this.renderers.resolve(request).extension;
  }

  async writeTo(filePath: string, request: ExportRequest): Promise<ExportResult> {
    const renderer = this.renderers.resolve(request.target);

    let bytes: Buffer;
    try {
      bytes = await renderer.render(request.document);
    } catch (error) {
      throw new DocumentError(
        'write-failed',
        `Could not convert ${request.document.source.fileName} to ${request.target}.`,
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      await writeFile(filePath, bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      throw new DocumentError(
        'write-failed',
        code === 'EACCES' || code === 'EPERM' || code === 'EBUSY'
          ? `Windows would not let Docket write ${filePath}.`
          : `Could not write ${filePath}.`,
        code === 'EBUSY'
          ? 'The file is open in another program. Close it and try again.'
          : error instanceof Error
            ? error.message
            : String(error)
      );
    }

    const stats = await stat(filePath);
    return { filePath, sizeBytes: stats.size, target: request.target };
  }
}
