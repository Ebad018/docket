import type { DocumentKind, RecentEntry } from '@shared/documents';

export interface RecordOpenInput {
  readonly filePath: string;
  readonly fileName: string;
  readonly folder: string;
  readonly kind: DocumentKind;
  readonly sizeBytes: number;
  readonly openedAt: string;
}

export interface RecentQuery {
  readonly limit?: number;
}

/**
 * The listing's storage contract. Everything above this line depends on the
 * interface, never on SQLite — swapping the store is a composition-root edit.
 */
export interface RecentFilesRepository {
  list(query?: RecentQuery): Promise<RecentEntry[]>;
  recordOpen(input: RecordOpenInput): Promise<void>;
  remove(filePath: string): Promise<void>;
  clear(): Promise<void>;
  setPinned(filePath: string, pinned: boolean): Promise<void>;
}
