'use client';

/**
 * Auto-with-confirm prompt to start a lifecycle checklist for one employee.
 * Shows a live preview ("6 base + 3 Kitchen = 9") before creating anything.
 * Used after hire, on a promotion (level-up), on termination, and for manual starts.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { LEVEL_LABEL } from './ChecklistSetup';
import type { Stage } from '@/types/staffing';

interface PreviewData {
  total: number; business: number; employee: number; hasBase: boolean; hasTeam: boolean;
  setupComplete: boolean; referenceDate: string; hasContractDate: boolean;
  departmentName: string | null; employeeName: string; currentLevel: string | null;
}

export default function StartChecklistPrompt({
  employeeId, fixedStage, defaultTargetLevel, fromLevel, terminationId, onStarted, onClose,
}: {
  employeeId: number;
  fixedStage?: Stage;
  defaultTargetLevel?: string;
  fromLevel?: string | null;
  terminationId?: number;
  onStarted: (instanceId: number) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>(fixedStage || 'joining');
  const [targetLevel, setTargetLevel] = useState<string>(defaultTargetLevel || '2');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [existingId, setExistingId] = useState<number | null>(null);
  const [startKey] = useState(() =>
    (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sk-${employeeId}-${Date.now()}`);

  const loadPreview = useCallback(async () => {
    setLoading(true); setErr(''); setExistingId(null);
    try {
      const params = new URLSearchParams({ employee_id: String(employeeId), stage });
      if (stage === 'promotion') params.set('target_level', targetLevel);
      const res = await fetch(`/api/staffing/checklists/preview?${params}`);
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Could not load.'); setPreview(null); }
      else setPreview(data);
    } catch { setErr('Could not load.'); }
    finally { setLoading(false); }
  }, [employeeId, stage, targetLevel]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function start() {
    setBusy(true); setErr(''); setExistingId(null);
    try {
      const res = await fetch('/api/staffing/checklists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId, stage, start_key: startKey,
          target_level: stage === 'promotion' ? targetLevel : undefined,
          from_level: stage === 'promotion' ? (fromLevel ?? undefined) : undefined,
          termination_id: terminationId,
        }),
      });
      const data = await res.json();
      if (res.ok) { onStarted(data.id); return; }
      if (res.status === 409 && data.id) { setExistingId(data.id); setErr(data.error || 'Already open.'); }
      else setErr(data.error || 'Could not start.');
    } catch { setErr('Could not start.'); }
    finally { setBusy(false); }
  }

  const stageWord = stage === 'leaving' ? 'leaving' : stage === 'promotion' ? 'promotion' : 'joining';
  const name = preview?.employeeName || 'this employee';

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="w-11 h-11 rounded-xl bg-green-100 text-green-700 grid place-items-center text-xl mb-3">
          {stage === 'leaving' ? '🚪' : stage === 'promotion' ? '⬆️' : '🌱'}
        </div>
        <h3 className="text-[19px] font-extrabold text-gray-900 mb-1">
          Start {name}&rsquo;s {stageWord} checklist?
        </h3>

        {!fixedStage && (
          <div className="flex gap-2 my-3">
            {(['joining', 'promotion', 'leaving'] as Stage[]).map(s => (
              <button key={s} onClick={() => setStage(s)}
                className={`flex-1 rounded-xl border py-2 text-[12px] font-bold capitalize ${
                  stage === s ? 'border-transparent bg-[#FFF4E6] text-[#C2410C]' : 'border-gray-200 bg-white text-gray-500'}`}>
                {s}
              </button>
            ))}
          </div>
        )}

        {stage === 'promotion' && (
          <div className="flex gap-2 my-3">
            {['2', '3'].map(l => (
              <button key={l} onClick={() => setTargetLevel(l)}
                className={`flex-1 rounded-xl border py-2 text-[12px] font-bold ${
                  targetLevel === l ? 'border-transparent bg-[#FFF4E6] text-[#C2410C]' : 'border-gray-200 bg-white text-gray-500'}`}>
                → {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : preview && preview.setupComplete ? (
          <p className="text-[13.5px] text-gray-600 leading-relaxed mb-4">
            This creates <strong className="text-gray-800">{preview.total} tasks</strong>
            {stage !== 'promotion' && preview.hasTeam && preview.departmentName
              ? <> — the base list plus <strong className="text-gray-800">{preview.departmentName}</strong> extras</> : null}
            {' '}({preview.business} for your team, {preview.employee} for {preview.employeeName || 'the employee'}).
            {stage === 'joining' && !preview.hasContractDate
              ? <span className="block mt-1 text-amber-700">No start date on file — deadlines will count from today.</span> : null}
          </p>
        ) : (
          <p className="text-[13.5px] text-amber-700 mb-4">
            No {stageWord} checklist is set up for this {stage === 'promotion' ? 'level' : "employee's team"} yet.
            Ask an admin to create one in Checklist Setup.
          </p>
        )}

        {err && (
          <div className="mb-3">
            <p className="text-[13px] text-red-600">{err}</p>
            {existingId != null && (
              <button onClick={() => onStarted(existingId)} className="text-[13px] font-semibold text-[#C2410C] mt-1">Open the existing checklist →</button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-gray-200 text-gray-600 font-semibold py-3">Not now</button>
          <button onClick={start} disabled={busy || loading || !preview?.setupComplete}
            className="flex-1 rounded-2xl bg-[#F5800A] text-white font-bold py-3 disabled:opacity-50">
            {busy ? 'Starting…' : 'Start checklist'}
          </button>
        </div>
      </div>
    </div>
  );
}
