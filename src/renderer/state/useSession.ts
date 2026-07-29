import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OpenDocument, RecentEntry } from '@shared/documents';
import type { ExportTarget, PortableDocument } from '@shared/portable';
import type { IpcResult } from '@shared/ipc';
import { initialDraft, isDirty, rebase, toPatch, type Deck, type Draft } from './deck';

export interface Notice {
  readonly id: number;
  readonly tone: 'info' | 'error';
  readonly title: string;
  readonly detail?: string;
}

export type View = { kind: 'listing' } | { kind: 'deck'; id: string };

let noticeSequence = 0;
let deckSequence = 0;

export const useSession = () => {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [view, setView] = useState<View>({ kind: 'listing' });
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Paths opened in this session, so the listing can print them in. */
  const [freshPaths, setFreshPaths] = useState<readonly string[]>([]);

  const decksRef = useRef(decks);
  decksRef.current = decks;

  const notify = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = (noticeSequence += 1);
    setNotices((current) => [...current.slice(-3), { ...notice, id }]);
    window.setTimeout(
      () => setNotices((current) => current.filter((entry) => entry.id !== id)),
      notice.tone === 'error' ? 9000 : 4200
    );
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  /** Unwraps an IPC envelope, surfacing failures as notices exactly once. */
  const unwrap = useCallback(
    <T,>(result: IpcResult<T>, title: string): T | null => {
      if (result.ok) return result.value;
      if (result.code === 'cancelled') return null;
      notify({ tone: 'error', title: `${title}: ${result.message}`, detail: result.detail });
      return null;
    },
    [notify]
  );

  const refreshRecents = useCallback(async () => {
    const result = await window.docket.recents.list();
    const entries = unwrap(result, 'Could not read the listing');
    if (entries) setRecents(entries);
  }, [unwrap]);

  const adopt = useCallback((document: OpenDocument): Deck => {
    const existing = decksRef.current.find(
      (deck) => deck.document.meta.filePath === document.meta.filePath
    );
    if (existing && isDirty(existing)) {
      // Reopening a document with unsaved edits keeps the edits. Losing work to
      // a double-click on the listing would be indefensible.
      setView({ kind: 'deck', id: existing.id });
      return existing;
    }

    const deck: Deck = existing
      ? { ...existing, document, draft: initialDraft(document), saving: false }
      : {
          id: `deck-${(deckSequence += 1)}`,
          document,
          draft: initialDraft(document),
          saving: false,
          savedAt: null
        };

    setDecks((current) =>
      existing
        ? current.map((entry) => (entry.id === deck.id ? deck : entry))
        : [...current, deck]
    );
    setView({ kind: 'deck', id: deck.id });
    return deck;
  }, []);

  const openPath = useCallback(
    async (filePath: string) => {
      setLoading(true);
      try {
        const result = await window.docket.documents.openPath(filePath);
        const document = unwrap(result, 'Could not open that file');
        if (!document) return null;
        adopt(document);
        setFreshPaths((current) =>
          current.includes(document.meta.filePath)
            ? current
            : [...current, document.meta.filePath]
        );
        void refreshRecents();
        return document;
      } finally {
        setLoading(false);
      }
    },
    [adopt, refreshRecents, unwrap]
  );

  const openPaths = useCallback(
    async (paths: readonly string[]) => {
      for (const path of paths) await openPath(path);
    },
    [openPath]
  );

  const openDialog = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.docket.documents.openDialog();
      const documents = unwrap(result, 'Could not open that file');
      if (!documents || documents.length === 0) return;
      documents.forEach((document) => adopt(document));
      setFreshPaths((current) => [
        ...current,
        ...documents.map((document) => document.meta.filePath)
      ]);
      void refreshRecents();
    } finally {
      setLoading(false);
    }
  }, [adopt, refreshRecents, unwrap]);

  const updateDraft = useCallback((id: string, update: (draft: Draft) => Draft) => {
    setDecks((current) =>
      current.map((deck) => (deck.id === id ? { ...deck, draft: update(deck.draft) } : deck))
    );
  }, []);

  const closeDeck = useCallback((id: string) => {
    setDecks((current) => {
      const next = current.filter((deck) => deck.id !== id);
      setView((currentView) => {
        if (currentView.kind !== 'deck' || currentView.id !== id) return currentView;
        const index = current.findIndex((deck) => deck.id === id);
        const neighbour = next[Math.min(index, next.length - 1)];
        return neighbour ? { kind: 'deck', id: neighbour.id } : { kind: 'listing' };
      });
      return next;
    });
  }, []);

  const save = useCallback(
    async (id: string, asCopy = false) => {
      const deck = decksRef.current.find((entry) => entry.id === id);
      if (!deck) return;
      if (!asCopy && !isDirty(deck)) {
        notify({ tone: 'info', title: 'Nothing to save — no edits since the last write.' });
        return;
      }

      setDecks((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, saving: true } : entry))
      );

      const patch = toPatch(deck);
      try {
        if (asCopy) {
          const result = await window.docket.documents.saveAs(
            deck.document.meta.filePath,
            patch,
            deck.document.meta.fileName
          );
          const saved = unwrap(result, 'Could not save a copy');
          if (saved) {
            adopt(saved);
            notify({ tone: 'info', title: `Saved a copy as ${saved.meta.fileName}` });
            void refreshRecents();
          }
        } else {
          const result = await window.docket.documents.save(
            deck.document.meta.filePath,
            patch
          );
          const saved = unwrap(result, `Could not save ${deck.document.meta.fileName}`);
          if (saved) {
            // Re-read so the deck reflects exactly what is now on disk.
            const reopened = await window.docket.documents.openPath(saved.filePath);
            if (reopened.ok) {
              setDecks((current) =>
                current.map((entry) =>
                  entry.id === id ? rebase(entry, reopened.value, saved.savedAt) : entry
                )
              );
            }
            notify({ tone: 'info', title: `Saved ${deck.document.meta.fileName}` });
            void refreshRecents();
          }
        }
      } finally {
        setDecks((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, saving: false } : entry))
        );
      }
    },
    [adopt, notify, refreshRecents, unwrap]
  );

  const runExport = useCallback(
    async (document: PortableDocument, target: ExportTarget, suggestedName: string) => {
      setExporting(true);
      try {
        const result = await window.docket.documents.exportAs({
          document,
          target,
          suggestedName
        });
        const written = unwrap(result, 'Could not convert that document');
        if (!written) return null;

        const name = written.filePath.split(/[\\/]/).pop() ?? written.filePath;
        notify({
          tone: 'info',
          title: `Converted to ${name}`,
          detail: `${(written.sizeBytes / 1024).toFixed(1)} KB · ${written.filePath}`
        });
        return written;
      } finally {
        setExporting(false);
      }
    },
    [notify, unwrap]
  );

  const removeRecent = useCallback(
    async (filePath: string) => {
      const result = await window.docket.recents.remove(filePath);
      const entries = unwrap(result, 'Could not update the listing');
      if (entries) setRecents(entries);
    },
    [unwrap]
  );

  const clearRecents = useCallback(async () => {
    const result = await window.docket.recents.clear();
    const entries = unwrap(result, 'Could not clear the listing');
    if (entries) {
      setRecents(entries);
      notify({ tone: 'info', title: 'Listing cleared. Pinned entries were kept.' });
    }
  }, [notify, unwrap]);

  const togglePin = useCallback(
    async (filePath: string) => {
      const result = await window.docket.recents.togglePin(filePath);
      const entries = unwrap(result, 'Could not pin that file');
      if (entries) setRecents(entries);
    },
    [unwrap]
  );

  const revealInFolder = useCallback((filePath: string) => {
    void window.docket.documents.revealInFolder(filePath);
  }, []);

  const restoreSamples = useCallback(async () => {
    const result = await window.docket.samples.ensure();
    const paths = unwrap(result, 'Could not write the sample documents');
    if (paths && paths.length > 0) {
      await openPath(paths[0]);
      notify({
        tone: 'info',
        title: `Four sample documents are in ${paths[0].replace(/[\\/][^\\/]+$/, '')}`
      });
    }
  }, [notify, openPath, unwrap]);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  useEffect(() => window.docket.shell.onOpenPaths((paths) => void openPaths(paths)), [openPaths]);

  const activeDeck = useMemo(
    () => (view.kind === 'deck' ? (decks.find((deck) => deck.id === view.id) ?? null) : null),
    [decks, view]
  );

  const dirtyDecks = useMemo(() => decks.filter((deck) => isDirty(deck)), [decks]);

  // The .exe is a document editor; closing it with unsaved work must cost a
  // deliberate confirmation, not a reflex.
  useEffect(() => {
    if (dirtyDecks.length === 0) return undefined;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirtyDecks.length]);

  return {
    decks,
    activeDeck,
    dirtyDecks,
    view,
    setView,
    recents,
    notices,
    loading,
    exporting,
    freshPaths,
    runExport,
    openDialog,
    openPath,
    openPaths,
    closeDeck,
    updateDraft,
    save,
    refreshRecents,
    removeRecent,
    clearRecents,
    togglePin,
    revealInFolder,
    restoreSamples,
    notify,
    dismissNotice
  };
};

export type Session = ReturnType<typeof useSession>;
