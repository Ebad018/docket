import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentKind } from '@shared/documents';
import {
  EXPORT_TARGETS,
  tally,
  targetsFor,
  type ExportTarget,
  type PortableDocument
} from '@shared/portable';
import type { Deck } from '@/state/deck';
import { isDirty } from '@/state/deck';
import { extractorRegistry } from '@/export/registry';
import { DEFAULT_SETTINGS, type ExportSettings } from '@/export/types';
import { IconClose, IconSave } from './icons';

interface ExportBayProps {
  readonly deck: Deck;
  readonly initialTarget: ExportTarget | null;
  readonly busy: boolean;
  onClose(): void;
  onSave(): void;
  onRun(document: PortableDocument, target: ExportTarget, suggestedName: string): void;
}

/** The listing's card-stock family, so a format looks the same everywhere. */
const STOCK_CLASS: Record<DocumentKind, string> = {
  markdown: 'listing__stock--md',
  docx: 'listing__stock--doc',
  xlsx: 'listing__stock--xls',
  pdf: 'listing__stock--pdf'
};

/**
 * The job ticket: pick a target, set the run options, read what will come out,
 * send it. A side panel rather than a modal — the document stays visible, and
 * nothing here needs to interrupt or protect focus.
 */
export const ExportBay = ({
  deck,
  initialTarget,
  busy,
  onClose,
  onSave,
  onRun
}: ExportBayProps) => {
  const sourceKind = deck.document.payload.kind;
  const available = useMemo(() => targetsFor(sourceKind), [sourceKind]);

  const [target, setTarget] = useState<ExportTarget>(
    () => initialTarget ?? available[0]?.target ?? 'pdf'
  );
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS);
  const [preview, setPreview] = useState<PortableDocument | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reading, setReading] = useState(true);

  const panelRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);

  const extractor = extractorRegistry.find(sourceKind);
  const dirty = isDirty(deck);
  /* Word and PDF convert from the rendered document, which is what is on disk;
     Markdown and Excel convert from the live draft. Only the first pair can go
     stale, so only they warrant the warning. */
  const staleEdits = dirty && (sourceKind === 'docx' || sourceKind === 'pdf');

  useEffect(() => {
    if (initialTarget && available.some((entry) => entry.target === initialTarget)) {
      setTarget(initialTarget);
    }
  }, [available, initialTarget]);

  // Focus the panel, not a control inside it: landing on Close reads as if the
  // panel is asking to be dismissed, and Escape already covers that.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const build = useCallback(async () => {
    const id = (requestId.current += 1);
    setReading(true);
    setFailure(null);
    try {
      const built = await extractorRegistry.build(sourceKind, {
        document: deck.document,
        draft: deck.draft,
        settings
      });
      if (requestId.current === id) setPreview(built);
    } catch (error) {
      if (requestId.current === id) {
        setPreview(null);
        setFailure(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (requestId.current === id) setReading(false);
    }
  }, [deck.document, deck.draft, settings, sourceKind]);

  useEffect(() => {
    void build();
  }, [build]);

  const counts = preview ? tally(preview) : null;
  const descriptor = EXPORT_TARGETS.find((entry) => entry.target === target);
  const suggestedName = deck.document.meta.fileName.replace(/\.[^.]+$/, '');

  return (
    <aside
      className="bay"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Convert this document"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className="bay__head">
        <span className="stamp">Convert</span>
        <button
          type="button"
          className="control control--quiet control--icon"
          onClick={onClose}
          aria-label="Close the convert panel"
        >
          <IconClose size={12} />
        </button>
      </header>

      <div className="bay__body">
        <p className="bay__from">
          <span className={`listing__stock ${STOCK_CLASS[sourceKind]}`}>
            {deck.document.capabilities.stock}
          </span>
          <span className="bay__filename" title={deck.document.meta.filePath}>
            {deck.document.meta.fileName}
          </span>
        </p>

        <fieldset className="bay__group">
          <legend className="stamp">Convert to</legend>
          <div className="bay__targets">
            {available.map((entry) => (
              <button
                key={entry.target}
                type="button"
                className="control"
                aria-pressed={target === entry.target}
                onClick={() => setTarget(entry.target)}
              >
                <span className={`listing__stock ${STOCK_CLASS[entry.target]}`}>
                  {entry.stock}
                </span>
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>

        {extractor && extractor.options.length > 0 && (
          <fieldset className="bay__group">
            <legend className="stamp">Run options</legend>
            {extractor.options.map((option) => (
              <label className="bay__option" key={option.id}>
                <input
                  type="checkbox"
                  checked={settings[option.id]}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      [option.id]: event.target.checked
                    }))
                  }
                />
                <span>
                  {option.label}
                  {option.hint && <small>{option.hint}</small>}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="bay__group">
          <legend className="stamp">Output</legend>
          {failure ? (
            <p className="bay__warning bay__warning--error">{failure}</p>
          ) : reading || !counts ? (
            <p className="bay__readout">Reading the document…</p>
          ) : (
            <p className="bay__readout">
              <strong>{counts.blocks.toLocaleString()}</strong> blocks ·{' '}
              <strong>{counts.words.toLocaleString()}</strong> words
              {counts.tables > 0 && (
                <>
                  {' '}
                  · <strong>{counts.tables}</strong>{' '}
                  {counts.tables === 1 ? 'table' : 'tables'}
                </>
              )}
              {counts.pageBreaks > 0 && (
                <>
                  {' '}
                  · <strong>{counts.pageBreaks + 1}</strong> sections
                </>
              )}
            </p>
          )}

          <p className="bay__filename bay__filename--out">
            {suggestedName}.{descriptor?.extension}
          </p>
        </fieldset>

        {staleEdits && (
          <div className="bay__warning">
            <p>
              This conversion reads the document as saved. You have unsaved edits,
              and they will not be included.
            </p>
            <button type="button" className="control" onClick={onSave}>
              <IconSave />
              Save first
            </button>
          </div>
        )}

        {sourceKind === 'pdf' && (
          <p className="bay__note">
            Text is recovered by inferring paragraphs from glyph positions, because
            a PDF does not store them. Ordinary single-column pages come out well;
            multi-column layouts, forms and typeset tables do not.
          </p>
        )}

        {sourceKind === 'docx' && (
          <p className="bay__note">
            Converted from the rendered document, so tables, emphasis and links are
            kept. Images, headers and footers are not carried across.
          </p>
        )}
      </div>

      <footer className="bay__foot">
        <button
          type="button"
          className="control control--primary"
          disabled={busy || reading || !preview || Boolean(failure)}
          onClick={() => preview && onRun(preview, target, suggestedName)}
        >
          {busy ? 'Converting…' : `Convert and save…`}
        </button>
      </footer>
    </aside>
  );
};
