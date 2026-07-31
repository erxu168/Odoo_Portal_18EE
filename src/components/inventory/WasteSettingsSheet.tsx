'use client';

import React, { useState, useEffect, useRef } from 'react';
import BottomSheet from '@/components/ui/BottomSheet';

/**
 * Waste settings — one switch per department: must an entry carry a photo?
 *
 * Off by default ON PURPOSE, and the warning below the list is the point:
 * a required photo is the single most likely reason someone quietly stops
 * recording, and that failure is silent — entries just stop appearing.
 */

interface Dept { id: number; name: string }

export default function WasteSettingsSheet({ companyId, onClose, onSettled }: {
  companyId: number;
  onClose: () => void;
  /** Fires once every queued write has finished — refresh the photo rule THEN,
   *  or a fast refetch reads the database from before the toggle committed. */
  onSettled?: () => void;
}) {
  const [departments, setDepartments] = useState<Dept[] | null>(null);
  const [settings, setSettings] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  // Two guards per department: a promise CHAIN so writes reach the server in
  // tap order (two racing PUTs could otherwise land reversed and leave the
  // database saying the opposite of the screen), and a sequence number so only
  // the LATEST tap's failure may revert the UI.
  const seq = useRef<Record<number, number>>({});
  const chain = useRef<Record<number, Promise<unknown>>>({});

  useEffect(() => {
    const t = ++token.current;
    (async () => {
      try {
        const [deptRes, setRes] = await Promise.all([
          fetch(`/api/inventory/departments?company_id=${companyId}`).then((r) => r.json()),
          fetch(`/api/inventory/waste/settings?company_id=${companyId}`).then((r) => r.json()),
        ]);
        if (t !== token.current) return;
        setDepartments(deptRes.departments || []);
        setSettings(setRes.settings || {});
      } catch {
        if (t === token.current) { setDepartments([]); setError('Could not load departments.'); }
      }
    })();
  }, [companyId]);

  function toggle(deptId: number) {
    const next = !settings[deptId];
    const mySeq = (seq.current[deptId] = (seq.current[deptId] || 0) + 1);
    // Instant feedback, reverted if the server says no.
    setSettings((s) => ({ ...s, [deptId]: next }));
    setError(null);
    const prev = chain.current[deptId] || Promise.resolve();
    chain.current[deptId] = prev.then(async () => {
      try {
        const res = await fetch('/api/inventory/waste/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ department_id: deptId, photo_required: next }),
        });
        if (seq.current[deptId] !== mySeq) return;   // a newer tap owns this switch now
        if (!res.ok) {
          const d = await res.json();
          setSettings((s) => ({ ...s, [deptId]: !next }));
          setError(d.error || 'Could not save.');
        }
      } catch {
        if (seq.current[deptId] !== mySeq) return;
        setSettings((s) => ({ ...s, [deptId]: !next }));
        setError('No connection — nothing changed.');
      }
    });
  }

  function handleClose() {
    const pending = Object.values(chain.current);
    onClose();
    void Promise.allSettled(pending).then(() => onSettled?.());
  }

  return (
    <BottomSheet title="Waste settings" onClose={handleClose}>
      <div className="px-1 pb-2">
        <p className="text-[var(--fs-sm)] text-gray-600 mb-3">
          <b>Photo required</b> — staff must attach a picture before an entry saves, per department.
        </p>

        {departments === null ? (
          <div className="py-6 text-center text-[var(--fs-sm)] text-gray-400">Loading…</div>
        ) : departments.length === 0 ? (
          <div className="py-6 text-center text-[var(--fs-sm)] text-gray-400">No departments for this restaurant.</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl px-3 divide-y divide-gray-100">
            {departments.map((d) => {
              const on = !!settings[d.id];
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 text-[var(--fs-sm)] font-semibold text-gray-900 truncate">{d.name}</span>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={`Photo required for ${d.name}`}
                    onClick={() => toggle(d.id)}
                    className={`relative flex-shrink-0 w-[44px] h-[26px] rounded-full transition-colors ${on ? 'bg-green-600' : 'bg-gray-300'}`}
                  >
                    <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'right-[3px]' : 'left-[3px]'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-[var(--fs-xs)] font-semibold text-red-700">{error}</div>
        )}

        <div className="mt-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[var(--fs-xs)] text-amber-800 leading-snug">
          <b>Be deliberate about turning this on.</b> Mid-service, with a bin in one hand,
          &ldquo;take a photo first&rdquo; is where people give up — and it fails silently:
          entries just stop appearing. Start off, build the habit, and switch it on only
          where you need evidence.
        </div>
      </div>
    </BottomSheet>
  );
}
