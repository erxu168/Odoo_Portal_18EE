import { test, expect } from '@playwright/test';

/**
 * The measurements below are taken from a real Android screenshot of the Shift
 * Handover "Add to the log" sheet, where the first version of this shipped
 * broken: the note box showed one line of text and the rest sat behind the
 * "Post to the log" button.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const kv = require('../src/lib/keyboard-visibility');

const MARGIN = 16;

// Phone, keyboard open. The sheet ends where the keyboard starts.
const VIEWPORT = { top: 0, bottom: 1270 };
// The sheet's SCROLLING BODY. Its footer (the green button) occupies
// 1090..1270, so the body stops at 1090 — well above the keyboard.
const SHEET_BODY = { top: 340, bottom: 1090 };
// The note textarea as it sat, unscrolled: one line peeking above the footer.
const NOTE = { top: 962, bottom: 1382 };

test('a field behind the sheet footer is moved, not just clear of the keyboard', () => {
  const withFooter = kv.scrollNeededFor(NOTE, VIEWPORT, SHEET_BODY, MARGIN);
  // Measuring against the viewport alone asks for far too little — that is the
  // bug: 128px of scroll leaves the box behind the button.
  const viewportOnly = kv.scrollNeededFor(NOTE, VIEWPORT, null, MARGIN);

  expect(viewportOnly.delta).toBe(1382 - (1270 - MARGIN));   // 128
  expect(withFooter.delta).toBe(1382 - (1090 - MARGIN));     // 308
  expect(withFooter.delta).toBeGreaterThan(viewportOnly.delta);

  // After scrolling, the whole box clears the footer.
  const moved = { top: NOTE.top - withFooter.delta, bottom: NOTE.bottom - withFooter.delta };
  expect(moved.bottom).toBeLessThanOrEqual(SHEET_BODY.bottom - MARGIN);
  expect(moved.top).toBeGreaterThan(SHEET_BODY.top);          // label above it still visible
});

test('a field that is already clear is never moved', () => {
  const high = { top: 400, bottom: 520 };
  expect(kv.scrollNeededFor(high, VIEWPORT, SHEET_BODY, MARGIN).delta).toBe(0);
  // Exactly on the margin counts as clear.
  const exact = { top: 900, bottom: SHEET_BODY.bottom - MARGIN };
  expect(kv.scrollNeededFor(exact, VIEWPORT, SHEET_BODY, MARGIN).delta).toBe(0);
});

test('a control taller than its space keeps its top rather than revealing its bottom', () => {
  // 900px of textarea in ~750px of body: scrolling far enough to show the end
  // would push the start off, so the scroll is capped by the headroom.
  const tall = { top: 360, bottom: 1260 };
  const { delta } = kv.scrollNeededFor(tall, VIEWPORT, SHEET_BODY, MARGIN);
  expect(delta).toBe(360 - (SHEET_BODY.top + MARGIN));  // = headroom, not the full overflow
  expect(tall.top - delta).toBe(SHEET_BODY.top + MARGIN);
});

test('with no scroll container the viewport is the whole story', () => {
  const { visibleBottom, delta } = kv.scrollNeededFor(NOTE, VIEWPORT, null, MARGIN);
  expect(visibleBottom).toBe(1270);
  expect(delta).toBeGreaterThan(0);
});

test('a scroller taller than the viewport is still bounded by the keyboard', () => {
  // Full-screen scrolling page: the keyboard, not the container, is the limit.
  const page = { top: 0, bottom: 4000 };
  const { visibleBottom } = kv.scrollNeededFor(NOTE, VIEWPORT, page, MARGIN);
  expect(visibleBottom).toBe(VIEWPORT.bottom);
});
