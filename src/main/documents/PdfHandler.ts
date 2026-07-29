import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName, PDFString, PDFArray, degrees, rgb } from 'pdf-lib';
import type {
  DocumentPatch,
  DocumentPayload,
  FormatCapabilities,
  PdfAnnotation,
  PdfPatch
} from '@shared/documents';
import { DocumentError, type DocumentHandler } from './DocumentHandler';

export class PdfHandler implements DocumentHandler {
  readonly kind = 'pdf' as const;
  readonly extensions = ['pdf'] as const;

  readonly capabilities: FormatCapabilities = {
    label: 'PDF Document',
    stock: 'PDF',
    canEditText: false,
    canEditCells: false,
    canAnnotate: true,
    canReorderPages: true,
    editingNote:
      'Highlights, notes and page order save into the file as real PDF objects. The text layer is not rewritten: a PDF stores text as positioned glyphs, so editing it in place reflows nothing and breaks the page.'
  };

  async read(filePath: string): Promise<DocumentPayload> {
    const bytes = await readBytes(filePath);

    let pageCount = 0;
    let title: string | null = null;
    let author: string | null = null;

    try {
      const pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false
      });
      pageCount = pdf.getPageCount();
      title = pdf.getTitle() ?? null;
      author = pdf.getAuthor() ?? null;
    } catch (error) {
      throw new DocumentError(
        'read-failed',
        `${filePath} is not a PDF Docket can open.`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // pdf.js in the renderer reads the original bytes, so the page renders
    // exactly as its author laid it out rather than as pdf-lib re-serialises it.
    return {
      kind: 'pdf',
      pageCount,
      bytes: new Uint8Array(bytes),
      title: title || null,
      author: author || null
    };
  }

  async write(filePath: string, patch: DocumentPatch): Promise<void> {
    if (patch.kind !== 'pdf') {
      throw new DocumentError('write-failed', 'That edit does not belong to a PDF.');
    }

    try {
      const source = await PDFDocument.load(await readBytes(filePath), {
        ignoreEncryption: true
      });
      const output = await buildOutput(source, patch);
      await writeFile(filePath, await output.save({ useObjectStreams: false }));
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      throw new DocumentError(
        'write-failed',
        `Could not save ${filePath}.`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

const buildOutput = async (source: PDFDocument, patch: PdfPatch): Promise<PDFDocument> => {
  const order = patch.pageOrder.filter(
    (index) => Number.isInteger(index) && index >= 0 && index < source.getPageCount()
  );
  if (order.length === 0) {
    throw new DocumentError(
      'write-failed',
      'A PDF must keep at least one page.',
      'Restore a page before saving.'
    );
  }

  const unchangedOrder =
    order.length === source.getPageCount() && order.every((page, index) => page === index);

  // Reordering requires a fresh document; when the order is untouched we edit
  // the original in place so nothing outside the annotation layer moves.
  const output = unchangedOrder ? source : await PDFDocument.create();
  if (!unchangedOrder) {
    const copied = await output.copyPages(source, [...order]);
    copied.forEach((page) => output.addPage(page));
  }

  order.forEach((sourceIndex, outputIndex) => {
    const page = output.getPage(outputIndex);
    const rotation = patch.rotations[sourceIndex];
    if (typeof rotation === 'number') {
      page.setRotation(degrees(((rotation % 360) + 360) % 360));
    }
  });

  const byOutputPage = new Map<number, PdfAnnotation[]>();
  for (const annotation of patch.annotations) {
    const outputIndex = order.indexOf(annotation.page);
    if (outputIndex === -1) continue; // Its page was deleted.
    const list = byOutputPage.get(outputIndex) ?? [];
    list.push(annotation);
    byOutputPage.set(outputIndex, list);
  }

  for (const [outputIndex, annotations] of byOutputPage) {
    attachAnnotations(output, output.getPage(outputIndex), annotations);
  }

  return output;
};

/**
 * Writes real PDF annotation objects rather than painting onto the page
 * content. Painted rectangles cannot be removed and are invisible to every
 * other reader's annotation list; these round-trip through Acrobat and Edge.
 */
const attachAnnotations = (
  document: PDFDocument,
  page: ReturnType<PDFDocument['getPage']>,
  annotations: readonly PdfAnnotation[]
): void => {
  const { width, height } = page.getSize();
  const context = document.context;

  const dictionaries = annotations.map((annotation) => {
    const x = annotation.x * width;
    const y = (1 - annotation.y - annotation.height) * height;
    const w = annotation.width * width;
    const h = annotation.height * height;
    const colour = parseColour(annotation.color);

    const shared = {
      Type: 'Annot',
      Rect: [x, y, x + w, y + h],
      C: [colour.red, colour.green, colour.blue],
      T: PDFString.of('Docket'),
      M: PDFString.fromDate(new Date(annotation.createdAt)),
      NM: PDFString.of(annotation.id),
      F: 4 // Print.
    };

    if (annotation.type === 'highlight') {
      return context.obj({
        ...shared,
        Subtype: 'Highlight',
        // Quad order is upper-left, upper-right, lower-left, lower-right.
        QuadPoints: [x, y + h, x + w, y + h, x, y, x + w, y],
        CA: 0.4,
        Contents: PDFString.of(annotation.text ?? '')
      });
    }

    return context.obj({
      ...shared,
      Subtype: 'Text',
      Name: 'Comment',
      Open: false,
      Contents: PDFString.of(annotation.text ?? '')
    });
  });

  const existing = page.node.lookup(PDFName.of('Annots'), PDFArray);
  if (existing) {
    // Drop annotations Docket wrote previously so a re-save replaces rather
    // than stacks them; annotations from other tools are left alone.
    const kept = existing.asArray().filter((entry) => {
      const dictionary = context.lookupMaybe(entry, PDFDict);
      const name = dictionary?.lookupMaybe(PDFName.of('NM'), PDFString);
      return !name?.asString().startsWith('dk-');
    });
    const rebuilt = context.obj([...kept, ...dictionaries]);
    page.node.set(PDFName.of('Annots'), rebuilt);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj(dictionaries));
  }
};

const parseColour = (hex: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return rgb(1, 0.85, 0.2);
  const value = parseInt(match[1], 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const readBytes = async (filePath: string): Promise<Buffer> => {
  try {
    return await readFile(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      throw new DocumentError('not-found', `${filePath} is no longer on disk.`);
    }
    throw new DocumentError(
      'read-failed',
      `Could not read ${filePath}.`,
      error instanceof Error ? error.message : String(error)
    );
  }
};
