import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from './pdf';
import { IconRotate, IconTrash } from '@/components/icons';

interface PdfRailProps {
  readonly document: PDFDocumentProxy;
  readonly order: readonly number[];
  readonly rotations: Readonly<Record<number, number>>;
  readonly currentPage: number;
  onGoTo(displayIndex: number): void;
  onRotate(sourceIndex: number, delta: number): void;
  onRemove(sourceIndex: number): void;
  onMove(from: number, to: number): void;
}

export const PdfRail = ({
  document: pdf,
  order,
  rotations,
  currentPage,
  onGoTo,
  onRotate,
  onRemove,
  onMove
}: PdfRailProps) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  return (
    <div className="pdf__rail" aria-label="Pages">
      {order.map((sourceIndex, displayIndex) => (
        <div
          key={`${sourceIndex}-${displayIndex}`}
          draggable
          onDragStart={() => setDragIndex(displayIndex)}
          onDragOver={(event) => {
            event.preventDefault();
            setDropIndex(displayIndex);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setDropIndex(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragIndex !== null && dragIndex !== displayIndex) {
              onMove(dragIndex, displayIndex);
            }
            setDragIndex(null);
            setDropIndex(null);
          }}
        >
          <button
            type="button"
            className={[
              'pdf__thumb',
              dragIndex === displayIndex ? 'pdf__thumb--dragging' : '',
              dropIndex === displayIndex && dragIndex !== displayIndex
                ? 'pdf__thumb--dropbefore'
                : ''
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={currentPage === displayIndex + 1}
            aria-label={`Go to page ${displayIndex + 1}`}
            onClick={() => onGoTo(displayIndex)}
          >
            <span className="pdf__thumb-frame">
              <Thumbnail
                document={pdf}
                sourceIndex={sourceIndex}
                rotation={rotations[sourceIndex] ?? 0}
              />
            </span>
            <span className="pdf__thumb-label">
              <span>{displayIndex + 1}</span>
              <span className="pdf__thumb-tools">
                <span
                  role="button"
                  tabIndex={0}
                  className="pdf__thumb-tool"
                  title="Rotate 90° clockwise"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRotate(sourceIndex, 90);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onRotate(sourceIndex, 90);
                    }
                  }}
                >
                  <IconRotate size={12} />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="pdf__thumb-tool"
                  title={order.length > 1 ? 'Remove this page' : 'A PDF must keep one page'}
                  aria-disabled={order.length <= 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(sourceIndex);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove(sourceIndex);
                    }
                  }}
                >
                  <IconTrash size={12} />
                </span>
              </span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
};

const Thumbnail = ({
  document: pdf,
  sourceIndex,
  rotation
}: {
  document: PDFDocumentProxy;
  sourceIndex: number;
  rotation: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(sourceIndex + 1).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const viewport = page.getViewport({
        scale: 118 / base.width,
        rotation: (page.rotate + rotation) % 360
      });
      await renderPageToCanvas(page, canvasRef.current, viewport);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, rotation, sourceIndex]);

  return <canvas ref={canvasRef} />;
};
