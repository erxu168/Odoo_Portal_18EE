'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface ReconciliationPayment {
  id: number;
  tenancy_id: number;
  expected_date: string;
  expected_amount: number;
  received_amount: number;
  status: string;
  tenant_name: string;
  room_code: string;
  street: string;
  matched_iban: string | null;
  matched_tx_date: string | null;
}

interface UnmatchedTx {
  id: number;
  tx_date: string;
  amount: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  status: string;
}

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function paymentBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    expected: { bg: '#DBEAFE', text: '#1E3A8A', label: 'Expected' },
    matched:  { bg: '#DCFCE7', text: '#166534', label: 'Paid' },
    partial:  { bg: '#FEF3C7', text: '#92400E', label: 'Partial' },
    missing:  { bg: '#FEE2E2', text: '#991B1B', label: 'Missing' },
    waived:   { bg: '#F3F4F6', text: '#374151', label: 'Waived' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

type ViewMode = 'payments' | 'unmatched';

export default function SepaReconciliation() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<ReconciliationPayment[]>([]);
  const [unmatchedTx, setUnmatchedTx] = useState<UnmatchedTx[]>([]);
  const [counts, setCounts] = useState({ matched: 0, partial: 0, missing: 0 });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<ViewMode>('payments');
  const [assigningPayment, setAssigningPayment] = useState<number | null>(null);

  const loadReconciliation = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rentals/sepa/reconciliation?month=${month}`);
      const data = await res.json();
      setPayments(data.payments || []);
      setUnmatchedTx(data.unmatched_tx || []);
      setCounts(data.counts || { matched: 0, partial: 0, missing: 0 });
    } catch (err) {
      console.error('[rentals] reconciliation load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadReconciliation();
  }, [loadReconciliation]);

  async function manualAssign(paymentId: number, txId: number) {
    try {
      await fetch(`/api/rentals/payments/${paymentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sepa_tx_id: txId,
          resolution_note: 'Manual match via SEPA reconciliation',
          resolved_by_user_id: 1,
        }),
      });
      setAssigningPayment(null);
      loadReconciliation();
    } catch (err) {
      console.error('[rentals] manual assign failed:', err);
      alert('Assignment failed');
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="SEPA Reconciliation"
        subtitle={month}
        showBack
        onBack={() => router.push('/rentals/payments')}
      />

      <div className="px-4 py-4 space-y-4">
        {/* Month selector */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(month + '-01');
              d.setMonth(d.getMonth() - 1);
              setMonth(d.toISOString().slice(0, 7));
            }}
            className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] text-gray-900 outline-none focus:border-green-600"
          />
          <button
            onClick={() => {
              const d = new Date(month + '-01');
              d.setMonth(d.getMonth() + 1);
              setMonth(d.toISOString().slice(0, 7));
            }}
            className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>

        {/* Counts */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-green-50 rounded-xl p-3">
              <div className="text-xl font-bold text-green-700">{counts.matched}</div>
              <div className="text-[10px] text-green-600 font-semibold uppercase">Matched</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-xl font-bold text-amber-700">{counts.partial}</div>
              <div className="text-[10px] text-amber-600 font-semibold uppercase">Partial</div>
            </div>
            <div className="bg-red-50 rounded-xl p-3">
              <div className="text-xl font-bold text-red-700">{counts.missing}</div>
              <div className="text-[10px] text-red-600 font-semibold uppercase">Missing</div>
            </div>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setView('payments')}
            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
              view === 'payments' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
            }`}
          >
            Payments ({payments.length})
          </button>
          <button
            onClick={() => setView('unmatched')}
            className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
              view === 'unmatched' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
            }`}
          >
            Unmatched ({unmatchedTx.length})
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : view === 'payments' ? (
          <div className="space-y-2">
            {payments.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-gray-500">
                No payments for {month}. Generate monthly payments first.
              </div>
            ) : (
              payments.map(p => {
                const badge = paymentBadge(p.status);
                const isAssigning = assigningPayment === p.id;
                return (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-[#1F2933]">{p.tenant_name}</div>
                        <div className="text-[11px] text-gray-500">{p.room_code} \u00b7 {p.street}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                          Expected: {eur(p.expected_amount)}
                          {p.received_amount > 0 ? ` \u00b7 Received: ${eur(p.received_amount)}` : ''}
                        </div>
                        {p.matched_iban && (
                          <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{p.matched_iban}</div>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold flex-shrink-0" style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                    </div>

                    {/* Manual assign for missing/expected payments */}
                    {(p.status === 'missing' || p.status === 'expected') && unmatchedTx.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        {isAssigning ? (
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-semibold text-gray-500 mb-1">Select matching transaction:</div>
                            {unmatchedTx.slice(0, 5).map(tx => (
                              <button
                                key={tx.id}
                                onClick={() => manualAssign(p.id, tx.id)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg active:bg-gray-100 transition-colors text-left"
                              >
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-[#1F2933] truncate">{tx.counterparty_name || 'Unknown'}</div>
                                  <div className="text-[10px] text-gray-400">{tx.tx_date}{tx.purpose ? ` \u00b7 ${tx.purpose.slice(0, 30)}` : ''}</div>
                                </div>
                                <span className="text-[12px] font-bold text-green-700 tabular-nums flex-shrink-0">{eur(tx.amount)}</span>
                              </button>
                            ))}
                            <button
                              onClick={() => setAssigningPayment(null)}
                              className="w-full text-[11px] text-gray-400 py-1 active:text-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAssigningPayment(p.id)}
                            className="text-[11px] font-semibold text-green-700 active:opacity-70"
                          >
                            Manual match {'\u2192'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {unmatchedTx.length === 0 ? (
              <div className="text-center py-8 text-[13px] text-gray-500">
                No unmatched transactions. All clear!
              </div>
            ) : (
              unmatchedTx.map(tx => (
                <div key={tx.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1F2933]">{tx.counterparty_name || 'Unknown sender'}</div>
                      <div className="text-[11px] text-gray-500">{tx.tx_date}</div>
                      {tx.counterparty_iban && (
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">{tx.counterparty_iban}</div>
                      )}
                      {tx.purpose && (
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">{tx.purpose}</div>
                      )}
                    </div>
                    <span className="text-[14px] font-bold text-green-700 tabular-nums flex-shrink-0">{eur(tx.amount)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
