'use client';

import React, { useState, useEffect } from 'react';
import InfoButton from '@/components/hr/InfoButton';
import type { EmployeeData } from '@/types/hr';
import { FIELD_EXPLAINERS } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
}

function formatIban(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.replace(/(.{4})/g, '$1 ').trim();
}

function maskIban(iban: string): string {
  const cleaned = iban.replace(/\s+/g, '');
  if (cleaned.length <= 8) return formatIban(cleaned);
  const masked = cleaned.slice(0, 4) + cleaned.slice(4, -4).replace(/./g, '\u2022') + cleaned.slice(-4);
  return masked.replace(/(.{4})/g, '$1 ').trim();
}

export default function StepBank({ employee, onNext, onPrev, saving }: Props) {
  const [currentIban, setCurrentIban] = useState<string | null>(null);
  const [iban, setIban] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const ex = FIELD_EXPLAINERS.bank_iban;

  useEffect(() => {
    fetch('/api/hr/bank')
      .then(r => r.json())
      .then(d => {
        if (d.iban) {
          setCurrentIban(d.iban);
          setIban(formatIban(d.iban));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleIbanChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^A-Za-z0-9]/g, '');
    if (raw.length <= 34) {
      setIban(formatIban(raw));
    }
    setSaveError(null);
  }

  async function handleContinue() {
    const cleaned = iban.replace(/\s+/g, '');

    if (cleaned === currentIban || (!cleaned && !currentIban)) {
      onNext({});
      return;
    }

    if (!cleaned) {
      onNext({});
      return;
    }

    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) {
      setSaveError('Please enter a valid IBAN (e.g. DE89 3704 0044 0532 0130 00)');
      return;
    }

    setLocalSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/hr/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iban: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Failed to save IBAN');
        return;
      }
      setCurrentIban(cleaned);
      onNext({});
    } catch {
      setSaveError('Network error. Please try again.');
    } finally {
      setLocalSaving(false);
    }
  }

  const isSaving = saving || localSaving;

  return (
    <div className="pb-8">
      <div className="p-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-[var(--fs-sm)] text-gray-500">Loading bank info...</span>
          </div>
        ) : currentIban ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="text-[var(--fs-xs)] font-bold text-green-700 uppercase tracking-wide mb-1">Current IBAN</div>
            <div className="text-[var(--fs-md)] font-mono font-bold text-gray-900">{maskIban(currentIban)}</div>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="text-[var(--fs-sm)] text-gray-500">No bank account on file</div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-500 uppercase tracking-wide">{currentIban ? 'Update IBAN' : 'Enter IBAN'}</span>
            <InfoButton title={ex.title} text={ex.text} url={ex.url} urlLabel={ex.urlLabel} />
          </div>
          <input
            className="form-input font-mono"
            value={iban}
            onChange={handleIbanChange}
            placeholder="DE__ ____ ____ ____ ____ __"
          />
        </div>

        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[var(--fs-sm)] text-red-700">
            {saveError}
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[var(--fs-sm)] text-amber-800">
          <strong>Note:</strong> Bank account changes are reviewed by your manager.
        </div>
      </div>
      <div className="px-5 pt-4 pb-8 flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleContinue} disabled={isSaving} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          {isSaving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
