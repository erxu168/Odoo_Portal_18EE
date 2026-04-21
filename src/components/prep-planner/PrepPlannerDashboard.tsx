'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { COMPANIES, DEFAULT_COMPANY_ID } from './companies';

interface Stats {
  items: number;
  activeItems: number;
  linkedItems: number;
  tomorrowForecasts: number;
  lastRunStatus: string | null;
  lastRunAt: string | null;
}

const DEFAULT_STATS: Stats = {
  items: 0,
  activeItems: 0,
  linkedItems: 0,
  tomorrowForecasts: 0,
  lastRunStatus: null,
  lastRunAt: null,
};

function tomorrowBerlinDate(): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return tomorrow.toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

export default function PrepPlannerDashboard() {
  const router = useRouter();
  const [companyId, setCompanyId] = useState<number>(DEFAULT_COMPANY_ID);
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const date = tomorrowBerlinDate();
        const [itemsRes, fcRes] = await Promise.all([
          fetch(`/api/prep-planner/items?companyId=${companyId}&includeInactive=1`),
          fetch(`/api/prep-planner/forecasts?companyId=${companyId}&date=${date}`),
        ]);
        const itemsData = await itemsRes.json();
        const fcData = await fcRes.json();
        if (cancelled) return;

        const items = itemsData.items || [];
        const active = items.filter((i: { active: number }) => i.active === 1);

        const fcByItemRes = await fetch(`/api/prep-planner/forecasts-by-item?companyId=${companyId}&date=${date}`);
        const fcByItemData = await fcByItemRes.json();

        setStats({
          items: items.length,
          activeItems: active.length,
          linkedItems: 0,
          tomorrowForecasts: (fcByItemData.forecasts || []).length,
          lastRunStatus: fcData.run?.status || null,
          lastRunAt: fcData.run?.finished_at || fcData.run?.started_at || null,
        });
      } catch (err) {
        console.error('[prep-planner] dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [companyId]);

  async function runForecastNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch(`/api/prep-planner/run?companyId=${companyId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Run failed');
      setRunMsg(`Ran in ${data.durationMs}ms \u2014 wrote ${data.forecastRowsWritten} POS + ${data.prepItemRowsWritten || 0} prep-item forecasts`);
      // reload stats
      setTimeout(() => { window.location.reload(); }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Run failed';
      setRunMsg(msg);
    } finally {
      setRunning(false);
    }
  }

  const tiles = [
    {
      key: 'items',
      label: 'Prep items',
      sublabel: `${stats.activeItems} active \u00b7 ${stats.items} total`,
      href: '/prep-planner/items',
      color: 'bg-cyan-50 border-cyan-200',
      iconBg: 'bg-cyan-100',
      iconColor: 'text-cyan-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>
        </svg>
      ),
    },
    {
      key: 'forecasts',
      label: 'Forecasts',
      sublabel: stats.tomorrowForecasts > 0
        ? `${stats.tomorrowForecasts} rows for tomorrow`
        : 'No forecasts yet',
      href: '/prep-planner/forecasts',
      color: stats.tomorrowForecasts > 0 ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200',
      iconBg: stats.tomorrowForecasts > 0 ? 'bg-indigo-100' : 'bg-gray-100',
      iconColor: stats.tomorrowForecasts > 0 ? 'text-indigo-600' : 'text-gray-500',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
        </svg>
      ),
    },
  ];

  const runLabel = stats.lastRunAt
    ? `Last run ${new Date(stats.lastRunAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`
    : 'Never run';

  const selectedCompany = COMPANIES.find(c => c.id === companyId);

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-20">
      <AppHeader title="Prep Planner" subtitle="Demand forecasts & prep targets" />

      <div className="px-4 py-5 space-y-5">
        {/* Company selector */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <label className="block text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-1.5">Company</label>
          <select
            value={companyId}
            onChange={e => setCompanyId(Number(e.target.value))}
            className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-[14px] font-semibold text-gray-900"
          >
            {COMPANIES.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-cyan-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Stat strip */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="grid grid-cols-3 divide-x divide-gray-100">
                <div className="text-center px-2">
                  <div className="text-xl font-bold text-[#1F2933]">{stats.activeItems}</div>
                  <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Active</div>
                </div>
                <div className="text-center px-2">
                  <div className="text-xl font-bold text-[#1F2933]">{stats.tomorrowForecasts}</div>
                  <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Tomorrow</div>
                </div>
                <div className="text-center px-2">
                  <div className={`text-xl font-bold ${stats.lastRunStatus === 'success' ? 'text-green-600' : stats.lastRunStatus === 'error' ? 'text-red-600' : 'text-gray-400'}`}>
                    {stats.lastRunStatus === 'success' ? 'OK' : stats.lastRunStatus === 'error' ? 'ERR' : '\u2014'}
                  </div>
                  <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Run</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-gray-500 text-center">{runLabel}</div>
            </div>

            {/* 2x2 tile grid */}
            <div className="grid grid-cols-2 gap-3">
              {tiles.map(tile => (
                <button
                  key={tile.key}
                  onClick={() => router.push(`${tile.href}?companyId=${companyId}`)}
                  className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
                >
                  <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                    {tile.icon}
                  </div>
                  <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">{tile.sublabel}</div>
                </button>
              ))}
            </div>

            {/* Quick actions */}
            <div>
              <p className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Quick actions</p>
              <div className="space-y-2">
                <button
                  onClick={() => router.push(`/prep-planner/items/new?companyId=${companyId}`)}
                  className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 active:bg-gray-50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-cyan-100 text-cyan-600 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[13px] font-semibold text-[#1F2933]">Add prep item</div>
                    <div className="text-[11px] text-gray-500">Rice, Bulgogi, Kimchi\u2026</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </button>

                <button
                  onClick={runForecastNow}
                  disabled={running}
                  className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 active:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    {running ? (
                      <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[13px] font-semibold text-[#1F2933]">{running ? 'Running forecast\u2026' : 'Run forecast now'}</div>
                    <div className="text-[11px] text-gray-500">{selectedCompany ? selectedCompany.name : 'Selected company'}</div>
                  </div>
                </button>

                {runMsg && (
                  <div className="px-4 py-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[12px] text-indigo-800">
                    {runMsg}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
