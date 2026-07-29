import type { CellValue } from '@shared/documents';

/**
 * A small spreadsheet calculator.
 *
 * A workbook Docket edits must show the consequence of the edit — a grid where
 * changing an input leaves every total stale is a viewer wearing an editor's
 * clothes. This evaluates the arithmetic and the common function set live, in
 * the renderer, over the grid the user is looking at.
 *
 * It is deliberately not a complete implementation of Excel's language. A
 * formula naming a function it does not know evaluates to #NAME?, and the
 * grid keeps showing the value Excel last stored for that cell instead. On
 * save the formula text is written untouched, with fullCalcOnLoad set, so
 * Excel recalculates everything itself and nothing computed here is ever
 * baked into the file.
 */

export type FormulaValue = CellValue;

export interface GridSource {
  readonly rowCount: number;
  readonly columnCount: number;
  /** 1-based, matching the spreadsheet's own addressing. */
  cellAt(row: number, column: number): { value: CellValue; formula: string | null };
}

const ERRORS = {
  div0: '#DIV/0!',
  value: '#VALUE!',
  name: '#NAME?',
  ref: '#REF!',
  cycle: '#CYCLE!',
  parse: '#ERROR!'
} as const;

export const isErrorValue = (value: CellValue): boolean =>
  typeof value === 'string' && /^#[A-Z0-9/?!]+$/.test(value);

class FormulaError extends Error {
  constructor(readonly value: string) {
    super(value);
  }
}

/* ── Public entry point ──────────────────────────────────────────────── */

export class FormulaEngine {
  private readonly cache = new Map<string, CellValue>();
  private readonly visiting = new Set<string>();

  constructor(private readonly grid: GridSource) {}

