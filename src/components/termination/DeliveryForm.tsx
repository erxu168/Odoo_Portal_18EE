'use client';

import React, { useState } from 'react';
import type { DeliveryMethod } from '@/types/termination';
import { DELIVERY_METHOD_LABELS } from '@/types/termination';

interface Props {
  onSubmit: (data: {
    delivery_method: DeliveryMethod;
    delivery_date: string;
    delivery_tracking_number?: string;
    delivery_witness?: string;
    delivery_notes?: string;
  }) => void;
  onCancel: () => void;
}

const METHODS: DeliveryMethod[] = [
  'einschreiben_rueckschein',
  'einwurf_einschreiben',
  'personal',
  'bote',
];

export default function DeliveryForm({ onSubmit, onCancel }: Props) {
  const [method, setMethod] = useState<DeliveryMethod | ''>('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [witness, setWitness] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const needsTracking = method === 'einschreiben_rueckschein' || method === 'einwurf_einschreiben';
  const needsWitness = method === 'personal' || method === 'bote';

  async function handleSubmit() {
    if (!method) { alert('Bitte Zustellungsart w\u00e4hlen'); return; }
    if (!date) { alert('Bitte Datum eingeben'); return; }
    if (needsWitness && !witness.trim()) { alert('Zeuge erforderlich'); return; }
    setSubmitting(true);
    try {
      await onSubmit({
        delivery_method: method,
        delivery_date: date,
        ...(trackingNumber ? { delivery_tracking_number: trackingNumber } : {}),
        ...(witness ? { delivery_witness: witness } : {}),
        ...(notes ? { delivery_notes: notes } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm mb-3">
      <span className="text-[13px] font-semibold text-gray-900 block mb-3">Zustellung erfassen</span>

      {/* Method selector */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {METHODS.map(m => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`py-2.5 px-3 rounded-xl text-[12px] font-medium border transition-colors ${
              method === m
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 active:bg-gray-100'
            }`}
          >
            {DELIVERY_METHOD_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Date */}
      <label className="block mb-3">
        <span className="text-[12px] text-gray-500 block mb-1">Zustelldatum</span>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] bg-gray-50"
        />
      </label>

      {/* Tracking number */}
      {needsTracking && (
        <label className="block mb-3">
          <span className="text-[12px] text-gray-500 block mb-1">Sendungsnummer</span>
          <input
            type="text"
            value={trackingNumber}
            onChange={e => setTrackingNumber(e.target.value)}
            placeholder="RR 1234 5678 9 DE"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] bg-gray-50"
          />
        </label>
      )}

      {/* Witness */}
      {needsWitness && (
        <label className="block mb-3">
          <span className="text-[12px] text-gray-500 block mb-1">Zeuge *</span>
          <input
            type="text"
            value={witness}
            onChange={e => setWitness(e.target.value)}
            placeholder="Name des Zeugen"
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] bg-gray-50"
          />
        </label>
      )}

      {/* Notes */}
      <label className="block mb-4">
        <span className="text-[12px] text-gray-500 block mb-1">Anmerkungen (optional)</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] bg-gray-50 resize-none"
        />
      </label>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-[14px] active:bg-gray-200"
        >
          Abbrechen
        </button>
        <button
          onClick={handleSubmit}
          disabled={!method || submitting}
          className="flex-1 py-3 rounded-xl bg-red-600 text-white font-semibold text-[14px] active:bg-red-700 disabled:opacity-50"
        >
          {submitting ? 'Speichere...' : 'Zustellung speichern'}
        </button>
      </div>
    </div>
  );
}
