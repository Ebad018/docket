import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfAnnotation } from '@shared/documents';
import type { ViewerProps } from './types';
import { pdfjs } from './pdf';
import { PdfPage, type Tool } from './PdfPage';
import { PdfRail } from './PdfRail';
import {
  IconCursor,
  IconHighlight,
  IconNote,
  IconSearch,
  IconZoomIn,
  IconZoomOut
} from '@/components/icons';

const ZOOM_STEPS = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
const HIGHLIGHT_COLOURS = ['#f3d13c', '#7fd08a', '#7cb6ef', '#f39ac0'];

export const PdfViewer = ({ deck, updateDraft, onReadout }: ViewerProps) => {
  const payload = deck.document.payload.kind === 'pdf' ? deck.document.payload : null;
  const draft = deck.draft.kind === 'pdf' ? deck.draft : null;

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool>('select');
  const [colour, setColour] = useState(HIGHLIGHT_COLOURS[0]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Record<number, number>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [showRail, setShowRail] = useState(true);

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!payload) return undefined;
    let cancelled = false;
    // pdf.js takes ownership of the buffer it is handed, so it gets a copy —
    // the deck keeps the original bytes for a later save-as.
    const task = pdfjs.getDocument({ data: payload.bytes.slice() });
    task.promise.then(
      (loaded) => {
        if (cancelled) void loaded.destroy();
        else setPdf(loaded);
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'This PDF could not be rendered.');
        }
      }
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [payload]);

  const order = draft?.pageOrder ?? [];
  const rotations = draft?.rotations ?? {};
  const annotations = draft?.annotations ?? [];

  const matchTotal = useMemo(
    () => Object.values(matches).reduce((total, count) => total + count, 0),
    [matches]
  );

  useEffect(() => {
    onReadout([
      `PAGE ${currentPage}/${order.length}`,
      `${Math.round(scale * 100)}%`,
      annotations.length > 0 ? `${annotations.length} MARKS` : 'NO MARKS',
      query.trim() ? `${matchTotal} MATCHES` : ''
    ].filter(Boolean));
  }, [annotations.length, currentPage, matchTotal, onReadout, order.length, query, scale]);

  // Which page is under the top of the viewport, for the readout and the rail.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const onScroll = () => {
      const pages = [...element.querySelectorAll<HTMLElement>('.pdf__page')];
      const top = element.getBoundingClientRect().top;
      const found = pages.find((page) => page.getBoundingClientRect().bottom > top + 24);
      if (found?.dataset.page) setCurrentPage(Number(found.dataset.page));
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [pdf]);

  const recordMatches = useCallback((sourceIndex: number, count: number) => {
    setMatches((current) =>
      current[sourceIndex] === count ? current : { ...current, [sourceIndex]: count }
    );
  }, []);

  const addAnnotation = useCallback(
    (annotation: PdfAnnotation) =>
      updateDraft((current) =>
        current.kind === 'pdf'
          ? { ...current, annotations: [...current.annotations, annotation] }
          : current
      ),
    [updateDraft]
  );

  const removeAnnotation = useCallback(
    (id: string) =>
      updateDraft((current) =>
        current.kind === 'pdf'
          ? {
              ...current,
              annotations: current.annotations.filter((entry) => entry.id !== id)
            }
          : current
      ),
    [updateDraft]
  );

  const rotate = (sourceIndex: number, delta: number) =>
    updateDraft((current) =>
      current.kind === 'pdf'
        ? {
            ...current,
            rotations: {
              ...current.rotations,
              [sourceIndex]: (((current.rotations[sourceIndex] ?? 0) + delta) % 360 + 360) % 360
            }
          }
        : current
    );

  const removePage = (sourceIndex: number) =>
    updateDraft((current) => {
      if (current.kind !== 'pdf') return current;
      if (current.pageOrder.length <= 1) return current;
      return {
        ...current,
        pageOrder: current.pageOrder.filter((page) => page !== sourceIndex)
      };
    });

  const movePage = (from: number, to: number) =>
    updateDraft((current) => {
      if (current.kind !== 'pdf') return current;
      const next = [...current.pageOrder];
      const [moved] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, moved);
      return { ...current, pageOrder: next };
    });

  const restorePages = () =>
    updateDraft((current) =>
      current.kind === 'pdf' && payload
        ? {
            ...current,
            pageOrder: Array.from({ length: payload.pageCount }, (_, index) => index)
          }
        : current
    );

  const zoom = (direction: 1 | -1) =>
    setScale((current) => {
      const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
      const next = Math.min(
        ZOOM_STEPS.length - 1,
        Math.max(0, (index === -1 ? ZOOM_STEPS.length - 1 : index) + direction)
      );
      return ZOOM_STEPS[next];
    });

  const fitWidth = () => {
    const element = viewportRef.current;
    const page = element?.querySelector<HTMLElement>('.pdf__page');
    if (!element || !page) return;
    const available = element.clientWidth - 2 * 24;
    const naturalWidth = page.offsetWidth / scale;
    setScale(Math.max(0.25, Math.min(3, available / naturalWidth)));
  };

  const jumpToMatch = () => {
    const element = viewportRef.current;
    if (!element) return;
    const withMatches = order.findIndex((sourceIndex) => (matches[sourceIndex] ?? 0) > 0);
    if (withMatches === -1) return;
    element
      .querySelectorAll<HTMLElement>('.pdf__page')
      [withMatches]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!payload || !draft) return null;

  if (error) {
    return (
      <div className="workbench">
        <div className="placeholder">
          <p className="placeholder__title">This PDF would not render</p>
          <p className="placeholder__body">{error}</p>
          <p className="placeholder__body">
            The file may be encrypted, or damaged. Docket has not modified it.
          </p>
        </div>
      </div>
    );
  }

  const removedCount = payload.pageCount - order.length;

  return (
    <div className="workbench">
      <div className="toolbar">
        <div className="toolbar__group" role="group" aria-label="Tool">
          <button
            type="button"
            className="control"
            aria-pressed={tool === 'select'}
            onClick={() => setTool('select')}
            title="Select text"
          >
            <IconCursor />
            Select
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={tool === 'highlight'}
            onClick={() => setTool('highlight')}
            title="Drag across the page to highlight"
          >
            <IconHighlight />
            Highlight
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={tool === 'note'}
            onClick={() => setTool('note')}
            title="Click the page to drop a note"
          >
            <IconNote />
            Note
          </button>
        </div>

        {tool === 'highlight' && (
          <div className="toolbar__group" role="group" aria-label="Highlight colour">
            {HIGHLIGHT_COLOURS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="control control--icon"
                aria-pressed={colour === swatch}
                aria-label={`Highlight in ${swatch}`}
                onClick={() => setColour(swatch)}
                style={{ background: swatch, borderColor: swatch === colour ? 'var(--ink)' : swatch }}
              />
            ))}
          </div>
        )}

        <span className="toolbar__rule" />

        <div className="toolbar__group">
          <button type="button" className="control control--icon" onClick={() => zoom(-1)} aria-label="Zoom out">
            <IconZoomOut />
          </button>
          <span className="stamp" style={{ minWidth: 40, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button type="button" className="control control--icon" onClick={() => zoom(1)} aria-label="Zoom in">
            <IconZoomIn />
          </button>
          <button type="button" className="control" onClick={fitWidth}>
            Fit width
          </button>
        </div>

        <span className="toolbar__rule" />

        <label className="jobstrip__search" style={{ flexBasis: 220 }}>
          <span className="visually-hidden">Search this document</span>
          <IconSearch />
          <input
            className="field"
            type="search"
            value={query}
            placeholder="Find in document"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpToMatch();
              if (event.key === 'Escape') setQuery('');
            }}
          />
        </label>
        {query.trim() && (
          <span className="stamp">
            {matchTotal === 0 ? 'no matches' : `${matchTotal} on this page set`}
          </span>
        )}

        <span className="toolbar__spacer" />

        <p className="toolbar__note" title={deck.document.capabilities.editingNote}>
          {deck.document.capabilities.editingNote}
        </p>

        {removedCount > 0 && (
          <button type="button" className="control" onClick={restorePages}>
            Restore {removedCount} removed {removedCount === 1 ? 'page' : 'pages'}
          </button>
        )}
        <button
          type="button"
          className="control"
          aria-pressed={showRail}
          onClick={() => setShowRail((current) => !current)}
        >
          Pages
        </button>
      </div>

      <div className={`stage pdf ${showRail ? '' : 'pdf--norail'}`} style={{ overflow: 'hidden' }}>
        {showRail && pdf && (
          <PdfRail
            document={pdf}
            order={order}
            rotations={rotations}
            currentPage={currentPage}
            onGoTo={(displayIndex) => {
              viewportRef.current
                ?.querySelectorAll<HTMLElement>('.pdf__page')
                [displayIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onRotate={rotate}
            onRemove={removePage}
            onMove={movePage}
          />
        )}

        <div className="pdf__viewport" ref={viewportRef}>
          {!pdf ? (
            <div className="placeholder">
              <p className="placeholder__title">Reading the document…</p>
            </div>
          ) : (
            order.map((sourceIndex, displayIndex) => (
              <PdfPage
                key={`${sourceIndex}-${displayIndex}`}
                document={pdf}
                sourceIndex={sourceIndex}
                displayNumber={displayIndex + 1}
                scale={scale}
                rotation={rotations[sourceIndex] ?? 0}
                tool={tool}
                highlightColour={colour}
                query={query}
                annotations={annotations.filter((entry) => entry.page === sourceIndex)}
                onAddAnnotation={addAnnotation}
                onRemoveAnnotation={removeAnnotation}
                onMatches={recordMatches}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
