'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { TERMINATION_TYPE_LABELS, type TerminationType } from '@/types/termination';
import { useCompany } from '@/lib/company-context';
import PdfViewer from '@/components/ui/PdfViewer';

interface Employee {
  id: number;
  name: string;
  company_id: [number, string];
  department_id: [number, string] | false;
  job_title: string | false;
  private_street: string | false;
  private_city: string | false;
  private_zip: string | false;
}

interface TermWizardProps {
  onBack: () => void;
  onCreated: (id: number) => void;
  onHome: () => void;
}

type Step = 'employee' | 'type' | 'details' | 'preview';

export default function TermWizard({ onBack, onCreated, onHome }: TermWizardProps) {
  const { companyId } = useCompany();
  const [step, setStep] = useState<Step>('employee');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Employee filters
  const [deptFilter, setDeptFilter] = useState<number | null>(null); // null = All

  // Form
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [termType, setTermType] = useState<TerminationType | ''>('');
  const [letterDate, setLetterDate] = useState(new Date().toISOString().split('T')[0]);
  const [calcMethod, setCalcMethod] = useState<'bgb' | 'receipt'>('bgb');
  const [receiptDate, setReceiptDate] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [lastWorkingDayManual, setLastWorkingDayManual] = useState('');
  const [includeSeverance, setIncludeSeverance] = useState(false);
  const [severanceAmount, setSeveranceAmount] = useState('');
  const [gardenLeave, setGardenLeave] = useState(false);
  const [resignationDate, setResignationDate] = useState('');

  // Preview
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [computedNoticePeriod, setComputedNoticePeriod] = useState('');
  const [computedLastDay, setComputedLastDay] = useState('');
  const [createdRecordId, setCreatedRecordId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = companyId
          ? `/api/termination/employees?company_id=${companyId}`
          : '/api/termination/employees';
        const res = await fetch(url);
        const json = await res.json();
        setEmployees(json.data || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  // Extract unique departments for filter chips
  const departments = useMemo(() => {
    const deptMap = new Map<number, string>();
    for (const emp of employees) {
      if (emp.department_id) {
        deptMap.set(emp.department_id[0], emp.department_id[1]);
      }
    }
    return Array.from(deptMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (deptFilter !== null) {
        if (!e.department_id || e.department_id[0] !== deptFilter) return false;
      }
      return true;
    });
  }, [employees, search, deptFilter]);

  const termTypes: { value: TerminationType; label: string; desc: string }[] = [
    { value: 'ordentlich', label: 'Standard Termination', desc: 'Statutory notice period (\u00a7622 BGB)' },
    { value: 'ordentlich_probezeit', label: 'Probation Termination', desc: '2 weeks notice' },
    { value: 'fristlos', label: 'Immediate Termination', desc: 'Effective immediately (\u00a7626 BGB)' },
    { value: 'aufhebung', label: 'Mutual Agreement', desc: 'Aufhebungsvertrag' },
    { value: 'bestaetigung', label: 'Resignation Acknowledgment', desc: 'Employee resigned' },
  ];

  function buildFormBody(): Record<string, unknown> {
    if (!selectedEmployee || !termType) return {};
    const body: Record<string, unknown> = {
      employee_id: selectedEmployee.id,
      company_id: selectedEmployee.company_id[0],
      termination_type: termType,
      calc_method: calcMethod,
      letter_date: letterDate,
      employee_name: selectedEmployee.name,
      employee_street: selectedEmployee.private_street || '',
      employee_city: selectedEmployee.private_city || '',
      employee_zip: selectedEmployee.private_zip || '',
    };
    if (receiptDate) body.receipt_date = receiptDate;
    if (termType === 'fristlos') {
      if (incidentDate) body.incident_date = incidentDate;
      if (incidentDescription) body.incident_description = incidentDescription;
    }
    if (termType === 'aufhebung') {
      if (lastWorkingDayManual) body.last_working_day = lastWorkingDayManual;
      body.include_severance = includeSeverance;
      if (includeSeverance && severanceAmount) body.severance_amount = parseFloat(severanceAmount);
      body.garden_leave = gardenLeave;
    }
    if (termType === 'bestaetigung' && resignationDate) {
      body.resignation_received_date = resignationDate;
    }
    return body;
  }

  async function handleGeneratePreview() {
    setPreviewLoading(true);
    setError('');
    try {
      const body = buildFormBody();
      const createRes = await fetch('/api/termination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const createJson = await createRes.json();
      if (!createJson.ok) throw new Error(createJson.error || 'Failed to create draft');

      const rec = createJson.data;
      setComputedNoticePeriod(rec.notice_period_text || '');
      setComputedLastDay(rec.last_working_day || '');

      const previewBody = {
        ...body,
        notice_period_text: rec.notice_period_text,
        last_working_day: rec.last_working_day,
        employee_start_date: rec.employee_start_date,
        tenure_years: rec.tenure_years,
      };

      const pdfRes = await fetch('/api/termination/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewBody),
      });
      const pdfJson = await pdfRes.json();
      if (!pdfJson.ok) throw new Error(pdfJson.error || 'PDF preview failed');

      setPdfBase64(pdfJson.pdfBase64);
      setCreatedRecordId(rec.id);
      setStep('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirm() {
    if (!createdRecordId) return;
    setSubmitting(true);
    setError('');
    try {
      const confirmRes = await fetch(`/api/termination/${createdRecordId}/confirm`, { method: 'POST' });
      const confirmJson = await confirmRes.json();
      if (!confirmJson.ok) throw new Error(confirmJson.error || 'Confirmation failed');

      const pdfRes = await fetch(`/api/termination/${createdRecordId}/pdf`, { method: 'POST' });
      if (!pdfRes.ok) {
        const pdfJson = await pdfRes.json();
        throw new Error(pdfJson.error || 'PDF generation failed');
      }

      onCreated(createdRecordId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDiscard() {
    if (createdRecordId) {
      try {
        await fetch(`/api/termination/${createdRecordId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'cancelled' }),
        });
      } catch { /* best effort */ }
      setCreatedRecordId(null);
    }
    setPdfBase64(null);
    setStep('details');
  }

  const formatDate = (d: string | false) => {
    if (!d) return '\u2013';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  function renderStepEmployee() {
    return (
      <>
        {/* Search */}
        <div className="mb-3">
          <input
            type="text" placeholder="Search employee..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30"
            autoFocus
          />
        </div>

        {/* Department filter chips */}
        {departments.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setDeptFilter(null)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                deptFilter === null
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
              }`}
            >
              All ({employees.length})
            </button>
            {departments.map(dept => {
              const count = employees.filter(e => e.department_id && e.department_id[0] === dept.id).length;
              return (
                <button
                  key={dept.id}
                  onClick={() => setDeptFilter(deptFilter === dept.id ? null : dept.id)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    deptFilter === dept.id
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                  }`}
                >
                  {dept.name} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Employee list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="text-[11px] text-gray-400 mb-2 px-1">
              {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}
            </div>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {filteredEmployees.map(emp => (
                <button
                  key={emp.id}
                  onClick={() => { setSelectedEmployee(emp); setStep('type'); }}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selectedEmployee?.id === emp.id
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-200 bg-white active:bg-gray-50'
                  }`}
                >
                  <div className="text-[14px] font-semibold text-gray-900">{emp.name}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">
                    {emp.department_id ? emp.department_id[1] : 'No department'}
                    {emp.job_title ? ` \u2022 ${emp.job_title}` : ''}
                  </div>
                </button>
              ))}
              {filteredEmployees.length === 0 && (
                <p className="text-center text-gray-400 text-[13px] py-8">No employees found</p>
              )}
            </div>
          </>
        )}
      </>
    );
  }

  function renderStepType() {
    return (
      <div className="space-y-2">
        <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
          <span className="text-[12px] text-gray-500">Employee</span>
          <div className="text-[14px] font-semibold">{selectedEmployee?.name}</div>
        </div>
        {termTypes.map(t => (
          <button
            key={t.value}
            onClick={() => { setTermType(t.value); setStep('details'); }}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${
              termType === t.value
                ? 'border-red-400 bg-red-50'
                : 'border-gray-200 bg-white active:bg-gray-50'
            }`}
          >
            <div className="text-[14px] font-semibold text-gray-900">{t.label}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>
    );
  }

  function renderStepDetails() {
    const showCalcMethod = termType === 'ordentlich' || termType === 'ordentlich_probezeit';
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex justify-between">
            <div><span className="text-[12px] text-gray-500">Employee</span><div className="text-[14px] font-semibold">{selectedEmployee?.name}</div></div>
            <div className="text-right"><span className="text-[12px] text-gray-500">Type</span><div className="text-[13px] font-medium">{termType ? TERMINATION_TYPE_LABELS[termType] : ''}</div></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="block">
            <span className="text-[12px] text-gray-500">Letter date</span>
            <input type="date" value={letterDate} onChange={e => setLetterDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
          </label>

          {showCalcMethod && (
            <label className="block">
              <span className="text-[12px] text-gray-500">Calculation method</span>
              <select value={calcMethod} onChange={e => setCalcMethod(e.target.value as 'bgb' | 'receipt')}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none">
                <option value="bgb">{'\u00a7'} 622 BGB statutory</option>
                <option value="receipt">From date of receipt</option>
              </select>
            </label>
          )}

          {showCalcMethod && calcMethod === 'receipt' && (
            <label className="block">
              <span className="text-[12px] text-gray-500">Date of receipt</span>
              <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
            </label>
          )}

          {termType === 'fristlos' && (
            <>
              <label className="block">
                <span className="text-[12px] text-gray-500">Incident date</span>
                <input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </label>
              <label className="block">
                <span className="text-[12px] text-gray-500">Description (internal only)</span>
                <textarea value={incidentDescription} onChange={e => setIncidentDescription(e.target.value)}
                  rows={3} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none" />
              </label>
            </>
          )}

          {termType === 'aufhebung' && (
            <>
              <label className="block">
                <span className="text-[12px] text-gray-500">Last working day</span>
                <input type="date" value={lastWorkingDayManual} onChange={e => setLastWorkingDayManual(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={gardenLeave} onChange={e => setGardenLeave(e.target.checked)} className="w-5 h-5 rounded" />
                <span className="text-[14px]">Garden leave (Freistellung)</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={includeSeverance} onChange={e => setIncludeSeverance(e.target.checked)} className="w-5 h-5 rounded" />
                <span className="text-[14px]">Severance payment (Abfindung)</span>
              </label>
              {includeSeverance && (
                <label className="block">
                  <span className="text-[12px] text-gray-500">Severance amount (EUR)</span>
                  <input type="number" step="0.01" value={severanceAmount} onChange={e => setSeveranceAmount(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                </label>
              )}
            </>
          )}

          {termType === 'bestaetigung' && (
            <label className="block">
              <span className="text-[12px] text-gray-500">Resignation received on</span>
              <input type="date" value={resignationDate} onChange={e => setResignationDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
            </label>
          )}
        </div>

        {error && <div className="bg-red-50 text-red-700 text-[13px] px-4 py-3 rounded-xl">{error}</div>}

        <button
          onClick={handleGeneratePreview}
          disabled={previewLoading}
          className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold text-[15px] active:bg-red-700 disabled:opacity-50"
        >
          {previewLoading ? 'Generating preview...' : 'Preview letter'}
        </button>
      </div>
    );
  }

  function renderStepPreview() {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Employee</span><span className="text-[14px] font-medium">{selectedEmployee?.name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Type</span><span className="text-[13px] font-medium">{termType ? TERMINATION_TYPE_LABELS[termType] : ''}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Notice period</span><span className="text-[14px] font-medium">{computedNoticePeriod}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Last working day</span><span className="text-[14px] font-bold text-red-600">{formatDate(computedLastDay)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 text-[12px]">Letter date</span><span className="text-[14px]">{formatDate(letterDate)}</span></div>
        </div>

        {pdfBase64 && (
          <button
            onClick={() => setShowPdfViewer(true)}
            className="w-full py-3.5 rounded-xl bg-white border-2 border-red-200 text-red-700 font-semibold text-[14px] flex items-center justify-center gap-2 active:bg-red-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            View draft letter
          </button>
        )}

        {error && <div className="bg-red-50 text-red-700 text-[13px] px-4 py-3 rounded-xl">{error}</div>}

        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full py-3.5 rounded-xl bg-red-600 text-white font-semibold text-[15px] active:bg-red-700 disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Confirm & create termination'}
        </button>

        <button
          onClick={handleDiscard}
          className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-[14px] active:bg-gray-200"
        >
          Edit details
        </button>

        {showPdfViewer && pdfBase64 && (
          <PdfViewer
            fileData={pdfBase64}
            fileName="Termination_Draft.pdf"
            onClose={() => setShowPdfViewer(false)}
          />
        )}
      </div>
    );
  }

  const stepLabels: Record<Step, string> = {
    employee: '1. Select employee',
    type: '2. Termination type',
    details: '3. Details',
    preview: '4. Review & confirm',
  };

  return (
    <div>
      <div className="bg-[#DC2626] px-5 pt-12 pb-3 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={step === 'employee' ? onBack : () => {
            if (step === 'type') setStep('employee');
            else if (step === 'details') setStep('type');
            else if (step === 'preview') handleDiscard();
          }} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">New Termination</h1>
            <p className="text-[12px] text-white/60 mt-0.5">{stepLabels[step]}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
        </div>
        <div className="flex gap-1 mt-3">
          {(['employee', 'type', 'details', 'preview'] as Step[]).map((s, i) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${
              i <= ['employee', 'type', 'details', 'preview'].indexOf(step)
                ? 'bg-white'
                : 'bg-white/20'
            }`} />
          ))}
        </div>
      </div>

      <div className="px-4 py-4">
        {step === 'employee' && renderStepEmployee()}
        {step === 'type' && renderStepType()}
        {step === 'details' && renderStepDetails()}
        {step === 'preview' && renderStepPreview()}
      </div>
    </div>
  );
}
