'use client';

import type { CookStation } from '@/types/cooktimer';

interface Props {
  stations: CookStation[];
  enabled: number[] | null;   // null = all
  soundOn: boolean;
  colorById: Record<number, string>;
  onToggleStation: (id: number) => void;
  onToggleSound: () => void;
  onClose: () => void;
}

/**
 * Tablet settings: which stations this tablet shows + the global sound switch.
 * Per-tablet, stored in localStorage (a Grill tablet shows only Grill; a shared
 * tablet shows all). Managers add new stations in the portal (Profiles screen).
 */
export default function CookSettingsOverlay({ stations, enabled, soundOn, colorById, onToggleStation, onToggleSound, onClose }: Props) {
  const isOn = (id: number) => enabled === null || enabled.includes(id);
  return (
    <div className="ct-overlay" onClick={onClose}>
      <div className="ct-settings" onClick={e => e.stopPropagation()}>
        <h3>Tablet settings</h3>
        <p>This tablet shows items for the stations enabled below. Managers add new stations in the portal.</p>

        {stations.map(s => (
          <div className="ct-srow" key={s.id}>
            <div className="ct-sname"><span className="ct-dot" style={{ background: colorById[s.id] }} />{s.name}</div>
            <div className={`ct-tog ${isOn(s.id) ? 'on' : ''}`} onClick={() => onToggleStation(s.id)} role="switch" aria-checked={isOn(s.id)} />
          </div>
        ))}

        <div className="ct-srow">
          <div className="ct-sname">Sound</div>
          <div className={`ct-tog ${soundOn ? 'on' : ''}`} onClick={onToggleSound} role="switch" aria-checked={soundOn} />
        </div>

        <button className="ct-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
