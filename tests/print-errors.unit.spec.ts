import { test, expect } from '@playwright/test';
import { explainPrintFailure, printFailure, namedPrintFailure, isDeliveryUncertain } from '../src/lib/print-errors';

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
  expect(out).toContain('same lot number');
  // and it must not leak the internal marker onto a kitchen screen
  expect(out).not.toContain('[delivery-uncertain]');
});

test('the uncertain message promises no reconnect it cannot deliver', () => {
  // The native path reconnects before saying this; Web Bluetooth does not.
  // One shared sentence must not claim both. (Codex re-review of de32d7b8.)
  const out = explainPrintFailure('[delivery-uncertain] NetworkError: GATT operation failed');
  expect(out).not.toContain('re-established');
  expect(out).not.toContain('reconnected');
});

test('uncertainty outranks every other route', () => {
  // A dropped link during a permission-flavoured failure is still uncertain:
  // "check the printer" must win over "go fix your permissions".
  const out = explainPrintFailure('[delivery-uncertain] Write failed: permission denied');
  expect(out).toContain('LOOK AT THE PRINTER');
});

test('isDeliveryUncertain reads the marker, and nothing else does', () => {
  expect(isDeliveryUncertain('[delivery-uncertain] boom')).toBe(true);
  expect(isDeliveryUncertain('Write failed: Broken pipe')).toBe(false);
  expect(isDeliveryUncertain(null)).toBe(false);
  expect(isDeliveryUncertain(undefined)).toBe(false);
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

test('a batch line never CLAIMS a label did not print when it cannot know', () => {
  // "did not print" is what sends someone back to print a duplicate.
  const certain = printFailure(2, 'Write failed: Broken pipe');
  expect(certain).toContain('Label 2 did not print');

  const unsure = printFailure(2, '[delivery-uncertain] Write failed: Broken pipe');
  expect(unsure).toContain('Label 2 may not have printed');
  expect(unsure).not.toContain('did not print');
});

test('the named variant follows the same rule', () => {
  expect(namedPrintFailure('Container 3', 'Write failed: Broken pipe'))
    .toContain('Container 3 did not print');
  expect(namedPrintFailure('Container 3', '[delivery-uncertain] boom'))
    .toContain('Container 3 may not have printed');
});

test('a network failure does not send anyone to the printer', () => {
  // The label never got MADE. Telling someone to wake a printer that is
  // sitting there ready is a wild goose chase. (Codex round 4.)
  for (const raw of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    const out = explainPrintFailure(raw);
    expect(out).toContain('wifi');
    expect(out).toContain('printer is not the problem');
    expect(out).not.toContain('refused the label');
  }
});
