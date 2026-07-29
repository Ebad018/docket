import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyMatch } from '@/lib/format';

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  run(): void;
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly commands: readonly Command[];
  onClose(): void;
}

export const CommandPalette = ({ open, commands, onClose }: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // The palette is the keyboard's front door; focus must land in it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const matches = useMemo(
    () =>
      commands.filter(
        (command) =>
          !command.disabled && fuzzyMatch(`${command.group} ${command.label}`, query)
      ),
    [commands, query]
  );

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, matches.length]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Run a command, or search the listing…"
          aria-label="Command"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((current) => (current + 1) % Math.max(1, matches.length));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor(
                (current) => (current - 1 + matches.length) % Math.max(1, matches.length)
              );
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              run(matches[cursor]);
            }
          }}
        />

        {matches.length === 0 ? (
          <p className="palette__empty">
            Nothing matches “{query}”. Press <span className="kbd">Esc</span> to close.
          </p>
        ) : (
          <ul className="palette__list" ref={listRef} role="listbox">
            {matches.map((command, index) => (
              <li key={command.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className="palette__item"
                  onMouseMove={() => setCursor(index)}
                  onClick={() => run(command)}
                >
                  <span className="stamp" style={{ minWidth: 62 }}>
                    {command.group}
                  </span>
                  <span className="palette__label">{command.label}</span>
                  {command.hint && (
                    <span className="palette__hint" title={command.hint}>
                      {command.hint}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
