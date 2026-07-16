'use client';

import React, { useCallback, useEffect, useState } from 'react';
import KioskSettings from '@/components/kiosk/KioskSettings';
import { loadKioskSettings, type KioskSettings as KioskSettingsT } from '@/lib/kiosk-settings';

/**
 * Tablet time-clock kiosk (no login). The restaurant is set on the tablet from the
 * gear → settings screen (manager/admin login), saved in localStorage. Staff tap
 * their name and enter a 4-digit PIN to clock IN/OUT (auto) via /api/kiosk/punch.
 *
 * Everyone at the restaurant is listed. A staff member without a PIN yet taps their
 * name and sets one up: we email them a 6-digit code (proves it's them), they enter
 * it and choose a PIN. "Forgot PIN" emails a reset link they open on their phone.
 * No geolocation (DSGVO) — device trust + PIN only.
 */

interface KioskStaff {
  employeeId: number;
  name: string;
  clockedIn: boolean;
  onBreak: boolean;
  hasPin: boolean;
}
type PunchAction = 'in' | 'break' | 'out' | 'resume';
interface PunchResult {
  ok: true;
  action: PunchAction;
  name: string;
  at: string;
  note: 'ontime' | 'late' | 'early' | 'overtime';
  mins: number;
  shift: string | null;
  breakMins?: number;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

// Short confirmation beep, created on the punch (a user gesture) so browsers allow it.
function beep(): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    /* audio unavailable — silent */
  }
}

