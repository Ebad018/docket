import { useCallback, useMemo, useState } from 'react';
import { targetsFor, type ExportTarget } from '@shared/portable';
import { shortenFolder } from './lib/format';
import { isDirty } from './state/deck';
import { useSession } from './state/useSession';
import { useShortcuts, useTheme, useWindowState, type Shortcut } from './state/useChrome';
import { TitleBar } from './components/TitleBar';
import { StatusLine } from './components/StatusLine';
import { Listing } from './components/Listing';
import { Toasts } from './components/Toasts';
import { CommandPalette, type Command } from './components/CommandPalette';
import { ExportBay } from './components/ExportBay';
import { viewerRegistry } from './viewers/registry';

export const App = () => {
  const session = useSession();
  const { theme, toggleTheme } = useTheme();
  const windowState = useWindowState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [readout, setReadout] = useState<readonly string[]>([]);
  /** `null` means the convert panel is closed; a target preselects it. */
  const [bay, setBay] = useState<{ target: ExportTarget | null } | null>(null);

  const { activeDeck } = session;
  const activeDirty = activeDeck ? isDirty(activeDeck) : false;
  const bayOpen = bay !== null && activeDeck !== null && session.view.kind === 'deck';

  /**
   * The readout belongs to whichever viewer is mounted, and each one sets it
   * when it mounts. The parent must not clear it: doing so blanks the reading
   * whenever the view does not actually change — clicking the active tab, or
   * any batched sequence that lands back where it started — and nothing then
   * puts it back, because no viewer remounted. On the listing there is no deck,
   * and the status line does not render a readout at all.
   */
  const selectView = session.setView;

  const closeDeck = useCallback(
    (id: string) => {
      const deck = session.decks.find((entry) => entry.id === id);
      if (deck && isDirty(deck)) {
        const discard = window.confirm(
          `${deck.document.meta.fileName} has unsaved edits.\n\nClose it and discard them?`
        );
        if (!discard) return;
      }
      session.closeDeck(id);
    },
    [session]
  );

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: 'open',
        group: 'File',
        label: 'Open a document…',
        hint: 'Ctrl O',
        run: () => void session.openDialog()
      },
      {
        id: 'listing',
        group: 'Go',
        label: 'Show the listing',
        hint: 'Ctrl L',
        run: () => selectView({ kind: 'listing' })
      },
      {
        id: 'save',
        group: 'File',
        label: activeDeck ? `Save ${activeDeck.document.meta.fileName}` : 'Save',
        hint: 'Ctrl S',
        disabled: !activeDeck,
        run: () => activeDeck && void session.save(activeDeck.id)
      },
      {
        id: 'save-as',
        group: 'File',
        label: 'Save a copy…',
        hint: 'Ctrl Shift S',
        disabled: !activeDeck,
        run: () => activeDeck && void session.save(activeDeck.id, true)
      },
      {
        id: 'convert',
        group: 'Convert',
        label: 'Convert this document…',
        hint: 'Ctrl E',
        disabled: !activeDeck,
        run: () => setBay({ target: null })
      },
      ...(activeDeck
        ? targetsFor(activeDeck.document.payload.kind).map((descriptor) => ({
            id: `convert-${descriptor.target}`,
            group: 'Convert',
            label: `Convert to ${descriptor.label}`,
            hint: `.${descriptor.extension}`,
            run: () => setBay({ target: descriptor.target })
          }))
        : []),
      {
        id: 'reveal',
        group: 'File',
        label: 'Show in Explorer',
        disabled: !activeDeck,
        run: () =>
          activeDeck && session.revealInFolder(activeDeck.document.meta.filePath)
      },
      {
        id: 'close',
        group: 'File',
        label: 'Close this document',
        hint: 'Ctrl W',
        disabled: !activeDeck,
        run: () => activeDeck && closeDeck(activeDeck.id)
      },
      {
        id: 'theme',
        group: 'View',
        label: theme === 'dark' ? 'Switch to the lit machine room' : 'Switch to the night shift',
        run: toggleTheme
      },
      {
        id: 'clear',
        group: 'Listing',
        label: 'Clear the listing (keeps pinned entries)',
        run: () => void session.clearRecents()
      },
      {
        id: 'samples',
        group: 'Listing',
        label: 'Write the four sample documents',
        run: () => void session.restoreSamples()
      },
      {
        id: 'default-apps',
        group: 'Windows',
        label: 'Make Docket the default for .md, .docx, .xlsx and .pdf…',
        hint: 'opens Settings',
        run: () => void window.docket.app.openDefaultAppsSettings()
      },
      {
        id: 'about',
        group: 'Windows',
        label: `About Docket ${__APP_VERSION__}`,
        hint: 'which build is this?',
        run: () => {
          void (async () => {
            const result = await window.docket.app.buildInfo();
            if (!result.ok) {
              session.notify({ tone: 'error', title: 'Could not read the build info.' });
              return;
            }
            const info = result.value;
            session.notify({
              tone: 'info',
              // The executable path is the point: several copies of Docket can
              // be installed at once and every window looks the same.
              title: `Docket ${info.version} — ${info.packaged ? 'installed' : 'development'} build`,
              detail: `Running from ${info.executable}\nElectron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}\nListing at ${info.userData}`
            });
          })();
        }
      }
    ];

    const openDecks: Command[] = session.decks.map((deck) => ({
      id: `deck-${deck.id}`,
      group: 'Open',
      label: deck.document.meta.fileName,
      hint: isDirty(deck) ? 'unsaved' : undefined,
      run: () => selectView({ kind: 'deck', id: deck.id })
    }));

    const recentCommands: Command[] = session.recents.slice(0, 40).map((entry) => ({
      id: `recent-${entry.filePath}`,
      group: 'Listing',
      label: entry.fileName,
      hint: shortenFolder(entry.folder, 2),
      run: () => void session.openPath(entry.filePath)
    }));

    return [...base, ...openDecks, ...recentCommands];
  }, [activeDeck, closeDeck, selectView, session, theme, toggleTheme]);

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { combo: 'mod+o', run: () => void session.openDialog(), whileTyping: true },
      { combo: 'mod+k', run: () => setPaletteOpen(true), whileTyping: true },
      { combo: 'mod+l', run: () => selectView({ kind: 'listing' }) },
      {
        combo: 'mod+s',
        whileTyping: true,
        run: () => activeDeck && void session.save(activeDeck.id)
      },
      {
        combo: 'mod+shift+s',
        whileTyping: true,
        run: () => activeDeck && void session.save(activeDeck.id, true)
      },
      {
        combo: 'mod+w',
        whileTyping: true,
        run: () => activeDeck && closeDeck(activeDeck.id)
      },
      {
        combo: 'mod+e',
        whileTyping: true,
        run: () => activeDeck && setBay((current) => (current ? null : { target: null }))
      },
      {
        combo: 'mod+Tab',
        run: () => {
          if (session.decks.length === 0) return;
          const index = session.decks.findIndex((deck) => deck.id === activeDeck?.id);
          const next = session.decks[(index + 1) % session.decks.length];
          selectView({ kind: 'deck', id: next.id });
        }
      }
    ],
    [activeDeck, closeDeck, selectView, session]
  );

  useShortcuts(shortcuts);

  const Viewer = activeDeck
    ? viewerRegistry.resolve(activeDeck.document.payload.kind)
    : undefined;

  return (
    <div className="shell">
      <TitleBar
        decks={session.decks}
        view={session.view}
        maximized={windowState.maximized}
        onSelect={selectView}
        onClose={closeDeck}
        onMinimize={windowState.minimize}
        onToggleMaximize={windowState.toggleMaximize}
        onCloseWindow={() => {
          if (session.dirtyDecks.length > 0) {
            const names = session.dirtyDecks
              .map((deck) => deck.document.meta.fileName)
              .join('\n');
            const discard = window.confirm(
              `These documents have unsaved edits:\n\n${names}\n\nClose Docket and discard them?`
            );
            if (!discard) return;
          }
          windowState.close();
        }}
      />

      <div className="stage-row">
        {session.view.kind === 'listing' || !activeDeck || !Viewer ? (
          <Listing
            entries={session.recents}
            freshPaths={session.freshPaths}
            busy={session.loading}
            onOpen={(filePath) => void session.openPath(filePath)}
            onOpenDialog={() => void session.openDialog()}
            onTogglePin={(filePath) => void session.togglePin(filePath)}
            onRemove={(filePath) => void session.removeRecent(filePath)}
            onClear={() => void session.clearRecents()}
            onReveal={session.revealInFolder}
            onRestoreSamples={() => void session.restoreSamples()}
            onConvert={(filePath) => {
              void session.openPath(filePath).then(() => setBay({ target: null }));
            }}
          />
        ) : (
          <Viewer
            key={activeDeck.id}
            deck={activeDeck}
            updateDraft={(update) => session.updateDraft(activeDeck.id, update)}
            onReadout={setReadout}
            onSave={() => void session.save(activeDeck.id)}
            onSaveCopy={() => void session.save(activeDeck.id, true)}
          />
        )}

        {bayOpen && activeDeck && (
          <ExportBay
            key={activeDeck.id}
            deck={activeDeck}
            initialTarget={bay?.target ?? null}
            busy={session.exporting}
            onClose={() => setBay(null)}
            onSave={() => void session.save(activeDeck.id)}
            onRun={(document, target, suggestedName) => {
              void session.runExport(document, target, suggestedName);
            }}
          />
        )}
      </div>

      <StatusLine
        deck={session.view.kind === 'deck' ? activeDeck : null}
        entryCount={session.recents.length}
        readout={readout}
        theme={theme}
        converting={session.exporting}
        onReveal={session.revealInFolder}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        onConvert={() => setBay((current) => (current ? null : { target: null }))}
      />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />

      <Toasts notices={session.notices} onDismiss={session.dismissNotice} />

      {activeDirty && (
        <span className="visually-hidden" role="status">
          {activeDeck?.document.meta.fileName} has unsaved edits.
        </span>
      )}
    </div>
  );
};
