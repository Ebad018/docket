import type { DocumentKind, OpenDocument } from '@shared/documents';
import type { PortableBlock, PortableDocument } from '@shared/portable';
import type { Draft } from '@/state/deck';

/**
 * Turns one source format into the canonical document. Extractors live in the
 * renderer because that is where the loaded payload and the user's unsaved
 * draft both are — converting what is on screen, not a stale copy from disk.
 */
export interface DocumentExtractor {
  readonly kind: DocumentKind;
  /** Options this source exposes in the export bay, in display order. */
  readonly options: readonly ExtractorOption[];
  /** Async because PDF text lives behind pdf.js, and a sync-only contract
   *  would force every other extractor to pretend otherwise. */
  extract(input: ExtractInput): Promise<PortableBlock[]>;
}

export interface ExtractInput {
  readonly document: OpenDocument;
  readonly draft: Draft;
  readonly settings: ExportSettings;
}

export interface ExtractorOption {
  readonly id: keyof ExportSettings;
  readonly label: string;
  readonly hint?: string;
}

/** Every toggle any extractor understands. Kept as one flat record so the bay
 *  can render options without knowing which extractor owns them. */
export interface ExportSettings {
  readonly includeTitle: boolean;
  readonly pageBreaks: boolean;
  readonly includeAnnotations: boolean;
  readonly sheetLabels: boolean;
  readonly firstRowIsHeader: boolean;
  readonly formulaResults: boolean;
}

export const DEFAULT_SETTINGS: ExportSettings = {
  includeTitle: true,
  pageBreaks: true,
  includeAnnotations: true,
  sheetLabels: true,
  firstRowIsHeader: true,
  formulaResults: true
};

export class DocumentExtractorRegistry {
  private readonly extractors = new Map<DocumentKind, DocumentExtractor>();

  register(extractor: DocumentExtractor): this {
    if (this.extractors.has(extractor.kind)) {
      throw new Error(`An extractor for "${extractor.kind}" is already registered.`);
    }
    this.extractors.set(extractor.kind, extractor);
    return this;
  }

  find(kind: DocumentKind): DocumentExtractor | undefined {
    return this.extractors.get(kind);
  }

  async build(kind: DocumentKind, input: ExtractInput): Promise<PortableDocument> {
    const extractor = this.extractors.get(kind);
    if (!extractor) {
      throw new Error(`Docket cannot convert ${kind} documents yet.`);
    }
    const { meta } = input.document;
    return {
      title: meta.fileName.replace(/\.[^.]+$/, ''),
      blocks: await extractor.extract(input),
      source: { kind, fileName: meta.fileName, filePath: meta.filePath },
      generatedAt: new Date().toISOString()
    };
  }
}
