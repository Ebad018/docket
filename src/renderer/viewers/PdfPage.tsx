import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PageViewport, PDFPageProxy } from 'pdfjs-dist';
import type { PdfAnnotation } from '@shared/documents';
import {
  boxOf,
  buildTextSpans,
  measureText,
  renderPageToCanvas,
  toPageFraction,
  toViewportRect,
  type PageBox,
  type TextSpan
} from './pdf';
import { IconNote } from '@/components/icons';

export type Tool = 'select' | 'highlight' | 'note';

interface PdfPageProps {
  readonly document: PDFDocumentProxy;
  /** Source page index, 0-based — the address annotations are stored against. */
  readonly sourceIndex: number;
  readonly displayNumber: number;
  readonly scale: number;
  readonly rotation: number;
  readonly tool: Tool;
  readonly highlightColour: string;
  readonly query: string;
  readonly annotations: readonly PdfAnnotation[];
  onAddAnnotation(annotation: PdfAnnotation): void;
  onRemoveAnnotation(id: string): void;
  onMatches(sourceIndex: number, count: number): void;
}

interface Marquee {
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
}

export const PdfPage = ({
  document: pdf,
  sourceIndex,
  displayNumber,
  scale,
  rotation,
  tool,
  highlightColour,
  query,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  onMatches
}: PdfPageProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [box, setBox] = useState<PageBox | null>(null);
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [draftNote, setDraftNote] = useState<{ x: number; y: number; text: string } | null>(
    null
  );

  // Pages render only once they are near the viewport. A 400-page file would
  // otherwise rasterise every page on open and stall the window.
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setVisible(true)),
      { rootMargin: '600px 0px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    void pdf.getPage(sourceIndex + 1).then((loaded) => {
      if (!cancelled) setPage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, sourceIndex, visible]);

  useEffect(() => {
    if (!page) return undefined;
    let cancelled = false;

    const nextViewport = page.getViewport({
      scale,
      rotation: (page.rotate + rotation) % 360
    });
    setViewport(nextViewport);
    setBox(boxOf(page));

    const run = async () => {
      if (canvasRef.current) {
        await renderPageToCanvas(page, canvasRef.current, nextViewport);
      }
      if (cancelled) return;
      const built = await buildTextSpans(page, nextViewport, measureText);
      if (!cancelled) setSpans(built);
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [page, rotation, scale]);

  useEffect(() => {
    if (spans.length === 0) return;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      onMatches(sourceIndex, 0);
      return;
    }
    const count = spans.reduce(
      (total, span) => total + (span.text.toLowerCase().includes(needle) ? 1 : 0),
      0
    );
    onMatches(sourceIndex, count);
  }, [onMatches, query, sourceIndex, spans]);

  const width = viewport?.width ?? 612 * scale;
  const height = viewport?.height ?? 792 * scale;

  const localPoint = (event: React.MouseEvent): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const commitHighlight = (area: Marquee) => {
    if (!viewport || !box) return;
    const left = Math.min(area.startX, area.x);
    const top = Math.min(area.startY, area.y);
    const right = Math.max(area.startX, area.x);
    const bottom = Math.max(area.startY, area.y);
    if (right - left < 6 || bottom - top < 5) return;

    const topLeft = toPageFraction(viewport, box, left, top);
    const bottomRight = toPageFraction(viewport, box, right, bottom);

    onAddAnnotation({
      id: `dk-${crypto.randomUUID()}`,
      page: sourceIndex,
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
      type: 'highlight',
      color: highlightColour,
      text: '',
      createdAt: new Date().toISOString()
    });
  };

  const commitNote = (text: string, at: { x: number; y: number }) => {
    if (!viewport || !box || !text.trim()) return;
    const point = toPageFraction(viewport, box, at.x, at.y);
    onAddAnnotation({
      id: `dk-${crypto.randomUUID()}`,
      page: sourceIndex,
      x: point.x,
      y: point.y,
      width: 20 / (box.width * scale),
      height: 20 / (box.height * scale),
      type: 'note',
      color: '#f3ac3c',
      text: text.trim(),
      createdAt: new Date().toISOString()
    });
  };

  const needle = query.trim().toLowerCase();

  return (
    <div
      className="pdf__page"
      ref={hostRef}
      style={{ width, height }}
      data-page={displayNumber}
      onMouseDown={(event) => {
        if (tool === 'highlight' && event.button === 0) {
          const point = localPoint(event);
          setMarquee({ startX: point.x, startY: point.y, x: point.x, y: point.y });
        }
        if (tool === 'note' && event.button === 0) {
          const point = localPoint(event);
          setDraftNote({ ...point, text: '' });
        }
      }}
      onMouseMove={(event) => {
        if (!marquee) return;
        const point = localPoint(event);
        setMarquee({ ...marquee, x: point.x, y: point.y });
      }}
      onMouseUp={() => {
        if (marquee) commitHighlight(marquee);
        setMarquee(null);
      }}
      onMouseLeave={() => {
        if (marquee) commitHighlight(marquee);
        setMarquee(null);
      }}
    >
      <canvas ref={canvasRef} width={width} height={height} />

      {!page && (
        <div className="skeleton" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <span
              className="skeleton__line"
              key={index}
              style={{ width: `${65 + ((index * 13) % 30)}%` }}
            />
          ))}
        </div>
      )}

      <div
        className="pdf__textlayer"
        style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }}
      >
        {spans.map((span, index) => {
          const matched = needle && span.text.toLowerCase().includes(needle);
          return (
            <span
              key={index}
              style={{
                left: `${span.left}px`,
                top: `${span.top}px`,
                fontSize: `${span.fontSize}px`,
                fontFamily: span.fontFamily,
                transform: `rotate(${span.angle}rad) scaleX(${span.scaleX})`,
                background: matched ? 'rgba(243, 172, 60, 0.55)' : undefined
              }}
            >
              {span.text}
            </span>
          );
        })}
      </div>

      <div className="pdf__annotlayer">
        {viewport &&
          box &&
          annotations.map((annotation) => {
            const rect = toViewportRect(viewport, box, annotation);
            if (annotation.type === 'note') {
              return (
                <button
                  key={annotation.id}
                  type="button"
                  className="pdf__annot pdf__annot--note"
                  style={{
                    left: rect.left,
                    top: rect.top,
                    background: annotation.color
                  }}
                  title={`${annotation.text}\n\nClick to remove`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveAnnotation(annotation.id);
                  }}
                >
                  <IconNote size={12} />
                </button>
              );
            }
            return (
              <button
                key={annotation.id}
                type="button"
                className="pdf__annot pdf__annot--highlight"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  background: annotation.color
                }}
                title="Highlight — click to remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAnnotation(annotation.id);
                }}
              />
            );
          })}

        {marquee && (
          <span
            className="pdf__marquee"
            style={{
              left: Math.min(marquee.startX, marquee.x),
              top: Math.min(marquee.startY, marquee.y),
              width: Math.abs(marquee.x - marquee.startX),
              height: Math.abs(marquee.y - marquee.startY)
            }}
          />
        )}
      </div>

      {draftNote && (
        <div
          className="pdf__notecard"
          style={{
            left: Math.min(draftNote.x, width - 248),
            top: Math.min(draftNote.y, height - 160)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="stamp">Note on page {displayNumber}</span>
          <textarea
            autoFocus
            value={draftNote.text}
            placeholder="What should this page remind you of?"
            onChange={(event) => setDraftNote({ ...draftNote, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDraftNote(null);
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                commitNote(draftNote.text, draftNote);
                setDraftNote(null);
              }
            }}
          />
          <div className="pdf__notecard-actions">
            <button type="button" className="control" onClick={() => setDraftNote(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="control control--primary"
              disabled={!draftNote.text.trim()}
              onClick={() => {
                commitNote(draftNote.text, draftNote);
                setDraftNote(null);
              }}
            >
              Add note
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
