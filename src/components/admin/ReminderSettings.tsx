'use client';

import React, { useEffect, useState } from 'react';

/**
 * Admin → HR document reminders & expiry alerts. Toggles the two weekly email
 * automations (backed by Odoo config params + scheduled actions in
 * krawings_hr_doc_reminder). Test mode routes every email to one address so a
 * live run can be trialled before it reaches real staff.
 */
const inp =
  'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white text-[var(--fs-base)] outline-none focus:border-green-600';
const lbl = 'block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1.5';

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-100 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[var(--fs-base)] font-semibold text-gray-900">{label}</div>
        {desc && <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{desc}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={'relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ' + (on ? 'bg-green-600' : 'bg-gray-300')}
      >
        <span className={'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-6' : 'left-1')} />
      </button>
    </div>
  );
}

export default function ReminderSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [remindersOn, setRemindersOn] = useState(false);
  const [expiryOn, setExpiryOn] = useState(false);
  const [contractOn, setContractOn] = useState(false);
  const [hrInbox, setHrInbox] = useState('');
  const [leadDays, setLeadDays] = useState('30');
  const [contractLeadDays, setContractLeadDays] = useState('45');
  const [testRecipient, setTestRecipient] = useState('');

  useEffect(() => {
    fetch('/api/admin/reminder-settings')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setMsg({ kind: 'err', text: d.error }); return; }
        setRemindersOn(!!d.remindersOn);
        setExpiryOn(!!d.expiryOn);
        setContractOn(!!d.contractOn);
        setHrInbox(d.hrInbox || '');
        setLeadDays(String(d.leadDays || 30));
        setContractLeadDays(String(d.contractLeadDays || 45));
        setTestRecipient(d.testRecipient || '');
      })
      .catch(() => setMsg({ kind: 'err', text: 'Could not load settings' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (msg?.kind === 'ok') { const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); }
  }, [msg]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/reminder-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersOn, expiryOn, contractOn, hrInbox, leadDays: Number(leadDays) || 30, contractLeadDays: Number(contractLeadDays) || 45, testRecipient }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setMsg({ kind: 'ok', text: 'Saved' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
      <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Document reminders &amp; expiry alerts</div>
      <p className="text-[var(--fs-sm)] text-gray-500 mb-4">
        Automatic weekly emails that nudge staff about missing documents, and warn before residence permits, visas and
        food-hygiene cards expire.
      </p>

      {loading ? (
        <div className="text-[var(--fs-sm)] text-gray-400 py-4">Loading…</div>
      ) : (
        <>
          <Toggle
            on={remindersOn}
            onChange={setRemindersOn}
            label="Missing-document reminders"
            desc="Weekly email to any staff member still missing a mandatory document, plus a summary to the HR inbox."
          />
          <Toggle
            on={expiryOn}
            onChange={setExpiryOn}
            label="Expiry alerts"
            desc="Warn staff and the HR inbox before a residence permit, visa or food-hygiene card expires."
          />
          <Toggle
            on={contractOn}
            onChange={setContractOn}
            label="Contract-end reminders"
            desc="Alert the manager / HR inbox before a fixed-term contract ends, so it can be renewed in time. Staff are not emailed."
          />

          <div className="mt-4">
            <label className={lbl}>HR summary inbox</label>
            <input value={hrInbox} onChange={e => setHrInbox(e.target.value)} placeholder="e.g. join@krawings.de" type="email" className={inp} />
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1">Where the outstanding-staff summaries go (for teams with no manager assigned).</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Expiry: days before to warn</label>
              <input value={leadDays} onChange={e => setLeadDays(e.target.value)} inputMode="numeric" placeholder="30" className={inp} />
            </div>
            <div>
              <label className={lbl}>Contract end: days before to warn</label>
              <input value={contractLeadDays} onChange={e => setContractLeadDays(e.target.value)} inputMode="numeric" placeholder="45" className={inp} />
            </div>
          </div>

          <div className="mt-4">
            <label className={lbl}>Test mode (optional)</label>
            <input value={testRecipient} onChange={e => setTestRecipient(e.target.value)} placeholder="leave blank for normal sending" type="email" className={inp} />
            <p className="text-[var(--fs-xs)] text-amber-600 mt-1">
              If you put an address here, ALL reminder emails go only to it (labelled with who they were meant for) — a
              safe way to trial a live run before it reaches real staff. Clear it to send for real.
            </p>
          </div>

          {(remindersOn || expiryOn || contractOn) && !testRecipient.trim() && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[var(--fs-sm)] text-amber-800">
              These emails go out to real staff and managers. Tip: put your own address in Test mode above first to preview a live run safely.
            </div>
          )}

          <button onClick={save} disabled={saving} className="w-full py-3 mt-5 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:bg-green-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>

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
