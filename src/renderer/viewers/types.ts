import type { ComponentType } from 'react';
import type { DocumentKind } from '@shared/documents';
import type { Deck, Draft } from '@/state/deck';

export interface ViewerProps {
  readonly deck: Deck;
  /** Replaces the deck's draft. Viewers never write to disk themselves. */
  updateDraft(update: (draft: Draft) => Draft): void;
  /** Short strings for the console readout: cursor position, page, cell. */
  onReadout(items: readonly string[]): void;
  onSave(): void;
  onSaveCopy(): void;
}

export type Viewer = ComponentType<ViewerProps>;

/**
 * The renderer's half of the format registry, mirroring the main process's.
 * A fifth format registers a viewer here and a handler there; no existing
 * viewer changes.
 */
export class ViewerRegistry {
  private readonly viewers = new Map<DocumentKind, Viewer>();

  register(kind: DocumentKind, viewer: Viewer): this {
    this.viewers.set(kind, viewer);
    return this;
  }

  resolve(kind: DocumentKind): Viewer | undefined {
    return this.viewers.get(kind);
  }
}
