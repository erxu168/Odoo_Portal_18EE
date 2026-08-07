import { test, expect } from '@playwright/test';
import { visibleLines, productIdOf } from '../src/lib/kds/visible-lines';

/**
 * Drinks at What a Jerk are self-service — the guest takes the bottle from the
 * fridge. Ethan, 2026-08-07: "currently, it displays also drinks but drinks
 * dont need to be displayed as it's self service".
 *
 * The manager unticks a menu category in KDS Settings; those products then never
 * reach the kitchen. Real IDs below: Ting Grapefruit Soda (979) and Club Mate
 * (1664) sit in pos.category 195 "WAJ Drinks"; Jerk Chicken stands in for food.
 */

const TING = 979;
const CLUB_MATE = 1664;
const FOOD = 1500;

const DRINKS = new Set([TING, CLUB_MATE]);

function line(productId: number | unknown, name: string) {
  return { id: Math.random(), product_id: productId, full_product_name: name, qty: 1 };
}

test('drink lines are dropped, food lines stay', () => {
  const lines = [
    line([FOOD, 'Jerk Chicken'], 'Jerk Chicken'),
    line([TING, 'Ting Grapefruit Soda 0,33l'], 'Ting'),
    line([CLUB_MATE, 'Club Mate 0,5L'], 'Club Mate'),
  ];
  const kept = visibleLines(lines, DRINKS);
  expect(kept.map(l => l.full_product_name)).toEqual(['Jerk Chicken']);
});

test('an order of nothing but drinks is left with no lines, so the KDS drops it', () => {
  const lines = [line([TING, 'Ting'], 'Ting'), line([CLUB_MATE, 'Club Mate'], 'Club Mate')];
  expect(visibleLines(lines, DRINKS)).toHaveLength(0);
});

test('an empty hidden set keeps everything — nothing ticked means nothing hidden', () => {
  const lines = [line([FOOD, 'Jerk Chicken'], 'Jerk Chicken'), line([TING, 'Ting'], 'Ting')];
  expect(visibleLines(lines, new Set())).toHaveLength(2);
});

test('FAIL-SAFE: a failed Odoo lookup yields an empty set, so the kitchen still sees its food', () => {
  // getHiddenProductIds resolves to an empty Set on error — that must never
  // blank the board. Losing a burger is far worse than showing a beer.
  const lines = [line([FOOD, 'Jerk Chicken'], 'Jerk Chicken')];
  expect(visibleLines(lines, new Set())).toHaveLength(1);
});

test('FAIL-SAFE: a line with no resolvable product is kept, not silently dropped', () => {
  const lines = [line(false, 'Mystery line'), line(undefined, 'Another')];
  expect(visibleLines(lines, DRINKS)).toHaveLength(2);
});

test('product_id is read from Odoo many2one [id, name] and from a bare id', () => {
  expect(productIdOf([TING, 'Ting Grapefruit Soda 0,33l'])).toBe(TING);
  expect(productIdOf(TING)).toBe(TING);
  expect(productIdOf(false)).toBeNull();
  expect(productIdOf(undefined)).toBeNull();
});

test('the filter does not mutate the caller’s lines', () => {
  const lines = [line([FOOD, 'Jerk Chicken'], 'Jerk Chicken'), line([TING, 'Ting'], 'Ting')];
  visibleLines(lines, DRINKS);
  expect(lines).toHaveLength(2);
});
