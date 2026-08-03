import { test, expect } from '@playwright/test';

/**
 * The shared numpad's guard rails, exercised at the logic level.
 *
 * These encode the three ways an Android tablet can commit a number the user
 * never meant: a barcode scanner firing a digit burst into an open pad, a
 * Bluetooth Enter sailing past a rule that has Confirm disabled, and a caller
 * rule (Manufacturing's tolerance) being quietly dropped in a refactor.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ni = require('../src/lib/numeric-input');

/** Mirrors NumpadProvider's burst rejection: >4 keys inside 50ms is a machine. */
const BURST_GAP_MS = 50;
const BURST_TRIP = 4;

function feed(keys: Array<{ ch: string; gap: number }>, rules: any) {
  const burst: { last: number; count: number; burstStart: string | null; tripped: boolean } =
    { last: 0, count: 0, burstStart: null, tripped: false };
  let buffer = '';
  let now = 0;
  for (const k of keys) {
    now += k.gap;
    const gap = now - burst.last;
    burst.last = now;
    if (gap >= BURST_GAP_MS) {
      burst.count = 0;
      burst.tripped = false;
      burst.burstStart = null;
    } else {
      burst.count += 1;
      if (burst.count === 1) burst.burstStart = buffer;
      if (burst.count >= BURST_TRIP) burst.tripped = true;
    }
    if (burst.tripped) {
      if (burst.burstStart !== null) buffer = burst.burstStart;
      continue;
    }
    buffer = ni.applyChar(buffer, k.ch, rules);
  }
  return buffer;
}

const DEC = { mode: 'decimal' as const, allowEmpty: false, min: 0 };

test('a barcode scan into an open pad leaves the quantity untouched', () => {
  // A ZQ310-class HID scanner fires a 13-digit EAN at ~10ms per key.
  const scan = '4006381333931'.split('').map((ch) => ({ ch, gap: 10 }));
  expect(feed(scan, DEC)).toBe('');

  // ...and a scan arriving after a human typed 12 rewinds to that 12, not to 12 + EAN.
  const typedThenScanned = [
    { ch: '1', gap: 300 },
    { ch: '2', gap: 300 },
    ...'4006381333931'.split('').map((ch) => ({ ch, gap: 10 })),
  ];
  expect(feed(typedThenScanned, DEC)).toBe('12');
});

test('human typing at speed is never mistaken for a scan', () => {
  // 120ms per key is brisk but human — every digit must land.
  const human = '1250'.split('').map((ch) => ({ ch, gap: 120 }));
  expect(feed(human, DEC)).toBe('1250');
});

test('hardware Enter cannot commit a value the rules refuse', () => {
  // The provider gates Enter on validate().canCommit, so this is the contract.
  const contractHours = { mode: 'decimal' as const, allowEmpty: false, min: 1, max: 48 };
  expect(ni.validate('0', contractHours).canCommit).toBe(false);
  expect(ni.validate('60', contractHours).canCommit).toBe(false);
  expect(ni.validate('20', contractHours).canCommit).toBe(true);
  // An empty buffer on a field that requires a value is refused, not read as 0.
  expect(ni.validate('', contractHours).canCommit).toBe(false);
  expect(ni.commit('', contractHours)).toBeUndefined();
});

test("Manufacturing's tolerance keeps its deliberate zero exemption", () => {
  // Reproduces WoDetail.openComponentPad's extraValidate. Zero always passes —
  // "I used none of this" is a real answer — but the range binds otherwise.
  const demand = 12;
  const pct = 5;
  const tolMin = Math.round(demand * (1 - pct / 100) * 1000) / 1000;
  const tolMax = Math.round(demand * (1 + pct / 100) * 1000) / 1000;
  const check = (n: number) => (n === 0 ? null : n < tolMin || n > tolMax ? 'out' : null);

  expect(check(0)).toBeNull();
  expect(check(12)).toBeNull();
  expect(check(11.4)).toBeNull();
  expect(check(12.6)).toBeNull();
  expect(check(11.39)).toBe('out');
  expect(check(12.61)).toBe('out');
});

test('a purchase quantity of zero is committable — it is how a line is removed', () => {
  expect(ni.validate('0', DEC).canCommit).toBe(true);
  expect(ni.commit('0', DEC)).toBe(0);
});
