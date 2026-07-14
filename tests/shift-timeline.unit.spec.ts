import { test, expect } from '@playwright/test';
import { computeSweep, minutesToHHMM, snapTo } from '../src/lib/shift-timeline';

test('snapTo rounds to 15-min', () => {
  expect(snapTo(607)).toBe(600); // 10:07 → 10:00
  expect(snapTo(613)).toBe(615); // 10:13 → 10:15
});

test('minutesToHHMM formats + wraps midnight', () => {
  expect(minutesToHHMM(630)).toBe('10:30');
  expect(minutesToHHMM(1440)).toBe('00:00');
  expect(minutesToHHMM(1410)).toBe('23:30');
});

test('forward drag: ordered + snapped', () => {
  expect(computeSweep(607, 847, 0, 1440)).toEqual({ startMin: 600, endMin: 840 }); // ~10 → 14
});

test('reverse drag: still ordered', () => {
  expect(computeSweep(840, 600, 0, 1440)).toEqual({ startMin: 600, endMin: 840 });
});

test('tiny drag: enforces 30-min minimum', () => {
  expect(computeSweep(600, 605, 0, 1440)).toEqual({ startMin: 600, endMin: 630 });
});

test('clamps to the window and shifts inward at the end edge', () => {
  // anchor at the very end (1440) dragging forward → window shifts back to keep 30 min
  expect(computeSweep(1440, 1440, 600, 1440)).toEqual({ startMin: 1410, endMin: 1440 });
});

test('shifts inward at the start edge', () => {
  expect(computeSweep(600, 600, 600, 1440)).toEqual({ startMin: 600, endMin: 630 });
});
