'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, EmptyState, SearchBar, Sheet, Spinner } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import { useCompany } from '@/lib/company-context';
import type { ShiftEmployee } from '@/types/shifts';

/**
 * Roster & Caps — manager team list.
 * Per person: roles they can work as, weekly hour cap, skill level.
 * Tap a person → edit sheet (cap input, skill radios, role chips) → PUT roster/[id].
 */

interface RosterCapsProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

interface RoleOption {
  id: number;
  name: string;
}

type SkillLevel = '1' | '2' | '3';

const SKILL_OPTIONS: { value: SkillLevel; title: string; desc: string }[] = [
  { value: '1', title: 'Trainee', desc: 'Cannot work alone — always paired with someone experienced' },
  { value: '2', title: 'Associate', desc: 'Can hold a shift on their own' },
  { value: '3', title: 'Team Lead', desc: 'Works alone and is trained on every task' },
];

const SKILL_BADGE: Record<SkillLevel, { variant: 'amber' | 'blue' | 'green'; label: string }> = {
  '1': { variant: 'amber', label: 'Trainee' },
  '2': { variant: 'blue', label: 'Associate' },
  '3': { variant: 'green', label: 'Team Lead' },
};

type EmpType = 'minijob' | 'midijob' | 'fulltime';
const EMP_TYPES: { value: EmpType; label: string }[] = [
  { value: 'minijob', label: 'Minijob' },
  { value: 'midijob', label: 'Midijob' },
  { value: 'fulltime', label: 'Full-time' },
];
const EMP_TYPE_LABEL: Record<EmpType, string> = { minijob: 'Minijob', midijob: 'Midijob', fulltime: 'Full-time' };
const MINIJOB_CAP = 603;
function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function fmtCap(cap: number): string {
  return `${cap % 1 === 0 ? cap.toFixed(0) : cap} h/wk`;
}

