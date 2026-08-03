import { test, expect } from '@playwright/test';

/**
 * The numeric buffer's truth table. These are the rules that decide what a
 * counted quantity, a price, and a barcode each mean — the empty-vs-zero cases
 * especially, because collapsing them writes a wrong stock level into Odoo.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ni = require('../src/lib/numeric-input');

const DEC = { mode: 'decimal' as const };
const DEC_EMPTY = { mode: 'decimal' as const, allowEmpty: true };
const INT = { mode: 'integer' as const };
const CODE = { mode: 'digit-string' as const };

function type(keys: string, rules: any, start = '') {
  return keys.split('').reduce((buf: string, ch: string) => ni.applyChar(buf, ch, rules), start);
}

test('empty and zero are different answers', () => {
  // The counting case: blank means nobody counted; 0 means there is none here.
  expect(ni.commit('', DEC_EMPTY)).toBeNull();
  expect(ni.commit('0', DEC_EMPTY)).toBe(0);

  // And without allowEmpty, blank is simply not committable — never a silent 0.
  expect(ni.validate('', DEC).canCommit).toBe(false);
  expect(ni.commit('', DEC)).toBeUndefined();
});

test('a lone zero is a placeholder, but 0. keeps its zero', () => {
  expect(ni.applyKey('0', '5', DEC)).toBe('5');       // not "05"
  expect(type('0.5', DEC)).toBe('0.5');
  expect(ni.commit('0.5', DEC)).toBe(0.5);
});

test('clear empties the buffer; delete walks back to empty', () => {
  expect(ni.applyKey('123', 'clear', DEC)).toBe('');
  expect(ni.applyKey('7', 'del', DEC)).toBe('');
  expect(ni.applyKey('', 'del', DEC)).toBe('');
  expect(ni.applyKey('12', 'del', DEC)).toBe('1');
});

test('a German decimal comma is accepted and stored as a dot', () => {
  expect(type('12,5', DEC)).toBe('12.5');
  expect(ni.commit(type('12,5', DEC), DEC)).toBe(12.5);
});

test('only one decimal separator, and none at all for integers', () => {
  expect(type('1.2.3', DEC)).toBe('1.23');
  expect(ni.applyKey('5', '.', INT)).toBe('5');
  expect(ni.applyKey('5', '.', { mode: 'decimal', fractionDigits: 0 })).toBe('5');
});

test('digit-string keeps leading zeros and never becomes a number', () => {
  expect(type('0301', CODE)).toBe('0301');
  expect(ni.commit('0301', CODE)).toBe('0301');
  expect(ni.commit('01067', CODE)).toBe('01067');   // Dresden postcode
  expect(ni.applyKey('12', '.', CODE)).toBe('12');  // no decimal key
});

test('min is enforced at zero too — the tolerance rule’s >0 escape is gone', () => {
  // ui/Numpad's tolerance check only fired when the value was above zero, so a
  // 0 slipped past any "at least 1" field. Weekly contract hours is exactly that.
  const rules = { mode: 'decimal' as const, min: 1 };
  expect(ni.validate('0', rules).canCommit).toBe(false);
  expect(ni.validate('1', rules).canCommit).toBe(true);
  expect(ni.validate('0.5', rules).canCommit).toBe(false);
});

test('max, whole numbers and decimal places are enforced', () => {
  expect(ni.validate('101', { mode: 'decimal', max: 100 }).canCommit).toBe(false);
  expect(ni.validate('2.5', INT).canCommit).toBe(false);
  expect(ni.validate('2.555', { mode: 'decimal', fractionDigits: 2 }).canCommit).toBe(false);
  expect(ni.validate('2.55', { mode: 'decimal', fractionDigits: 2 }).canCommit).toBe(true);
  // and typing past the allowed precision is refused at the key
  expect(type('2.555', { mode: 'decimal', fractionDigits: 2 })).toBe('2.55');
});

test('step tolerates floating-point dust', () => {
  const rules = { mode: 'decimal' as const, step: 0.1 };
  expect(ni.validate('0.3', rules).canCommit).toBe(true);   // 0.3/0.1 = 2.9999999999999996
  expect(ni.validate('0.25', rules).canCommit).toBe(false);
});

test('maxLength caps typing', () => {
  expect(type('12345678', { mode: 'digit-string', maxLength: 4 })).toBe('1234');
});

test('a value round-trips back into a buffer for reopening the pad', () => {
  expect(ni.bufferFromValue(12.5, DEC)).toBe('12.5');
  expect(ni.bufferFromValue(null, DEC)).toBe('');
  expect(ni.bufferFromValue(0, DEC)).toBe('0');      // a real zero reopens as zero
  expect(ni.bufferFromValue('0301', CODE)).toBe('0301');
});

test('an empty buffer displays as 0 without being zero', () => {
  expect(ni.displayText('')).toBe('0');
  expect(ni.commit('', DEC_EMPTY)).toBeNull();
});

test('minExclusive means "more than", which is not the same as min: 1', () => {
  // The recipe pads accepted any value > 0. Migrating them to `min: 1` would
  // have quietly banned a 0.5 kg production batch that used to work.
  const positive = { mode: 'decimal' as const, allowEmpty: false, minExclusive: 0 };
  expect(ni.validate('0.5', positive).canCommit).toBe(true);
  expect(ni.validate('0', positive).canCommit).toBe(false);
  expect(ni.validate('0.0', positive).canCommit).toBe(false);

  const atLeastOne = { mode: 'decimal' as const, allowEmpty: false, min: 1 };
  expect(ni.validate('0.5', atLeastOne).canCommit).toBe(false);
});

test('an in-progress draft survives the parent echoing the value back', () => {
  // The field reports a parsed number on every keystroke and the caller echoes
  // it straight back as the `value` prop. That echo must NOT read as an outside
  // change, or the draft is wiped mid-typing and the decimal point is lost.
  //
  // Codex's counterexample, which the first fix missed: select the contents and
  // type "." — that reports null, the echo lands, and without the check below
  // the next digit turns an intended 0.5 into 5.
  expect(ni.keepDraft({ draft: '.', prevValue: 2, value: null, reported: null })).toBe(true);

  // The ordinary case: "2." reports 2, the prop does not move at all.
  expect(ni.keepDraft({ draft: '2.', prevValue: 2, value: 2, reported: 2 })).toBe(true);

  // A value from OUTSIDE — an async price/par load landing mid-typing — wins.
  expect(ni.keepDraft({ draft: '2.', prevValue: 2, value: 7, reported: 2 })).toBe(false);

  // Nothing being typed: there is no draft to keep.
  expect(ni.keepDraft({ draft: null, prevValue: 2, value: 7, reported: undefined })).toBe(false);

  // A stable NaN prop must not read as "changed" on every render and eat every
  // keystroke — hence Object.is rather than !==.
  expect(ni.keepDraft({ draft: '1.', prevValue: NaN, value: NaN, reported: undefined })).toBe(true);
});
