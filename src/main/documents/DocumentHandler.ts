import type {
  DocumentKind,
  DocumentPatch,
  DocumentPayload,
  FormatCapabilities
} from '@shared/documents';

/**
 * Reading and writing are separate interfaces on purpose (ISP): a format that
 * can be read but not written must not be forced to stub out a `write` that
 * throws. The registry asks whether a handler implements the writer half
 * rather than calling and catching.
 */
export interface DocumentReader {
  readonly kind: DocumentKind;
  /** Lower-case, without the dot. */
  readonly extensions: readonly string[];
  readonly capabilities: FormatCapabilities;
  read(filePath: string): Promise<DocumentPayload>;
}

export interface DocumentWriter {
  /**
   * Applies a patch to the file at `filePath`. Implementations must either
   * write a fully valid file of their format or throw — never leave a
   * half-written document on disk.
   */
  write(filePath: string, patch: DocumentPatch): Promise<void>;
}

export type DocumentHandler = DocumentReader & Partial<DocumentWriter>;

export const isWritable = (
  handler: DocumentHandler
): handler is DocumentReader & DocumentWriter => typeof handler.write === 'function';

/** Thrown by handlers so the IPC layer can map failures to a stable code. */
export class DocumentError extends Error {
  constructor(
    readonly code:
      | 'not-found'
      | 'read-failed'
      | 'write-failed'
      | 'unsupported-format'
      | 'cancelled',
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}
