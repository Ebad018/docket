import { extname } from 'node:path';
import type { DocumentKind } from '@shared/documents';
import { DocumentError, type DocumentHandler } from './DocumentHandler';

/**
 * Open for extension, closed for modification: new formats arrive through
 * `register`, and nothing already in this class changes to accommodate them.
 */
export class DocumentHandlerRegistry {
  private readonly byExtension = new Map<string, DocumentHandler>();
  private readonly byKind = new Map<DocumentKind, DocumentHandler>();

  register(handler: DocumentHandler): this {
    if (this.byKind.has(handler.kind)) {
      throw new Error(`A handler for "${handler.kind}" is already registered.`);
    }
    this.byKind.set(handler.kind, handler);
    for (const extension of handler.extensions) {
      const key = normalise(extension);
      const existing = this.byExtension.get(key);
      if (existing) {
        throw new Error(
          `Extension ".${key}" is claimed by both "${existing.kind}" and "${handler.kind}".`
        );
      }
      this.byExtension.set(key, handler);
    }
    return this;
  }

  /** Returns the handler for a path, or throws a coded error naming the format. */
  resolve(filePath: string): DocumentHandler {
    const key = normalise(extname(filePath));
    const handler = this.byExtension.get(key);
    if (!handler) {
      throw new DocumentError(
        'unsupported-format',
        key
          ? `Docket does not open .${key} files.`
          : 'That file has no extension, so Docket cannot tell which reader to use.',
        `Registered formats: ${this.extensions().map((e) => `.${e}`).join(', ')}`
      );
    }
    return handler;
  }

  find(filePath: string): DocumentHandler | undefined {
    return this.byExtension.get(normalise(extname(filePath)));
  }

  handlers(): readonly DocumentHandler[] {
    return [...this.byKind.values()];
  }

  extensions(): readonly string[] {
    return [...this.byExtension.keys()];
  }

  /** Filters for the OS open dialog, derived from what is registered. */
  dialogFilters(): { name: string; extensions: string[] }[] {
    return [
      { name: 'All documents Docket reads', extensions: [...this.byExtension.keys()] },
      ...this.handlers().map((handler) => ({
        name: handler.capabilities.label,
        extensions: [...handler.extensions]
      }))
    ];
  }
}

const normalise = (extension: string): string =>
  extension.replace(/^\./, '').trim().toLowerCase();
