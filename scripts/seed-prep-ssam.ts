// scripts/seed-prep-ssam.ts
//
// Seed starter prep items for Ssam Kottbusser (company_id=3) and link them to
// real POS products currently visible in prep_demand_history on staging.
//
// Run with: npx tsx scripts/seed-prep-ssam.ts
//
// Idempotent: uses the same name-matching semantics as the API (UNIQUE on
// company_id+name), so re-running is safe and updates existing rows via
// ON CONFLICT DO UPDATE for links.
//
// Adjust items and multipliers in the UI afterwards — these are rough defaults.

import {
  createPrepItem,
  listPrepItems,
  upsertLink,
} from '../src/lib/prep-planner-mapping-db';

const COMPANY_ID = 3;

interface SeedItem {
  name: string;
  station: string;
  prep_type: 'advance' | 'batch' | 'ondemand';
  prep_time_min: number;
  max_holding_min: number;
  batch_size: number;
  unit: string;
  notes: string;
  links: { posId: number; posName: string; portions: number; notes?: string }[];
}

const ITEMS: SeedItem[] = [
  {
    name: 'Rice',
    station: 'pot',
    prep_type: 'batch',
    prep_time_min: 40,
    max_holding_min: 60,
    batch_size: 20,
    unit: 'portion',
    notes: 'Base side for all Korean BBQ sets and bibimbap.',
    links: [
      { posId: 559, posName: '[210] Bibimbap Entrecote Beef Bulgogi', portions: 1.5, notes: 'bibimbap bowl' },
      { posId: 356, posName: '[300] All About Beef', portions: 1 },
      { posId: 357, posName: '[301] Argentinian Entrecote', portions: 1 },
      { posId: 358, posName: '[302] US Prime Flank Steak', portions: 1 },
      { posId: 359, posName: '[303] So-Galbi', portions: 1 },
      { posId: 550, posName: '[304] Premium Entrecote Bulgogi', portions: 1 },
      { posId: 364, posName: '[320] All About Pork', portions: 1 },
      { posId: 366, posName: '[322] Pork Belly', portions: 1 },
      { posId: 368, posName: '[324] Pork Neck', portions: 1 },
      { posId: 369, posName: '[330] Curry Flavored Chicken', portions: 1 },
      { posId: 370, posName: '[331] Spicy Boneless Chicken', portions: 1 },
      { posId: 371, posName: '[332] Lamb Chops', portions: 1 },
    ],
  },
  {
    name: 'Kimchi (banchan)',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 30,
    max_holding_min: 240,
    batch_size: 30,
    unit: 'portion',
    notes: 'Fermented cabbage side served with every main.',
    links: [
      { posId: 356, posName: '[300] All About Beef', portions: 1 },
      { posId: 357, posName: '[301] Argentinian Entrecote', portions: 1 },
      { posId: 358, posName: '[302] US Prime Flank Steak', portions: 1 },
      { posId: 359, posName: '[303] So-Galbi', portions: 1 },
      { posId: 550, posName: '[304] Premium Entrecote Bulgogi', portions: 1 },
      { posId: 364, posName: '[320] All About Pork', portions: 1 },
      { posId: 366, posName: '[322] Pork Belly', portions: 1 },
      { posId: 368, posName: '[324] Pork Neck', portions: 1 },
      { posId: 369, posName: '[330] Curry Flavored Chicken', portions: 1 },
      { posId: 370, posName: '[331] Spicy Boneless Chicken', portions: 1 },
      { posId: 371, posName: '[332] Lamb Chops', portions: 1 },
      { posId: 559, posName: '[210] Bibimbap Entrecote Beef Bulgogi', portions: 1 },
    ],
  },
  {
    name: 'Bulgogi marinade',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 20,
    max_holding_min: 720,
    batch_size: 10,
    unit: 'portion',
    notes: 'Marinates beef overnight. Used in All About Beef, Bulgogi sets, bibimbap.',
    links: [
      { posId: 356, posName: '[300] All About Beef', portions: 1 },
      { posId: 357, posName: '[301] Argentinian Entrecote', portions: 1 },
      { posId: 358, posName: '[302] US Prime Flank Steak', portions: 1 },
      { posId: 550, posName: '[304] Premium Entrecote Bulgogi', portions: 1 },
      { posId: 559, posName: '[210] Bibimbap Entrecote Beef Bulgogi', portions: 1 },
    ],
  },
  {
    name: 'So-galbi marinade',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 25,
    max_holding_min: 720,
    batch_size: 6,
    unit: 'portion',
    notes: 'Short-rib marinade.',
    links: [
      { posId: 359, posName: '[303] So-Galbi', portions: 1 },
    ],
  },
  {
    name: 'Gochujang (spicy) marinade',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 15,
    max_holding_min: 720,
    batch_size: 8,
    unit: 'portion',
    notes: 'Spicy gochujang-based marinade for Dakgalbi.',
    links: [
      { posId: 370, posName: '[331] Spicy Boneless Chicken', portions: 1 },
    ],
  },
  {
    name: 'Curry chicken marinade',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 15,
    max_holding_min: 720,
    batch_size: 8,
    unit: 'portion',
    notes: 'Curry-based marinade.',
    links: [
      { posId: 369, posName: '[330] Curry Flavored Chicken', portions: 1 },
    ],
  },
  {
    name: 'Lamb marinade',
    station: 'cold',
    prep_type: 'advance',
    prep_time_min: 15,
    max_holding_min: 720,
    batch_size: 4,
    unit: 'portion',
    notes: 'Marinade for lamb chops.',
    links: [
      { posId: 371, posName: '[332] Lamb Chops', portions: 1 },
    ],
  },
  {
    name: 'Pork prep (sliced)',
    station: 'cold',
    prep_type: 'batch',
    prep_time_min: 20,
    max_holding_min: 360,
    batch_size: 6,
    unit: 'portion',
    notes: 'Sliced pork belly / neck ready for grill.',
    links: [
      { posId: 364, posName: '[320] All About Pork', portions: 1 },
      { posId: 366, posName: '[322] Pork Belly', portions: 1 },
      { posId: 368, posName: '[324] Pork Neck', portions: 1 },
    ],
  },
];

