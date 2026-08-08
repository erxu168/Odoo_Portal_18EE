import { test, expect } from '@playwright/test';
import { explainPrintFailure, printFailure } from '../src/lib/print-errors';

/**
 * WHAT A FAILED LABEL TELLS THE PERSON HOLDING THE PRINTER.
 *
 * The whole point of this module is that "Print failed for label 1" sent
 * someone back to a printer with no idea what to do. So the thing worth
 * pinning is not the wording — it is that each distinct cause routes to the
 * remedy that actually fixes it, and that a RETRIED failure (which carries two
 * messages glued together) routes on the one that names a fixable cause rather
 * than on whichever appears first in the string.
 */

test('a retried failure routes on the permission problem, not the socket noise', () => {
  // Exactly the shape printNative builds when the write dies and the reconnect
  // is then refused. The socket words come FIRST; the fixable cause is second.
  const raw = 'Write failed: Broken pipe (reconnect also failed: Bluetooth permission denied: nearby devices)';
  const out = explainPrintFailure(raw);
  expect(out).toContain('Permissions');
  expect(out).not.toContain('went to sleep');
});

test('a retried failure routes on Bluetooth being off, not the socket noise', () => {
  const raw = 'socket closed (reconnect also failed: Bluetooth is turned off. Enable it in Settings.)';
  const out = explainPrintFailure(raw);
  expect(out).toContain('Turn it on');
  expect(out).not.toContain('out of range');
});

test('a plain dead socket still says wake it up', () => {
  const out = explainPrintFailure('Write failed: Broken pipe');
  expect(out).toContain('went to sleep');
  expect(out).toContain('Broken pipe');   // the raw text survives for a bug report
});

test('an uncertain delivery never says "just print it again"', () => {
  // THE ONE THAT MATTERS: we cannot tell whether the label came out, and a
  // blind retry would put a second sticker with the SAME LOT NUMBER on a
  // second tub. It must send them to look at the printer first.
  const out = explainPrintFailure('[delivery-uncertain] Write failed: Broken pipe');
  expect(out).toContain('LOOK AT THE PRINTER');
  expect(out).toContain('may or may not');
  // and it must not leak the internal marker onto a kitchen screen
  expect(out).not.toContain('[delivery-uncertain]');
});

test('a browser that cannot carry the label points at the Android app', () => {
  const out = explainPrintFailure('NotSupportedError: GATT Error: attribute length invalid.');
  expect(out).toContain('Krawings app');
});

test('no reason at all is still actionable', () => {
  for (const empty of [null, undefined, '']) {
    const out = explainPrintFailure(empty);
    expect(out).toContain('tap Print again');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('null');
  }
});

test('a numbered label names itself and keeps the reason', () => {
  const out = printFailure(3, 'Write failed: Broken pipe');
  expect(out).toContain('Label 3');
  expect(out).toContain('went to sleep');
});
