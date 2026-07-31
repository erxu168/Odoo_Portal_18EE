'use client';

import React, { useMemo, useState } from 'react';

/**
 * Symbol picker — a searchable library PLUS free entry.
 *
 * Two ways in, because the two devices differ:
 *  - phone/tablet: tap a symbol, or type a word to filter ("fridge", "water");
 *  - Mac/desktop: the "any symbol" field takes the native emoji picker
 *    (⌃⌘Space) or a paste, so the whole system library is available — we do
 *    not try to out-list Apple.
 *
 * Deliberately dependency-free: an emoji package would add hundreds of KB to
 * a PWA that staff load on restaurant WiFi.
 */
interface Entry { e: string; k: string }

const LIBRARY: Record<string, Entry[]> = {
  'Rooms & building': [
    { e: '🚪', k: 'door room entrance' }, { e: '🏢', k: 'building floor office' },
    { e: '🏠', k: 'house home' }, { e: '🏭', k: 'factory production' },
    { e: '🗺️', k: 'map area zone plan' }, { e: '🧭', k: 'compass direction' },
    { e: '🪜', k: 'ladder stairs access' }, { e: '🛗', k: 'lift elevator' },
    { e: '🚻', k: 'toilet restroom wc' }, { e: '🚽', k: 'toilet wc' },
    { e: '🚿', k: 'shower wash' }, { e: '🅿️', k: 'parking' },
    { e: '🏬', k: 'store shop retail' }, { e: '🏪', k: 'shop kiosk' },
    { e: '🚧', k: 'construction closed barrier' }, { e: '🪟', k: 'window' },
  ],
  'Cold & storage': [
    { e: '🧊', k: 'fridge ice cold cooler' }, { e: '❄️', k: 'freezer frozen cold snow' },
    { e: '🥶', k: 'freezer frozen deep cold' }, { e: '🗄️', k: 'shelf cabinet rack file' },
    { e: '🗃️', k: 'drawer box card index' }, { e: '🧰', k: 'toolbox cabinet case' },
    { e: '📦', k: 'box carton floor space storage' }, { e: '🧺', k: 'basket crate bin laundry' },
    { e: '🪣', k: 'bucket pail' }, { e: '🛒', k: 'trolley cart' },
    { e: '📚', k: 'shelf books levels' }, { e: '🗳️', k: 'bin container' },
    { e: '🥡', k: 'takeaway container box' }, { e: '🫙', k: 'jar container dry goods' },
    { e: '🛢️', k: 'barrel drum oil' }, { e: '⚖️', k: 'scale weighing' },
  ],
  'Kitchen & equipment': [
    { e: '🍳', k: 'pan stove cooking hob' }, { e: '🔥', k: 'fire grill heat burner' },
    { e: '🍲', k: 'pot soup stock' }, { e: '🥘', k: 'pan paella dish' },
    { e: '🔪', k: 'knife prep cutting' }, { e: '🧑‍🍳', k: 'chef station cook' },
    { e: '🥣', k: 'bowl mixing' }, { e: '🍽️', k: 'plates dishes service' },
    { e: '☕', k: 'coffee machine hot drink' }, { e: '🫖', k: 'teapot tea' },
    { e: '🧇', k: 'waffle iron' }, { e: '🍕', k: 'pizza oven' },
    { e: '🥓', k: 'bacon meat grill' }, { e: '🌡️', k: 'thermometer temperature probe' },
    { e: '⏲️', k: 'timer clock' }, { e: '🧯', k: 'fire extinguisher safety' },
  ],
  'Drinks & bar': [
    { e: '🍺', k: 'beer keg tap draft' }, { e: '🍻', k: 'beers bar' },
    { e: '🍷', k: 'wine cellar bottle' }, { e: '🥂', k: 'sparkling champagne' },
    { e: '🍸', k: 'cocktail bar spirits' }, { e: '🥃', k: 'whisky spirits' },
    { e: '🧉', k: 'mate drink' }, { e: '🥤', k: 'soft drink cup soda' },
    { e: '🧃', k: 'juice carton' }, { e: '🍾', k: 'bottle champagne' },
    { e: '🫗', k: 'pouring jug' }, { e: '🧋', k: 'bubble tea' },
  ],
  'Food & produce': [
    { e: '🥬', k: 'vegetables greens produce' }, { e: '🥕', k: 'carrot vegetables' },
    { e: '🍅', k: 'tomato produce' }, { e: '🧅', k: 'onion produce' },
    { e: '🥩', k: 'meat butcher raw' }, { e: '🐔', k: 'chicken poultry' },
    { e: '🐟', k: 'fish seafood' }, { e: '🦐', k: 'shrimp seafood' },
    { e: '🧀', k: 'cheese dairy' }, { e: '🥛', k: 'milk dairy' },
    { e: '🥚', k: 'eggs' }, { e: '🍞', k: 'bread bakery' },
    { e: '🍚', k: 'rice dry goods' }, { e: '🍜', k: 'noodles dry goods' },
    { e: '🌶️', k: 'spice chilli hot' }, { e: '🧂', k: 'salt seasoning' },
    { e: '🍫', k: 'chocolate sweets' }, { e: '🍎', k: 'fruit apple' },
  ],
  'Utilities & safety': [
    { e: '🔧', k: 'utility spanner maintenance valve' }, { e: '🔩', k: 'bolt hardware' },
    { e: '🪛', k: 'screwdriver tools' }, { e: '🔌', k: 'power socket electricity plug' },
    { e: '⚡', k: 'electricity power meter fuse' }, { e: '🔋', k: 'battery power' },
    { e: '💡', k: 'light bulb lighting' }, { e: '🚰', k: 'water tap supply shut off' },
    { e: '💧', k: 'water drop shut off valve' }, { e: '🛟', k: 'safety ring' },
    { e: '🧯', k: 'fire extinguisher' }, { e: '🚨', k: 'alarm emergency' },
    { e: '🩹', k: 'first aid plaster' }, { e: '🚑', k: 'first aid ambulance emergency' },
    { e: '⛑️', k: 'safety helmet first aid' }, { e: '🔑', k: 'key access lock' },
    { e: '🔒', k: 'locked secure' }, { e: '📶', k: 'network wifi signal' },
    { e: '🖨️', k: 'printer label' }, { e: '📷', k: 'camera cctv' },
    { e: '♨️', k: 'heating boiler steam' }, { e: '🌬️', k: 'ventilation air extraction' },
  ],
  'Cleaning & waste': [
    { e: '🧽', k: 'sponge cleaning' }, { e: '🧼', k: 'soap cleaning hygiene' },
    { e: '🧴', k: 'bottle sanitiser cleaning' }, { e: '🧹', k: 'broom sweeping' },
    { e: '🚮', k: 'waste bin rubbish' }, { e: '♻️', k: 'recycling waste' },
    { e: '🗑️', k: 'bin trash waste' }, { e: '🧤', k: 'gloves hygiene' },
    { e: '🪠', k: 'plunger drain' }, { e: '🚯', k: 'no litter' },
  ],
  'Marks & numbers': [
    { e: '⭐', k: 'star favourite important' }, { e: '📍', k: 'pin location marker' },
    { e: '🎯', k: 'target spot' }, { e: '🔴', k: 'red dot marker' },
    { e: '🟢', k: 'green dot marker' }, { e: '🔵', k: 'blue dot marker' },
    { e: '🟡', k: 'yellow dot marker' }, { e: '🟣', k: 'purple dot marker' },
    { e: '⚠️', k: 'warning caution' }, { e: '❗', k: 'important attention' },
    { e: '✅', k: 'done ok check' }, { e: '🔢', k: 'numbers levels' },
    { e: '1️⃣', k: 'one level 1' }, { e: '2️⃣', k: 'two level 2' },
    { e: '3️⃣', k: 'three level 3' }, { e: '4️⃣', k: 'four level 4' },
    { e: '🅰️', k: 'a letter' }, { e: '🅱️', k: 'b letter' },
  ],
};

