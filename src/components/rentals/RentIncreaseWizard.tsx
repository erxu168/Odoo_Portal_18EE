'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface LegalCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface AnalysisResult {
  tenancy_id: number;
  current_kaltmiete: number;
  size_sqm: number;
  mietspiegel_eur_per_sqm: number | null;
  vergleichsmiete: number | null;
  max_kappung: number;
  max_mietpreisbremse: number | null;
  recommended_kaltmiete: number;
  recommended_delta: number;
  recommended_delta_pct: number;
  earliest_effective_date: string;
  checks: LegalCheck[];
  blockers: string[];
}

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export default function RentIncreaseWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenancyId = searchParams?.get('tenancy_id');

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [proposedKaltmiete, setProposedKaltmiete] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);

  useEffect(() => {
    if (!tenancyId) {
      setError('No tenancy selected');
      setLoading(false);
      return;
    }
    fetch(`/api/rentals/rent-increase/analyze?tenancy_id=${tenancyId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error);
        } else {
          setAnalysis(data);
          setProposedKaltmiete(String(data.recommended_kaltmiete));
          setProposedDate(data.earliest_effective_date);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [tenancyId]);

  async function handleCreate() {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/rentals/rent-increase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenancy_id: Number(tenancyId),
          proposed_kaltmiete: Number(proposedKaltmiete),
          proposed_effective_date: proposedDate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatedId(data.id);
      } else {
        alert(data.error || data.blockers?.join(', ') || 'Failed');
        setSaving(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(msg);
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Rent Increase" showBack onBack={() => router.back()} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Rent Increase" showBack onBack={() => router.back()} />
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{'\u26a0\ufe0f'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">Cannot analyze</div>
          <div className="text-[13px] text-gray-500 max-w-[260px] leading-relaxed">{error || 'Unknown error'}</div>
        </div>
      </div>
    );
  }

  if (createdId) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Rent Increase" showBack onBack={() => router.push('/rentals/tenancies')} />
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{'\u2705'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">Draft Created</div>
          <div className="text-[13px] text-gray-500 max-w-[260px] leading-relaxed mb-4">
            Rent increase #{createdId} saved as draft. Review and send to tenant when ready.
          </div>
          <button
            onClick={() => router.push(`/rentals/tenancies/${tenancyId}`)}
            className="bg-green-600 text-white font-semibold rounded-xl px-6 py-3 text-[14px] active:bg-green-700 transition-colors"
          >
            Back to Tenancy
          </button>
        </div>
      </div>
    );
  }

  const hasBlockers = analysis.blockers.length > 0;
  const proposed = Number(proposedKaltmiete) || 0;
  const delta = proposed - analysis.current_kaltmiete;
  const deltaPct = analysis.current_kaltmiete > 0 ? Math.round((delta / analysis.current_kaltmiete) * 100) : 0;
  const exceedsKappung = proposed > analysis.max_kappung;
  const exceedsBremse = analysis.max_mietpreisbremse !== null && proposed > analysis.max_mietpreisbremse;

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Mieterh\u00f6hung"
        subtitle="Rent Increase Analysis"
        showBack
        onBack={() => router.back()}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Current rent summary */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Current Rent</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <div className="text-xl font-bold text-[#1F2933] tabular-nums">{eur(analysis.current_kaltmiete)}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase">Kaltmiete</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-[#1F2933] tabular-nums">{analysis.size_sqm} m{'\u00b2'}</div>
              <div className="text-[10px] text-gray-400 font-semibold uppercase">Size</div>
            </div>
          </div>
          {analysis.mietspiegel_eur_per_sqm && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[12px] text-gray-500">Mietspiegel</span>
              <span className="text-[13px] font-semibold text-[#1F2933]">{analysis.mietspiegel_eur_per_sqm.toFixed(2)} {'\u20ac'}/m{'\u00b2'}</span>
            </div>
          )}
          {analysis.vergleichsmiete !== null && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-[12px] text-gray-500">Vergleichsmiete</span>
              <span className="text-[13px] font-semibold text-[#1F2933]">{eur(analysis.vergleichsmiete)}</span>
            </div>
          )}
        </div>

        {/* Legal checks */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Legal Checks</div>
          <div className="space-y-2">
            {analysis.checks.map(check => (
              <div key={check.key} className="flex items-start gap-2.5">
                <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                  check.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                }`}>
                  {check.passed ? '\u2713' : '\u2717'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-[#1F2933]">{check.label}</div>
                  <div className="text-[11px] text-gray-500">{check.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {hasBlockers && (
            <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-200">
              <div className="text-[12px] font-semibold text-red-800 mb-1">Blockers</div>
              {analysis.blockers.map((b, i) => (
                <div key={i} className="text-[11px] text-red-700">{'\u2022'} {b}</div>
              ))}
            </div>
          )}
        </div>

        {/* Limits */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Legal Limits</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-gray-500">Kappungsgrenze (20%/3yr)</span>
              <span className="text-[13px] font-bold text-[#1F2933] tabular-nums">{eur(analysis.max_kappung)}</span>
            </div>
            {analysis.max_mietpreisbremse !== null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-gray-500">Mietpreisbremse</span>
                <span className="text-[13px] font-bold text-[#1F2933] tabular-nums">{eur(analysis.max_mietpreisbremse)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-green-700 font-semibold">Recommended</span>
              <span className="text-[13px] font-bold text-green-700 tabular-nums">{eur(analysis.recommended_kaltmiete)}</span>
            </div>
          </div>
        </div>

        {/* Propose */}
        {!hasBlockers && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 space-y-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Proposed Increase</div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">New Kaltmiete ({'\u20ac'}) *</label>
              <input
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors"
                value={proposedKaltmiete}
                onChange={e => setProposedKaltmiete(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Effective Date *</label>
              <input
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors"
                value={proposedDate}
                onChange={e => setProposedDate(e.target.value)}
                type="date"
              />
            </div>

            {/* Delta preview */}
            <div className={`p-3 rounded-xl border ${exceedsKappung || exceedsBremse ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-gray-700">Change</span>
                <span className={`text-[14px] font-bold tabular-nums ${exceedsKappung || exceedsBremse ? 'text-red-700' : 'text-green-700'}`}>
                  +{eur(delta)} (+{deltaPct}%)
                </span>
              </div>
              {exceedsKappung && <div className="text-[11px] text-red-600 mt-1">{'\u26a0\ufe0f'} Exceeds Kappungsgrenze</div>}
              {exceedsBremse && <div className="text-[11px] text-red-600 mt-1">{'\u26a0\ufe0f'} Exceeds Mietpreisbremse</div>}
            </div>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={saving || !proposedKaltmiete || !proposedDate || exceedsKappung || exceedsBremse}
              className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors ${
                !saving && proposedKaltmiete && proposedDate && !exceedsKappung && !exceedsBremse
                  ? 'bg-green-600 text-white active:bg-green-700 shadow-lg shadow-green-600/30'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Create Draft
            </button>

            <p className="text-[10px] text-gray-400 text-center leading-relaxed">
              This tool computes legal limits but does not constitute legal advice. Consult a lawyer for complex cases.
            </p>
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Create rent increase draft?"
          message={`Propose ${eur(proposed)} Kaltmiete (+${deltaPct}%) effective ${proposedDate}. The draft can be reviewed before sending.`}
          confirmLabel="Create Draft"
          cancelLabel="Cancel"
          onConfirm={() => { setShowConfirm(false); handleCreate(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