async function main() {
  console.log(`[seed] company_id=${COMPANY_ID} Ssam Kottbusser`);
  const existing = listPrepItems(COMPANY_ID, { includeInactive: true });
  const byName = new Map(existing.map(i => [i.name.toLowerCase(), i]));

  let createdItems = 0;
  let updatedLinks = 0;

  for (const def of ITEMS) {
    let id: number;
    const existingItem = byName.get(def.name.toLowerCase());
    if (existingItem) {
      id = existingItem.id;
      console.log(`[seed] reusing existing item "${def.name}" (id=${id})`);
    } else {
      id = createPrepItem({
        company_id: COMPANY_ID,
        location_id: null,
        name: def.name,
        station: def.station,
        prep_type: def.prep_type,
        prep_time_min: def.prep_time_min,
        max_holding_min: def.max_holding_min,
        batch_size: def.batch_size,
        unit: def.unit,
        notes: def.notes,
      });
      createdItems++;
      console.log(`[seed] created "${def.name}" (id=${id})`);
    }

    for (const link of def.links) {
      upsertLink({
        prep_item_id: id,
        pos_product_id: link.posId,
        pos_product_name: link.posName,
        portions_per_sale: link.portions,
        notes: link.notes || null,
      });
      updatedLinks++;
    }
  }

  console.log('---');
  console.log(`[seed] created ${createdItems} new items`);
  console.log(`[seed] upserted ${updatedLinks} links`);
  console.log('[seed] done. Re-run the forecast to populate prep_item_forecasts.');
}

main().catch(err => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
