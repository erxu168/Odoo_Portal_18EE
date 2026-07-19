'use client';

/**
 * Checklist Setup — admin master lists for the Staff Lifecycle Checklists feature.
 * Grouped by stage (Joining / Promotion / Leaving). Joining & Leaving hold a shared
 * `base` list + per-team add-ons; Promotion holds one list per target level.
 */
import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';
import type { Stage, Scope } from '@/types/staffing';

interface TemplateWithCounts {
  id: number; stage: Stage; scope: Scope; department_id: number | null;
  target_level: string | null; name: string;
  task_count: number; business_count: number; employee_count: number;
}
interface Dept { id: number; name: string }

const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: 'joining', label: 'Joining', hint: 'When someone is hired' },
  { key: 'promotion', label: 'Promotion', hint: 'When someone moves up a level' },
  { key: 'leaving', label: 'Leaving', hint: 'When someone is terminated' },
];
export const LEVEL_LABEL: Record<string, string> = { '1': 'Trainee', '2': 'Associate', '3': 'Team Lead' };

export default function ChecklistSetup({ onBack, onOpen }: {
  onBack: () => void;
  onOpen: (templateId: number) => void;
}) {
  const { companyId } = useCompany();
  const [rows, setRows] = useState<TemplateWithCounts[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [t, d] = await Promise.all([
        fetch(`/api/staffing/templates?company_id=${companyId}`).then(r => r.json()),
        fetch(`/api/hr/departments?company_id=${companyId}`).then(r => r.json()),
      ]);
      setRows(t.templates || []);
      setDepts(d.departments || []);
    } catch { /* surfaced as empty state */ }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function subtitle(r: TemplateWithCounts): string {
    const parts = [`${r.task_count} ${r.task_count === 1 ? 'task' : 'tasks'}`];
    if (r.business_count) parts.push(`${r.business_count} business`);
    if (r.employee_count) parts.push(`${r.employee_count} employee`);
    return parts.join(' · ');
  }

  function scopeLabel(r: TemplateWithCounts): string {
    if (r.scope === 'base') return r.stage === 'leaving' ? 'Every leaver (base)' : 'Every new hire (base)';
    if (r.scope === 'team') return depts.find(d => d.id === r.department_id)?.name || 'Team';
    if (r.scope === 'level') return `→ ${LEVEL_LABEL[r.target_level || ''] || r.target_level}`;
    return r.name;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="ADMIN" title="Checklist Setup" subtitle="Hire, promote & leave" showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 space-y-6">
          {STAGES.map(stage => {
            const stageRows = rows.filter(r => r.stage === stage.key);
            return (
              <section key={stage.key}>
                <div className="flex items-baseline justify-between mb-2 px-1">
                  <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-gray-500">{stage.label}</h2>
                  <span className="text-[11px] text-gray-400">{stage.hint}</span>
                </div>
                {stageRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-[13px] text-gray-500">
                    No {stage.label.toLowerCase()} checklist yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stageRows.map(r => (
                      <button
                        key={r.id}
                        onClick={() => onOpen(r.id)}
                        className="w-full flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:scale-[0.99] transition-transform"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-bold text-gray-900 truncate">{scopeLabel(r)}</span>
                            {r.scope === 'base' && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">base</span>
                            )}
                          </div>
                          <div className="text-[12px] text-gray-500 mt-0.5">{subtitle(r)}</div>
                        </div>
                        <span className="text-gray-300 text-lg">›</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50">
        <button
          onClick={() => setCreating(true)}
          className="w-full rounded-2xl bg-[#F5800A] text-white font-bold text-[15px] py-3.5 shadow-[0_1px_3px_rgba(245,128,10,0.35)] active:scale-[0.98]"
        >
          + New checklist
        </button>
      </div>

      {creating && companyId && (
        <NewChecklistModal
          companyId={companyId}
          depts={depts}
          existing={rows}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onOpen(id); }}
        />
      )}
    </div>
  );
}

function NewChecklistModal({ companyId, depts, existing, onClose, onCreated }: {
  companyId: number; depts: Dept[]; existing: TemplateWithCounts[];
  onClose: () => void; onCreated: (id: number) => void;
}) {
  const [stage, setStage] = useState<Stage>('joining');
  const [scope, setScope] = useState<Scope>('base');
  const [deptId, setDeptId] = useState<number | ''>('');
  const [level, setLevel] = useState<string>('2');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isPromotion = stage === 'promotion';
  const effectiveScope: Scope = isPromotion ? 'level' : scope;

  // Prevent duplicate base/team/level lists (the DB also enforces this).
  const dupBase = effectiveScope === 'base' && existing.some(r => r.stage === stage && r.scope === 'base');
  const dupTeam = effectiveScope === 'team' && deptId !== '' && existing.some(r => r.stage === stage && r.scope === 'team' && r.department_id === deptId);
  const dupLevel = effectiveScope === 'level' && existing.some(r => r.scope === 'level' && r.target_level === level);

  async function submit() {
    setErr('');
    if (effectiveScope === 'team' && deptId === '') { setErr('Pick a team.'); return; }
    const defaultName = effectiveScope === 'base'
      ? (stage === 'leaving' ? 'Every leaver' : 'Every new hire')
      : effectiveScope === 'team'
        ? depts.find(d => d.id === deptId)?.name || 'Team'
        : `→ ${LEVEL_LABEL[level]}`;
    setBusy(true);
    try {
      const res = await fetch('/api/staffing/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId, stage, scope: effectiveScope,
          department_id: effectiveScope === 'team' ? deptId : null,
          target_level: effectiveScope === 'level' ? level : null,
          name: name.trim() || defaultName,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Could not create checklist.'); setBusy(false); return; }
      onCreated(data.id);
    } catch { setErr('Could not create checklist.'); setBusy(false); }
  }

  const dup = dupBase || dupTeam || dupLevel;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-[19px] font-extrabold text-gray-900 mb-4">New checklist</h3>

        <Label>Stage</Label>
        <Seg options={[['joining', 'Joining'], ['promotion', 'Promotion'], ['leaving', 'Leaving']]} value={stage} onChange={v => setStage(v as Stage)} />

        {!isPromotion && (
          <>
            <Label className="mt-4">Type</Label>
            <Seg options={[['base', 'Shared base'], ['team', 'Team add-on']]} value={scope} onChange={v => setScope(v as Scope)} />
          </>
        )}

        {!isPromotion && scope === 'team' && (
          <>
            <Label className="mt-4">Team</Label>
            <select value={deptId} onChange={e => setDeptId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-[14px]">
              <option value="">Choose a team…</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        )}

        {isPromotion && (
          <>
            <Label className="mt-4">Promote to</Label>
            <Seg options={[['2', '→ Associate'], ['3', '→ Team Lead']]} value={level} onChange={setLevel} />
          </>
        )}

        <Label className="mt-4">Name (optional)</Label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Auto-named if left blank"
          className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-[14px]" />

        {dup && <p className="text-[13px] text-amber-700 mt-3">A checklist of this kind already exists — open it instead.</p>}
        {err && <p className="text-[13px] text-red-600 mt-3">{err}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-gray-200 text-gray-600 font-semibold py-3">Cancel</button>
          <button onClick={submit} disabled={busy || dup}
            className="flex-1 rounded-2xl bg-[#F5800A] text-white font-bold py-3 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 ${className}`}>{children}</div>;
}

function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      {options.map(([val, label]) => (
        <button key={val} onClick={() => onChange(val)}
          className={`flex-1 rounded-xl border py-2.5 text-[13px] font-bold ${
            value === val ? 'border-transparent bg-[#FFF4E6] text-[#C2410C]' : 'border-gray-200 bg-white text-gray-500'
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}
