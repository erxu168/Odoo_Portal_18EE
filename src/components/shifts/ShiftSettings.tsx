'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { SectionTitle, Spinner, ToggleSwitch } from '@/components/shifts/ui';
import RolesDeptManager from '@/components/shifts/RolesDeptManager';

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
  onOpenPatterns?: () => void;
}

interface SettingsForm {
  requireApproval: boolean;
  answerDeadlineHours: number;
  settleBufferHours: number;
  allowAskAll: boolean;
  allowSickReport: boolean;
  weekendEnabled: boolean;
  requireConfirmation: boolean;
  confirmByHours: number;
  reminderEmailEnabled: boolean;
  reminderEveningTime: string;
  reminderMorningTime: string;
  reminderFinalLeadHours: number;
  agCostMinijob: number;
  agCostRegular: number;
}

const ANSWER_HOURS = [4, 8, 12, 24];
const SETTLE_HOURS = [1, 2, 4, 12];
const CONFIRM_HOURS = [12, 24, 48];
const EVENING_TIMES = ['16:00', '17:00', '18:00', '19:00', '20:00'];
const MORNING_TIMES = ['07:00', '08:00', '09:00', '10:00', '11:00'];
const FINAL_LEAD_HOURS = [2, 3, 4, 6];

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v ? v : fallback;
}

