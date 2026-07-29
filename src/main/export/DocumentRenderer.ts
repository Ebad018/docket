import type { ExportTarget, PortableDocument } from '@shared/portable';

/**
 * Turns the canonical document into bytes of one target format. Renderers know
 * nothing about where the document came from — that is the extractor's job on
 * the other side of the intermediate.
 */
export interface DocumentRenderer {
  readonly target: ExportTarget;
  readonly extension: string;
  render(document: PortableDocument): Promise<Buffer>;
}

/** Open for extension in the same way the read side is. */
export class DocumentRendererRegistry {
  private readonly renderers = new Map<ExportTarget, DocumentRenderer>();

  register(renderer: DocumentRenderer): this {
    if (this.renderers.has(renderer.target)) {
      throw new Error(`A renderer for "${renderer.target}" is already registered.`);
    }
    this.renderers.set(renderer.target, renderer);
    return this;
  }

  resolve(target: ExportTarget): DocumentRenderer {
    const renderer = this.renderers.get(target);
    if (!renderer) {
      throw new Error(`Docket cannot convert to "${target}".`);
    }
    return renderer;
  }

  targets(): readonly ExportTarget[] {
    return [...this.renderers.keys()];
  }
}