  /** Resolves a cell to its displayed value, following formulas. */
  valueOf(row: number, column: number): CellValue {
    const key = `${row}:${column}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    if (this.visiting.has(key)) return ERRORS.cycle;

    const cell = this.grid.cellAt(row, column);
    if (!cell.formula) {
      this.cache.set(key, cell.value);
      return cell.value;
    }

    this.visiting.add(key);
    let result: CellValue;
    try {
      result = this.evaluate(cell.formula);
    } catch (error) {
      // A formula this engine cannot handle falls back to the value the
      // spreadsheet itself last computed, rather than blanking the cell.
      result = error instanceof FormulaError && error.value === ERRORS.name
        ? (cell.value ?? ERRORS.name)
        : error instanceof FormulaError
          ? error.value
          : ERRORS.parse;
    } finally {
      this.visiting.delete(key);
    }

    this.cache.set(key, result);
    return result;
  }

  evaluate(source: string): CellValue {
    const parser = new Parser(source, this);
    return parser.parse();
  }

  invalidate(): void {
    this.cache.clear();
  }
}

/* ── Tokeniser ───────────────────────────────────────────────────────── */

type TokenType = 'number' | 'string' | 'ref' | 'name' | 'op' | 'punct' | 'end';

interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const OPERATORS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%'];

const tokenise = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '"') {
      let text = '';
      index += 1;
      while (index < source.length) {
        if (source[index] === '"') {
          if (source[index + 1] === '"') {
            text += '"';
            index += 2;
            continue;
          }
          break;
        }
        text += source[index];
        index += 1;
      }
      index += 1;
      tokens.push({ type: 'string', text });
      continue;
    }

    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      const match = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(source.slice(index));
      if (match) {
        tokens.push({ type: 'number', text: match[0] });
        index += match[0].length;
        continue;
      }
    }

    // A1, $A$1, and sheet-qualified references are recognised; the sheet part
    // is kept so the parser can reject cross-sheet references explicitly.
    const reference = /^(\$?[A-Za-z]{1,3}\$?\d{1,7})(?![A-Za-z0-9_.])/.exec(source.slice(index));
    if (reference) {
      tokens.push({ type: 'ref', text: reference[1] });
      index += reference[1].length;
      continue;
    }

    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(index));
    if (name) {
      tokens.push({ type: 'name', text: name[0] });
      index += name[0].length;
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ type: 'op', text: operator });
      index += operator.length;
      continue;
    }

    if ('(),:;'.includes(character)) {
      tokens.push({ type: 'punct', text: character });
      index += 1;
      continue;
    }

    throw new FormulaError(ERRORS.parse);
  }

  tokens.push({ type: 'end', text: '' });
  return tokens;
};

/* ── Parser / evaluator ──────────────────────────────────────────────── */

type Operand = CellValue | CellValue[];

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(
    source: string,
    private readonly engine: FormulaEngine
  ) {
    this.tokens = tokenise(source.replace(/^=/, ''));
  }

  parse(): CellValue {
    const value = this.comparison();
    if (this.peek().type !== 'end') throw new FormulaError(ERRORS.parse);
    return scalar(value);
  }

  private peek(): Token {
    return this.tokens[this.position];
  }

  private take(): Token {
    return this.tokens[this.position++];
  }

  private accept(text: string): boolean {
    if (this.peek().text === text && this.peek().type !== 'string') {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.accept(text)) throw new FormulaError(ERRORS.parse);
  }

  private comparison(): Operand {
    let left = this.concatenation();
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(token.text)) {
        return left;
      }
      this.take();
      const right = this.concatenation();
      left = compare(token.text, scalar(left), scalar(right));
    }
  }

  private concatenation(): Operand {
    let left = this.additive();
    while (this.peek().type === 'op' && this.peek().text === '&') {
      this.take();
      const right = this.additive();
      left = `${toText(scalar(left))}${toText(scalar(right))}`;
    }
    return left;
  }

  private additive(): Operand {
    let left = this.multiplicative();
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || (token.text !== '+' && token.text !== '-')) return left;
      this.take();
      const right = this.multiplicative();
      const a = toNumber(scalar(left));
      const b = toNumber(scalar(right));
      left = token.text === '+' ? a + b : a - b;
    }
  }

  private multiplicative(): Operand {
    let left = this.exponent();
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || (token.text !== '*' && token.text !== '/')) return left;
      this.take();
      const right = this.exponent();
      const a = toNumber(scalar(left));
      const b = toNumber(scalar(right));
      if (token.text === '/' && b === 0) throw new FormulaError(ERRORS.div0);
      left = token.text === '*' ? a * b : a / b;
    }
  }

  private exponent(): Operand {
    const left = this.unary();
    if (this.peek().type === 'op' && this.peek().text === '^') {
      this.take();
      const right = this.exponent();
      return toNumber(scalar(left)) ** toNumber(scalar(right));
    }
    return left;
  }

  private unary(): Operand {
    const token = this.peek();
    if (token.type === 'op' && (token.text === '-' || token.text === '+')) {
      this.take();
      const value = toNumber(scalar(this.unary()));
      return token.text === '-' ? -value : value;
    }
    return this.postfix();
  }

  private postfix(): Operand {
    const value = this.primary();
    if (this.peek().type === 'op' && this.peek().text === '%') {
      this.take();
      return toNumber(scalar(value)) / 100;
    }
    return value;
  }

  private primary(): Operand {
    const token = this.take();

    if (token.type === 'number') return Number(token.text);
    if (token.type === 'string') return token.text;

    if (token.type === 'punct' && token.text === '(') {
      const value = this.comparison();
      this.expect(')');
      return value;
    }

    if (token.type === 'ref') {
      if (this.peek().type === 'punct' && this.peek().text === ':') {
        this.take();
        const end = this.take();
        if (end.type !== 'ref') throw new FormulaError(ERRORS.ref);
        return this.range(token.text, end.text);
      }
      return this.cell(token.text);
    }

    if (token.type === 'name') {
      const upper = token.text.toUpperCase();
      if (upper === 'TRUE') return true;
      if (upper === 'FALSE') return false;
      if (this.peek().type === 'punct' && this.peek().text === '(') {
        this.take();
        const args: Operand[] = [];
        if (!this.accept(')')) {
          do {
            args.push(this.comparison());
          } while (this.accept(',') || this.accept(';'));
          this.expect(')');
        }
        return callFunction(upper, args);
      }
      throw new FormulaError(ERRORS.name);
    }

    throw new FormulaError(ERRORS.parse);
  }

  private cell(reference: string): CellValue {
    const address = parseAddress(reference);
    if (!address) throw new FormulaError(ERRORS.ref);
    return this.engine.valueOf(address.row, address.column);
  }

  private range(from: string, to: string): CellValue[] {
    const start = parseAddress(from);
    const end = parseAddress(to);
    if (!start || !end) throw new FormulaError(ERRORS.ref);

    const values: CellValue[] = [];
    const rowFrom = Math.min(start.row, end.row);
    const rowTo = Math.max(start.row, end.row);
    const columnFrom = Math.min(start.column, end.column);
    const columnTo = Math.max(start.column, end.column);

    // A guard against a runaway range like A1:XFD1048576 locking the renderer.
    if ((rowTo - rowFrom + 1) * (columnTo - columnFrom + 1) > 250_000) {
      throw new FormulaError(ERRORS.ref);
    }

    for (let row = rowFrom; row <= rowTo; row += 1) {
      for (let column = columnFrom; column <= columnTo; column += 1) {
        values.push(this.engine.valueOf(row, column));
      }
    }
    return values;
  }
}

export const parseAddress = (
  reference: string
): { row: number; column: number } | null => {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(reference);
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
};

/* ── Coercion ────────────────────────────────────────────────────────── */

const scalar = (operand: Operand): CellValue =>
  Array.isArray(operand) ? (operand[0] ?? null) : operand;

const flatten = (operands: Operand[]): CellValue[] =>
  operands.flatMap((operand) => (Array.isArray(operand) ? operand : [operand]));

const toNumber = (value: CellValue): number => {
  if (value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (isErrorValue(value)) throw new FormulaError(value);
  const parsed = Number(String(value).replace(/[,\s]/g, ''));
  if (Number.isNaN(parsed)) throw new FormulaError(ERRORS.value);
  return parsed;
};

const toText = (value: CellValue): string => {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
};

const toBoolean = (value: CellValue): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null || value === '') return false;
  if (/^true$/i.test(String(value))) return true;
  if (/^false$/i.test(String(value))) return false;
  return Boolean(value);
};

const numbersIn = (values: CellValue[]): number[] =>
  values.filter((value): value is number => typeof value === 'number');

const compare = (operator: string, left: CellValue, right: CellValue): boolean => {
  const bothNumeric = typeof left === 'number' && typeof right === 'number';
  const a = bothNumeric ? (left as number) : toText(left).toLowerCase();
  const b = bothNumeric ? (right as number) : toText(right).toLowerCase();

  switch (operator) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    default:
      return a >= b;
  }
};

/* ── Functions ───────────────────────────────────────────────────────── */

const matchesCriterion = (value: CellValue, criterion: CellValue): boolean => {
  const text = toText(criterion).trim();
  const comparison = /^(<=|>=|<>|<|>|=)(.*)$/.exec(text);
  if (comparison) {
    const operand = comparison[2].trim();
    const target: CellValue =
      operand !== '' && !Number.isNaN(Number(operand)) ? Number(operand) : operand;
    return compare(comparison[1], value, target);
  }
  if (text !== '' && !Number.isNaN(Number(text))) return toNumber(value) === Number(text);
  return toText(value).toLowerCase() === text.toLowerCase();
};

const callFunction = (name: string, args: Operand[]): CellValue => {
  const values = () => flatten(args);
  const numbers = () => numbersIn(values());
  const first = () => scalar(args[0] ?? null);

  switch (name) {
    case 'SUM':
      return numbers().reduce((total, value) => total + value, 0);
    case 'PRODUCT':
      return numbers().reduce((total, value) => total * value, 1);
    case 'AVERAGE':
    case 'AVG': {
      const list = numbers();
      if (list.length === 0) throw new FormulaError(ERRORS.div0);
      return list.reduce((total, value) => total + value, 0) / list.length;
    }
    case 'MEDIAN': {
      const list = numbers().sort((a, b) => a - b);
      if (list.length === 0) throw new FormulaError(ERRORS.value);
      const middle = Math.floor(list.length / 2);
      return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
    }
    case 'MIN': {
      const list = numbers();
      return list.length ? Math.min(...list) : 0;
    }
    case 'MAX': {
      const list = numbers();
      return list.length ? Math.max(...list) : 0;
    }
    case 'COUNT':
      return numbers().length;
    case 'COUNTA':
      return values().filter((value) => value !== null && value !== '').length;
    case 'COUNTBLANK':
      return values().filter((value) => value === null || value === '').length;
    case 'COUNTIF': {
      const list = Array.isArray(args[0]) ? args[0] : [scalar(args[0] ?? null)];
      return list.filter((value) => matchesCriterion(value, scalar(args[1] ?? null))).length;
    }
    case 'SUMIF': {
      const list = Array.isArray(args[0]) ? args[0] : [scalar(args[0] ?? null)];
      const targets = Array.isArray(args[2]) ? args[2] : list;
      const criterion = scalar(args[1] ?? null);
      return list.reduce<number>((total, value, index) => {
        if (!matchesCriterion(value, criterion)) return total;
        const target = targets[index];
        return total + (typeof target === 'number' ? target : 0);
      }, 0);
    }
    case 'ROUND': {
      const factor = 10 ** toNumber(scalar(args[1] ?? 0));
      return Math.round(toNumber(first()) * factor) / factor;
    }
    case 'ROUNDUP': {
      const factor = 10 ** toNumber(scalar(args[1] ?? 0));
      return Math.ceil(toNumber(first()) * factor) / factor;
    }
    case 'ROUNDDOWN':
    case 'TRUNC': {
      const factor = 10 ** toNumber(scalar(args[1] ?? 0));
      return Math.trunc(toNumber(first()) * factor) / factor;
    }
    case 'INT':
      return Math.floor(toNumber(first()));
    case 'ABS':
      return Math.abs(toNumber(first()));
    case 'SQRT': {
      const value = toNumber(first());
      if (value < 0) throw new FormulaError(ERRORS.value);
      return Math.sqrt(value);
    }
    case 'POWER':
      return toNumber(first()) ** toNumber(scalar(args[1] ?? null));
    case 'MOD': {
      const divisor = toNumber(scalar(args[1] ?? null));
      if (divisor === 0) throw new FormulaError(ERRORS.div0);
      return toNumber(first()) % divisor;
    }
    case 'IF':
      return toBoolean(first())
        ? scalar(args[1] ?? true)
        : scalar(args[2] ?? false);
    case 'IFERROR': {
      const value = first();
      return isErrorValue(value) ? scalar(args[1] ?? null) : value;
    }
    case 'AND':
      return values().every((value) => toBoolean(value));
    case 'OR':
      return values().some((value) => toBoolean(value));
    case 'NOT':
      return !toBoolean(first());
    case 'CONCAT':
    case 'CONCATENATE':
      return values().map((value) => toText(value)).join('');
    case 'LEN':
      return toText(first()).length;
    case 'LEFT':
      return toText(first()).slice(0, args.length > 1 ? toNumber(scalar(args[1])) : 1);
    case 'RIGHT': {
      const count = args.length > 1 ? toNumber(scalar(args[1])) : 1;
      const text = toText(first());
      return count <= 0 ? '' : text.slice(Math.max(0, text.length - count));
    }
    case 'MID': {
      const start = Math.max(1, toNumber(scalar(args[1] ?? 1)));
      return toText(first()).substr(start - 1, toNumber(scalar(args[2] ?? 0)));
    }
    case 'UPPER':
      return toText(first()).toUpperCase();
    case 'LOWER':
      return toText(first()).toLowerCase();
    case 'TRIM':
      return toText(first()).trim().replace(/\s+/g, ' ');
    case 'TODAY':
      return new Date().toLocaleDateString();
    case 'NOW':
      return new Date().toLocaleString();
    default:
      throw new FormulaError(ERRORS.name);
  }
};
