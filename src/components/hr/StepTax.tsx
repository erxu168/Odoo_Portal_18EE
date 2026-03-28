'use client';

import React, { useState } from 'react';
import InfoButton from '@/components/hr/InfoButton';
import type { EmployeeData } from '@/types/hr';
import { FIELD_EXPLAINERS } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
}

export default function StepTax({ employee, onNext, onPrev, saving }: Props) {
  const [steuerId, setSteuerId] = useState(employee.kw_steuer_id || '');
  const [idNr, setIdNr] = useState(employee.identification_id || '');
  const [steuerklasse, setSteuerklasse] = useState(employee.kw_steuerklasse || '');
  const [konfession, setKonfession] = useState(employee.kw_konfession || '--');
  const [kinder, setKinder] = useState(String(employee.kw_kinderfreibetrag || 0));

  function handleSubmit() {
    onNext({
      kw_steuer_id: steuerId || false,
      identification_id: idNr || false,
      kw_steuerklasse: steuerklasse || false,
      kw_konfession: konfession,
      kw_kinderfreibetrag: parseFloat(kinder) || 0,
    });
  }

  const ex = FIELD_EXPLAINERS;

  return (
    <div className="pb-40">
      <div className="p-5 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">Tax ID</span>
            <span className="text-[12px] text-gray-400">(Steuer-ID)</span>
            <InfoButton title={ex.kw_steuer_id.title} text={ex.kw_steuer_id.text} url={ex.kw_steuer_id.url} urlLabel={ex.kw_steuer_id.urlLabel} />
          </div>
          <input className="form-input font-mono" value={steuerId} onChange={e => setSteuerId(e.target.value)} placeholder="e.g. 12 345 678 901" maxLength={14} />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">ID card number</span>
            <span className="text-[12px] text-gray-400">(Personalausweis-Nr.)</span>
          </div>
          <input className="form-input font-mono" value={idNr} onChange={e => setIdNr(e.target.value)} placeholder="e.g. T220001293" />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">Tax class</span>
            <span className="text-[12px] text-gray-400">(Steuerklasse)</span>
            <InfoButton title={ex.kw_steuerklasse.title} text={ex.kw_steuerklasse.text} url={ex.kw_steuerklasse.url} urlLabel={ex.kw_steuerklasse.urlLabel} />
          </div>
          <select className="form-input" value={steuerklasse} onChange={e => setSteuerklasse(e.target.value as any)}>
            <option value="">Select your tax class...</option>
            <option value="1">I - Single / Divorced / Widowed</option>
            <option value="2">II - Single parent</option>
            <option value="3">III - Married (partner in Class V)</option>
            <option value="4">IV - Married (both Class IV)</option>
            <option value="5">V - Married (partner in Class III)</option>
            <option value="6">VI - Second job</option>
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">Church tax</span>
            <span className="text-[12px] text-gray-400">(Konfession)</span>
            <InfoButton title={ex.kw_konfession.title} text={ex.kw_konfession.text} url={ex.kw_konfession.url} urlLabel={ex.kw_konfession.urlLabel} />
          </div>
          <select className="form-input" value={konfession} onChange={e => setKonfession(e.target.value as any)}>
            <option value="--">None (no church tax)</option>
            <option value="ev">Protestant (Evangelisch)</option>
            <option value="rk">Roman Catholic (Roemisch-katholisch)</option>
            <option value="ak">Old Catholic (Altkatholisch)</option>
            <option value="jd">Jewish (Juedisch)</option>
          </select>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">Child tax allowance</span>
            <span className="text-[12px] text-gray-400">(Kinderfreibetrag)</span>
            <InfoButton title={ex.kw_kinderfreibetrag.title} text={ex.kw_kinderfreibetrag.text} />
          </div>
          <select className="form-input" value={kinder} onChange={e => setKinder(e.target.value)}>
            <option value="0">0 — No children</option>
            <option value="0.5">0.5 — 1 child (shared custody)</option>
            <option value="1">1.0 — 1 child (full allowance)</option>
            <option value="1.5">1.5 — 2 children (1 full + 1 shared)</option>
            <option value="2">2.0 — 2 children (full allowance)</option>
            <option value="2.5">2.5 — 3 children (2 full + 1 shared)</option>
            <option value="3">3.0 — 3 children (full allowance)</option>
            <option value="3.5">3.5 — 4 children (3 full + 1 shared)</option>
            <option value="4">4.0 — 4 children (full allowance)</option>
            <option value="4.5">4.5 — 5 children (4 full + 1 shared)</option>
            <option value="5">5.0 — 5 children (full allowance)</option>
          </select>
        </div>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleSubmit} disabled={saving} className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
