'use client';

import type { CookStation } from '@/types/cooktimer';

interface Props {
  stations: CookStation[];
  enabled: number[] | null;   // null = all
  colorById: Record<number, string>;
  clockText: string;
  onOpenSettings: () => void;
}

/** Top bar: brand, station chips (lit = this tablet shows that station), clock, gear. */
export default function CookTimerTopBar({ stations, enabled, colorById, clockText, onOpenSettings }: Props) {
  const isOn = (id: number) => enabled === null || enabled.includes(id);
  return (
    <div className="ct-topbar">
      <div className="ct-logo">KDS <span>Cooking Timer</span></div>
      <div className="ct-chips">
        {stations.map(s => {
          const on = isOn(s.id);
          return (
            <span
              key={s.id}
              className={`ct-chip ${on ? 'on' : ''}`}
              style={on ? { background: colorById[s.id], borderColor: colorById[s.id] } : undefined}
            >
              {s.name}
            </span>
          );
        })}
      </div>
      <div className="ct-clock">{clockText}</div>
      <div className="ct-gear" title="Settings" onClick={onOpenSettings}>{'⚙'}</div>
    </div>
  );
}
