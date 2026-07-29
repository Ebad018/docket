import { readFile, writeFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import type { DocumentPatch, DocumentPayload, FormatCapabilities } from '@shared/documents';
import { DocumentError, type DocumentHandler } from './DocumentHandler';
import { DocxPackage } from './docx/DocxPackage';

export class DocxHandler implements DocumentHandler {
  readonly kind = 'docx' as const;
  readonly extensions = ['docx'] as const;

  readonly capabilities: FormatCapabilities = {
    label: 'Word Document',
    stock: 'DOC',
    canEditText: true,
    canEditCells: false,
    canAnnotate: false,
    canReorderPages: false,
    editingNote:
      'Paragraph text is editable and keeps its style. Formatting that changes mid-paragraph collapses to the first run.'
  };

  async read(filePath: string): Promise<DocumentPayload> {
    const bytes = await readBytes(filePath);

    let structure: { blocks: DocxPackageBlocks; wordCount: number };
    try {
      const pkg = await DocxPackage.open(bytes);
      const parsed = pkg.parse();
      structure = { blocks: parsed.blocks, wordCount: parsed.wordCount };
    } catch (error) {
      throw new DocumentError(
        'read-failed',
        `${filePath} could not be read as a Word document.`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Mammoth's render is the faithful read view. A failure here costs the
    // pretty view, not the document, so it degrades to the structured blocks.
    let html = '';
    try {
      const result = await mammoth.convertToHtml(
        { buffer: bytes },
        {
          // Word's Title and Subtitle carry no outline level, so the default
          // mapping renders a document's own title as an ordinary paragraph —
          // in the read view and in anything converted from it.
          //
          // The selector quoting is not a matter of taste: mammoth's parser
          // accepts single quotes only, and rejects a double-quoted map
          // silently, reporting it as a warning nobody reads.
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => p.subtitle:fresh",
            "p[style-name='Quote'] => blockquote:fresh",
            "p[style-name='Intense Quote'] => blockquote:fresh"
          ]
        }
      );
      html = result.value;
    } catch {
      html = '';
    }

    return { kind: 'docx', blocks: structure.blocks, html, wordCount: structure.wordCount };
  }

  async write(filePath: string, patch: DocumentPatch): Promise<void> {
    if (patch.kind !== 'docx') {
      throw new DocumentError('write-failed', 'That edit does not belong to a Word document.');
    }
    try {
      const pkg = await DocxPackage.open(await readBytes(filePath));
      pkg.applyTextEdits(patch.blocks);
      await writeFile(filePath, await pkg.toBuffer());
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

type DocxPackageBlocks = ReturnType<DocxPackage['parse']>['blocks'];

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
