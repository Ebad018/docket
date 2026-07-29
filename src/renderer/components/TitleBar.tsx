import type { Deck } from '@/state/deck';
import { isDirty } from '@/state/deck';
import type { View } from '@/state/useSession';
import {
  IconClose,
  IconListing,
  IconMaximise,
  IconMinimise,
  IconRestore
} from './icons';

interface TitleBarProps {
  readonly decks: readonly Deck[];
  readonly view: View;
  readonly maximized: boolean;
  onSelect(view: View): void;
  onClose(id: string): void;
  onMinimize(): void;
  onToggleMaximize(): void;
  onCloseWindow(): void;
}

export const TitleBar = ({
  decks,
  view,
  maximized,
  onSelect,
  onClose,
  onMinimize,
  onToggleMaximize,
  onCloseWindow
}: TitleBarProps) => (
  <header className="titlebar">
    <div className="titlebar__brand">
      <span className="titlebar__reel" />
      <span className="titlebar__mark">DOCKET</span>
    </div>

    <nav className="titlebar__decks" aria-label="Open documents">
      <button
        type="button"
        className="deck deck--home"
        aria-current={view.kind === 'listing'}
        onClick={() => onSelect({ kind: 'listing' })}
        title="The listing (Ctrl+L)"
      >
        <IconListing />
        <span className="deck__name">Listing</span>
      </button>

      {decks.map((deck) => {
        const dirty = isDirty(deck);
        return (
          <button
            type="button"
            key={deck.id}
            className="deck"
            aria-current={view.kind === 'deck' && view.id === deck.id}
            onClick={() => onSelect({ kind: 'deck', id: deck.id })}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(deck.id);
            }}
            title={`${deck.document.meta.filePath}${dirty ? ' — unsaved edits' : ''}`}
          >
            <span
              className={`lamp ${
                deck.saving ? 'lamp--amber' : dirty ? 'lamp--red' : 'lamp--off'
              }`}
              aria-hidden="true"
            />
            <span className="deck__name">{deck.document.meta.fileName}</span>
            <span
              role="button"
              tabIndex={0}
              className="deck__close"
              aria-label={`Close ${deck.document.meta.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(deck.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose(deck.id);
                }
              }}
            >
              <IconClose size={11} />
            </span>
          </button>
        );
      })}
    </nav>

    <div className="titlebar__controls">
      <button type="button" className="winbutton" onClick={onMinimize} aria-label="Minimise">
        <IconMinimise size={13} />
      </button>
      <button
        type="button"
        className="winbutton"
        onClick={onToggleMaximize}
        aria-label={maximized ? 'Restore down' : 'Maximise'}
      >
        {maximized ? <IconRestore size={13} /> : <IconMaximise size={13} />}
      </button>
      <button
        type="button"
        className="winbutton winbutton--close"
        onClick={onCloseWindow}
        aria-label="Close Docket"
      >
        <IconClose size={13} />
      </button>
    </div>
  </header>
);
