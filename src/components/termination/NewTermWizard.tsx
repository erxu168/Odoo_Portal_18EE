'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useCompany } from '@/lib/company-context';
import { ds } from '@/lib/design-system';
import AppHeader from '@/components/ui/AppHeader';
import type { TerminationType, CalcMethod } from '@/types/termination';

interface NewTermWizardProps {
  onBack: () => void;
  onCreated: (id: number) => void;
}

interface Employee {
  id: number;
  name: string;
  department_id: [number, string] | false;
  job_title: string | false;
  first_contract_date: string | false;
  company_id: [number, string];
}

const TYPE_OPTIONS: { value: TerminationType; label: string; desc: string; icon: string }[] = [
  { value: 'ordentlich_probezeit', label: 'Probation Termination', desc: '2 weeks notice, no reason required', icon: '\u{1F4CB}' },
  { value: 'ordentlich', label: 'Standard Termination', desc: 'Statutory notice per Section 622 BGB', icon: '\u{1F4C4}' },
  { value: 'fristlos', label: 'Immediate Termination', desc: 'Effective immediately, cause required', icon: '\u26A1' },
  { value: 'aufhebung', label: 'Mutual Agreement', desc: 'Mutual termination agreement', icon: '\u{1F91D}' },
  { value: 'bestaetigung', label: 'Employee Resignation Confirmation', desc: 'Confirm employee-initiated resignation', icon: '\u2709\uFE0F' },
];

