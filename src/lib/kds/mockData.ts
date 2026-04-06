/**
 * KDS mock data — 7 seed orders matching the mockup.
 * Random order generator for development simulation.
 */
import type { KdsOrder } from '@/types/kds';

export function createSeedOrders(): KdsOrder[] {
  return [
    {
      id: 1, table: 'T5', type: 'Dine-in', waitMin: 14, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'a1', name: 'Jerk Chicken', qty: 1, note: 'Extra spicy', done: false },
        { id: 'a2', name: 'Festival', qty: 2, done: false },
        { id: 'a3', name: 'Coleslaw', qty: 1, done: false },
      ],
    },
    {
      id: 2, table: 'T3', type: 'Dine-in', waitMin: 11, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'b1', name: 'Curry Goat', qty: 1, done: false },
        { id: 'b2', name: 'Rice & Peas', qty: 1, done: false },
        { id: 'b3', name: 'Plantain', qty: 1, done: false },
        { id: 'b4', name: 'Festival', qty: 1, done: false },
      ],
    },
    {
      id: 3, table: '#38', type: 'Takeaway', waitMin: 6, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'c1', name: 'Jerk Chicken', qty: 2, done: false },
        { id: 'c2', name: 'Rice & Peas', qty: 2, done: false },
        { id: 'c3', name: 'Coleslaw', qty: 2, done: false },
      ],
    },
    {
      id: 4, table: 'T8', type: 'Dine-in', waitMin: 7, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'd1', name: 'Jerk Chicken', qty: 1, done: false },
        { id: 'd2', name: 'Rice & Peas', qty: 1, done: false },
        { id: 'd3', name: 'Plantain', qty: 2, done: false },
      ],
    },
    {
      id: 5, table: '#42', type: 'Takeaway', waitMin: 3, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'e1', name: 'Jerk Pork', qty: 1, done: false },
        { id: 'e2', name: 'Festival', qty: 2, done: false },
        { id: 'e3', name: 'Coleslaw', qty: 1, done: false },
      ],
    },
    {
      id: 6, table: 'T1', type: 'Dine-in', waitMin: 3, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'f1', name: 'Oxtail', qty: 1, done: false },
        { id: 'f2', name: 'Rice & Peas', qty: 1, done: false },
        { id: 'f3', name: 'Plantain', qty: 1, done: false },
      ],
    },
    {
      id: 7, table: 'T9', type: 'Dine-in', waitMin: 1, status: 'prep', readyAt: null, doneAt: null,
      items: [
        { id: 'g1', name: 'Curry Goat', qty: 1, done: false },
        { id: 'g2', name: 'Festival', qty: 1, done: false },
        { id: 'g3', name: 'Jerk Chicken', qty: 2, note: 'No sauce', done: false },
      ],
    },
  ];
}

const DISHES = ['Jerk Chicken', 'Jerk Pork', 'Festival', 'Curry Goat', 'Rice & Peas', 'Plantain', 'Oxtail', 'Coleslaw'];

export function generateRandomOrder(nextId: number): KdsOrder {
  const numItems = 2 + Math.floor(Math.random() * 3);
  const items: KdsOrder['items'] = [];
  const used = new Set<string>();
  for (let i = 0; i < numItems; i++) {
    let dish: string;
    do { dish = DISHES[Math.floor(Math.random() * DISHES.length)]; } while (used.has(dish));
    used.add(dish);
    items.push({ id: `n${nextId}_${i}`, name: dish, qty: 1 + Math.floor(Math.random() * 2), done: false });
  }
  const isTakeaway = Math.random() > 0.7;
  return {
    id: nextId,
    table: isTakeaway ? `#${40 + nextId}` : `T${10 + nextId}`,
    type: isTakeaway ? 'Takeaway' : 'Dine-in',
    waitMin: 0,
    status: 'prep',
    readyAt: null,
    doneAt: null,
    items,
  };
}
