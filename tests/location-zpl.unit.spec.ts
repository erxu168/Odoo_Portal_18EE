import { test, expect } from '@playwright/test';
import { generateLocationZPL } from '../src/lib/zpl';

/**
 * The ZPL a shelf label is printed from.
 *
 * Worth pinning because the feedback loop is a physical printer: a malformed
 * command does not throw, it quietly prints a blank sticker, and you only find
 * out standing at the machine with a roll half gone.
 */

const AT = { widthMm: 75, heightMm: 50 };

test('it is a complete ZPL document', () => {
  const z = generateLocationZPL({ name: 'Walk in Cooler 1', code: 'KWLOC-25' }, AT);
  expect(z.startsWith('^XA')).toBe(true);
  expect(z.trimEnd().endsWith('^XZ')).toBe(true);
});

test('the label is told its real size in dots (75 x 50 mm at 203 dpi)', () => {
  const z = generateLocationZPL({ name: 'D4', code: 'KWLOC-9' }, AT);
  expect(z).toContain('^PW600');   // 75mm x 8 dots/mm
  expect(z).toContain('^LL400');   // 50mm x 8
});

test('300 dpi scales the whole label, not just the text', () => {
  const z = generateLocationZPL({ name: 'D4', code: 'KWLOC-9' }, { ...AT, dpi: 300 });
  expect(z).toContain('^PW900');   // 75 x 12
  expect(z).toContain('^LL600');   // 50 x 12
});

test('the QR carries the scannable code, in QR mode', () => {
  const z = generateLocationZPL({ name: 'Freezer #1', code: 'KWLOC-31' }, AT);
  expect(z).toMatch(/\^BQN,2,\d+/);
  expect(z).toContain('^FDQA,KWLOC-31^FS');
});

test('the name and the code are both printed, so a dead QR is not a dead label', () => {
  const z = generateLocationZPL({ name: 'Shelf R-side', code: 'KWLOC-44' }, AT);
  expect(z).toContain('Shelf R-side');
  // once in the QR payload, once as readable text
  expect(z.split('KWLOC-44').length - 1).toBe(2);
});

test('the path is printed when asked for, and absent when not', () => {
  const withBranch = generateLocationZPL(
    { name: 'D4', branch: 'WAJ Kitchen › Walk in Cooler 1', code: 'KWLOC-9' }, AT);
  expect(withBranch).toContain('WAJ Kitchen');
  const without = generateLocationZPL({ name: 'D4', code: 'KWLOC-9' }, AT);
  expect(without).not.toContain('WAJ Kitchen');
});

test('ZPL control characters in a place name cannot break the label', () => {
  // A location literally named with ^ or ~ would otherwise end the field and
  // print garbage — or run commands.
  const z = generateLocationZPL({ name: 'Bay ^A0 ~JA rack', code: 'KWLOC-7' }, AT);
  expect(z).toContain('Bay \\^A0 \\~JA rack');
  // Exactly the three fields WE emit — QR, name, code. A ^ that survived
  // unescaped would open a fourth and print garbage, or run a command.
  expect((z.match(/\^FD/g) || []).length).toBe(3);
});

test('every field is opened and closed', () => {
  const z = generateLocationZPL({ name: 'Walk in Cooler 1', branch: 'WAJ Kitchen', code: 'KWLOC-25' }, AT);
  expect((z.match(/\^FO/g) || []).length).toBe((z.match(/\^FS/g) || []).length);
});

test('a tiny label still produces a scannable QR and readable text', () => {
  const z = generateLocationZPL({ name: 'D1', code: 'KWLOC-2' }, { widthMm: 57, heightMm: 32 });
  const mag = Number(z.match(/\^BQN,2,(\d+)/)![1]);
  expect(mag).toBeGreaterThanOrEqual(2);      // below 2 a QR stops scanning reliably
  const fonts = [...z.matchAll(/\^A0N,(\d+),(\d+)/g)].map((m) => Number(m[1]));
  expect(Math.min(...fonts)).toBeGreaterThanOrEqual(12);
});

test('an A4 sheet does not blow the QR up to absurd size', () => {
  const z = generateLocationZPL({ name: 'WAJ Kitchen', code: 'KWLOC-1' }, { widthMm: 210, heightMm: 297 });
  const mag = Number(z.match(/\^BQN,2,(\d+)/)![1]);
  expect(mag).toBeLessThanOrEqual(10);        // the ^BQ ceiling
});

test('nothing is positioned outside the label', () => {
  const z = generateLocationZPL({ name: 'A very long drawer name that wraps', branch: 'A › B › C', code: 'KWLOC-99' }, AT);
  const W = 600, H = 400;
  for (const m of z.matchAll(/\^FO(\d+),(\d+)/g)) {
    expect(Number(m[1])).toBeLessThan(W);
    expect(Number(m[2])).toBeLessThan(H);
  }
});