export default function NewTermWizard({ onBack, onCreated }: NewTermWizardProps) {
  const { companyId } = useCompany();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [termType, setTermType] = useState<TerminationType>('ordentlich');
  const today = new Date().toISOString().split('T')[0];
  const [letterDate, setLetterDate] = useState(today);
  const [calcMethod, setCalcMethod] = useState<CalcMethod>('bgb');
  const [receiptDate, setReceiptDate] = useState('');
  const [gardenLeave, setGardenLeave] = useState(false);
  const [includeSeverance, setIncludeSeverance] = useState(false);
  const [severanceAmount, setSeveranceAmount] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('company_id', String(companyId));
      if (empSearch) params.set('search', empSearch);
      const res = await fetch(`/api/hr/employees?${params}`);
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch (_e) { void _e; }
    finally { setLoading(false); }
  }, [companyId, empSearch]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  function formatDate(d: string | false): string {
    if (!d) return '---';
    const parts = d.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  async function handleCreate() {
    if (!selectedEmp || !companyId) return;
    setSubmitting(true); setError('');
    try {
      const payload: Record<string, unknown> = {
        employee_id: selectedEmp.id, company_id: companyId,
        termination_type: termType, letter_date: letterDate, calc_method: calcMethod,
      };
      if (receiptDate) payload.receipt_date = receiptDate;
      if (gardenLeave) payload.garden_leave = true;
      if (includeSeverance && severanceAmount) { payload.include_severance = true; payload.severance_amount = parseFloat(severanceAmount); }
      if (incidentDate) payload.incident_date = incidentDate;
      if (incidentDesc) payload.incident_description = incidentDesc;

      const res = await fetch('/api/hr/termination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data.error || 'Failed');
      onCreated(data.id);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error creating termination'); }
    finally { setSubmitting(false); }
  }

  const ProgressDots = () => (
    <div className="flex gap-1.5 px-5 py-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className={`flex-1 h-1 rounded-full ${i < step ? 'bg-green-600' : i === step ? 'bg-green-600 opacity-50' : 'bg-gray-200'}`} />
      ))}
    </div>
  );

  const stepTitles = ['Select Employee', 'Termination Type', 'Details', 'Review'];

  return (
    <>
      <AppHeader supertitle={`STEP ${step} OF 4`} title={stepTitles[step - 1]} subtitle="New Termination" showBack onBack={step > 1 ? () => setStep(step - 1) : onBack} />
      <ProgressDots />
      <div className="px-4 pb-24">

        {step === 1 && (
          <>
            <p className="text-[13px] text-gray-500 mb-3">Select the employee to terminate.</p>
            <input className={`${ds.input} mb-3`} type="text" placeholder="Search by name..." value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
            {loading ? (
              <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>
            ) : (
              <div className={`${ds.card} overflow-hidden`}>
                {employees.map(emp => (
                  <button key={emp.id} onClick={() => setSelectedEmp(emp)}
                    className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 text-left transition-colors ${selectedEmp?.id === emp.id ? 'bg-green-50 border-l-[3px] border-l-green-600' : 'active:bg-gray-50'}`}>
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-[13px] font-bold text-gray-600 flex-shrink-0">{getInitials(emp.name)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-gray-900 truncate">{emp.name}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {emp.department_id ? emp.department_id[1].split('/').pop()?.trim() : 'No department'}
                        {emp.first_contract_date && <> &middot; since {formatDate(emp.first_contract_date)}</>}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedEmp?.id === emp.id ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300'}`}>
                      {selectedEmp?.id === emp.id && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                  </button>
                ))}
                {employees.length === 0 && <div className="py-8 text-center text-[13px] text-gray-500">No employees found</div>}
              </div>
            )}
            <button className={`${ds.btnPrimary} mt-4`} disabled={!selectedEmp} onClick={() => setStep(2)} style={!selectedEmp ? { opacity: 0.4 } : {}}>Next</button>
          </>
        )}

        {step === 2 && selectedEmp && (
          <>
            <p className="text-[13px] text-gray-500 mb-3">{selectedEmp.name}</p>
            <div className="space-y-2">
              {TYPE_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setTermType(opt.value)}
                  className={`${ds.card} w-full flex items-center gap-3 p-4 text-left transition-colors ${termType === opt.value ? 'ring-2 ring-green-600 bg-green-50' : 'active:bg-gray-50'}`}>
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold text-gray-900">{opt.label}</div>
                    <div className="text-[12px] text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <button className={`${ds.btnPrimary} mt-4`} onClick={() => setStep(3)}>Next</button>
          </>
        )}

        {step === 3 && selectedEmp && (
          <>
            <p className="text-[13px] text-gray-500 mb-3">{selectedEmp.name} &middot; {TYPE_OPTIONS.find(t => t.value === termType)?.label}</p>
            <div className={ds.fieldRow}>
              <label className={ds.label}>Letter Date</label>
              <input className={ds.input} type="date" value={letterDate} onChange={e => setLetterDate(e.target.value)} />
            </div>
            <div className={ds.fieldRow}>
              <label className={ds.label}>Calculation Method</label>
              <select className={ds.input} value={calcMethod} onChange={e => setCalcMethod(e.target.value as CalcMethod)}>
                <option value="bgb">Section 622 BGB (statutory)</option>
                <option value="receipt">From date of receipt</option>
              </select>
            </div>
            {calcMethod === 'receipt' && (<div className={ds.fieldRow}><label className={ds.label}>Receipt Date</label><input className={ds.input} type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} /></div>)}
            {termType === 'fristlos' && (
              <>
                <div className={ds.fieldRow}><label className={ds.label}>Incident Date</label><input className={ds.input} type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} /></div>
                <div className={ds.fieldRow}><label className={ds.label}>Description (internal)</label><textarea className={ds.input} rows={3} value={incidentDesc} onChange={e => setIncidentDesc(e.target.value)} placeholder="Reason for immediate termination..." /></div>
              </>
            )}
            {termType === 'aufhebung' && (
              <>
                <div className="flex items-center gap-3 mb-4"><input type="checkbox" id="gl" checked={gardenLeave} onChange={e => setGardenLeave(e.target.checked)} className="w-5 h-5 accent-green-600" /><label htmlFor="gl" className="text-[14px] font-medium text-gray-900">Garden Leave</label></div>
                <div className="flex items-center gap-3 mb-4"><input type="checkbox" id="sev" checked={includeSeverance} onChange={e => setIncludeSeverance(e.target.checked)} className="w-5 h-5 accent-green-600" /><label htmlFor="sev" className="text-[14px] font-medium text-gray-900">Severance Pay</label></div>
                {includeSeverance && (<div className={ds.fieldRow}><label className={ds.label}>Severance Amount (EUR)</label><input className={ds.input} type="number" step="0.01" value={severanceAmount} onChange={e => setSeveranceAmount(e.target.value)} placeholder="0.00" /></div>)}
              </>
            )}
            <button className={`${ds.btnPrimary} mt-2`} onClick={() => setStep(4)}>Review</button>
          </>
        )}

        {step === 4 && selectedEmp && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 mb-4">
              <span className="text-lg">\u26A0\uFE0F</span>
              <span className="text-[13px] text-amber-900 leading-relaxed">A draft will be created in Odoo. The letter must be confirmed and signed separately.</span>
            </div>
            <div className={`${ds.sectionLabel} mb-2`}>Employee</div>
            <div className={`${ds.card} mb-4`}>
              <div className="flex justify-between py-2.5 px-4 border-b border-gray-100"><span className="text-[13px] text-gray-500">Name</span><span className="text-[13px] font-medium">{selectedEmp.name}</span></div>
              <div className="flex justify-between py-2.5 px-4 border-b border-gray-100"><span className="text-[13px] text-gray-500">Department</span><span className="text-[13px] font-medium">{selectedEmp.department_id ? selectedEmp.department_id[1].split('/').pop()?.trim() : '---'}</span></div>
              <div className="flex justify-between py-2.5 px-4"><span className="text-[13px] text-gray-500">Since</span><span className="text-[13px] font-medium">{formatDate(selectedEmp.first_contract_date)}</span></div>
            </div>
            <div className={`${ds.sectionLabel} mb-2`}>Termination</div>
            <div className={`${ds.card} mb-4`}>
              <div className="flex justify-between py-2.5 px-4 border-b border-gray-100"><span className="text-[13px] text-gray-500">Type</span><span className="text-[13px] font-medium">{TYPE_OPTIONS.find(t => t.value === termType)?.label}</span></div>
              <div className="flex justify-between py-2.5 px-4 border-b border-gray-100"><span className="text-[13px] text-gray-500">Date</span><span className="text-[13px] font-medium">{formatDate(letterDate)}</span></div>
              <div className="flex justify-between py-2.5 px-4"><span className="text-[13px] text-gray-500">Method</span><span className="text-[13px] font-medium">{calcMethod === 'bgb' ? 'Section 622 BGB' : 'From Receipt'}</span></div>
              {gardenLeave && <div className="flex justify-between py-2.5 px-4 border-t border-gray-100"><span className="text-[13px] text-gray-500">Garden Leave</span><span className="text-[13px] font-medium">Yes</span></div>}
              {includeSeverance && severanceAmount && <div className="flex justify-between py-2.5 px-4 border-t border-gray-100"><span className="text-[13px] text-gray-500">Severance</span><span className="text-[13px] font-medium">{severanceAmount} EUR</span></div>}
            </div>
            <div className={`${ds.sectionLabel} mb-2`}>Company</div>
            <div className={`${ds.card} mb-6`}>
              <div className="flex justify-between py-2.5 px-4"><span className="text-[13px] text-gray-500">Company</span><span className="text-[13px] font-medium">{selectedEmp.company_id[1]}</span></div>
            </div>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[13px] text-red-800 mb-4">{error}</div>}
            <button className={ds.btnPrimary} onClick={handleCreate} disabled={submitting}>{submitting ? 'Creating...' : 'Create Termination'}</button>
            <button className={`${ds.btnSecondary} mt-2`} onClick={() => setStep(3)}>Back</button>
          </>
        )}
      </div>
    </>
  );
}
