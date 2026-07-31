import { test, expect } from '@playwright/test';
import { pluralizePack } from '../src/lib/crate-units';

// Managers type the pack word themselves, and they type "units" as readily as
// "unit". A word already ending in s must come back untouched — the screens
// were showing "1 can = 0.28 unitses".

test('a word already ending in s is left alone', () => {
  expect(pluralizePack('units', 2)).toBe('units');
  expect(pluralizePack('pieces', 2)).toBe('pieces');
  expect(pluralizePack('cans', 3)).toBe('cans');
});

test('normal singulars still pluralize', () => {
  expect(pluralizePack('crate', 2)).toBe('crates');
  expect(pluralizePack('box', 2)).toBe('boxes');
  expect(pluralizePack('bunch', 2)).toBe('bunches');
  expect(pluralizePack('glass', 2)).toBe('glasses');
  expect(pluralizePack('tray', 2)).toBe('trays');
  expect(pluralizePack('canister', 2)).toBe('canisters');
});

test('one of anything keeps its own word', () => {
  expect(pluralizePack('box', 1)).toBe('box');
  expect(pluralizePack('units', 1)).toBe('units');
});
