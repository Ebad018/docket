import ExcelJS from 'exceljs';
import type {
  Cell,
  CellValue,
  DocumentPatch,
  DocumentPayload,
  FormatCapabilities,
  Sheet
} from '@shared/documents';
import { DocumentError, type DocumentHandler } from './DocumentHandler';

/** Padding so a sheet always has room to type into beyond its last used cell. */
const SPARE_ROWS = 12;
const SPARE_COLUMNS = 4;
const MIN_ROWS = 32;
const MIN_COLUMNS = 12;

export class XlsxHandler implements DocumentHandler {
  readonly kind = 'xlsx' as const;
  readonly extensions = ['xlsx', 'xlsm'] as const;

  readonly capabilities: FormatCapabilities = {
    label: 'Excel Workbook',
    stock: 'XLS',
    canEditText: false,
    canEditCells: true,
    canAnnotate: false,
    canReorderPages: false,
    editingNote:
      'Cell values and formulas are editable. Charts, pivot tables and macros are preserved but not shown.'
  };

  async read(filePath: string): Promise<DocumentPayload> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(filePath);
    } catch (error) {
      throw toDocumentError(error, 'read', filePath);
    }

    const sheets: Sheet[] = workbook.worksheets
      .filter((worksheet) => worksheet.state !== 'veryHidden')
      .map((worksheet) => readSheet(worksheet));

    if (sheets.length === 0) {
      throw new DocumentError('read-failed', `${filePath} contains no readable sheets.`);
    }
    return { kind: 'xlsx', sheets };
  }

  async write(filePath: string, patch: DocumentPatch): Promise<void> {
    if (patch.kind !== 'xlsx') {
      throw new DocumentError('write-failed', 'That edit does not belong to a workbook.');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(filePath);
    } catch (error) {
      throw toDocumentError(error, 'read', filePath);
    }

    for (const edit of patch.cells) {
      const worksheet = workbook.getWorksheet(edit.sheet);
      if (!worksheet) {
        throw new DocumentError(
          'write-failed',
          `The sheet “${edit.sheet}” is no longer in this workbook.`,
          'It may have been renamed or removed since Docket opened the file.'
        );
      }
      applyCellEdit(worksheet.getRow(edit.row).getCell(edit.column), edit.input);
    }

    // Formulas are written without a cached result, so Excel recalculates the
    // whole book on open rather than trusting a value Docket computed.
    workbook.calcProperties.fullCalcOnLoad = true;

    try {
      await workbook.xlsx.writeFile(filePath);
    } catch (error) {
      throw toDocumentError(error, 'write', filePath);
    }
  }
}

/* ── Reading ─────────────────────────────────────────────────────────── */

const readSheet = (worksheet: ExcelJS.Worksheet): Sheet => {
  const usedRows = worksheet.actualRowCount > 0 ? worksheet.rowCount : 0;
  const usedColumns = worksheet.actualColumnCount > 0 ? worksheet.columnCount : 0;

  const rowCount = Math.max(MIN_ROWS, usedRows + SPARE_ROWS);
  const columnCount = Math.max(MIN_COLUMNS, usedColumns + SPARE_COLUMNS);

  const rows: Cell[][] = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const cells: Cell[] = [];
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      cells.push(readCell(row.getCell(columnIndex)));
    }
    rows.push(cells);
  }

  const columnWidths: number[] = [];
  for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
    const width = worksheet.getColumn(columnIndex).width;
    columnWidths.push(typeof width === 'number' ? Math.round(width * 7.5) : 108);
  }

  return { name: worksheet.name, rowCount, columnCount, columnWidths, rows };
};

const EMPTY_CELL: Cell = { value: null, formula: null, kind: 'empty', numberFormat: null };

const readCell = (cell: ExcelJS.Cell): Cell => {
  const raw = cell.value;
  const numberFormat = typeof cell.numFmt === 'string' ? cell.numFmt : null;

  if (raw === null || raw === undefined || raw === '') return EMPTY_CELL;

  if (typeof raw === 'object') {
    if ('formula' in raw || 'sharedFormula' in raw) {
      const formula =
        ('formula' in raw && raw.formula) ||
        ('sharedFormula' in raw && raw.sharedFormula) ||
        '';
      return {
        value: toPlainValue((raw as ExcelJS.CellFormulaValue).result ?? null),
        formula: String(formula),
        kind: 'formula',
        numberFormat
      };
    }
    if ('richText' in raw) {
      return {
        value: raw.richText.map((part) => part.text).join(''),
        formula: null,
        kind: 'text',
        numberFormat
      };
    }
    if ('text' in raw && 'hyperlink' in raw) {
      return { value: String(raw.text), formula: null, kind: 'text', numberFormat };
    }
    if ('error' in raw) {
      return { value: String(raw.error), formula: null, kind: 'error', numberFormat };
    }
    if (raw instanceof Date) {
      return { value: raw.toISOString(), formula: null, kind: 'date', numberFormat };
    }
    return { value: String(raw), formula: null, kind: 'text', numberFormat };
  }

  if (typeof raw === 'number') {
    return { value: raw, formula: null, kind: 'number', numberFormat };
  }
  if (typeof raw === 'boolean') {
    return { value: raw, formula: null, kind: 'boolean', numberFormat };
  }
  return { value: String(raw), formula: null, kind: 'text', numberFormat };
};

const toPlainValue = (value: unknown): CellValue => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'error' in (value as Record<string, unknown>)) {
    return String((value as { error: unknown }).error);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
};

/* ── Writing ─────────────────────────────────────────────────────────── */

const applyCellEdit = (cell: ExcelJS.Cell, input: string): void => {
  const trimmed = input.trim();

  if (trimmed === '') {
    cell.value = null;
    return;
  }
  if (trimmed.startsWith('=')) {
    cell.value = { formula: trimmed.slice(1) } as ExcelJS.CellFormulaValue;
    return;
  }
  if (/^(TRUE|FALSE)$/i.test(trimmed)) {
    cell.value = trimmed.toUpperCase() === 'TRUE';
    return;
  }
  // Only treat it as a number when the whole string is one — "1-2" and phone
  // numbers with leading zeros must survive as text.
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed) && !/^0\d/.test(trimmed)) {
    cell.value = Number(trimmed);
    return;
  }
  cell.value = input;
};

const toDocumentError = (
  error: unknown,
  phase: 'read' | 'write',
  filePath: string
): DocumentError => {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    return new DocumentError('not-found', `${filePath} is no longer on disk.`);
  }
  if (code === 'EBUSY' || code === 'EACCES' || code === 'EPERM') {
    return new DocumentError(
      phase === 'read' ? 'read-failed' : 'write-failed',
      `${filePath} is locked by another program.`,
      'Close the workbook in Excel, then try again.'
    );
  }
  return new DocumentError(
    phase === 'read' ? 'read-failed' : 'write-failed',
    `Could not ${phase} ${filePath}.`,
    error instanceof Error ? error.message : String(error)
  );
};
