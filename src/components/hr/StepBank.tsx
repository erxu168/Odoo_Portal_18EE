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

export default function StepBank({ employee, onNext, onPrev, saving }: Props) {
  const bankName = employee.bank_account_id ? (employee.bank_account_id as [number, string])[1] : '';
  const [iban, setIban] = useState(bankName);
  const ex = FIELD_EXPLAINERS.bank_iban;

  return (
    <div className="pb-40">
      <div className="p-5 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[13px] font-semibold text-gray-500 uppercase tracking-wide">IBAN</span>
            <InfoButton title={ex.title} text={ex.text} url={ex.url} urlLabel={ex.urlLabel} />
          </div>
          <input className="form-input font-mono" value={iban} onChange={e => setIban(e.target.value)} placeholder="DE__ ____ ____ ____ ____ __" />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[13px] text-amber-800">
          <strong>Note:</strong> Bank account changes are reviewed by your manager. Your IBAN is shown from your existing Odoo record.
        </div>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={() => onNext({})} disabled={saving} className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
