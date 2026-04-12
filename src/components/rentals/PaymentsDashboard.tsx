'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface PaymentSummary {
  total: number;
  matched: number;
  partial: number;
  missing: number;
  expected: number;
}

interface SepaImportResult {
  importId: number;
  txCount: number;
  totalCredits: number;
  matched: number;
  unmatched: number;
}

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export default function PaymentsDashboard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<SepaImportResult | null>(null);
  const [summary, setSummary] = useState<PaymentSummary>({ total: 0, matched: 0, partial: 0, missing: 0, expected: 0 });

  useEffect(() => {
    loadPayments();
  }, []);

  async function loadPayments() {
    setLoading(true);
    try {
      const res = await fetch('/api/rentals/tenancies?status=active');
      const data = await res.json();
      const tenancies = data.tenancies || [];

      setSummary({
        total: tenancies.length,
        matched: 0, partial: 0, missing: 0,
        expected: tenancies.length,
      });
    } catch (err) {
      console.error('[rentals] payments load failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSepaUpload(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/rentals/sepa/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          content: text,
          user_id: 1, // TODO: from auth context
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data);
        // Auto-run reconciliation
        const reconRes = await fetch('/api/rentals/sepa/reconciliation', { method: 'POST' });
        const reconData = await reconRes.json();
        if (reconData.matched !== undefined) {
          setImportResult(prev => prev ? { ...prev, matched: reconData.matched, unmatched: reconData.unmatched } : prev);
        }
      } else {
        alert(data.error || 'Import failed');
      }
    } catch (err) {
      console.error('[rentals] SEPA import failed:', err);
      alert('Upload failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Payments"
        subtitle="SEPA & reconciliation"
        showBack
        onBack={() => router.push('/rentals')}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 py-5 space-y-4">
          {/* Summary */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Payment Overview</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-green-700">{summary.matched}</div>
                <div className="text-[11px] text-green-600 font-semibold">Matched</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{summary.missing}</div>
                <div className="text-[11px] text-red-600 font-semibold">Missing</div>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{summary.partial}</div>
                <div className="text-[11px] text-amber-600 font-semibold">Partial</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{summary.expected}</div>
                <div className="text-[11px] text-blue-600 font-semibold">Expected</div>
              </div>
            </div>
          </div>

          {/* SEPA Import */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">SEPA Bank Import</div>
            <p className="text-[12px] text-gray-500 mb-3">Upload a CAMT.053, MT940, or CSV bank statement to auto-match payments.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,.csv,.txt"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleSepaUpload(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors ${
                importing
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white active:bg-green-700 shadow-lg shadow-green-600/30'
              }`}
            >
              {importing ? 'Importing...' : 'Upload Bank Statement'}
            </button>

            {importResult && (
              <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-200">
                <div className="text-[13px] font-semibold text-green-800 mb-1">Import Complete</div>
                <div className="text-[12px] text-green-700 space-y-0.5">
                  <div>{importResult.txCount} transactions \u00b7 {eur(importResult.totalCredits)} total</div>
                  <div>{importResult.matched} matched \u00b7 {importResult.unmatched} unmatched</div>
                </div>
              </div>
            )}
          </div>

          {/* Generate expected payments */}
          <button
            onClick={async () => {
              const month = new Date().toISOString().slice(0, 7); // YYYY-MM
              await fetch('/api/rentals/payments/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month }),
              });
              loadPayments();
            }}
            className="w-full bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3 active:bg-gray-50 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-[13px] font-semibold text-[#1F2933]">Generate Monthly Payments</div>
              <div className="text-[11px] text-gray-500">Create expected entries for all active tenancies</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>

          {/* SEPA Reconciliation */}
          <button
            onClick={() => router.push('/rentals/sepa')}
            className="w-full bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3 active:bg-gray-50 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-[13px] font-semibold text-[#1F2933]">SEPA Reconciliation</div>
              <div className="text-[11px] text-gray-500">Match payments, resolve discrepancies</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
