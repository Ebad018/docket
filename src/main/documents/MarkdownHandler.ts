import { readFile, writeFile } from 'node:fs/promises';
import type { DocumentPatch, DocumentPayload, FormatCapabilities } from '@shared/documents';
import { DocumentError, type DocumentHandler } from './DocumentHandler';

export class MarkdownHandler implements DocumentHandler {
  readonly kind = 'markdown' as const;
  readonly extensions = ['md', 'markdown', 'mdown', 'mkd'] as const;

  readonly capabilities: FormatCapabilities = {
    label: 'Markdown',
    stock: 'MD',
    canEditText: true,
    canEditCells: false,
    canAnnotate: false,
    canReorderPages: false,
    editingNote: 'Edits write the full source back to the file.'
  };

  async read(filePath: string): Promise<DocumentPayload> {
    try {
      const text = await readFile(filePath, 'utf8');
      // Strip a UTF-8 BOM so it never shows up as a stray glyph in the editor.
      return { kind: 'markdown', text: text.replace(/^﻿/, '') };
    } catch (error) {
      throw toDocumentError(error, 'read', filePath);
    }
  }

  async write(filePath: string, patch: DocumentPatch): Promise<void> {
    if (patch.kind !== 'markdown') {
      throw new DocumentError('write-failed', 'That edit does not belong to a Markdown file.');
    }
    try {
      await writeFile(filePath, patch.text, 'utf8');
    } catch (error) {
      throw toDocumentError(error, 'write', filePath);
    }
  }
}

const toDocumentError = (
  error: unknown,
  phase: 'read' | 'write',
  filePath: string
): DocumentError => {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    return new DocumentError('not-found', `${filePath} is no longer on disk.`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new DocumentError(
      phase === 'read' ? 'read-failed' : 'write-failed',
      `Windows would not let Docket ${phase} ${filePath}.`,
      'Close the file in any other application, then try again.'
    );
  }
  return new DocumentError(
    phase === 'read' ? 'read-failed' : 'write-failed',
    `Could not ${phase} ${filePath}.`,
    error instanceof Error ? error.message : String(error)
  );
};
