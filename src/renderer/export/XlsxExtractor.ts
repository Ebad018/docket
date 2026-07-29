import type { CellValue, Sheet } from '@shared/documents';
import type { InlineRun, PortableBlock } from '@shared/portable';
import { cellKey } from '@/state/deck';
import { FormulaEngine, isErrorValue, type GridSource } from '@/lib/formula';
import type { DocumentExtractor, ExtractInput } from './types';

/**
 * A workbook becomes one table per sheet, trimmed to the region that actually
 * holds data — exporting the padding rows the grid adds for typing room would
 * produce pages of empty cells.
 */
export class XlsxExtractor implements DocumentExtractor {
  readonly kind = 'xlsx' as const;
  readonly options = [
    { id: 'sheetLabels' as const, label: 'Label each sheet' },
    {
      id: 'firstRowIsHeader' as const,
      label: 'Treat the first row as a header',
      hint: 'Repeats it across page breaks in PDF and Word.'
    },
    {
      id: 'formulaResults' as const,
      label: 'Export formula results',
      hint: 'Off exports the formula text itself, such as =SUM(C2:C8).'
    },
    { id: 'pageBreaks' as const, label: 'Start each sheet on a new page' }
  ];

  async extract({ document, draft, settings }: ExtractInput): Promise<PortableBlock[]> {
    if (document.payload.kind !== 'xlsx') return [];
    const edits = draft.kind === 'xlsx' ? draft.edits : {};
    const blocks: PortableBlock[] = [];

    document.payload.sheets.forEach((sheet, index) => {
      if (index > 0 && settings.pageBreaks) blocks.push({ type: 'pageBreak' });
      // A sheet name is a section heading, not a marker: it should become
      // `## Run sheet` in Markdown and a real outline entry in Word.
      if (settings.sheetLabels) {
        blocks.push({ type: 'heading', level: 2, runs: [{ text: sheet.name }] });
      }

      const table = sheetToTable(sheet, edits, settings.firstRowIsHeader, settings.formulaResults);
      if (table) blocks.push(table);
      else blocks.push({ type: 'paragraph', runs: [{ text: 'This sheet is empty.', italic: true }] });
    });

    return blocks;
  }
}

const sheetToTable = (
  sheet: Sheet,
  edits: Readonly<Record<string, string>>,
  firstRowIsHeader: boolean,
  formulaResults: boolean
): PortableBlock | null => {
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
  const engine = new FormulaEngine(source);

  const textAt = (row: number, column: number): string => {
    const edit = edits[cellKey(sheet.name, row, column)];
    const cell = sheet.rows[row - 1]?.[column - 1];

    if (!formulaResults) {
      if (edit !== undefined) return edit;
      if (cell?.formula) return `=${cell.formula}`;
    }
    return display(engine.valueOf(row, column), cell?.numberFormat ?? null);
  };

  // Trim to the populated region so the padding rows never reach the output.
  let lastRow = 0;
  let lastColumn = 0;
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      if (textAt(row, column).trim() !== '') {
        lastRow = Math.max(lastRow, row);
        lastColumn = Math.max(lastColumn, column);
      }
    }
  }
  if (lastRow === 0 || lastColumn === 0) return null;

  const rowAt = (row: number): InlineRun[][] =>
    Array.from({ length: lastColumn }, (_, index) => {
      const text = textAt(row, index + 1);
      return text ? [{ text }] : [];
    });

  const align = Array.from({ length: lastColumn }, (_, index) => {
    // Right-align a column when its body is predominantly numeric, the way a
    // spreadsheet already displays it.
    const start = firstRowIsHeader ? 2 : 1;
    let numeric = 0;
    let filled = 0;
    for (let row = start; row <= lastRow; row += 1) {
      const value = engine.valueOf(row, index + 1);
      if (value === null || value === '') continue;
      filled += 1;
      if (typeof value === 'number') numeric += 1;
    }
    return filled > 0 && numeric / filled >= 0.6 ? ('right' as const) : null;
  });

  const bodyStart = firstRowIsHeader ? 2 : 1;
  const rows: InlineRun[][][] = [];
  for (let row = bodyStart; row <= lastRow; row += 1) rows.push(rowAt(row));

  return {
    type: 'table',
    head: firstRowIsHeader ? rowAt(1) : null,
    rows,
    align
  };
};

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

const display = (value: CellValue, numberFormat: string | null): string => {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') {
    if (isErrorValue(value)) return value;
    if (ISO_DATE.test(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString();
    }
    return value;
  }

  const format = numberFormat ?? '';
  const decimals = /\.(0+)/.exec(format)?.[1].length ?? 0;

  if (format.includes('%')) return `${(value * 100).toFixed(decimals)}%`;

  const grouped = format.includes('#,##') || format.includes('0,0');
  const rendered = grouped
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })
    : decimals > 0
      ? value.toFixed(decimals)
      : Number.isInteger(value)
        ? String(value)
        : String(Number(value.toFixed(10)));

  const currency = /[$£€¥]/.exec(format);
  return currency ? `${currency[0]}${rendered}` : rendered;
};
