import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentKind, RecentEntry } from '@shared/documents';
import {
  formatBytes,
  formatClock,
  formatFullStamp,
  formatRelative,
  shortenFolder
} from '@/lib/format';
import { IconConvert, IconFolder, IconOpen, IconPin, IconSearch, IconTrash } from './icons';
import { EmptyListing } from './EmptyListing';

export type SortKey = 'lastOpenedAt' | 'fileName' | 'folder' | 'sizeBytes' | 'openCount';

interface ListingProps {
  readonly entries: readonly RecentEntry[];
  readonly freshPaths: readonly string[];
  readonly busy: boolean;
  onOpen(filePath: string): void;
  onOpenDialog(): void;
  onTogglePin(filePath: string): void;
  onRemove(filePath: string): void;
  onClear(): void;
  onReveal(filePath: string): void;
  onRestoreSamples(): void;
  onConvert(filePath: string): void;
}

const STOCK: Record<DocumentKind, { code: string; className: string; label: string }> = {
  markdown: { code: 'MD', className: 'listing__stock--md', label: 'Markdown' },
  docx: { code: 'DOC', className: 'listing__stock--doc', label: 'Word' },
  xlsx: { code: 'XLS', className: 'listing__stock--xls', label: 'Excel' },
  pdf: { code: 'PDF', className: 'listing__stock--pdf', label: 'PDF' }
};

const KINDS = Object.keys(STOCK) as DocumentKind[];

