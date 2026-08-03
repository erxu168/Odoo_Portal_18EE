/**
 * numeric-input — the one place that decides what typing a number MEANS.
 *
 * Spec: docs/superpowers/specs/2026-08-03-android-keyboard-numpad-design.md
 *
 * Pure, no React, no DOM: every keypad in the portal drives its buffer through
 * here so "what does Clear do", "is empty the same as zero", and "is 0301 a
 * number or a code" have exactly one answer.
 *
 * THE RULE THAT MATTERS MOST — empty is not zero.
 * In counting, an empty field means "nobody counted this" and a typed 0 means
 * "there is none here, set the stock to zero". They travel to different places
 * in Odoo. ui/Numpad used to collapse them with `parseFloat(v) || 0`; that is
 * corrected here, and callers opt in per screen via `allowEmpty`.
 */

export type NumpadMode =
  /** whole numbers only — no decimal key */
  | 'integer'
  /** numbers with a decimal part */
  | 'decimal'
  /** a string of digits that happens to look numeric: postcode, barcode, employee no.
   *  Leading zeros are meaningful and it is NEVER parsed as a number. */
  | 'digit-string';

export interface NumericRules {
  mode: NumpadMode;
  /** May the field be left empty? false (default) disables Confirm on an empty buffer — it never silently commits 0. */
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  /** Value must be a whole multiple of this (offset from min, or from 0 when there is no min). */
  step?: number;
  /** Maximum digits after the decimal point. */
  fractionDigits?: number;
  /** Maximum total characters — mainly for digit-string (barcode length, PIN length). */
  maxLength?: number;
}

export type NumpadKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  /** decimal separator — comma and dot both arrive as this */
  | '.'
  /** delete one character */
  | 'del'
  /** empty the buffer */
  | 'clear';

/** A committed value: a number for integer/decimal, a string for digit-string, null for a deliberate blank. */
export type NumericValue = number | string | null;

export interface Validity {
  /** May the user press Confirm right now? */
  canCommit: boolean;
  /** Why not, in plain language — shown in the pad. Null when fine. */
  reason: string | null;
}

const DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

/**
 * Normalize a hardware or pasted character to a pad key.
 * German keyboards and German locale both produce a decimal COMMA, so it is
 * accepted everywhere and stored as a dot.
 */
export function keyFromChar(char: string): NumpadKey | null {
  if (DIGITS.has(char)) return char as NumpadKey;
  if (char === '.' || char === ',') return '.';
  return null;
}

/** Count digits after the decimal point in a raw buffer. */
function fractionLength(buffer: string): number {
  const dot = buffer.indexOf('.');
  return dot === -1 ? 0 : buffer.length - dot - 1;
}

/**
 * Apply one key to the buffer and return the new buffer.
 * Always returns a valid buffer string; rejected keys return it unchanged.
 *
 * Buffer conventions:
 *   ''      the field is blank (NOT zero)
 *   '0'     an explicit zero
 *   '0.'    mid-typing a decimal — commits as 0
 */
export function applyKey(buffer: string, key: NumpadKey, rules: NumericRules): string {
  if (key === 'clear') return '';

  if (key === 'del') {
    return buffer.length <= 1 ? '' : buffer.slice(0, -1);
  }

  if (key === '.') {
    // Only decimals have a separator at all, and only ever one.
    if (rules.mode !== 'decimal') return buffer;
    if (buffer.includes('.')) return buffer;
    // A field allowed 0 decimal places has no use for the key.
    if (rules.fractionDigits === 0) return buffer;
    return buffer === '' ? '0.' : buffer + '.';
  }

  // A digit from here on.
  if (rules.maxLength !== undefined && buffer.length >= rules.maxLength) return buffer;

  if (rules.mode === 'digit-string') {
    // Leading zeros are the whole point — never collapse them.
    return buffer + key;
  }

  if (rules.fractionDigits !== undefined && buffer.includes('.')) {
    if (fractionLength(buffer) >= rules.fractionDigits) return buffer;
  }

  // A lone '0' is a placeholder, not a leading digit: typing 5 gives 5, not 05.
  // But '0.' is mid-decimal and must keep its zero.
  if (buffer === '0') return key;

  return buffer + key;
}

/** Apply a hardware/pasted character. Returns the buffer unchanged for keys we don't own. */
export function applyChar(buffer: string, char: string, rules: NumericRules): string {
  const key = keyFromChar(char);
  return key === null ? buffer : applyKey(buffer, key, rules);
}

/** Format a committed value back into a buffer string for reopening the pad. */
export function bufferFromValue(value: NumericValue | undefined, rules: NumericRules): string {
  if (value === null || value === undefined || value === '') return '';
  if (rules.mode === 'digit-string') return String(value);
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return '';
  return String(num);
}

/**
 * Is the current buffer committable, and if not, why?
 *
 * Deliberately has NO "only check when the value is above zero" escape. The old
 * tolerance rule in ui/Numpad carried `currentNum > 0`, which would let 0 sail
 * past a field whose minimum is 1 (weekly hours, batch sizes). Range rules here
 * apply to every value including zero.
 */
export function validate(buffer: string, rules: NumericRules): Validity {
  const trimmed = buffer.trim();

  if (trimmed === '') {
    return rules.allowEmpty
      ? { canCommit: true, reason: null }
      : { canCommit: false, reason: 'Enter a value' };
  }

  if (rules.mode === 'digit-string') {
    if (rules.maxLength !== undefined && trimmed.length > rules.maxLength) {
      return { canCommit: false, reason: `Too long — ${rules.maxLength} digits maximum` };
    }
    return { canCommit: true, reason: null };
  }

  const num = parseFloat(trimmed);
  if (!Number.isFinite(num)) return { canCommit: false, reason: 'Not a number' };

  if (rules.mode === 'integer' && !Number.isInteger(num)) {
    return { canCommit: false, reason: 'Whole numbers only' };
  }

  if (rules.fractionDigits !== undefined && fractionLength(trimmed) > rules.fractionDigits) {
    return rules.fractionDigits === 0
      ? { canCommit: false, reason: 'Whole numbers only' }
      : { canCommit: false, reason: `At most ${rules.fractionDigits} decimal place${rules.fractionDigits === 1 ? '' : 's'}` };
  }

  if (rules.min !== undefined && num < rules.min) {
    return { canCommit: false, reason: `Must be at least ${formatHint(rules.min)}` };
  }
  if (rules.max !== undefined && num > rules.max) {
    return { canCommit: false, reason: `Must be at most ${formatHint(rules.max)}` };
  }

  if (rules.step !== undefined && rules.step > 0) {
    const base = rules.min ?? 0;
    const offset = num - base;
    const steps = offset / rules.step;
    // Float dust: 0.3 / 0.1 is 2.9999999999999996, which is a valid step.
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return { canCommit: false, reason: `Must go up in steps of ${formatHint(rules.step)}` };
    }
  }

  return { canCommit: true, reason: null };
}

function formatHint(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(n);
}

/**
 * Turn a buffer into the value to save. Returns `undefined` when the buffer is
 * not committable — callers must check `validate` first and never treat a
 * refusal as zero.
 */
export function commit(buffer: string, rules: NumericRules): NumericValue | undefined {
  const { canCommit } = validate(buffer, rules);
  if (!canCommit) return undefined;

  const trimmed = buffer.trim();
  if (trimmed === '') return null; // Deliberately blank — NOT zero.
  if (rules.mode === 'digit-string') return trimmed;

  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

/** What the pad shows. An empty buffer shows a dimmed 0 without BEING zero. */
export function displayText(buffer: string): string {
  return buffer === '' ? '0' : buffer;
}
