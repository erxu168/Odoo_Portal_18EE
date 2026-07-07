'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * Tablet time-clock kiosk (no login). The device URL carries the restaurant:
 *   /kiosk?company=6
 * Staff tap their name, enter a 4-digit PIN, and are clocked IN or OUT (auto).
 * Writes Odoo hr.attendance via /api/kiosk/punch. No geolocation (DSGVO).
 */

interface KioskStaff {
  employeeId: number;
  name: string;
  clockedIn: boolean;
}
interface PunchResult {
  ok: true;
  action: 'in' | 'out';
  name: string;
  at: string;
  note: 'ontime' | 'late' | 'early' | 'overtime';
  mins: number;
  shift: string | null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

export default function KioskPage() {
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<'grid' | 'pin' | 'done'>('grid');
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [selected, setSelected] = useState<KioskStaff | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('company');
    const c = raw ? parseInt(raw, 10) : NaN;
    setCompanyId(Number.isInteger(c) && c > 0 ? c : null);
    setReady(true);
    const tick = () =>
      setClock(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const loadStaff = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await fetch(`/api/kiosk/staff?company_id=${companyId}`);
      const d = await r.json();
      if (r.ok) setStaff(Array.isArray(d.staff) ? d.staff : []);
    } catch {
      /* keep last list on transient error */
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    loadStaff();
    const t = setInterval(loadStaff, 30000);
    return () => clearInterval(t);
  }, [companyId, loadStaff]);

  useEffect(() => {
    if (screen !== 'done') return;
    const t = setTimeout(() => {
      setScreen('grid');
      setSelected(null);
      setResult(null);
      loadStaff();
    }, 5000);
    return () => clearTimeout(t);
  }, [screen, loadStaff]);

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Trap the browser Back gesture so a punch can't accidentally leave the clock.
  useEffect(() => {
    history.pushState(null, '', location.href);
    const onPop = () => history.pushState(null, '', location.href);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function pickPerson(s: KioskStaff) {
    enterFullscreen(); // first tap is a user gesture — a good moment to go full screen
    setSelected(s);
    setPin('');
    setPinError(false);
    setScreen('pin');
  }

  const submitPin = useCallback(
    async (finalPin: string) => {
      if (!selected || !companyId) return;
      setBusy(true);
      setPinError(false);
      try {
        const r = await fetch('/api/kiosk/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, employee_id: selected.employeeId, pin: finalPin }),
        });
        const d = await r.json();
        if (r.ok && d.ok) {
          setResult(d as PunchResult);
          setScreen('done');
        } else {
          setPin('');
          setPinError(true);
        }
      } catch {
        setPin('');
        setPinError(true);
      } finally {
        setBusy(false);
      }
    },
    [selected, companyId],
  );

  function keyPress(digit: string) {
    if (busy || pin.length >= 4) return;
    setPinError(false);
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) submitPin(next);
  }

  const header = (
    <header className="bg-[#1A1F2E] text-white px-6 py-4 flex items-center justify-between">
      <div className="text-[22px] font-extrabold tracking-tight">🕒 Time Clock</div>
      <div className="text-[22px] font-bold tabular-nums">{clock}</div>
    </header>
  );

