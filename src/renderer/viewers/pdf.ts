import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageViewport, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

export interface PageBox {
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
}

/** The page's own unrotated box — the frame annotations are stored against. */
export const boxOf = (page: PDFPageProxy): PageBox => {
  const [x0, y0, x1, y1] = page.view;
  return { x0, y0, width: x1 - x0, height: y1 - y0 };
};

/** Viewport pixel → fraction of the unrotated page, top-left origin. */
export const toPageFraction = (
  viewport: PageViewport,
  box: PageBox,
  x: number,
  y: number
): { x: number; y: number } => {
  const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
  return {
    x: (pdfX - box.x0) / box.width,
    y: 1 - (pdfY - box.y0) / box.height
  };
};

/** Fraction of the unrotated page → viewport pixel rectangle. */
export const toViewportRect = (
  viewport: PageViewport,
  box: PageBox,
  rect: { x: number; y: number; width: number; height: number }
): { left: number; top: number; width: number; height: number } => {
  const pdfLeft = box.x0 + rect.x * box.width;
  const pdfRight = box.x0 + (rect.x + rect.width) * box.width;
  const pdfTop = box.y0 + (1 - rect.y) * box.height;
  const pdfBottom = box.y0 + (1 - rect.y - rect.height) * box.height;

  const [ax, ay] = viewport.convertToViewportPoint(pdfLeft, pdfTop);
  const [bx, by] = viewport.convertToViewportPoint(pdfRight, pdfBottom);

  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay)
  };
};

export interface TextSpan {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly scaleX: number;
  readonly angle: number;
}

/**
 * Builds the selectable text overlay.
 *
 * Each glyph run is placed with the transform pdf.js reports, then scaled
 * horizontally so its measured width matches the width the PDF declares. That
 * last step is what makes a mouse drag select the words the user is pointing
 * at rather than drifting across the line.
 */
export const buildTextSpans = async (
  page: PDFPageProxy,
  viewport: PageViewport,
  measure: (text: string, font: string) => number
): Promise<TextSpan[]> => {
  const content = await page.getTextContent();
  const spans: TextSpan[] = [];

  for (const item of content.items) {
    if (!('str' in item) || item.str.length === 0) continue;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    if (fontHeight <= 0) continue;

    const angle = Math.atan2(transform[1], transform[0]);
    const style = content.styles[item.fontName];
    const fontFamily = style?.fontFamily ?? 'sans-serif';
    const declaredWidth = item.width * viewport.scale;
    const measured = measure(item.str, `${fontHeight}px ${fontFamily}`);

    spans.push({
      text: item.str,
      left: transform[4],
      top: transform[5] - fontHeight,
      fontSize: fontHeight,
      fontFamily,
      scaleX: measured > 0 && declaredWidth > 0 ? declaredWidth / measured : 1,
      angle
    });
  }

  return spans;
};

let measureContext: CanvasRenderingContext2D | null = null;

export const measureText = (text: string, font: string): number => {
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width;
};

/** Device-pixel-ratio-aware render, so pages are sharp on a scaled display. */
export const renderPageToCanvas = async (
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PageViewport
): Promise<void> => {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  await page.render({ canvasContext: context, viewport }).promise;
};