export const Listing = ({
  entries,
  freshPaths,
  busy,
  onOpen,
  onOpenDialog,
  onTogglePin,
  onRemove,
  onClear,
  onReveal,
  onRestoreSamples,
  onConvert
}: ListingProps) => {
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<readonly DocumentKind[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'lastOpenedAt',
    ascending: false
  });
  const [menu, setMenu] = useState<{ entry: RecentEntry; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = () => setMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (kinds.length > 0 && !kinds.includes(entry.kind)) return false;
      if (!needle) return true;
      return (
        entry.fileName.toLowerCase().includes(needle) ||
        entry.folder.toLowerCase().includes(needle)
      );
    });

    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sort.key) {
        case 'fileName':
          return direction * a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
        case 'folder':
          return direction * a.folder.localeCompare(b.folder, undefined, { numeric: true });
        case 'sizeBytes':
          return direction * (a.sizeBytes - b.sizeBytes);
        case 'openCount':
          return direction * (a.openCount - b.openCount);
        default:
          return direction * (Date.parse(a.lastOpenedAt) - Date.parse(b.lastOpenedAt));
      }
    });
  }, [entries, kinds, query, sort]);

  const toggleKind = (kind: DocumentKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]
    );

  const applySort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, ascending: !current.ascending }
        : { key, ascending: key === 'fileName' || key === 'folder' }
    );

  const sortState = (key: SortKey) =>
    sort.key === key ? (sort.ascending ? 'ascending' : 'descending') : 'none';

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    paths.forEach((path) => onOpen(path));
  };

  const nothingRecorded = entries.length === 0;

  return (
    <div
      className="listing-stage"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div className="jobstrip">
        <label className="jobstrip__search">
          <span className="visually-hidden">Search the listing</span>
          <IconSearch />
          <input
            ref={searchRef}
            className="field"
            type="search"
            value={query}
            placeholder="Search names and folders"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
              if (event.key === 'Enter' && visible[0]) onOpen(visible[0].filePath);
            }}
          />
        </label>

        <div className="jobstrip__filters" role="group" aria-label="Filter by format">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="control"
              aria-pressed={kinds.includes(kind)}
              onClick={() => toggleKind(kind)}
            >
              {STOCK[kind].code}
            </button>
          ))}
        </div>

        <span className="jobstrip__spacer" />

        <span className="jobstrip__count">
          {visible.length === entries.length
            ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
            : `${visible.length} of ${entries.length}`}
        </span>

        <button
          type="button"
          className="control control--quiet"
          onClick={onClear}
          disabled={nothingRecorded}
          title="Clear every unpinned entry from the listing"
        >
          <IconTrash />
          Clear
        </button>

        <button type="button" className="control control--primary" onClick={onOpenDialog}>
          <IconOpen />
          Open file
          <span className="kbd" style={{ marginLeft: 4 }}>
            Ctrl O
          </span>
        </button>
      </div>

      <div className="fanfold">
        <div className="tractor tractor--left" aria-hidden="true" />

        <div className="listing">
          {/* The printed column rules stay on the sheet even when nothing has
              been run yet — an empty listing is still a listing. */}
          <div className="listing__head" role="row">
                <span className="listing__heading">Stock</span>
                <button
                  type="button"
                  className="listing__heading"
                  aria-sort={sortState('fileName')}
                  onClick={() => applySort('fileName')}
                >
                  Document
                </button>
                <button
                  type="button"
                  className="listing__heading"
                  aria-sort={sortState('folder')}
                  onClick={() => applySort('folder')}
                >
                  Folder
                </button>
                <button
                  type="button"
                  className="listing__heading"
                  aria-sort={sortState('lastOpenedAt')}
                  onClick={() => applySort('lastOpenedAt')}
                >
                  Last opened
                </button>
                <button
                  type="button"
                  className="listing__heading listing__heading--right"
                  aria-sort={sortState('sizeBytes')}
                  onClick={() => applySort('sizeBytes')}
                >
                  Size
                </button>
                <button
                  type="button"
                  className="listing__heading listing__heading--right"
                  aria-sort={sortState('openCount')}
                  onClick={() => applySort('openCount')}
                  title="How many times this file has been opened in Docket"
                >
                  Runs
                </button>
                <span className="listing__heading" aria-label="Pinned" />
              </div>

              <div className="listing__body">
                {nothingRecorded ? (
                  <EmptyListing
                    onOpenDialog={onOpenDialog}
                    onRestoreSamples={onRestoreSamples}
                  />
                ) : visible.length === 0 ? (
                  <div className="placeholder" style={{ height: 'auto', paddingTop: '4rem' }}>
                    <p className="placeholder__title">No entry matches that</p>
                    <p className="placeholder__body">
                      {kinds.length > 0
                        ? 'Try clearing the format filters, or search a different name.'
                        : 'The listing only holds files you have opened in Docket. Open a new one and it appears here.'}
                    </p>
                  </div>
                ) : (
                  visible.map((entry) => (
                    <div
                      key={entry.filePath}
                      role="button"
                      tabIndex={0}
                      className={[
                        'listing__row',
                        entry.exists ? '' : 'listing__row--missing',
                        freshPaths.includes(entry.filePath) ? 'listing__row--fresh' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      // A single click opens. This is a record of work, not a
                      // file manager — selecting a row without opening it has
                      // no purpose here, so the double-click ceremony is not
                      // earning anything.
                      onClick={() => onOpen(entry.filePath)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onOpen(entry.filePath);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({
                          entry,
                          x: Math.min(event.clientX, window.innerWidth - 220),
                          y: Math.min(event.clientY, window.innerHeight - 190)
                        });
                      }}
                      title={
                        entry.exists
                          ? `${entry.filePath}\nLast opened ${formatFullStamp(entry.lastOpenedAt)}`
                          : `${entry.filePath}\nNo longer on disk`
                      }
                    >
                      <span
                        className={`listing__stock ${STOCK[entry.kind].className}`}
                        aria-label={STOCK[entry.kind].label}
                      >
                        {STOCK[entry.kind].code}
                      </span>

                      <span className="listing__name">
                        {entry.fileName}
                        {!entry.exists && (
                          <span
                            className="stamp"
                            style={{ color: 'var(--lamp-red)', letterSpacing: '0.08em' }}
                          >
                            moved
                          </span>
                        )}
                      </span>

                      <span className="listing__folder">
                        <span>{shortenFolder(entry.folder)}</span>
                      </span>

                      <span className="listing__when">
                        {formatRelative(entry.lastOpenedAt)}
                        <small>{formatClock(entry.lastOpenedAt)}</small>
                      </span>

                      <span className="listing__size">{formatBytes(entry.sizeBytes)}</span>
                      <span className="listing__runs">{entry.openCount}</span>

                      <button
                        type="button"
                        className="listing__pin"
                        aria-pressed={entry.pinned}
                        aria-label={
                          entry.pinned
                            ? `Unpin ${entry.fileName}`
                            : `Pin ${entry.fileName} to the top`
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          onTogglePin(entry.filePath);
                        }}
                      >
                        <IconPin size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
        </div>

        <div className="tractor tractor--right" aria-hidden="true" />
      </div>

      {dragging && (
        <div className="dropveil">
          <div className="dropveil__frame">Drop to open</div>
        </div>
      )}

      {busy && (
        <div className="dropveil" role="status">
          <div className="dropveil__frame">Reading…</div>
        </div>
      )}

      {menu && (
        <div className="rowmenu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            type="button"
            className="rowmenu__item"
            role="menuitem"
            onClick={() => onOpen(menu.entry.filePath)}
          >
            <IconOpen />
            Open
          </button>
          <button
            type="button"
            className="rowmenu__item"
            role="menuitem"
            onClick={() => onConvert(menu.entry.filePath)}
          >
            <IconConvert />
            Open and convert…
          </button>
          <button
            type="button"
            className="rowmenu__item"
            role="menuitem"
            onClick={() => onReveal(menu.entry.filePath)}
          >
            <IconFolder />
            Show in Explorer
          </button>
          <button
            type="button"
            className="rowmenu__item"
            role="menuitem"
            onClick={() => onTogglePin(menu.entry.filePath)}
          >
            <IconPin />
            {menu.entry.pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <div className="rowmenu__rule" />
          <button
            type="button"
            className="rowmenu__item rowmenu__item--danger"
            role="menuitem"
            onClick={() => onRemove(menu.entry.filePath)}
          >
            <IconTrash />
            Remove from listing
          </button>
        </div>
      )}
    </div>
  );
};