export default function RosterCaps({ companyId, onBack }: RosterCapsProps) {
  const { companyName } = useCompany();
  const [employees, setEmployees] = useState<ShiftEmployee[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Edit sheet state
  const [editing, setEditing] = useState<ShiftEmployee | null>(null);
  const [capStr, setCapStr] = useState('');
  const [skill, setSkill] = useState<SkillLevel | null>(null);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [empType, setEmpType] = useState<EmpType | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [pinStr, setPinStr] = useState('');
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/roster?company_id=${companyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmployees(Array.isArray(data.employees) ? data.employees : []);
      setRoles(Array.isArray(data.roles) ? data.roles : []);
      setPinnedIds(new Set(Array.isArray(data.pinnedEmployeeIds) ? data.pinnedEmployeeIds : []));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) fetchRoster();
  }, [companyId, fetchRoster]);

  const roleNameById = new Map<number, string>(roles.map(r => [r.id, r.name]));

  function roleNames(e: ShiftEmployee): string {
    const names = e.roleIds.map(id => roleNameById.get(id)).filter((v): v is string => Boolean(v));
    return names.join(' · ');
  }

  const filtered = employees.filter(e => {
    if (!search) return true;
    return e.name.toLowerCase().includes(search.toLowerCase());
  });

  function openEdit(e: ShiftEmployee) {
    setEditing(e);
    setCapStr(e.cap !== null ? String(e.cap % 1 === 0 ? e.cap.toFixed(0) : e.cap) : '');
    setSkill(e.skill);
    setRoleIds(e.roleIds);
    setEmpType(e.employmentType);
    setNeedsConfirm(false);
    setPinStr('');
    setSaveError(null);
  }

  function toggleRole(id: number) {
    setRoleIds(prev => (prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!editing) return;
    const trimmed = capStr.trim();
    const capNum = trimmed === '' ? null : Number(trimmed);
    if (capNum !== null && (!Number.isFinite(capNum) || capNum < 0)) {
      setSaveError('Enter a valid number of hours, or leave it empty for no cap.');
      return;
    }
    if (pinStr && !/^\d{4}$/.test(pinStr)) {
      setSaveError('PIN must be exactly 4 digits.');
      return;
    }
    // Employment type is an official HR change — confirm before writing it back.
    if (empType !== editing.employmentType && !needsConfirm) {
      setNeedsConfirm(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/shifts/roster/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          cap: capNum,
          skill,
          role_ids: roleIds,
          employment_type: empType,
          pin: /^\d{4}$/.test(pinStr) ? pinStr : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEditing(null);
      setNeedsConfirm(false);
      await fetchRoster();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Roster & Caps" showBack onBack={onBack} />

      <div className="pt-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search team…" />
      </div>

      <div className="px-4 pb-24">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load the roster</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={fetchRoster}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : employees.length === 0 ? (
          <EmptyState icon="👥" title="No team members" body="People scheduled for this company will appear here." />
        ) : (
          <>
            <div className="text-[var(--fs-xs)] font-semibold tracking-wider uppercase text-gray-400 px-1 pt-2 pb-2">
              {companyName || 'Team'} · {employees.length} {employees.length === 1 ? 'person' : 'people'}
            </div>

            {filtered.length === 0 ? (
              <EmptyState icon="🔍" title="No matches" body="Nobody on the team matches your search." />
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
                {filtered.map((e, i) => {
                  const names = roleNames(e);
                  const badge = e.skill ? SKILL_BADGE[e.skill] : null;
                  return (
                    <button
                      key={e.id}
                      onClick={() => openEdit(e)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
                        {initials(e.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{e.name}</div>
                        <div className={`text-[var(--fs-sm)] mt-0.5 truncate ${names ? 'text-gray-500' : 'text-gray-400'}`}>
                          {names || 'No role yet'}
                          {e.employmentType ? ` · ${EMP_TYPE_LABEL[e.employmentType]}` : ''}
                          {pinnedIds.has(e.id) ? ' · 🔑' : ''}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        {e.cap !== null ? (
                          <div className="text-[var(--fs-md)] font-bold text-gray-900 tabular-nums">{fmtCap(e.cap)}</div>
                        ) : e.skill !== null ? (
                          <div className="text-[var(--fs-md)] font-bold text-gray-900">No cap</div>
                        ) : (
                          <div className="text-[var(--fs-sm)] text-gray-500">—</div>
                        )}
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="gray">Not set</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)}>
        {editing && (
          <div className="flex flex-col gap-4 px-4 pb-6">
            <div className="flex items-center gap-3">
              <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
                {initials(editing.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">{editing.name}</div>
                <div className={`text-[var(--fs-sm)] truncate ${roleNames(editing) ? 'text-gray-500' : 'text-gray-400'}`}>
                  {roleNames(editing) || 'No role yet'}
                </div>
              </div>
            </div>

            <div>
              <div className={ds.label}>Employment type</div>
              <div className="flex gap-2">
                {EMP_TYPES.map(t => {
                  const on = empType === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => setEmpType(on ? null : t.value)}
                      className={`flex-1 h-11 rounded-xl text-[var(--fs-sm)] font-bold border transition-colors ${
                        on ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              {empType === 'minijob' && (
                <p className="text-[var(--fs-sm)] text-amber-700 mt-1.5 leading-snug">
                  Minijob earnings limit {eur(MINIJOB_CAP)}/month — you’ll be warned before scheduling over it.
                </p>
              )}
            </div>

            <div>
              <div className={ds.label}>Pay rate</div>
              <div className="flex items-center justify-between bg-gray-100 border border-gray-200 rounded-xl px-4 py-3">
                <span className="text-[var(--fs-md)] font-bold text-gray-900 tabular-nums">{eur(editing.hourlyRate)} / h</span>
                <span className="text-[var(--fs-xs)] text-gray-500">
                  {editing.hasContract ? '🔒 from contract' : '🔒 min-wage (no contract)'}
                </span>
              </div>
            </div>

            <div>
              <div className={ds.label}>Weekly hour cap</div>
              <div className="flex items-center gap-2 max-w-[220px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus-within:border-green-600">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={capStr}
                  onChange={e => setCapStr(e.target.value)}
                  placeholder="—"
                  className="w-16 bg-transparent outline-none text-[var(--fs-md)] font-semibold text-gray-900 placeholder-gray-400"
                />
                <span className="text-[var(--fs-sm)] text-gray-400 whitespace-nowrap">hours / week</span>
              </div>
              <p className="text-[var(--fs-sm)] text-gray-500 mt-1.5 leading-snug">
                Leave empty for no cap. Staff can still take more — you’ll see a warning flag when they do.
              </p>
            </div>

            <div>
              <div className={ds.label}>Skill level</div>
              <div className="flex flex-col gap-2">
                {SKILL_OPTIONS.map(opt => {
                  const sel = skill === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSkill(sel ? null : opt.value)}
                      className={`flex items-start gap-2.5 w-full text-left border rounded-xl px-3.5 py-3 transition-colors ${
                        sel ? 'border-green-600 bg-green-50/60' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <span
                        className={`w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                          sel ? 'border-green-600 bg-green-600' : 'border-gray-300'
                        }`}
                      >
                        {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[var(--fs-md)] font-bold text-gray-900">{opt.title}</span>
                        <span className="block text-[var(--fs-sm)] text-gray-500 leading-snug">{opt.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className={ds.label}>Can work as</div>
              {roles.length === 0 ? (
                <p className="text-[var(--fs-sm)] text-gray-400">No roles set up yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => {
                    const on = roleIds.includes(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => toggleRole(r.id)}
                        className={`px-3.5 py-2 rounded-full text-[var(--fs-sm)] font-bold border transition-colors ${
                          on
                            ? 'bg-gray-900 border-gray-900 text-white'
                            : 'bg-white border-gray-200 text-gray-500'
                        }`}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className={ds.label}>
                Kiosk PIN{pinnedIds.has(editing.id) ? <span className="text-green-600 font-bold"> · set ✓</span> : ''}
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={4}
                value={pinStr}
                onChange={e => setPinStr(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder={pinnedIds.has(editing.id) ? '•••• (blank = keep)' : 'Set a 4-digit PIN'}
                className="w-full max-w-[220px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[var(--fs-md)] font-semibold text-gray-900 tracking-[0.4em] outline-none focus:border-green-600"
              />
              <p className="text-[var(--fs-sm)] text-gray-500 mt-1.5 leading-snug">
                Staff type this on the tablet clock to clock in/out. Blank = leave unchanged.
              </p>
            </div>

            {saveError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
                {saveError}
              </div>
            )}

            {needsConfirm && (
              <div className="rounded-xl bg-amber-50 border border-amber-300 p-3.5">
                <div className="text-[var(--fs-md)] font-bold text-amber-900 mb-1">
                  Update {editing.name.split(' ')[0]}’s Employee file?
                </div>
                <div className="text-[var(--fs-sm)] text-amber-800 leading-snug mb-3">
                  Employment type is stored on the official Employee record in Odoo HR — payroll, tax class and
                  social insurance follow from it.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNeedsConfirm(false)}
                    className="flex-1 h-11 rounded-xl border border-gray-300 bg-white text-gray-700 text-[var(--fs-sm)] font-bold active:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 h-11 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Update file'}
                  </button>
                </div>
              </div>
            )}

            {!needsConfirm && (
              <button onClick={handleSave} disabled={saving} className={`${ds.btnPrimary} disabled:opacity-50`}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
