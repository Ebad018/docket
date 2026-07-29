import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  syntaxHighlighting
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  highlightSelectionMatches,
  search,
  searchKeymap
} from '@codemirror/search';
import { tags } from '@lezer/highlight';
import type { ViewerProps } from './types';
import { outline, renderMarkdown, wordCount } from '@/lib/markdown';
import { IconPreview, IconSource, IconSplit } from '@/components/icons';

type Mode = 'split' | 'source' | 'preview';

/** Impact type, not a rainbow: structure is carried by weight and one accent. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '800', color: 'var(--ink-strong)' },
  { tag: tags.heading2, fontWeight: '750', color: 'var(--ink-strong)' },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: '700',
    color: 'var(--ink-strong)'
  },
  { tag: tags.strong, fontWeight: '750', color: 'var(--ink-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--ink-faint)' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: [tags.monospace, tags.literal], color: 'var(--lamp-green)' },
  { tag: tags.quote, color: 'var(--ink-soft)', fontStyle: 'italic' },
  { tag: [tags.processingInstruction, tags.meta], color: 'var(--ink-faint)' },
  { tag: tags.list, color: 'var(--lamp-amber)' },
  { tag: tags.comment, color: 'var(--ink-faint)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--lamp-amber)' },
  { tag: tags.string, color: 'var(--lamp-green)' },
  { tag: tags.number, color: 'var(--accent)' }
]);

export const MarkdownViewer = ({ deck, updateDraft, onReadout, onSave }: ViewerProps) => {
  const [mode, setMode] = useState<Mode>('split');
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const text = deck.draft.kind === 'markdown' ? deck.draft.text : '';

  const setText = useCallback(
    (next: string) => updateDraft((draft) => ({ ...draft, kind: 'markdown', text: next })),
    [updateDraft]
  );
  const setTextRef = useRef(setText);
  setTextRef.current = setText;

  const extensions = useMemo<Extension[]>(
    () => [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      rectangularSelection(),
      bracketMatching(),
      search({ top: true }),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: [] }),
      syntaxHighlighting(highlightStyle),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current();
            return true;
          }
        },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) setTextRef.current(update.state.doc.toString());
      })
    ],
    []
  );

  // Created once per open document, keyed on the deck and its path only.
  // Depending on the payload as well would rebuild the editor after every
  // save — throwing away undo history and dropping the cursor to line 1.
  //
  // The host element it attaches to must therefore outlive every mode change.
  // It does: both panes stay mounted and the hidden one is collapsed in CSS.
  // Unmounting the pane instead took CodeMirror's DOM with it while this
  // effect kept its stale deps, so nothing ever rebuilt the editor and Split
  // came back empty — and the orphaned view leaked its measure loop.
  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      state: EditorState.create({
        doc: deck.document.payload.kind === 'markdown' ? deck.document.payload.text : '',
        extensions
      }),
      parent: hostRef.current
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id, deck.document.meta.filePath, extensions]);

  // A pane that was display:none has no geometry, so CodeMirror's cached
  // measurements are wrong the moment it is shown again at a new width.
  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [mode]);

  const html = useMemo(() => renderMarkdown(text), [text]);
  const headings = useMemo(() => outline(text), [text]);

  useEffect(() => {
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    onReadout([
      `${wordCount(text)} WORDS`,
      `${lines} LINES`,
      `${headings.length} HEADINGS`
    ]);
  }, [headings.length, onReadout, text]);

  const jumpTo = (line: number) => {
    const view = viewRef.current;
    if (!view) return;
    const position = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from;
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: 'start' })
    });
    view.focus();
  };

  return (
    <div className="workbench">
      <div className="toolbar">
        <div className="toolbar__group" role="group" aria-label="Layout">
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'source'}
            onClick={() => setMode('source')}
            title="Source only"
          >
            <IconSource />
            Source
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'split'}
            onClick={() => setMode('split')}
            title="Source and preview"
          >
            <IconSplit />
            Split
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
            title="Preview only"
          >
            <IconPreview />
            Preview
          </button>
        </div>

        {headings.length > 0 && (
          <>
            <span className="toolbar__rule" />
            <label className="toolbar__group">
              <span className="stamp">Jump to</span>
              <select
                className="field"
                value=""
                onChange={(event) => {
                  if (event.target.value !== '') jumpTo(Number(event.target.value));
                }}
              >
                <option value="">Heading…</option>
                {headings.map((heading) => (
                  <option key={`${heading.line}`} value={heading.line}>
                    {'　'.repeat(Math.max(0, heading.level - 1))}
                    {heading.text}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <span className="toolbar__spacer" />
        <p className="toolbar__note" title={deck.document.capabilities.editingNote}>
          {deck.document.capabilities.editingNote}
        </p>
      </div>

      {/* Both panes are always mounted; the mode class hides one. Conditional
          rendering would destroy the editor on every switch. */}
      <div className={`stage md md--${mode}`} style={{ overflow: 'hidden' }}>
        <div className="md__pane md__pane--source" aria-hidden={mode === 'preview'}>
          <div className="md__editor" ref={hostRef} />
        </div>
        <div className="md__pane md__pane--preview" aria-hidden={mode === 'source'}>
          <div className="md__preview">
            {/* Sanitised in renderMarkdown: tags and URL schemes are allow-listed. */}
            <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </div>
  );
};