  if (!ready) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <div className="text-5xl mb-3">🔧</div>
            <div className="text-xl font-bold text-gray-900 mb-1">This tablet is not set up yet</div>
            <div className="text-gray-500">Open this clock with the restaurant in the address, e.g. <span className="font-mono">/kiosk?company=6</span></div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Confirmation ----
  if (screen === 'done' && result) {
    const r = result;
    let noteMsg = '';
    let noteClass = 'bg-green-50 text-green-700';
    if (r.action === 'in') {
      if (r.note === 'late') { noteMsg = `${r.mins} min late — logged`; noteClass = 'bg-amber-50 text-amber-700'; }
      else noteMsg = 'You’re on time';
    } else {
      if (r.note === 'early') { noteMsg = `Left ${r.mins} min early`; noteClass = 'bg-amber-50 text-amber-700'; }
      else if (r.note === 'overtime') { noteMsg = `${r.mins} min overtime — thanks!`; noteClass = 'bg-blue-50 text-blue-700'; }
      else noteMsg = 'See you!';
    }
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-7xl mb-2">{r.action === 'in' ? '👋' : '✅'}</div>
          <div className="text-3xl font-extrabold text-gray-900">{r.action === 'in' ? 'Clocked in' : 'Clocked out'}</div>
          <div className="text-xl font-semibold text-gray-600 mt-1">{r.name}</div>
          <div className="text-6xl font-extrabold tabular-nums my-5 text-gray-900">{r.at}</div>
          <div className={`rounded-2xl px-7 py-3 text-lg font-bold ${noteClass}`}>{noteMsg}</div>
          {r.shift && <div className="text-gray-400 mt-4 text-lg">Your shift: {r.shift}</div>}
          <button
            onClick={() => { setScreen('grid'); setSelected(null); setResult(null); loadStaff(); }}
            className="mt-8 bg-green-600 text-white px-10 py-3.5 rounded-full text-lg font-bold active:bg-green-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ---- PIN entry ----
  if (screen === 'pin' && selected) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center p-6">
          <button
            onClick={() => { setScreen('grid'); setSelected(null); }}
            className="self-start bg-white border border-gray-200 rounded-full px-5 py-2.5 font-bold text-gray-600 active:bg-gray-100"
          >
            ‹ Back
          </button>
          <div className="w-24 h-24 rounded-full bg-gray-200 text-gray-600 text-3xl font-bold flex items-center justify-center mt-4">
            {initials(selected.name)}
          </div>
          <div className="text-2xl font-extrabold text-gray-900 mt-4">Hi, {firstName(selected.name)}</div>
          <div className="text-gray-500 font-semibold mt-1">
            {selected.clockedIn ? 'Enter PIN to clock OUT' : 'Enter PIN to clock IN'}
          </div>
          <div className="flex gap-4 my-7">
            {[0, 1, 2, 3].map(i => (
              <span key={i} className={`w-4 h-4 rounded-full ${pin.length > i ? 'bg-green-600' : 'border-2 border-gray-300'}`} />
            ))}
          </div>
          <div className="h-6 mb-2">{pinError && <div className="text-red-600 font-bold">Wrong PIN — try again</div>}</div>
          <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
            {keys.map(k => (
              <button
                key={k}
                onClick={() => keyPress(k)}
                className="h-16 rounded-2xl bg-white border border-gray-200 text-2xl font-bold text-gray-900 active:bg-green-50 active:scale-95 transition-transform"
              >
                {k}
              </button>
            ))}
            <button
              onClick={() => { setPin(''); setPinError(false); }}
              className="h-16 rounded-2xl bg-transparent text-gray-500 text-lg font-bold active:bg-gray-100"
            >
              Clear
            </button>
            <button
              onClick={() => keyPress('0')}
              className="h-16 rounded-2xl bg-white border border-gray-200 text-2xl font-bold text-gray-900 active:bg-green-50 active:scale-95 transition-transform"
            >
              0
            </button>
            <button
              onClick={() => { setPin(p => p.slice(0, -1)); setPinError(false); }}
              className="h-16 rounded-2xl bg-transparent text-gray-500 text-2xl font-bold active:bg-gray-100"
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Staff grid ----
  const workingNow = staff.filter(s => s.clockedIn).length;
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {header}
      <div className="flex-1 p-6">
        <div className="text-center text-gray-600 text-lg font-semibold mb-6">Tap your name to clock in or out</div>
        {staff.length === 0 ? (
          <div className="text-center text-gray-400 mt-16 text-lg">
            No staff set up for the clock yet.
            <div className="text-base mt-1">A manager assigns PINs in Roster &amp; Caps.</div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {staff.map(s => (
              <button
                key={s.employeeId}
                onClick={() => pickPerson(s)}
                className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col items-center gap-2 shadow-sm active:scale-95 transition-transform"
              >
                <div className="w-20 h-20 rounded-full bg-gray-200 text-gray-600 text-2xl font-bold flex items-center justify-center">
                  {initials(s.name)}
                </div>
                <div className="text-[17px] font-bold text-gray-900 text-center leading-tight">{s.name}</div>
                <div className={`text-sm font-bold ${s.clockedIn ? 'text-green-600' : 'text-gray-400'}`}>
                  {s.clockedIn ? '● Working' : '○ Off'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="text-center text-green-600 font-bold py-4">● {workingNow} working now</footer>
    </div>
  );
}
