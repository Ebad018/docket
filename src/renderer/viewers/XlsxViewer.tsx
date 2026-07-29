import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell, CellValue, Sheet } from '@shared/documents';
import type { ViewerProps } from './types';
import { cellKey } from '@/state/deck';
import { FormulaEngine, isErrorValue, type GridSource } from '@/lib/formula';
import { columnLabel } from '@/lib/format';

const ROW_HEIGHT = 26;
const OVERSCAN = 8;

interface Selection {
  readonly row: number;
  readonly column: number;
}

export const XlsxViewer = ({ deck, updateDraft, onReadout, onSave }: ViewerProps) => {
  const payload = deck.document.payload.kind === 'xlsx' ? deck.document.payload : null;
  const draft = deck.draft.kind === 'xlsx' ? deck.draft : null;

  const [selection, setSelection] = useState<Selection>({ row: 1, column: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const scrollRef = useRef<HTMLDivElement>(null);
  const formulaRef = useRef<HTMLInputElement>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);

  const sheetIndex = draft?.activeSheet ?? 0;
  const sheet: Sheet | null = payload?.sheets[sheetIndex] ?? payload?.sheets[0] ?? null;
  const edits = draft?.edits ?? {};

  /* The engine resolves the grid the user is looking at: the file's cells,
     overlaid with anything typed since it was opened. */
  const engine = useMemo(() => {
    if (!sheet) return null;
    const source: GridSource = {
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      cellAt: (row, column) => {
        const edit = edits[cellKey(sheet.name, row, column)];
        if (edit !== undefined) return parseInput(edit);
        const cell = sheet.rows[row - 1]?.[column - 1];
        return { value: cell?.value ?? null, formula: cell?.formula ?? null };
      }
    };
    return new FormulaEngine(source);
  }, [edits, sheet]);

  const rawAt = useCallback(
    (row: number, column: number): { cell: Cell | null; input: string | null } => {
      if (!sheet) return { cell: null, input: null };
      const input = edits[cellKey(sheet.name, row, column)] ?? null;
      return { cell: sheet.rows[row - 1]?.[column - 1] ?? null, input };
    },
    [edits, sheet]
  );

  /** What the formula bar shows: the formula if there is one, else the value. */
  const editorTextFor = useCallback(
    (row: number, column: number): string => {
      const { cell, input } = rawAt(row, column);
      if (input !== null) return input;
      if (!cell) return '';
      if (cell.formula) return `=${cell.formula}`;
      if (cell.value === null) return '';
      return String(cell.value);
    },
    [rawAt]
  );

  useEffect(() => {
    if (!sheet || !engine) return;
    const address = `${columnLabel(selection.column)}${selection.row}`;
    const value = engine.valueOf(selection.row, selection.column);
    onReadout([
      `SHEET ${sheetIndex + 1}/${payload?.sheets.length ?? 1}`,
      address,
      typeof value === 'number' ? `= ${value.toLocaleString()}` : 'TEXT',
      Object.keys(edits).length > 0 ? `${Object.keys(edits).length} EDITED` : 'NO EDITS'
    ]);
  }, [edits, engine, onReadout, payload?.sheets.length, selection, sheet, sheetIndex]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [sheet?.name]);

  if (!payload || !sheet || !engine) return null;

  const commit = (row: number, column: number, input: string) => {
    const original = editorTextFor(row, column);
    updateDraft((current) => {
      if (current.kind !== 'xlsx') return current;
      const key = cellKey(sheet.name, row, column);
      const next = { ...current.edits };
      const cell = sheet.rows[row - 1]?.[column - 1];
      const originalText = cell?.formula
        ? `=${cell.formula}`
        : cell?.value === null || cell?.value === undefined
          ? ''
          : String(cell.value);
      if (input === originalText) delete next[key];
      else next[key] = input;
      return { ...current, edits: next };
    });
    if (input !== original) engine.invalidate();
  };

  const selectSheet = (index: number) => {
    updateDraft((current) =>
      current.kind === 'xlsx' ? { ...current, activeSheet: index } : current
    );
    setSelection({ row: 1, column: 1 });
    setEditing(null);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  };

  const move = (rowDelta: number, columnDelta: number) => {
    setSelection((current) => {
      const row = Math.min(Math.max(1, current.row + rowDelta), sheet.rowCount);
      const column = Math.min(Math.max(1, current.column + columnDelta), sheet.columnCount);
      // Keep the selection inside the scrolled window.
      const element = scrollRef.current;
      if (element) {
        const top = (row - 1) * ROW_HEIGHT;
        if (top < element.scrollTop) element.scrollTop = top;
        else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight - ROW_HEIGHT) {
          element.scrollTop = top - element.clientHeight + 2 * ROW_HEIGHT;
        }
      }
      return { row, column };
    });
    setEditing(null);
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    if (editing !== null) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1, 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1, 0);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(0, -1);
        break;
      case 'ArrowRight':
      case 'Tab':
        event.preventDefault();
        move(0, event.shiftKey ? -1 : 1);
        break;
      case 'Home':
        event.preventDefault();
        setSelection((current) => ({ ...current, column: 1 }));
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        setEditing(editorTextFor(selection.row, selection.column));
        requestAnimationFrame(() => cellInputRef.current?.focus());
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        commit(selection.row, selection.column, '');
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          setEditing(event.key);
          requestAnimationFrame(() => cellInputRef.current?.focus());
        }
    }
  };

  const firstRow = Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) + 1 - OVERSCAN);
  const lastRow = Math.min(
    sheet.rowCount,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );
  const rowsAbove = firstRow - 1;
  const rowsBelow = sheet.rowCount - lastRow;

  const editingCell = editing !== null;

  return (
    <div className="workbench">
      <div className="xlsx">
        <div className="xlsx__formulabar">
          <span className="xlsx__address">
            {columnLabel(selection.column)}
            {selection.row}
          </span>
          <input
            ref={formulaRef}
            className="field xlsx__formula"
            value={editing ?? editorTextFor(selection.row, selection.column)}
            placeholder="Value, or a formula beginning with ="
            aria-label={`Contents of ${columnLabel(selection.column)}${selection.row}`}
            onChange={(event) => setEditing(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (editing !== null) commit(selection.row, selection.column, editing);
                setEditing(null);
                move(1, 0);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(null);
              }
            }}
            onBlur={() => {
              if (editing !== null) {
                commit(selection.row, selection.column, editing);
                setEditing(null);
              }
            }}
          />
        </div>

        <div
          className="xlsx__gridwrap"
          ref={scrollRef}
          tabIndex={0}
          role="grid"
          aria-label={`Sheet ${sheet.name}`}
          aria-rowcount={sheet.rowCount}
          aria-colcount={sheet.columnCount}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={onGridKeyDown}
        >
          <table className="xlsx__grid">
            <thead>
              <tr>
                <th style={{ width: 52, minWidth: 52 }} />
                {Array.from({ length: sheet.columnCount }, (_, index) => (
                  <th
                    key={index}
                    style={{
                      width: sheet.columnWidths[index] ?? 108,
                      minWidth: sheet.columnWidths[index] ?? 108
                    }}
                  >
                    {columnLabel(index + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsAbove > 0 && (
                <tr style={{ height: rowsAbove * ROW_HEIGHT }} aria-hidden="true">
                  <th />
                  <td colSpan={sheet.columnCount} />
                </tr>
              )}

              {Array.from({ length: Math.max(0, lastRow - firstRow + 1) }, (_, offset) => {
                const row = firstRow + offset;
                return (
                  <tr key={row}>
                    <th scope="row" style={{ width: 52, minWidth: 52 }}>
                      {row}
                    </th>
                    {Array.from({ length: sheet.columnCount }, (_, columnOffset) => {
                      const column = columnOffset + 1;
                      const selected =
                        selection.row === row && selection.column === column;
                      const { cell, input } = rawAt(row, column);
                      const value = engine.valueOf(row, column);
                      const isFormula = input?.trim().startsWith('=') || Boolean(cell?.formula);

                      return (
                        <td
                          key={column}
                          aria-selected={selected}
                          className={[
                            'xlsx__cell',
                            `xlsx__cell--${classOf(value, isFormula)}`,
                            input !== null ? 'xlsx__cell--dirty' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onMouseDown={() => {
                            if (editing !== null) {
                              commit(selection.row, selection.column, editing);
                              setEditing(null);
                            }
                            setSelection({ row, column });
                            scrollRef.current?.focus();
                          }}
                          onDoubleClick={() => {
                            setSelection({ row, column });
                            setEditing(editorTextFor(row, column));
                            requestAnimationFrame(() => cellInputRef.current?.focus());
                          }}
                        >
                          {selected && editingCell ? (
                            <input
                              ref={cellInputRef}
                              className="xlsx__cellinput"
                              value={editing ?? ''}
                              onChange={(event) => setEditing(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commit(row, column, editing ?? '');
                                  setEditing(null);
                                  move(1, 0);
                                  scrollRef.current?.focus();
                                }
                                if (event.key === 'Tab') {
                                  event.preventDefault();
                                  commit(row, column, editing ?? '');
                                  setEditing(null);
                                  move(0, event.shiftKey ? -1 : 1);
                                  scrollRef.current?.focus();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setEditing(null);
                                  scrollRef.current?.focus();
                                }
                                if (
                                  (event.ctrlKey || event.metaKey) &&
                                  event.key.toLowerCase() === 's'
                                ) {
                                  event.preventDefault();
                                  commit(row, column, editing ?? '');
                                  setEditing(null);
                                  onSave();
                                }
                              }}
                              onBlur={() => {
                                if (editing !== null) {
                                  commit(row, column, editing);
                                  setEditing(null);
                                }
                              }}
                            />
                          ) : (
                            display(value, cell?.numberFormat ?? null)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {rowsBelow > 0 && (
                <tr style={{ height: rowsBelow * ROW_HEIGHT }} aria-hidden="true">
                  <th />
                  <td colSpan={sheet.columnCount} />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="xlsx__tabs" role="tablist" aria-label="Sheets">
          {payload.sheets.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              role="tab"
              className="xlsx__tab"
              aria-current={index === sheetIndex}
              aria-selected={index === sheetIndex}
              onClick={() => selectSheet(index)}
            >
              {entry.name}
            </button>
          ))}
          <span className="toolbar__spacer" />
          <span
            className="stamp"
            style={{ alignSelf: 'center', padding: '0 var(--step-4)', textTransform: 'none' }}
            title="Docket computes the common function set live. Excel recalculates the whole book when it opens the saved file."
          >
            Live calc · SUM AVERAGE IF and 30 more
          </span>
        </div>
      </div>
    </div>
  );
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

const parseInput = (input: string): { value: CellValue; formula: string | null } => {
  const trimmed = input.trim();
  if (trimmed.startsWith('=')) return { value: null, formula: trimmed.slice(1) };
  if (trimmed === '') return { value: null, formula: null };
  if (/^(TRUE|FALSE)$/i.test(trimmed)) {
    return { value: trimmed.toUpperCase() === 'TRUE', formula: null };
  }
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) && !/^0\d/.test(trimmed)) {
    return { value: Number(trimmed), formula: null };
  }
  return { value: input, formula: null };
};

const classOf = (value: CellValue, isFormula: boolean): string => {
  if (typeof value === 'string' && isErrorValue(value)) return 'error';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return isFormula ? 'formula' : 'number';
  return 'text';
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

/** A pragmatic subset of Excel's number formats: enough that a currency column
 *  reads as currency and a percentage reads as a percentage. */
const display = (value: CellValue, numberFormat: string | null): string => {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
    }
    return value;
  }

  const format = numberFormat ?? '';
  if (format.includes('%')) {
    const decimals = decimalsIn(format);
    return `${(value * 100).toFixed(decimals)}%`;
  }

  const decimals = decimalsIn(format);
  const grouped = format.includes('#,##') || format.includes('0,0');
  const rendered = grouped
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })
    : decimals > 0
      ? value.toFixed(decimals)
      : trimNumber(value);

  const currency = /[$£€¥]/.exec(format);
  return currency ? `${currency[0]}${rendered}` : rendered;
};

const decimalsIn = (format: string): number => {
  const match = /\.(0+)/.exec(format);
  return match ? match[1].length : 0;
};

const trimNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
