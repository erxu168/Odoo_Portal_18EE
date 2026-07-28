import { test, expect } from '@playwright/test';
import { matchesProfileSearch } from '../src/components/cooktimer/setup/utils';

// A cook profile has TWO names: the one shown to cooks and the dish's real name
// on the till. Setup search must find either.
const fries = { name: 'Fries', productName: 'French Fries' };
const jerk = { name: 'Jerk Chicken', productName: 'Smokey Boneless Jerk Chicken' };
const unlinked = { name: 'Mac & Cheese', productName: null };

test('an empty query matches everything', () => {
  for (const q of ['', '   ']) {
    expect(matchesProfileSearch(fries, q)).toBe(true);
    expect(matchesProfileSearch(unlinked, q)).toBe(true);
  }
});

test('matches the name shown to cooks (existing behaviour kept)', () => {
  expect(matchesProfileSearch(fries, 'Fries')).toBe(true);
  expect(matchesProfileSearch(jerk, 'Jerk Chicken')).toBe(true);
  expect(matchesProfileSearch(unlinked, 'Mac')).toBe(true);
});

test('ALSO matches the till name — the point of this change', () => {
  // "Smokey" appears only on the till, not in the cook-facing name.
  expect(matchesProfileSearch(jerk, 'Smokey')).toBe(true);
  expect(matchesProfileSearch(jerk, 'Boneless')).toBe(true);
  expect(matchesProfileSearch(fries, 'French')).toBe(true);
});

test('is case-insensitive and trims the query on both names', () => {
  expect(matchesProfileSearch(jerk, '  sMoKeY  ')).toBe(true);
  expect(matchesProfileSearch(fries, 'FRENCH')).toBe(true);
  expect(matchesProfileSearch(fries, '  fries ')).toBe(true);
});

test('matches a substring anywhere, not just the start', () => {
  expect(matchesProfileSearch(jerk, 'ness Jerk')).toBe(false); // not a real substring
  expect(matchesProfileSearch(jerk, 'less Jerk')).toBe(true);  // "…Boneless Jerk…"
});

test('a dish with no till name still searches by its cook name and never throws', () => {
  expect(matchesProfileSearch(unlinked, 'Cheese')).toBe(true);
  expect(matchesProfileSearch(unlinked, 'French')).toBe(false);
  expect(matchesProfileSearch({ name: 'X' }, 'x')).toBe(true); // productName absent entirely
});

test('a non-matching query matches neither name', () => {
  expect(matchesProfileSearch(fries, 'plantain')).toBe(false);
  expect(matchesProfileSearch(jerk, 'plantain')).toBe(false);
});
