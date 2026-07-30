import { test, expect } from '@playwright/test';
import { announceChange, onRecordChange, removedIds } from '../src/lib/record-events';
import { isExpanded, toggleExpanded, expandAll, collapseAll, expandedCount, revealPath, setExpanded } from '../src/lib/tree-expansion';

/**
 * Ethan, 2026-07-30: "i click on delete and then i get out of the location and
 * what i expect would be that the location is gone from the current view, but it
 * stays. only when i refresh the page, the location is gone."
 *
 * The cause: the detail page navigated back, Next served the CACHED list route
 * with its React state intact, and nothing told that state the row had gone.
 * These pin the signal that fixes it.
 */

test('a delete reaches a listener', () => {
  const heard: number[] = [];
  const off = onRecordChange('location', (c) => heard.push(c.id));
  announceChange({ kind: 'location', verb: 'deleted', id: 42 });
  off();
  expect(heard).toEqual([42]);
});

test('THE CASCADE: deleting a room reports its shelves too', () => {
  // A list told only about the room keeps rendering children of something gone.
  let change: any = null;
  const off = onRecordChange('location', (c) => { change = c; });
  announceChange({ kind: 'location', verb: 'deleted', id: 10, alsoAffected: [11, 12, 13] });
  off();
  expect(removedIds(change)).toEqual([10, 11, 12, 13]);
});

test('unsubscribing actually stops delivery', () => {
  const heard: number[] = [];
  const off = onRecordChange('product', (c) => heard.push(c.id));
  off();
  announceChange({ kind: 'product', verb: 'deleted', id: 1 });
  expect(heard).toEqual([]);
});

test('a listener that throws does not silence the others', () => {
  const heard: string[] = [];
  const offA = onRecordChange('location', () => { throw new Error('boom'); });
  const offB = onRecordChange('location', () => heard.push('B'));
  announceChange({ kind: 'location', verb: 'deleted', id: 5 });
  offA(); offB();
  expect(heard, 'the second list must still be told').toEqual(['B']);
});

test('kinds are isolated — a product delete does not disturb location lists', () => {
  const heard: string[] = [];
  const off = onRecordChange('location', () => heard.push('loc'));
  announceChange({ kind: 'product', verb: 'deleted', id: 1 });
  off();
  expect(heard).toEqual([]);
});

test('only removals produce removed ids', () => {
  expect(removedIds({ kind: 'location', verb: 'updated', id: 1, alsoAffected: [2] })).toEqual([]);
  expect(removedIds({ kind: 'location', verb: 'archived', id: 1 })).toEqual([1]);
});

test('unsubscribing DURING delivery does not skip the next listener', () => {
  // The set is snapshotted before iterating; mutating it mid-loop otherwise
  // silently drops whoever came next.
  const heard: string[] = [];
  let offA: () => void = () => {};
  offA = onRecordChange('list', () => { heard.push('A'); offA(); });
  const offB = onRecordChange('list', () => heard.push('B'));
  announceChange({ kind: 'list', verb: 'deleted', id: 1 });
  offB();
  expect(heard).toEqual(['A', 'B']);
});

/* --- collapse state: session-only, by design ------------------------------- */

test('branches start CLOSED — that is the overview Ethan asked for', () => {
  collapseAll('t1');
  expect(isExpanded('t1', 5)).toBe(false);
});

test('toggling opens then closes', () => {
  collapseAll('t2');
  expect(toggleExpanded('t2', 5)).toBe(true);
  expect(isExpanded('t2', 5)).toBe(true);
  expect(toggleExpanded('t2', 5)).toBe(false);
  expect(isExpanded('t2', 5)).toBe(false);
});

test('scopes are independent — a picker sheet opens on its own terms', () => {
  collapseAll('a'); collapseAll('b');
  setExpanded('a', 7, true);
  expect(isExpanded('a', 7)).toBe(true);
  expect(isExpanded('b', 7)).toBe(false);
});

test('expand all, then collapse all', () => {
  collapseAll('t3');
  expandAll('t3', [1, 2, 3]);
  expect(expandedCount('t3')).toBe(3);
  collapseAll('t3');
  expect(expandedCount('t3')).toBe(0);
});

test('a selected row is never hidden behind closed parents', () => {
  // shelf 3 inside cabinet 2 inside room 1
  collapseAll('t4');
  const parentOf = (id: number) => ({ 3: 2, 2: 1, 1: null } as Record<number, number | null>)[id];
  revealPath('t4', 3, parentOf);
  expect(isExpanded('t4', 2)).toBe(true);
  expect(isExpanded('t4', 1)).toBe(true);
});

test('a cycle in the tree cannot hang the screen', () => {
  collapseAll('t5');
  const parentOf = (id: number) => (id === 1 ? 2 : 1);   // 1 -> 2 -> 1 -> ...
  revealPath('t5', 1, parentOf);                          // bounded, must return
  expect(expandedCount('t5')).toBeGreaterThan(0);
});

test('the store is plain memory — nothing is written to a browser storage', () => {
  // The whole point of the design: sessionStorage survives a RELOAD, which is
  // exactly what Ethan did not want ("whenver i reload the browser then it
  // should start from the top"). If this module ever reaches for a storage, this
  // fails — there is no storage available in this environment at all.
  collapseAll('t6');
  setExpanded('t6', 1, true);
  expect(typeof globalThis.sessionStorage).toBe('undefined');
  expect(isExpanded('t6', 1)).toBe(true);
});
