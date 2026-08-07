import { test, expect } from '@playwright/test';
import { parseDrawings, serializeDrawings, distanceToShape, shapeHandles, translateShape, MAX_DRAWING_TEXT, type GuideDrawing } from '@/lib/guide-drawings';

/**
 * Warning stamps and text labels, round-tripped.
 *
 * The client and the Odoo validator must agree on every one of these — the
 * annotated-photo standard says so, and a disagreement here means a mark that
 * saves and then vanishes (or the reverse).
 */
test('a warning stamp round-trips and a text label keeps its words', () => {
  const marks: GuideDrawing[] = [
    { type: 'warning', color: '#DC2626', width: 4, points: [[0.5, 0.25]] },
    { type: 'text', color: '#FFFFFF', width: 2, points: [[0.1, 0.9]], text: 'Hot surface' },
  ];
  const back = parseDrawings(serializeDrawings(marks));
  expect(back).toHaveLength(2);
  expect(back[0].type).toBe('warning');
  expect(back[0].points).toEqual([[0.5, 0.25]]);
  expect(back[1].text).toBe('Hot surface');
});

test('a label with no words is dropped rather than stored invisibly', () => {
  const raw = JSON.stringify([{ type: 'text', color: '#DC2626', width: 2, points: [[0.5, 0.5]], text: '   ' }]);
  expect(parseDrawings(raw)).toHaveLength(0);
});

test('a stamp with two points is refused — it is one anchor, not a drag', () => {
  const raw = JSON.stringify([{ type: 'warning', color: '#DC2626', width: 2, points: [[0.1, 0.1], [0.9, 0.9]] }]);
  expect(parseDrawings(raw)).toHaveLength(0);
});

test('words are capped and newlines flattened, because every one is copied onto every daily list', () => {
  const long = 'x'.repeat(MAX_DRAWING_TEXT + 50);
  const marks: GuideDrawing[] = [{ type: 'text', color: '#DC2626', width: 2, points: [[0.5, 0.5]], text: `a\nb ${long}` }];
  const back = parseDrawings(serializeDrawings(marks));
  expect(back[0].text!.length).toBeLessThanOrEqual(MAX_DRAWING_TEXT);
  expect(back[0].text).not.toContain('\n');
});

test('a stamp is grabbable near its point, has no stretch handles, and moves as a whole', () => {
  const s: GuideDrawing = { type: 'warning', color: '#DC2626', width: 3, points: [[0.5, 0.5]] };
  expect(distanceToShape(s, 0.51, 0.51)).toBe(0);          // within the finger floor
  expect(distanceToShape(s, 0.9, 0.9)).toBeGreaterThan(0.1);
  expect(shapeHandles(s)).toEqual([]);                      // nothing to stretch
  expect(translateShape(s, 0.2, -0.1).points[0]).toEqual([0.7, 0.4]);
});

test('a text mark keeps its words when moved', () => {
  const s: GuideDrawing = { type: 'text', color: '#DC2626', width: 2, points: [[0.2, 0.2]], text: 'Mind the gap' };
  expect(translateShape(s, 0.1, 0.1).text).toBe('Mind the gap');
});