function timeOptions(base: string[], current: string): string[] {
  return base.includes(current) ? base : [...base, current].sort();
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** A percentage 0–100 (0 is valid, unlike numOr). */
function pctOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback;
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

export default function ShiftSettings({ companyId, onBack, onOpenPatterns }: ShiftSettingsProps) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  // AG-rate inputs are free numbers → edit locally, commit on blur (the instant-
  // save would otherwise PUT invalid half-typed values).
  const [agMiniStr, setAgMiniStr] = useState('');
  const [agRegStr, setAgRegStr] = useState('');

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
        weekendEnabled: bool(s.weekendEnabled, true),
        requireConfirmation: bool(s.requireConfirmation, false),
        confirmByHours: numOr(s.confirmByHours, 24),
        reminderEmailEnabled: bool(s.reminderEmailEnabled, false),
        reminderEveningTime: str(s.reminderEveningTime, '18:00'),
        reminderMorningTime: str(s.reminderMorningTime, '09:00'),
        reminderFinalLeadHours: numOr(s.reminderFinalLeadHours, 3),
        agCostMinijob: pctOr(s.agCostMinijob, 30),
        agCostRegular: pctOr(s.agCostRegular, 21),
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

  // Instant save (matches the roles/departments editor): each change PUTs
  // immediately and shows a brief "Saved" toast — no separate Save button to
  // forget on the way out.
  async function update(patch: Partial<SettingsForm>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/shifts/settings?company_id=${companyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
      void fetchSettings(); // resync to what's actually stored
    } finally {
      setSaving(false);
    }
  }

  // Keep the AG-input strings in sync when the stored values change (load/save).
  useEffect(() => {
    if (form) {
      setAgMiniStr(String(form.agCostMinijob));
      setAgRegStr(String(form.agCostRegular));
    }
  }, [form?.agCostMinijob, form?.agCostRegular]);

  function commitAg(field: 'agCostMinijob' | 'agCostRegular', raw: string, current: number, resync: (s: string) => void) {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) {
      resync(String(current)); // ignore blank / invalid → restore the stored value
      return;
    }
    const n = Math.max(0, Math.min(100, Math.round(parsed * 10) / 10));
    if (n !== current) void update({ [field]: n } as Partial<SettingsForm>);
    else resync(String(current));
  }

  const selectClass =
    'bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[var(--fs-md)] font-semibold text-gray-900 outline-none focus:border-green-600 min-h-[44px]';
  const pctInputClass =
    'w-20 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-[var(--fs-md)] font-semibold text-gray-900 text-right outline-none focus:border-green-600 min-h-[44px] tabular-nums';

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

            <SectionTitle>Weekend rule</SectionTitle>
            <div className="mx-4 bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <SettingRow
                title="Weekend shifts first"
                hint="Staff must claim their fair share of Fri–Sun shifts before they can pick weekday shifts"
                divider={false}
                control={
                  <ToggleSwitch
                    on={form.weekendEnabled}
                    onToggle={() => update({ weekendEnabled: !form.weekendEnabled })}
                  />
                }
              />
            </div>

            <SectionTitle>Shift confirmation</SectionTitle>
            <div className="mx-4 bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <SettingRow
                title="Require shift confirmation"
                hint="Staff must tap “I’ll be there” on their shifts; you get a board of who hasn’t confirmed"
                divider={false}
                control={
                  <ToggleSwitch
                    on={form.requireConfirmation}
                    onToggle={() => update({ requireConfirmation: !form.requireConfirmation })}
                  />
                }
              />
              {form.requireConfirmation && (
                <>
                  <SettingRow
                    title="Alert me by"
                    hint="How long before a shift an unconfirmed one is flagged for you on the board"
                    divider
                    control={
                      <select
                        aria-label="Alert me by"
                        className={selectClass}
                        value={form.confirmByHours}
                        onChange={e => update({ confirmByHours: Number(e.target.value) })}
                      >
                        {hourOptions(CONFIRM_HOURS, form.confirmByHours).map(h => (
                          <option key={h} value={h}>
                            {h} hours before
                          </option>
                        ))}
                      </select>
                    }
                  />
                      <SettingRow
                        title="Evening-before reminder"
                        hint="First reminder — the evening before (drives the app + push nudge, and email if on)"
                        divider
                        control={
                          <select
                            aria-label="Evening-before reminder time"
                            className={selectClass}
                            value={form.reminderEveningTime}
                            onChange={e => update({ reminderEveningTime: e.target.value })}
                          >
                            {timeOptions(EVENING_TIMES, form.reminderEveningTime).map(t => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        }
                      />
                      <SettingRow
                        title="Morning-of reminder"
                        hint="Second reminder, on the morning of the shift"
                        divider
                        control={
                          <select
                            aria-label="Morning-of reminder time"
                            className={selectClass}
                            value={form.reminderMorningTime}
                            onChange={e => update({ reminderMorningTime: e.target.value })}
                          >
                            {timeOptions(MORNING_TIMES, form.reminderMorningTime).map(t => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        }
                      />
                      <SettingRow
                        title="Final reminder"
                        hint="Last reminder before the shift, then it’s escalated to you"
                        divider
                        control={
                          <select
                            aria-label="Final reminder lead time"
                            className={selectClass}
                            value={form.reminderFinalLeadHours}
                            onChange={e => update({ reminderFinalLeadHours: Number(e.target.value) })}
                          >
                            {(FINAL_LEAD_HOURS.includes(form.reminderFinalLeadHours)
                              ? FINAL_LEAD_HOURS
                              : [...FINAL_LEAD_HOURS, form.reminderFinalLeadHours].sort((a, b) => a - b)
                            ).map(h => (
                              <option key={h} value={h}>
                                {h} hours before
                              </option>
                            ))}
                          </select>
                        }
                      />
                      <SettingRow
                        title="Email reminders"
                        hint="Also email the reminder with a one-tap confirm link (on top of the app nudges)"
                        divider
                        control={
                          <ToggleSwitch
                            on={form.reminderEmailEnabled}
                            onToggle={() => update({ reminderEmailEnabled: !form.reminderEmailEnabled })}
                          />
                        }
                      />
                </>
              )}
            </div>

            <SectionTitle>Labour cost</SectionTitle>
            <div className="mx-4 bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
              <SettingRow
                title="Employer costs — Minijob"
                hint="Extra % on top of gross pay for Minijob staff (employer social contributions)"
                divider={false}
                control={
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.5}
                      aria-label="Employer on-cost percentage for Minijob staff"
                      className={pctInputClass}
                      value={agMiniStr}
                      onChange={e => setAgMiniStr(e.target.value)}
                      onBlur={e => commitAg('agCostMinijob', e.target.value, form.agCostMinijob, setAgMiniStr)}
                    />
                    <span className="text-[var(--fs-md)] font-bold text-gray-500">%</span>
                  </div>
                }
              />
              <SettingRow
                title="Employer costs — regular staff"
                hint="Extra % for Midijob / full-time staff (pension, health, unemployment, care…)"
                divider
                control={
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.5}
                      aria-label="Employer on-cost percentage for regular staff"
                      className={pctInputClass}
                      value={agRegStr}
                      onChange={e => setAgRegStr(e.target.value)}
                      onBlur={e => commitAg('agCostRegular', e.target.value, form.agCostRegular, setAgRegStr)}
                    />
                    <span className="text-[var(--fs-md)] font-bold text-gray-500">%</span>
                  </div>
                }
              />
            </div>
            <div className="mx-4 mt-1.5 text-[var(--fs-sm)] text-gray-400 leading-snug">
              Used to estimate the full cost of each shift. A planning estimate — not exact payroll.
            </div>

            {onOpenPatterns && (
              <>
                <SectionTitle>Planning setup</SectionTitle>
                <button
                  onClick={onOpenPatterns}
                  className="mx-4 w-[calc(100%-2rem)] bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] flex items-center gap-3 px-4 py-3.5 active:bg-gray-50"
                >
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[var(--fs-md)] font-bold text-gray-900">Patterns &amp; publishing</div>
                    <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 leading-snug">
                      Build a weekly pattern once, then publish it with a deadline for staff to pick
                    </div>
                  </div>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}

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

      {savedToast && !saving && (
        <div className="fixed bottom-10 left-1/2 z-[110] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-sm)] font-semibold text-white shadow-lg">
          Saved
        </div>
      )}
    </div>
  );
}
