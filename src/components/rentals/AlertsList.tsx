'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import type { Alert } from '@/types/rentals';

function alertIcon(type: string): string {
  if (type.includes('contract_ending')) return '\ud83d\udcdd';
  if (type.includes('payment_overdue')) return '\ud83d\udcb3';
  if (type.includes('rent_increase') || type.includes('staffel') || type.includes('index')) return '\ud83d\udcc8';
  if (type.includes('inspection')) return '\u2705';
  return '\ud83d\udd14';
}

function alertSeverity(type: string): { bg: string; text: string } {
  if (type === 'contract_ending_30' || type === 'payment_overdue') return { bg: '#FEE2E2', text: '#991B1B' };
  if (type === 'contract_ending_60' || type === 'staffel_step_due') return { bg: '#FEF3C7', text: '#92400E' };
  return { bg: '#DBEAFE', text: '#1E3A8A' };
}

function alertTypeLabel(type: string): string {
  const map: Record<string, string> = {
    contract_ending_90: 'Contract ending (90d)',
    contract_ending_60: 'Contract ending (60d)',
    contract_ending_30: 'Contract ending (30d)',
    rent_increase_eligible: 'Rent increase eligible',
    staffel_step_due: 'Staffel step due',
    index_cpi_update: 'CPI update available',
    payment_overdue: 'Payment overdue',
    inspection_due: 'Inspection due',
  };
  return map[type] || type;
}

type FilterKey = 'active' | 'dismissed' | 'resolved';

export default function AlertsList() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('active');

  useEffect(() => {
    loadAlerts(filter);
  }, [filter]);

  async function loadAlerts(status: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/rentals/alerts?status=${status}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error('[rentals] alerts load failed:', err);
    } finally {
      setLoading(false);
    }
  }

  async function dismissAlert(alertId: number) {
    try {
      await fetch(`/api/rentals/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' }),
      });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err) {
      console.error('[rentals] dismiss alert failed:', err);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Alerts"
        subtitle={`${alerts.length} ${filter}`}
        showBack
        onBack={() => router.push('/rentals')}
        action={
          <button
            onClick={async () => {
              await fetch('/api/rentals/alerts', { method: 'POST' });
              loadAlerts(filter);
            }}
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
            title="Refresh alerts engine"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
        }
      />

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {(['active', 'dismissed', 'resolved'] as FilterKey[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap capitalize transition-colors ${
              filter === f
                ? 'bg-green-600 text-white shadow-sm'
                : 'border bg-white border-gray-200 text-gray-500'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{filter === 'active' ? '\u2705' : '\ud83d\udd14'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">
            {filter === 'active' ? 'All clear!' : `No ${filter} alerts`}
          </div>
          <div className="text-[13px] text-gray-500 max-w-[220px] leading-relaxed">
            {filter === 'active' ? 'No active alerts right now' : `No alerts in ${filter} status`}
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 space-y-2">
          {alerts.map(alert => {
            const sev = alertSeverity(alert.type);
            return (
              <div
                key={alert.id}
                className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">{alertIcon(alert.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-[#1F2933]">{alert.title}</span>
                      <span className="px-2 py-0.5 rounded-md text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: sev.bg, color: sev.text }}>
                        {alertTypeLabel(alert.type)}
                      </span>
                    </div>
                    <p className="text-[12px] text-gray-500 leading-relaxed">{alert.body}</p>
                    {alert.due_date && (
                      <div className="text-[11px] text-gray-400 mt-1 tabular-nums">Due: {alert.due_date}</div>
                    )}
                  </div>
                </div>
                {filter === 'active' && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                    {alert.tenancy_id && (
                      <button
                        onClick={() => router.push(`/rentals/tenancies/${alert.tenancy_id}`)}
                        className="flex-1 py-2 rounded-lg bg-green-50 text-green-700 text-[12px] font-semibold active:bg-green-100 transition-colors"
                      >
                        View Tenancy
                      </button>
                    )}
                    <button
                      onClick={() => dismissAlert(alert.id)}
                      className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold active:bg-gray-200 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
