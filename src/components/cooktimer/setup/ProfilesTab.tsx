'use client';
import { useState } from 'react';
import type { CookProfile, CookStationAdmin } from '@/types/cooktimer';
import { fmtDuration, totalCookSeconds, stepChipClass, stationDot } from './utils';
import Toggle from './Toggle';

/** Cook Profiles tab — profiles grouped by station, each showing its step chain,
 *  total time and an active toggle. Tap a card to edit. */
export default function ProfilesTab({
  profiles, stations, onEdit, onNew, onToggleActive, onDelete,
}: {
  profiles: CookProfile[];
  stations: CookStationAdmin[];
  onEdit: (p: CookProfile) => void;
  onNew: () => void;
  onToggleActive: (p: CookProfile, active: boolean) => void;
  onDelete: (p: CookProfile) => void;
}) {
  const [q, setQ] = useState('');
  const activeCount = profiles.filter(p => p.active).length;
  const needle = q.trim().toLowerCase();
  const filtered = needle ? profiles.filter(p => p.name.toLowerCase().includes(needle)) : profiles;

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-extrabold text-gray-900">Cook profiles</h2>
        <span className="text-xs text-gray-400 font-semibold">{profiles.length} · {activeCount} active</span>
        <div className="flex-1" />
        <button onClick={onNew} className="rounded-xl bg-green-600 text-white font-bold text-sm px-4 py-2.5 active:brightness-110">＋ New profile</button>
      </div>

      {profiles.length > 0 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search profiles…"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] mb-4 focus:outline-none focus:border-sky-400" />
      )}

      {profiles.length === 0 && (
        <div className="text-center text-gray-400 py-16">
          <div className="text-3xl mb-2">🍳</div>
          <div className="font-semibold text-gray-500">No cook profiles yet</div>
          <div className="text-sm">Add one to feed the TO COOK queue.</div>
        </div>
      )}

      {profiles.length > 0 && filtered.length === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">No profiles match “{q}”.</div>
      )}

      {stations.map((st, si) => {
        const list = filtered.filter(p => p.stationId === st.id);
        if (list.length === 0) return null;
        return (
          <div key={st.id} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${stationDot(si)}`} />
              <h3 className="text-[11px] font-extrabold tracking-wider text-gray-500 uppercase">{st.name}</h3>
              <span className="text-[11px] text-gray-400 font-semibold">· {list.length}</span>
              {!st.active && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">STATION OFF</span>}
            </div>
            <div className="space-y-2.5">
              {list.map(p => (
                <ProfileRow key={p.id} profile={p} onEdit={() => onEdit(p)}
                  onToggle={v => onToggleActive(p, v)} onDelete={() => onDelete(p)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfileRow({
  profile, onEdit, onToggle, onDelete,
}: {
  profile: CookProfile;
  onEdit: () => void;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
}) {
  const total = totalCookSeconds(profile.steps);
  const needsTimes = profile.steps.some(s => s.stepType !== 'action' && s.durationSeconds === 0);
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 flex gap-3 items-center ${profile.active ? '' : 'opacity-60'}`}>
      <button onClick={onEdit} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-bold text-[15px] text-gray-900 truncate">{profile.name}</span>
          {needsTimes && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">CHECK TIMES</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {profile.steps.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300 text-xs">→</span>}
              <span className={`text-xs font-semibold px-2 py-1 rounded-md border ${stepChipClass(s.stepType)}`}>
                {s.label}{s.stepType !== 'action' && <span className="ml-1 text-[10px] opacity-70 tabular-nums">{fmtDuration(s.durationSeconds)}</span>}
              </span>
            </span>
          ))}
        </div>
      </button>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <div className="text-base font-extrabold text-gray-900 tabular-nums leading-none">{fmtDuration(total)}</div>
        <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">total</div>
      </div>
      <Toggle on={profile.active} onChange={onToggle} label={`${profile.name} active`} />
      <button onClick={onDelete} aria-label={`Delete ${profile.name}`} className="w-8 h-8 rounded-lg text-gray-300 hover:text-red-500 active:bg-red-50 flex items-center justify-center flex-shrink-0">🗑</button>
    </div>
  );
}
