'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * Admin → Email (SMTP) settings, per company. Each restaurant can use its own
 * outgoing mailbox (Strato, Gmail app-password, or any SMTP host). Company 0 =
 * "Default (all restaurants)" fallback used when a company has none of its own.
 */

interface Company {
  id: number;
  name: string;
}
interface Effective {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passwordSet: boolean;
}

const PRESETS: Record<string, { host: string; port: string; secure: boolean; note?: string }> = {
  strato: { host: 'smtp.strato.de', port: '465', secure: true },
  gmail: { host: 'smtp.gmail.com', port: '587', secure: false, note: 'Gmail needs an “App Password” (not your normal password) — create one in your Google account security settings.' },
};

const inp =
  'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white text-[var(--fs-base)] outline-none focus:border-green-600';
const lbl = 'block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1.5';

export default function EmailSettings() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number>(0);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [secure, setSecure] = useState(true);
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [effective, setEffective] = useState<Effective | null>(null);
  const [presetNote, setPresetNote] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/companies')
      .then(r => r.json())
      .then(d => setCompanies(Array.isArray(d.companies) ? d.companies : []))
      .catch(() => {});
  }, []);

  const load = useCallback(async (cid: number) => {
    setLoading(true);
    setMsg(null);
    setPresetNote(null);
    try {
      const r = await fetch(`/api/admin/email-settings?company_id=${cid}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load');
      setHost(d.host || '');
      setPort(d.port || '');
      setSecure(d.secure === '1' ? true : d.secure === '0' ? false : (d.effective?.secure ?? true));
      setUser(d.user || '');
      setFrom(d.from || '');
      setPassword('');
      setPasswordSet(!!d.passwordSet);
      setEffective(d.effective || null);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not load settings' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(companyId);
  }, [companyId, load]);

  function applyPreset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    setHost(p.host);
    setPort(p.port);
    setSecure(p.secure);
    setPresetNote(p.note || null);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, host, port, secure: secure ? '1' : '0', user, from, password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setPassword('');
      await load(companyId);
      return true;
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (await save()) setMsg({ kind: 'ok', text: 'Saved' });
  }

  async function sendTest() {
    if (!testTo.trim()) {
      setMsg({ kind: 'err', text: 'Enter an email address to send the test to.' });
      return;
    }
    setTesting(true);
    setMsg(null);
    const ok = await save(); // save first so the test uses the current values
    if (!ok) {
      setTesting(false);
      return;
    }
    try {
      const r = await fetch('/api/admin/email-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, to: testTo.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Send failed');
      setMsg({ kind: 'ok', text: d.message || 'Test email sent — check the inbox.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setTesting(false);
    }
  }

  const inherits = !user && effective?.passwordSet;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
      <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Email (SMTP)</div>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">
        The outgoing mailbox each restaurant uses for staff invites and password-reset emails. Each restaurant can
        have its own, or leave it blank to use the shared default.
      </p>

      <label className={lbl}>Restaurant</label>
      <select value={companyId} onChange={e => setCompanyId(Number(e.target.value))} className={`${inp} appearance-none mb-4`}>
        <option value={0}>Default (all restaurants)</option>
        {companies.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {loading ? (
        <div className="text-[var(--fs-sm)] text-gray-400 py-4">Loading…</div>
      ) : (
        <>
          {companyId !== 0 && inherits && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-[var(--fs-sm)] text-blue-800">
              This restaurant currently uses the <b>default</b> mailbox ({effective?.user}). Fill this in to give it its own.
            </div>
          )}

          <label className={lbl}>Quick setup</label>
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={() => applyPreset('strato')} className="px-3 py-2 rounded-lg border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-700 active:bg-gray-50">Strato</button>
            <button type="button" onClick={() => applyPreset('gmail')} className="px-3 py-2 rounded-lg border border-gray-200 text-[var(--fs-sm)] font-semibold text-gray-700 active:bg-gray-50">Gmail</button>
            <span className="text-[var(--fs-xs)] text-gray-400 self-center">or fill in a custom server below</span>
          </div>
          {presetNote && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[var(--fs-sm)] text-amber-800">{presetNote}</div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className={lbl}>SMTP server (host)</label>
              <input value={host} onChange={e => setHost(e.target.value)} placeholder="e.g. smtp.strato.de" className={inp} />
            </div>
            <div>
              <label className={lbl}>Port</label>
              <input value={port} onChange={e => setPort(e.target.value)} placeholder="465" inputMode="numeric" className={inp} />
            </div>
            <div>
              <label className={lbl}>Security</label>
              <select value={secure ? 'ssl' : 'starttls'} onChange={e => setSecure(e.target.value === 'ssl')} className={`${inp} appearance-none`}>
                <option value="ssl">SSL (usually port 465)</option>
                <option value="starttls">STARTTLS (usually port 587)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={lbl}>Username (the email login)</label>
              <input value={user} onChange={e => setUser(e.target.value)} placeholder="noreply@krawings.de" autoComplete="off" className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Password {passwordSet && <span className="text-green-600 normal-case font-medium">· saved</span>}</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={passwordSet ? '•••••••• (leave blank to keep)' : 'mailbox password / app password'}
                autoComplete="new-password"
                className={inp}
              />
            </div>
            <div className="col-span-2">
              <label className={lbl}>“From” address (optional)</label>
              <input value={from} onChange={e => setFrom(e.target.value)} placeholder="defaults to the username" className={inp} />
            </div>
          </div>

          <button onClick={onSave} disabled={saving} className="w-full py-3 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:bg-green-700 disabled:opacity-50 mb-4">
            {saving ? 'Saving…' : 'Save'}
          </button>

          <div className="border-t border-gray-100 pt-4">
            <label className={lbl}>Send a test email</label>
            <div className="flex gap-2">
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="your@email.com" type="email" className={inp} />
              <button onClick={sendTest} disabled={testing} className="px-4 py-2.5 bg-gray-900 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-90 disabled:opacity-50 whitespace-nowrap">
                {testing ? 'Sending…' : 'Send test'}
              </button>
            </div>
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5">Saves first, then sends — so you test exactly what you entered.</p>
          </div>

          {msg && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-[var(--fs-sm)] ${msg.kind === 'ok' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {msg.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
