'use client';

/**
 * Checklist Template Editor — edit the tasks inside one master checklist.
 * Two sections (Business / Employee). Each task: title, section, responsible,
 * optional deadline (days after the reference date) + reminder.
 */
import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { LEVEL_LABEL } from './ChecklistSetup';
import type { TemplateRow, TemplateTaskRow, Audience, ResponsibleType, UpsertTemplateTaskInput } from '@/types/staffing';

interface Assignee { id: number; name: string; role: string }

const RESP_LABEL: Record<ResponsibleType, string> = {
  specific_user: 'A specific person',
  employee_manager: "The employee's manager",
  the_employee: 'The employee',
};

export default function ChecklistTemplateEditor({ templateId, onBack }: {
  templateId: number; onBack: () => void;
}) {
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [tasks, setTasks] = useState<TemplateTaskRow[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TemplateTaskRow | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/staffing/templates/${templateId}`).then(r => r.json());
      setTemplate(d.template || null);
      setTasks(d.tasks || []);
      if (d.template?.company_id) {
        const a = await fetch(`/api/staffing/assignees?company_id=${d.template.company_id}`).then(r => r.json());
        setAssignees(a.assignees || []);
      }
    } catch { /* empty state */ }
    finally { setLoading(false); }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  const title = template
    ? template.scope === 'base'
      ? (template.stage === 'leaving' ? 'Every leaver' : 'Every new hire')
      : template.scope === 'level'
        ? `→ ${LEVEL_LABEL[template.target_level || ''] || template.target_level}`
        : template.name
    : 'Checklist';

  async function remove(id: number) {
    if (!confirm('Remove this task?')) return;
    await fetch(`/api/staffing/templates/${templateId}/tasks/${id}`, { method: 'DELETE' });
    load();
  }

  const business = tasks.filter(t => t.audience === 'business');
  const employee = tasks.filter(t => t.audience === 'employee');

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle={template ? template.stage.toUpperCase() : ''} title={title} subtitle="Edit tasks" showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="p-5 space-y-6">
          {template?.scope === 'team' && (
            <div className="flex gap-2 items-start rounded-xl bg-green-50 text-green-800 px-3 py-2.5 text-[12px] font-medium">
              <span>🌱</span><span>These add on top of the shared base list. Put only team-specific extras here.</span>
            </div>
          )}

          <Section title="Business tasks" count={business.length}>
            {business.map(t => <TaskRow key={t.id} task={t} assignees={assignees} onEdit={() => setEditing(t)} onDelete={() => remove(t.id)} />)}
          </Section>

          <Section title="Employee tasks" count={employee.length}>
            {employee.map(t => <TaskRow key={t.id} task={t} assignees={assignees} onEdit={() => setEditing(t)} onDelete={() => remove(t.id)} />)}
          </Section>
        </div>
      )}

      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50">
        <button onClick={() => setEditing('new')}
          className="w-full rounded-2xl bg-[#F5800A] text-white font-bold text-[15px] py-3.5 shadow-[0_1px_3px_rgba(245,128,10,0.35)] active:scale-[0.98]">
          + Add task
        </button>
      </div>

      {editing && (
        <TaskForm
          templateId={templateId}
          existing={editing === 'new' ? null : editing}
          assignees={assignees}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-gray-500 mb-2 px-1">{title} <span className="text-gray-400">· {count}</span></h2>
      {count === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-[13px] text-gray-500">No tasks yet.</div>
      ) : <div className="space-y-2">{children}</div>}
    </section>
  );
}

function TaskRow({ task, assignees, onEdit, onDelete }: { task: TemplateTaskRow; assignees: Assignee[]; onEdit: () => void; onDelete: () => void }) {
  const who = task.responsible_type === 'specific_user'
    ? (assignees.find(a => a.id === task.responsible_user_id)?.name || 'A person')
    : RESP_LABEL[task.responsible_type];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-gray-900">{task.title}</div>
        <div className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{who}</span>
          {task.due_offset_days != null && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">Day {task.due_offset_days}</span>}
          {task.reminder === 1 && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold">🔔</span>}
        </div>
      </div>
      <button onClick={onEdit} className="text-[13px] font-semibold text-[#C2410C] px-2 py-1">Edit</button>
      <button onClick={onDelete} className="text-[13px] font-semibold text-red-600 px-2 py-1">Delete</button>
    </div>
  );
}

function TaskForm({ templateId, existing, assignees, onClose, onSaved }: {
  templateId: number; existing: TemplateTaskRow | null; assignees: Assignee[];
  onClose: () => void; onSaved: () => void;
}) {
  const [audience, setAudience] = useState<Audience>(existing?.audience || 'business');
  const [title, setTitle] = useState(existing?.title || '');
  const [respType, setRespType] = useState<ResponsibleType>(existing?.responsible_type || 'employee_manager');
  const [respUser, setRespUser] = useState<number | ''>(existing?.responsible_user_id ?? '');
  const [hasDeadline, setHasDeadline] = useState(existing?.due_offset_days != null);
  const [days, setDays] = useState<number>(existing?.due_offset_days ?? 7);
  const [reminder, setReminder] = useState(existing?.reminder === 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Employee-only tasks can be assigned to "the employee"; business ones cannot.
  const respOptions: ResponsibleType[] = audience === 'employee'
    ? ['specific_user', 'employee_manager', 'the_employee']
    : ['specific_user', 'employee_manager'];

  async function submit() {
    setErr('');
    if (!title.trim()) { setErr('Enter a task title.'); return; }
    if (respType === 'specific_user' && respUser === '') { setErr('Pick the responsible person.'); return; }
    const body: UpsertTemplateTaskInput = {
      audience, title: title.trim(), responsible_type: respType,
      responsible_user_id: respType === 'specific_user' ? Number(respUser) : null,
      due_offset_days: hasDeadline ? days : null,
      reminder: hasDeadline && reminder,
    };
    setBusy(true);
    const url = existing
      ? `/api/staffing/templates/${templateId}/tasks/${existing.id}`
      : `/api/staffing/templates/${templateId}/tasks`;
    const res = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error || 'Could not save.'); setBusy(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-[19px] font-extrabold text-gray-900 mb-4">{existing ? 'Edit task' : 'Add task'}</h3>

        <FLabel>Task</FLabel>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Set up POS PIN"
          className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-[14px]" />

        <FLabel className="mt-4">List</FLabel>
        <Seg2 options={[['business', 'Business'], ['employee', 'Employee']]} value={audience}
          onChange={v => { setAudience(v as Audience); if (v === 'business' && respType === 'the_employee') setRespType('employee_manager'); }} />

        <FLabel className="mt-4">Responsible</FLabel>
        <select value={respType} onChange={e => setRespType(e.target.value as ResponsibleType)}
          className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-[14px]">
          {respOptions.map(o => <option key={o} value={o}>{RESP_LABEL[o]}</option>)}
        </select>
        {respType === 'specific_user' && (
          <select value={respUser} onChange={e => setRespUser(e.target.value ? Number(e.target.value) : '')}
            className="w-full mt-2 rounded-xl border border-gray-300 bg-gray-50 px-3 py-3 text-[14px]">
            <option value="">Choose a person…</option>
            {assignees.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
          </select>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-gray-700">Deadline</div>
            <div className="text-[11px] text-gray-500">Days after the start / change date</div>
          </div>
          <Toggle on={hasDeadline} onToggle={() => setHasDeadline(v => !v)} />
        </div>
        {hasDeadline && (
          <div className="mt-3 flex items-center gap-3">
            <input type="number" min={0} value={days} onChange={e => setDays(Math.max(0, Number(e.target.value)))}
              className="w-20 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-[14px] text-center font-bold" />
            <span className="text-[13px] text-gray-500">days</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[13px] text-gray-700">🔔 Remind</span>
              <Toggle on={reminder} onToggle={() => setReminder(v => !v)} />
            </div>
          </div>
        )}

        {err && <p className="text-[13px] text-red-600 mt-3">{err}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-gray-200 text-gray-600 font-semibold py-3">Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-2xl bg-[#F5800A] text-white font-bold py-3 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save task'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 ${className}`}>{children}</div>;
}
function Seg2({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      {options.map(([val, label]) => (
        <button key={val} onClick={() => onChange(val)}
          className={`flex-1 rounded-xl border py-2.5 text-[13px] font-bold ${value === val ? 'border-transparent bg-[#FFF4E6] text-[#C2410C]' : 'border-gray-200 bg-white text-gray-500'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className={`w-[46px] h-[27px] rounded-full relative transition-colors ${on ? 'bg-[#F5800A]' : 'bg-gray-300'}`}>
      <span className={`absolute top-[3px] w-[21px] h-[21px] rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-[3px]'}`} />
    </button>
  );
}
