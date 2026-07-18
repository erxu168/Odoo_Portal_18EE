import { test, expect } from '@playwright/test';
import { minimumWageForDate, roundCents, shiftLabourCost } from '../src/lib/shift-labour-cost';

test('minimumWageForDate follows the BMAS schedule by date', () => {
  expect(minimumWageForDate('2026-07-18')).toBe(13.9);
  expect(minimumWageForDate('2026-01-01')).toBe(13.9);
  expect(minimumWageForDate('2025-12-31')).toBe(12.82);
  expect(minimumWageForDate('2027-01-01')).toBe(14.6);
  expect(minimumWageForDate('2028-06-01')).toBe(14.6); // beyond last step → latest known
  expect(minimumWageForDate('2024-05-01')).toBe(12.82); // before first step → earliest known
});

test('shiftLabourCost applies the AG percentage and rounds to cents', () => {
  // 8h × €20 × 1.21 = €193.60
  expect(shiftLabourCost(8, 20, 21)).toBe(193.6);
  // 4h × €13.90 × 1.30 = €72.28
  expect(shiftLabourCost(4, 13.9, 30)).toBe(72.28);
  // 0% AG → plain wage cost
  expect(shiftLabourCost(5, 15, 0)).toBe(75);
  // Floating-point .5-cent boundary: 0.5h × €15 × 1.21 = €9.075 → €9.08 (not 9.07)
  expect(shiftLabourCost(0.5, 15, 21)).toBe(9.08);
});

test('roundCents rounds half up to two decimals', () => {
  expect(roundCents(72.275)).toBe(72.28);
  expect(roundCents(10)).toBe(10);
  expect(roundCents(0.1 + 0.2)).toBe(0.3);
});
