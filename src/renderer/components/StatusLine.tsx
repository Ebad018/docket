import type { Deck } from '@/state/deck';
import { isDirty } from '@/state/deck';
import { formatBytes, formatClock } from '@/lib/format';
import { IconCommand, IconConvert, IconFolder, IconMoon, IconSun } from './icons';
import type { Theme } from '@/state/useChrome';

interface StatusLineProps {
  readonly deck: Deck | null;
  readonly entryCount: number;
  readonly readout: readonly string[];
  readonly theme: Theme;
  readonly converting: boolean;
  onReveal(filePath: string): void;
  onToggleTheme(): void;
  onOpenPalette(): void;
  onConvert(): void;
}

/** The console readout: what is loaded, where it came from, and what state it
 *  is in. It is the one place the full path is always legible. */
export const StatusLine = ({
  deck,
  entryCount,
  readout,
  theme,
  converting,
  onReveal,
  onToggleTheme,
  onOpenPalette,
  onConvert
}: StatusLineProps) => {
  const dirty = deck ? isDirty(deck) : false;

  return (
    <footer className="statusline">
      <span className="statusline__slot">
        <span
          className={`lamp ${
            !deck ? 'lamp--off' : deck.saving ? 'lamp--amber' : dirty ? 'lamp--red' : 'lamp--green'
          }`}
          aria-hidden="true"
        />
        <span className="statusline__value">
          {!deck
            ? `LISTING · ${entryCount} ${entryCount === 1 ? 'ENTRY' : 'ENTRIES'}`
            : deck.saving
              ? 'WRITING'
              : dirty
                ? 'UNSAVED'
                : deck.savedAt
                  ? `SAVED ${formatClock(deck.savedAt)}`
                  : 'READ'}
        </span>
      </span>

      {deck && (
        <>
          <span className="statusline__slot">
            {deck.document.capabilities.stock}
            <span className="statusline__value">
              {formatBytes(deck.document.meta.sizeBytes)}
            </span>
          </span>

          {readout.map((item) => (
            <span className="statusline__slot statusline__value" key={item}>
              {item}
            </span>
          ))}

          <button
            type="button"
            className="statusline__slot statusline__slot--path"
            onClick={() => onReveal(deck.document.meta.filePath)}
            title="Show this file in Explorer"
          >
            <IconFolder size={11} />
            <span>{deck.document.meta.filePath}</span>
          </button>
        </>
      )}

      {!deck && <span className="statusline__slot statusline__slot--path" />}

      {deck && (
        <button
          type="button"
          className="statusline__slot statusline__slot--action"
          onClick={onConvert}
          title="Convert this document to Markdown, Word or PDF (Ctrl+E)"
        >
          <IconConvert size={11} />
          {converting ? 'CONVERTING' : 'CONVERT'}
        </button>
      )}

      <button
        type="button"
        className="statusline__slot"
        onClick={onOpenPalette}
        title="Command palette"
      >
        <IconCommand size={11} />
        CTRL K
      </button>

      <button
        type="button"
        className="statusline__slot"
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to the lit machine room' : 'Switch to the night shift'}
      >
        {theme === 'dark' ? <IconSun size={11} /> : <IconMoon size={11} />}
        {theme === 'dark' ? 'NIGHT' : 'DAY'}
      </button>
    </footer>
  );
};
