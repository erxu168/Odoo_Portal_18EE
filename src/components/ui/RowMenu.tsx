'use client';

/**
 * The "⋮" menu on a list row — Edit, Delete, and anything else that would
 * otherwise sit on the row as a permanent word.
 *
 * Why it exists: a red "Delete" repeated down every row makes the most
 * dangerous action on a screen also the most repeated thing on it, and it
 * competes for width with the content the row is actually about. Behind a menu
 * it is still two taps away and the row goes quiet. The Shift Handover module —
 * the design standard's reference — already does exactly this; this is that
 * pattern, shared, rather than a third copy of it.
 *
 * Every handler stops the click. These menus live inside rows that are often
 * themselves tappable, and a menu that lets its click through fires whatever is
 * underneath it.
 */
import { useEffect, useRef, useState } from 'react';
import { useEscapeStack } from '@/lib/modal-stack';

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  /** Red, and placed under a divider — for destructive actions. */
  danger?: boolean;
  disabled?: boolean;
}

export default function RowMenu({ items, label = 'More actions', align = 'right' }: {
  items: RowMenuItem[];
  label?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeStack(() => setOpen(false), open);

  // Close when the finger lands anywhere else — including on another row's menu,
  // so two can never be open at once.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 -mr-1.5 -mt-1 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 active:bg-gray-100"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          onClick={e => e.stopPropagation()}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-11 z-30 min-w-[9rem] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden`}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick(); }}
              className={`w-full text-left px-3.5 min-h-[44px] text-[var(--fs-sm)] font-semibold disabled:opacity-40 ${
                item.danger
                  ? 'text-red-600 active:bg-red-50 hover:bg-red-50'
                  : 'text-gray-800 active:bg-gray-50 hover:bg-gray-50'
              } ${i > 0 && item.danger ? 'border-t border-gray-100' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
