'use client';

import { useEffect, useState } from 'react';

interface StaffOption { employeeId: number; name: string }

interface Props {
  configId: number;
  task: { id: number; name: string; details?: string | null } | null;
  onClose: () => void;
  onCompleted: (taskId: number) => void;
}

/**
 * Full-screen KDS modal: a cook picks themselves, enters their 4-digit clock-in
 * PIN, and the task is marked done in Odoo credited to them. Mirrors the shared-
 * device PIN pad in WorkingAsBanner, styled for the KDS dark theme.
 */
export default function KdsTaskCompleteModal({ configId, task, onClose, onCompleted }: Props) {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [picked, setPicked] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Reset + load staff whenever a new task is opened.
  useEffect(() => {
    if (!task) return;
    setPicked(null); setPin(''); setErr(''); setBusy(false); setDone(false);
    let active = true;
    setLoadingStaff(true);
    fetch(`/api/kds/staff?configId=${configId}`)
      .then(r => r.json())
      .then(d => { if (active) setStaff(Array.isArray(d.staff) ? d.staff : []); })
      .catch(() => { if (active) setStaff([]); })
      .finally(() => { if (active) setLoadingStaff(false); });
    return () => { active = false; };
  }, [task, configId]);

  function tapDigit(d: string) {
    setErr('');
    setPin(prev => (prev.length >= 4 ? prev : prev + d));
  }

  async function submitPin(finalPin: string) {
    if (!task || !picked || finalPin.length !== 4) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/kds/tasks/${task.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId, employeeId: picked.employeeId, pin: finalPin }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setDone(true);
        setTimeout(() => { onCompleted(task.id); onClose(); }, 700);
      } else if (res.status === 401) {
        setErr('Wrong PIN'); setPin('');
      } else if (res.status === 429) {
        setErr(d.error || 'Too many attempts — wait a moment.'); setPin('');
      } else {
        // 422 (e.g. photo required) or other — surface the message, let them close.
        setErr(d.error || 'Could not complete task'); setPin('');
      }
    } catch {
      setErr('Connection failed'); setPin('');
    } finally {
      setBusy(false);
    }
  }

  // Auto-submit when the 4th digit is entered.
  useEffect(() => {
    if (picked && pin.length === 4) submitPin(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (!task) return null;

  return (
    <div className="kds-taskdone-overlay" onClick={onClose}>
      <div className="kds-taskdone-modal" onClick={e => e.stopPropagation()}>
        <button className="kds-taskdone-close" onClick={onClose} aria-label="Close">×</button>

        <div className="kds-taskdone-head">
          <div className="kds-taskdone-title">{task.name}</div>
          {task.details && <div className="kds-taskdone-details">{task.details}</div>}
        </div>

        {done ? (
          <div className="kds-taskdone-success">
            <div className="kds-taskdone-check">✓</div>
            <div>Marked done</div>
          </div>
        ) : !picked ? (
          <>
            <div className="kds-taskdone-sub">Who&rsquo;s completing this?</div>
            {loadingStaff ? (
              <div className="kds-taskdone-empty">Loading…</div>
            ) : staff.length === 0 ? (
              <div className="kds-taskdone-empty">No staff have a PIN yet. Set PINs in Manage Staff.</div>
            ) : (
              <div className="kds-taskdone-staff">
                {staff.map(s => (
                  <button key={s.employeeId} className="kds-taskdone-person"
                    onClick={() => { setPicked(s); setPin(''); setErr(''); }}>
                    <span className="kds-taskdone-avatar">
                      {s.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <span className="kds-taskdone-name">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="kds-taskdone-sub">{picked.name} · enter your 4-digit PIN</div>
            <div className="kds-taskdone-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`kds-taskdone-dot ${i < pin.length ? 'filled' : ''}`} />
              ))}
            </div>
            {err && <div className="kds-taskdone-err">{err}</div>}
            <div className="kds-taskdone-pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button key={d} className="kds-taskdone-key" onClick={() => tapDigit(d)} disabled={busy}>{d}</button>
              ))}
              <button className="kds-taskdone-key ghost" onClick={() => { setPicked(null); setPin(''); setErr(''); }}>Back</button>
              <button className="kds-taskdone-key" onClick={() => tapDigit('0')} disabled={busy}>0</button>
              <button className="kds-taskdone-key ghost" onClick={() => setPin(p => p.slice(0, -1))}>⌫</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
