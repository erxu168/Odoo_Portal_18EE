import { test, expect } from '@playwright/test';
import { parEntryFactor, parToEntry, parToBase } from '../src/lib/crate-units';

// Par is STORED in base units, but a measure-based product counted in packs
// ("1 can = 0.28 kg") is ENTERED and SHOWN in packs. These helpers are the one
// conversion both the product page and the counting session use.

test('measure base counted in packs converts; everything else is factor 1', () => {
  expect(parEntryFactor('kg', 0.28)).toBe(0.28);      // canned beans: kg counted in cans
  expect(parEntryFactor('L', 0.7)).toBe(0.7);         // spirits: litres counted in bottles
  expect(parEntryFactor('Units', 24)).toBe(1);        // cola: base IS bottles, crate is just a bundle
  expect(parEntryFactor('kg', null)).toBe(1);         // flour: kg, no pack — typed in kg
  expect(parEntryFactor('kg', 0)).toBe(1);            // a zero pack size must never divide
  expect(parEntryFactor('', undefined)).toBe(1);
});

test('typed packs round-trip through stored base units exactly', () => {
  const f = parEntryFactor('kg', 0.28);
  const stored = parToBase(12, f);                    // manager types 12 cans
  expect(stored).toBe(3.36);                          // stored as kg, no float dust
  expect(parToEntry(stored, f)).toBe(12);             // shows as 12 cans again
});

test('a legacy kg par displays as sensible packs (2dp)', () => {
  // Par saved as 5 kg before the product got its can size.
  expect(parToEntry(5, parEntryFactor('kg', 0.28))).toBe(17.86);
});

test('factor 1 changes nothing in either direction', () => {
  expect(parToBase(12, 1)).toBe(12);
  expect(parToEntry(3.36, 1)).toBe(3.36);
});

test('float-dust factors stay clean both ways', () => {
  const f = parEntryFactor('kg', 0.1);
  expect(parToBase(3, f)).toBe(0.3);                  // 3 * 0.1 === 0.30000000000000004 raw
  expect(parToEntry(0.3, f)).toBe(3);
});

test('a non-positive factor is treated as 1, never divides by zero', () => {
  expect(parToEntry(3.36, 0)).toBe(3.36);
  expect(parToBase(3.36, 0)).toBe(3.36);
});