const ALL: Entry[] = Object.values(LIBRARY).flat();

/** Legacy set used by Shift Handover's log types. */
const KITCHEN_QUICK = ['🍗', '🍚', '🍜', '🥘', '🍞', '🥩', '🐔', '🌶️', '🧊', '❄️', '🧀', '🥬', '🥕', '🍅', '🧅', '💧', '🧽', '🧼', '🧴', '🧹', '🧯', '🔥', '🌡️', '🔪', '🥣', '🍳', '🛢️', '🚚', '📦', '📋', '📝', '✅', '⏰', '🕐', '⚠️', '❗'];

export function EmojiPicker({
  value,
  onPick,
  set = 'kitchen',
  title = 'Pick a symbol',
  columns = 8,
}: {
  value: string;
  onPick: (emoji: string) => void;
  /** 'kitchen' keeps the original compact grid; 'storage' opens the searchable library. */
  set?: 'kitchen' | 'storage';
  title?: string;
  columns?: number;
}) {
  const [query, setQuery] = useState('');
  const [own, setOwn] = useState('');

  const groups = useMemo(() => {
    if (set !== 'storage') return { '': KITCHEN_QUICK.map(e => ({ e, k: '' })) };
    const q = query.trim().toLowerCase();
    if (!q) return LIBRARY;
    const hits = ALL.filter(x => x.k.includes(q) || x.e === q);
    return hits.length ? { [`Matching “${query.trim()}”`]: hits } : {};
  }, [set, query]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5">
      {title && <p className="mb-2 text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400">{title}</p>}

      {set === 'storage' && (
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search symbols — fridge, water, star…"
          aria-label="Search symbols"
          className="mb-2 h-10 w-full rounded-lg border-[1.5px] border-gray-200 px-3 text-[13.5px] outline-none focus:border-blue-600"
        />
      )}

      <div className="max-h-64 overflow-y-auto pr-0.5">
        {Object.entries(groups).map(([group, list]) => (
          <div key={group} className="mb-2 last:mb-0">
            {group && <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{group}</p>}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {list.map(({ e }) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onPick(e)}
                  aria-label={`Symbol ${e}`}
                  aria-pressed={value === e}
                  className={`grid aspect-square place-items-center rounded-lg text-[20px] transition-transform active:scale-95 ${value === e ? 'bg-green-50 ring-2 ring-green-500' : 'bg-gray-50'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
        {Object.keys(groups).length === 0 && (
          <p className="py-3 text-center text-[12.5px] text-gray-500">
            Nothing matches “{query.trim()}” — use the field below for any symbol.
          </p>
        )}
      </div>

      {set === 'storage' && (
        <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
          <input
            value={own}
            onChange={e => {
              const v = Array.from(e.target.value).slice(-2).join('');
              setOwn(v);
              if (v) onPick(v);
            }}
            placeholder="… or any symbol"
            aria-label="Use any symbol"
            className="h-10 w-28 flex-shrink-0 rounded-lg border-[1.5px] border-dashed border-gray-300 text-center text-[18px] outline-none focus:border-blue-600"
          />
          <span className="text-[11px] leading-snug text-gray-500">
            Click here and press <b>⌃⌘Space</b> for the full Mac symbol picker (or paste one).
          </span>
        </div>
      )}
    </div>
  );
}

export default EmojiPicker;