export default function KioskPage() {
  const [settings, setSettings] = useState<KioskSettingsT | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [screen, setScreen] = useState<'grid' | 'pin' | 'setup' | 'done'>('grid');
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [selected, setSelected] = useState<KioskStaff | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [clock, setClock] = useState('');
  const [flash, setFlash] = useState('');
  // A non-PIN problem to show back on the grid (state conflict, rate limit, error).
  const [notice, setNotice] = useState('');

  // Forgot-PIN feedback shown on the PIN screen.
  const [forgotMsg, setForgotMsg] = useState('');

  // First-time PIN setup flow.
  const [setupStep, setSetupStep] = useState<'start' | 'code'>('start');
  const [setupEmailMasked, setSetupEmailMasked] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupError, setSetupError] = useState('');

  const companyId = settings?.companyId ?? null;
  const fullscreenLock = settings?.fullscreenLock ?? true;
  const idleSeconds = settings?.idleSeconds ?? 5;

  useEffect(() => {
    setSettings(loadKioskSettings());
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
    }, Math.max(1, idleSeconds) * 1000);
    return () => clearTimeout(t);
  }, [screen, idleSeconds, loadStaff]);

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Trap the browser Back gesture so a punch can't accidentally leave the clock.
  // Only while the full-screen lock is on (otherwise leave navigation normal).
  useEffect(() => {
    if (!fullscreenLock) return;
    history.pushState(null, '', location.href);
    const onPop = () => history.pushState(null, '', location.href);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [fullscreenLock]);

  const backToGrid = useCallback(() => {
    setScreen('grid');
    setSelected(null);
    setPin('');
    setPinError(false);
    setForgotMsg('');
    setSetupStep('start');
    setSetupCode('');
    setSetupPin('');
    setSetupConfirm('');
    setSetupError('');
    setSetupEmailMasked('');
    loadStaff(); // refresh clocked-in/out status on return to the grid
  }, [loadStaff]);

  function pickPerson(s: KioskStaff) {
    if (fullscreenLock) enterFullscreen(); // first tap is a user gesture — a good moment to go full screen
    setFlash('');
    setNotice('');
    setSelected(s);
    if (s.hasPin) {
      setPin('');
      setPinError(false);
      setForgotMsg('');
      setScreen('pin');
    } else {
      setSetupStep('start');
      setSetupCode('');
      setSetupPin('');
      setSetupConfirm('');
      setSetupError('');
      setSetupEmailMasked('');
      setScreen('setup');
    }
  }

  const submitPin = useCallback(
    async (finalPin: string, action: PunchAction) => {
      if (!selected || !companyId) return;
      setBusy(true);
      setPinError(false);
      try {
        const r = await fetch('/api/kiosk/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, employee_id: selected.employeeId, pin: finalPin, action }),
        });
        const d = await r.json();
        if (r.ok && d.ok) {
          if (settings?.sound) beep();
          setResult(d as PunchResult);
          setScreen('done');
        } else if (r.status === 401) {
          // Wrong PIN — let them try again.
          setPin('');
          setPinError(true);
        } else {
          // Not a PIN problem (state changed, rate limited, server error): show the
          // reason and go back to the grid, which reloads everyone's live state.
          setNotice(typeof d?.error === 'string' ? d.error : 'Please try again.');
          backToGrid();
        }
      } catch {
        // Network / non-JSON failure — not a PIN problem.
        setNotice('Network problem — please try again.');
        backToGrid();
      } finally {
        setBusy(false);
      }
    },
    [selected, companyId, settings?.sound, backToGrid],
  );

  function keyPress(digit: string) {
    if (busy || pin.length >= 4) return;
    setPinError(false);
    const next = pin + digit;
    setPin(next);
    // A person who is OFF has a single action (clock in) → auto-submit on the 4th
    // digit. WORKING / ON BREAK must choose Break vs End shift, so wait for a button.
    if (next.length === 4 && selected && !selected.clockedIn && !selected.onBreak) {
      submitPin(next, 'in');
    }
  }

  // ---- Forgot PIN (email a reset link) ----
  const requestForgot = useCallback(async () => {
    if (!selected || !companyId || busy) return;
    setBusy(true);
    setForgotMsg('');
    try {
      const r = await fetch('/api/kiosk/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, employee_id: selected.employeeId }),
      });
      const d = await r.json();
      setForgotMsg(r.ok && d.ok ? `Reset link sent to ${d.emailMasked}. Open it on your phone.` : d.error || 'Could not send the link.');
    } catch {
      setForgotMsg('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }, [selected, companyId, busy]);

  // ---- First-time setup: request the email code ----
  const requestSetupCode = useCallback(async () => {
    if (!selected || !companyId || busy) return;
    setBusy(true);
    setSetupError('');
    try {
      const r = await fetch('/api/kiosk/setup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, employee_id: selected.employeeId }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setSetupEmailMasked(d.emailMasked || 'your email');
        setSetupStep('code');
      } else {
        setSetupError(d.error || 'Could not send the code.');
      }
    } catch {
      setSetupError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }, [selected, companyId, busy]);

  // ---- First-time setup: confirm code + set PIN + clock in ----
  const confirmSetup = useCallback(async () => {
    if (!selected || !companyId || busy) return;
    if (!/^\d{6}$/.test(setupCode)) { setSetupError('Enter the 6-digit code from your email.'); return; }
    if (!/^\d{4}$/.test(setupPin)) { setSetupError('Your PIN must be 4 digits.'); return; }
    if (setupPin !== setupConfirm) { setSetupError('The two PINs don’t match.'); return; }
    setBusy(true);
    setSetupError('');
    try {
      const r = await fetch('/api/kiosk/setup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, employee_id: selected.employeeId, code: setupCode, pin: setupPin }),
      });
      const d = await r.json();
      if (r.ok && d.action) {
        if (settings?.sound) beep();
        setResult(d as PunchResult);
        setScreen('done');
      } else if (r.ok && d.ok) {
        setFlash('PIN set! Tap your name to clock in.');
        backToGrid();
        loadStaff();
      } else {
        setSetupError(d.error || 'Could not set your PIN.');
      }
    } catch {
      setSetupError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }, [selected, companyId, busy, setupCode, setupPin, setupConfirm, settings?.sound, loadStaff, backToGrid]);

  const header = (
    <header className="bg-[#1A1F2E] text-white px-6 py-4 flex items-center justify-between">
      <div className="min-w-0 flex items-baseline gap-2">
        <span className="text-[22px] font-extrabold tracking-tight shrink-0">🕒 Time Clock</span>
        {settings?.tabletName && (
          <span className="text-[14px] font-semibold text-white/60 truncate">· {settings.tabletName}</span>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-[22px] font-bold tabular-nums">{clock}</div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Kiosk settings"
          className="w-11 h-11 flex items-center justify-center rounded-full text-white/70 text-xl active:bg-white/10 active:text-white"
        >
          ⚙
        </button>
      </div>
    </header>
  );

  const overlay = settingsOpen && settings && (
    <KioskSettings
      settings={settings}
      onChange={next => setSettings(next)}
      onClose={() => {
        setSettingsOpen(false);
        loadStaff();
      }}
    />
  );

  const setupInputCls =
    'w-full text-center text-3xl font-bold tracking-[0.35em] tabular-nums bg-gray-50 border border-gray-200 rounded-2xl py-3.5 outline-none focus:border-green-500';

  let content: React.ReactNode;

  if (!settings) {
    content = <div className="min-h-screen bg-gray-50" />;
  } else if (!companyId) {
    // ---- Not set up yet (no restaurant chosen) ----
    content = (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <div className="text-5xl mb-3">🔧</div>
            <div className="text-xl font-bold text-gray-900 mb-1">This tablet is not set up yet</div>
            <div className="text-gray-500 mb-6">A manager picks the restaurant in settings.</div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="bg-green-600 text-white px-8 py-3.5 rounded-full text-lg font-bold active:bg-green-700"
            >
              ⚙ Set up this tablet
            </button>
          </div>
        </div>
      </div>
    );
  } else if (screen === 'done' && result) {
    // ---- Confirmation ----
    const r = result;
    let icon = '✅';
    let title = 'Clocked out';
    let noteMsg = '';
    let noteClass = 'bg-green-50 text-green-700';
    if (r.action === 'in') {
      icon = '👋'; title = 'Clocked in';
      if (r.note === 'late') { noteMsg = `${r.mins} min late — logged`; noteClass = 'bg-amber-50 text-amber-700'; }
      else noteMsg = 'You’re on time';
    } else if (r.action === 'resume') {
      icon = '👋'; title = 'Welcome back';
      noteMsg = r.breakMins != null ? `${r.breakMins} min break — back to work` : 'Back to work';
    } else if (r.action === 'break') {
      icon = '☕'; title = 'On break';
      noteMsg = 'Clock back in when you return'; noteClass = 'bg-amber-50 text-amber-700';
    } else {
      icon = '✅'; title = 'Clocked out';
      if (r.note === 'early') { noteMsg = `Left ${r.mins} min early`; noteClass = 'bg-amber-50 text-amber-700'; }
      else if (r.note === 'overtime') { noteMsg = `${r.mins} min overtime — thanks!`; }
      else noteMsg = 'See you!';
    }
    content = (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-7xl mb-2">{icon}</div>
          <div className="text-3xl font-extrabold text-gray-900">{title}</div>
          <div className="text-xl font-semibold text-gray-600 mt-1">{r.name}</div>
          <div className="text-6xl font-extrabold tabular-nums my-5 text-gray-900">{r.at}</div>
          <div className={`rounded-2xl px-7 py-3 text-lg font-bold ${noteClass}`}>{noteMsg}</div>
          {r.shift && <div className="text-gray-400 mt-4 text-lg">Your shift: {r.shift}</div>}
          <button
            onClick={backToGrid}
            className="mt-8 bg-green-600 text-white px-10 py-3.5 rounded-full text-lg font-bold active:bg-green-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  } else if (screen === 'pin' && selected) {
    // ---- PIN entry ----
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    // OFF → single action (auto clock-in). WORKING / ON BREAK → choose an action.
    const mode: 'off' | 'working' | 'onbreak' = selected.clockedIn
      ? 'working'
      : selected.onBreak
        ? 'onbreak'
        : 'off';
    const pinReady = pin.length === 4 && !busy;
    const subtitle =
      mode === 'working' ? 'Enter PIN, then choose' : mode === 'onbreak' ? 'Enter PIN, then choose' : 'Enter PIN to clock IN';
    content = (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center p-6">
          <button
            onClick={backToGrid}
            className="self-start bg-white border border-gray-200 rounded-full px-5 py-2.5 font-bold text-gray-600 active:bg-gray-100"
          >
            ‹ Back
          </button>
          <div className="w-24 h-24 rounded-full bg-gray-200 text-gray-600 text-3xl font-bold flex items-center justify-center mt-4">
            {initials(selected.name)}
          </div>
          <div className="text-2xl font-extrabold text-gray-900 mt-4">Hi, {firstName(selected.name)}</div>
          <div className="text-gray-500 font-semibold mt-1">{subtitle}</div>
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

          {mode !== 'off' && (
            <div className="w-full max-w-xs mt-6 flex flex-col gap-3">
              {mode === 'working' ? (
                <button
                  disabled={!pinReady}
                  onClick={() => submitPin(pin, 'break')}
                  className="w-full py-4 rounded-2xl text-lg font-bold bg-amber-500 text-white active:bg-amber-600 disabled:opacity-40 transition-opacity"
                >
                  ☕ Break
                </button>
              ) : (
                <button
                  disabled={!pinReady}
                  onClick={() => submitPin(pin, 'resume')}
                  className="w-full py-4 rounded-2xl text-lg font-bold bg-green-600 text-white active:bg-green-700 disabled:opacity-40 transition-opacity"
                >
                  ▶️ Back from break
                </button>
              )}
              <button
                disabled={!pinReady}
                onClick={() => submitPin(pin, 'out')}
                className="w-full py-4 rounded-2xl text-lg font-bold bg-white border-2 border-red-200 text-red-600 active:bg-red-50 disabled:opacity-40 transition-opacity"
              >
                🔴 End shift
              </button>
            </div>
          )}

          <div className="mt-6 text-center">
            <button onClick={requestForgot} disabled={busy} className="text-gray-500 font-semibold underline active:text-gray-700 disabled:opacity-50">
              Forgot PIN?
            </button>
            {forgotMsg && <div className="text-sm text-gray-600 mt-2 max-w-xs">{forgotMsg}</div>}
          </div>
        </div>
      </div>
    );
  } else if (screen === 'setup' && selected) {
    // ---- First-time PIN setup ----
    content = (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center p-6">
          <button
            onClick={backToGrid}
            className="self-start bg-white border border-gray-200 rounded-full px-5 py-2.5 font-bold text-gray-600 active:bg-gray-100"
          >
            ‹ Back
          </button>
          <div className="w-24 h-24 rounded-full bg-gray-200 text-gray-600 text-3xl font-bold flex items-center justify-center mt-4">
            {initials(selected.name)}
          </div>
          <div className="text-2xl font-extrabold text-gray-900 mt-4">Hi, {firstName(selected.name)}</div>

          {setupStep === 'start' ? (
            <div className="flex flex-col items-center w-full max-w-xs mt-2">
              <div className="text-gray-500 font-semibold text-center mt-1">You don’t have a PIN yet.</div>
              <div className="text-gray-500 text-center text-sm mt-2 mb-6">
                We’ll email you a 6-digit code to make sure it’s you. Then you pick your own 4-digit PIN.
              </div>
              <button
                onClick={requestSetupCode}
                disabled={busy}
                className="w-full bg-green-600 text-white py-4 rounded-2xl text-lg font-bold active:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
              {setupError && <div className="text-red-600 font-semibold text-sm text-center mt-4">{setupError}</div>}
            </div>
          ) : (
            <div className="flex flex-col w-full max-w-xs mt-2 gap-3">
              <div className="text-gray-500 text-center text-sm mb-1">
                We sent a code to <span className="font-bold text-gray-700">{setupEmailMasked}</span>. Enter it, then choose your PIN.
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Code from email</label>
                <input
                  inputMode="numeric" autoComplete="off" maxLength={6} placeholder="––––––"
                  value={setupCode}
                  onChange={e => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={setupInputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Choose a 4-digit PIN</label>
                <input
                  type="password" inputMode="numeric" autoComplete="off" maxLength={4} placeholder="••••"
                  value={setupPin}
                  onChange={e => setSetupPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={setupInputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Confirm PIN</label>
                <input
                  type="password" inputMode="numeric" autoComplete="off" maxLength={4} placeholder="••••"
                  value={setupConfirm}
                  onChange={e => setSetupConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={setupInputCls}
                />
              </div>
              {setupError && <div className="text-red-600 font-semibold text-sm text-center">{setupError}</div>}
              <button
                onClick={confirmSetup}
                disabled={busy}
                className="mt-1 bg-green-600 text-white py-4 rounded-2xl text-lg font-bold active:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Setting up…' : 'Set PIN & clock in'}
              </button>
              <button onClick={requestSetupCode} disabled={busy} className="text-gray-500 font-semibold underline text-sm active:text-gray-700 disabled:opacity-50">
                Resend code
              </button>
            </div>
          )}
        </div>
      </div>
    );
  } else {
    // ---- Staff grid ----
    const workingNow = staff.filter(s => s.clockedIn).length;
    const onBreakNow = staff.filter(s => s.onBreak).length;
    content = (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {header}
        <div className="flex-1 p-6">
          <div className="text-center text-gray-600 text-lg font-semibold mb-6">Tap your name to clock in or out</div>
          {flash && (
            <div className="max-w-md mx-auto mb-5 text-center bg-green-50 text-green-700 font-bold rounded-2xl px-5 py-3">
              {flash}
            </div>
          )}
          {notice && (
            <div className="max-w-md mx-auto mb-5 text-center bg-amber-50 text-amber-800 font-bold rounded-2xl px-5 py-3">
              {notice}
            </div>
          )}
          {staff.length === 0 ? (
            <div className="text-center text-gray-400 mt-16 text-lg">
              No staff found for this restaurant.
              <div className="text-base mt-1">Check the restaurant in ⚙ settings.</div>
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
                  {!s.hasPin ? (
                    <div className="text-sm font-bold text-blue-600">Set up PIN</div>
                  ) : s.clockedIn ? (
                    <div className="text-sm font-bold text-green-600">● Working</div>
                  ) : s.onBreak ? (
                    <div className="text-sm font-bold text-amber-600">⏸ On break</div>
                  ) : (
                    <div className="text-sm font-bold text-gray-400">○ Off</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {settings.showWorkingNow && (
          <footer className="text-center font-bold py-4">
            <span className="text-green-600">● {workingNow} working</span>
            {onBreakNow > 0 && <span className="text-amber-600"> · ⏸ {onBreakNow} on break</span>}
          </footer>
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      {overlay}
    </>
  );
}
