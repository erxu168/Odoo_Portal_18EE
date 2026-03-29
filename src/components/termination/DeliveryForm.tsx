'use client';

import React, { useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { DELIVERY_METHOD_LABELS } from '@/types/termination';
import type { DeliveryMethod } from '@/types/termination';

interface Props {
  id: number;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

const METHODS: { value: DeliveryMethod; label: string }[] = [
  { value: 'einschreiben_rueckschein', label: 'Einschreiben mit R\u00fcckschein' },
  { value: 'einwurf_einschreiben', label: 'Einwurf-Einschreiben' },
  { value: 'personal', label: 'Pers\u00f6nliche \u00dcbergabe' },
  { value: 'bote', label: 'Bote (mit Zeuge)' },
];

export default function DeliveryForm({ id, onBack, onDone }: Props) {
  const [method, setMethod] = useState<DeliveryMethod | ''>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [trackingNumber, setTrackingNumber] = useState('');
  const [witness, setWitness] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsTracking = method === 'einschreiben_rueckschein' || method === 'einwurf_einschreiben';
  const needsWitness = method === 'personal' || method === 'bote';

  async function handleSubmit() {
    if (!method) { setError('Bitte Zustellungsart w\u00e4hlen'); return; }
    if (!date) { setError('Bitte Datum eingeben'); return; }
    if (needsWitness && !witness) { setError('Zeuge ist erforderlich'); return; }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/termination/${id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_method: method,
          delivery_date: date,
          delivery_tracking_number: trackingNumber || undefined,
          delivery_witness: witness || undefined,
          delivery_notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        onDone();
      } else {
        setError(data.error || 'Fehler');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppHeader title="Zustellung erfassen" showBack onBack={onBack} />
      <div className="px-4 py-4 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
          <div className="text-xs font-semibold text-gray-400 uppercase">Zustellungsart</div>
          <div className="space-y-2">
            {METHODS.map(m => (
              <button
                key={m.value}
                onClick={() => { setMethod(m.value); setError(''); }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  method === m.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-100 bg-white text-gray-700 active:bg-gray-50'
                }`}
              >
                <div className="text-sm font-medium">{m.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
          <div>
            <label className="text-xs text-gray-500">Zustelldatum</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" />
          </div>

          {needsTracking && (
            <div>
              <label className="text-xs text-gray-500">Sendungsnummer</label>
              <input type="text" value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
                placeholder="RR 1234 5678 9DE"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1 font-mono" />
            </div>
          )}

          {needsWitness && (
            <div>
              <label className="text-xs text-gray-500">Zeuge (Name)</label>
              <input type="text" value={witness} onChange={e => setWitness(e.target.value)}
                placeholder="Vor- und Nachname"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500">Anmerkungen (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm mt-1" rows={2} />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !method}
          className="w-full py-3.5 rounded-xl bg-green-600 text-white font-bold text-sm active:bg-green-700 disabled:opacity-50"
        >
          {submitting ? 'Wird gespeichert...' : 'Zustellung best\u00e4tigen'}
        </button>
      </div>
    </>
  );
}
