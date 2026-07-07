'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { SectionTitle, Spinner, ToggleSwitch } from '@/components/shifts/ui';
import RolesDeptManager from '@/components/shifts/RolesDeptManager';
import { ds } from '@/lib/design-system';

/**
 * Shift Settings — manager-only, per company.
 * Behavior policies are toggles, not code: approval requirement, answer/settle
 * deadlines, ask-all and the one-tap sick lane. Saved via PUT /api/shifts/settings.
 */

interface ShiftSettingsProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

interface SettingsForm {
  requireApproval: boolean;
  answerDeadlineHours: number;
  settleBufferHours: number;
  allowAskAll: boolean;
  allowSickReport: boolean;
}

const ANSWER_HOURS = [4, 8, 12, 24];
const SETTLE_HOURS = [1, 2, 4, 12];

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function hourOptions(base: number[], current: number): number[] {
  return base.includes(current) ? base : [current, ...base].sort((a, b) => a - b);
}

function SettingRow({
  title,
  hint,
  control,
  divider,
}: {
  title: string;
  hint: string;
  control: React.ReactNode;
  divider: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${divider ? 'border-t border-gray-100' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[var(--fs-md)] font-bold text-gray-900">{title}</div>
        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 leading-snug">{hint}</div>
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

export default function ShiftSettings({ companyId, onBack }: ShiftSettingsProps) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/settings?company_id=${companyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Accept either a bare settings object or one nested under "settings".
      const s = data.settings && typeof data.settings === 'object' ? data.settings : data;
      setForm({
        requireApproval: bool(s.requireApproval, true),
        answerDeadlineHours: numOr(s.answerDeadlineHours, 12),
        settleBufferHours: numOr(s.settleBufferHours, 2),
        allowAskAll: bool(s.allowAskAll, true),
        allowSickReport: bool(s.allowSickReport, true),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) fetchSettings();
  }, [companyId, fetchSettings]);

  function update(patch: Partial<SettingsForm>) {
    setForm(f => (f ? { ...f, ...patch } : f));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/shifts/settings?company_id=${companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    'bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[var(--fs-md)] font-semibold text-gray-900 outline-none focus:border-green-600 min-h-[44px]';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Shift Settings" showBack onBack={onBack} />

      <div className="pb-36 max-w-xl mx-auto w-full">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load settings</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchSettings}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : form ? (
          <>
            <SectionTitle>Cover requests</SectionTitle>
            <div className="mx-4 bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <SettingRow
                title="Require my approval"
                hint="Off: covers apply as soon as the teammate accepts — you’re notified and can undo"
                divider={false}
                control={
                  <ToggleSwitch
                    on={form.requireApproval}
                    onToggle={() => update({ requireApproval: !form.requireApproval })}
                  />
                }
              />
              <SettingRow
                title="Time to answer a request"
                hint="Then it returns to the asker"
                divider
                control={
                  <select
                    aria-label="Time to answer a request"
                    className={selectClass}
                    value={form.answerDeadlineHours}
                    onChange={e => update({ answerDeadlineHours: Number(e.target.value) })}
                  >
                    {hourOptions(ANSWER_HOURS, form.answerDeadlineHours).map(h => (
                      <option key={h} value={h}>
                        {h} hours
                      </option>
                    ))}
                  </select>
                }
              />
              <SettingRow
                title="Settled before shift start"
                hint="Closer than this, staff are pointed to you"
                divider
                control={
                  <select
                    aria-label="Settled before shift start"
                    className={selectClass}
                    value={form.settleBufferHours}
                    onChange={e => update({ settleBufferHours: Number(e.target.value) })}
                  >
                    {hourOptions(SETTLE_HOURS, form.settleBufferHours).map(h => (
                      <option key={h} value={h}>
                        {h} hour{h === 1 ? '' : 's'}
                      </option>
                    ))}
                  </select>
                }
              />
              <SettingRow
                title="Ask all eligible at once"
                hint="First yes wins"
                divider
                control={
                  <ToggleSwitch
                    on={form.allowAskAll}
                    onToggle={() => update({ allowAskAll: !form.allowAskAll })}
                  />
                }
              />
            </div>

            <SectionTitle>Sick reports</SectionTitle>
            <div className="mx-4 bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <SettingRow
                title="One-tap sick report"
                hint="Goes straight to you, marked At risk"
                divider={false}
                control={
                  <ToggleSwitch
                    on={form.allowSickReport}
                    onToggle={() => update({ allowSickReport: !form.allowSickReport })}
                  />
                }
              />
            </div>

            <div className="pt-2">
              <RolesDeptManager companyId={companyId} />
            </div>

            <p className="text-[var(--fs-xs)] text-gray-400 text-center px-6 pt-4 leading-snug">
              Settings and roles/departments apply to this company only.
            </p>

            {saveError && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
                {saveError}
              </div>
            )}
          </>
        ) : null}
      </div>

      {form && !loading && !error && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 max-w-xl mx-auto px-4 py-3 safe-bottom">
          <button onClick={handleSave} disabled={saving} className={`${ds.btnPrimary} disabled:opacity-50`}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}

      {savedToast && (
        <div className="fixed bottom-24 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-sm)] font-semibold text-white shadow-lg">
          Settings saved
        </div>
      )}
    </div>
  );
}
