import type { RecentEntry } from '@shared/documents';
import type { RecentFilesRepository } from '../recents/RecentFilesRepository';

/** Reads and curates the listing. Writing new entries belongs to opening a
 *  document, so it lives in DocumentService, not here. */
export class RecentFilesService {
  constructor(private readonly repository: RecentFilesRepository) {}

  list(limit?: number): Promise<RecentEntry[]> {
    return this.repository.list({ limit });
  }

  remove(filePath: string): Promise<void> {
    return this.repository.remove(filePath);
  }

  /** Clears unpinned history. Pinned entries are a deliberate keep. */
  clear(): Promise<void> {
    return this.repository.clear();
  }

  async togglePin(filePath: string): Promise<RecentEntry[]> {
    const entries = await this.repository.list({ limit: 1000 });
    const entry = entries.find((candidate) => candidate.filePath === filePath);
    await this.repository.setPinned(filePath, !entry?.pinned);
    return this.repository.list({ limit: 500 });
  }
}
