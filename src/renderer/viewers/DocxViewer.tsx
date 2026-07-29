import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocxBlock } from '@shared/documents';
import type { ViewerProps } from './types';
import { sanitiseHtml } from '@/lib/markdown';
import { IconPreview, IconSplit, IconSource } from '@/components/icons';

type Mode = 'split' | 'read' | 'outline';

const KIND_LABEL: Record<DocxBlock['type'], string> = {
  heading: 'Heading',
  paragraph: 'Para',
  listItem: 'List',
  quote: 'Quote'
};

export const DocxViewer = ({ deck, updateDraft, onReadout }: ViewerProps) => {
  const [mode, setMode] = useState<Mode>('split');
  const [onlyEdited, setOnlyEdited] = useState(false);
  const outlineRef = useRef<HTMLDivElement>(null);

  const payload = deck.document.payload.kind === 'docx' ? deck.document.payload : null;
  const edits = deck.draft.kind === 'docx' ? deck.draft.edits : {};

  const html = useMemo(() => (payload?.html ? sanitiseHtml(payload.html) : ''), [payload?.html]);

  const blocks = useMemo(
    () => (payload ? payload.blocks.filter((block) => !block.inTable) : []),
    [payload]
  );

  const shown = onlyEdited
    ? blocks.filter((block) => edits[block.index] !== undefined)
    : blocks;

  const editedCount = Object.keys(edits).length;

  useEffect(() => {
    if (!payload) return;
    onReadout([
      `${payload.wordCount.toLocaleString()} WORDS`,
      `${payload.blocks.length} BLOCKS`,
      editedCount > 0 ? `${editedCount} EDITED` : 'NO EDITS'
    ]);
  }, [editedCount, onReadout, payload]);

  if (!payload) return null;

  const setBlock = (index: number, original: string, value: string) =>
    updateDraft((draft) => {
      if (draft.kind !== 'docx') return draft;
      const next = { ...draft.edits };
      // Typing a paragraph back to its original text is not an edit.
      if (value === original) delete next[index];
      else next[index] = value;
      return { kind: 'docx', edits: next };
    });

  const revert = (index: number) =>
    updateDraft((draft) => {
      if (draft.kind !== 'docx') return draft;
      const next = { ...draft.edits };
      delete next[index];
      return { kind: 'docx', edits: next };
    });

  return (
    <div className="workbench">
      <div className="toolbar">
        <div className="toolbar__group" role="group" aria-label="Layout">
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'read'}
            onClick={() => setMode('read')}
          >
            <IconPreview />
            Read
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'split'}
            onClick={() => setMode('split')}
          >
            <IconSplit />
            Split
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'outline'}
            onClick={() => setMode('outline')}
          >
            <IconSource />
            Outline
          </button>
        </div>

        <span className="toolbar__rule" />

        <button
          type="button"
          className="control"
          aria-pressed={onlyEdited}
          disabled={editedCount === 0}
          onClick={() => setOnlyEdited((current) => !current)}
        >
          Edited only
          {editedCount > 0 && <span className="palette__hint">{editedCount}</span>}
        </button>

        <span className="toolbar__spacer" />
        <p className="toolbar__note" title={deck.document.capabilities.editingNote}>
          {deck.document.capabilities.editingNote}
        </p>
      </div>

      <div className={`stage docx docx--${mode === 'split' ? 'split' : 'read'}`}>
        {mode !== 'outline' && (
          <div className="docx__sheet">
            {html ? (
              // Sanitised: the renderer's HTML comes from a file the user did
              // not necessarily write.
              <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="placeholder">
                <p className="placeholder__title">No read view for this document</p>
                <p className="placeholder__body">
                  Docket could not render this file's layout, but its text is
                  intact — switch to Outline to read and edit it.
                </p>
              </div>
            )}
          </div>
        )}

        {mode !== 'read' && (
          <div className="docx__outline" ref={outlineRef}>
            <div className="docx__outline-head">
              <span className="stamp">
                {onlyEdited ? 'Edited paragraphs' : 'Every paragraph'} · {shown.length}
              </span>
            </div>

            {shown.length === 0 ? (
              <div className="placeholder" style={{ height: 'auto', padding: '3rem 1.5rem' }}>
                <p className="placeholder__title">
                  {onlyEdited ? 'Nothing edited yet' : 'This document has no text'}
                </p>
                <p className="placeholder__body">
                  {onlyEdited
                    ? 'Change a paragraph and it will appear here.'
                    : 'Every paragraph in this file is empty, or the text lives entirely inside tables and text boxes.'}
                </p>
              </div>
            ) : (
              shown.map((block) => {
                const edited = edits[block.index] !== undefined;
                const value = edits[block.index] ?? block.text;
                return (
                  <div
                    key={block.index}
                    className={`docx__block ${edited ? 'docx__block--dirty' : ''}`}
                  >
                    <div className="docx__block-meta">
                      <span className="docx__block-kind">
                        {KIND_LABEL[block.type]}
                        {block.type === 'heading' ? ` ${block.level}` : ''}
                      </span>
                      {edited && (
                        <button
                          type="button"
                          className="docx__block-kind"
                          style={{ color: 'var(--lamp-amber)' }}
                          onClick={() => revert(block.index)}
                        >
                          Revert
                        </button>
                      )}
                      <span className="docx__block-index">¶{block.index + 1}</span>
                    </div>
                    <textarea
                      className={`docx__input ${
                        block.type === 'heading' ? 'docx__input--heading' : ''
                      }`}
                      value={value}
                      rows={1}
                      spellCheck
                      aria-label={`${KIND_LABEL[block.type]} ${block.index + 1}`}
                      onChange={(event) =>
                        setBlock(block.index, block.text, event.target.value)
                      }
                    />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
