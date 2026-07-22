'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
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

interface Tile {
  id: string;
  emoji: string;
  label: string;
  sub: string;
  disabled?: boolean;
  onClick: () => void;
}

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
      setRunMsg(`Ran in ${data.durationMs}ms — wrote ${data.forecastRowsWritten} POS + ${data.prepItemRowsWritten || 0} prep-item forecasts`);
      // reload stats
      setTimeout(() => { window.location.reload(); }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Run failed';
      setRunMsg(msg);
    } finally {
      setRunning(false);
    }
  }

  const runLabel = stats.lastRunAt
    ? `Last run ${new Date(stats.lastRunAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`
    : 'Never run';

  const selectedCompany = COMPANIES.find(c => c.id === companyId);
  const runValue = stats.lastRunStatus === 'success' ? 'OK' : stats.lastRunStatus === 'error' ? 'ERR' : '—';

  const tiles: Tile[] = [
    { id: 'items', emoji: '\u{1F961}', label: 'Prep items', sub: `${stats.activeItems} active · ${stats.items} total`, onClick: () => router.push(`/prep-planner/items?companyId=${companyId}`) },
    { id: 'forecasts', emoji: '\u{1F4C8}', label: 'Forecasts', sub: stats.tomorrowForecasts > 0 ? `${stats.tomorrowForecasts} for tomorrow` : 'No forecasts yet', onClick: () => router.push(`/prep-planner/forecasts?companyId=${companyId}`) },
    { id: 'variance', emoji: '\u{1F4CA}', label: 'Accuracy', sub: 'Forecast vs actual', onClick: () => router.push(`/prep-planner/variance?companyId=${companyId}`) },
    { id: 'add', emoji: '⏺️', label: 'Add prep item', sub: 'Rice, Bulgogi, Kimchi…', onClick: () => router.push(`/prep-planner/items/new?companyId=${companyId}`) },
    { id: 'run', emoji: '\u{1F504}', label: running ? 'Running…' : 'Run forecast', sub: selectedCompany ? selectedCompany.name : 'Selected company', disabled: running, onClick: runForecastNow },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Prep Planner" subtitle="Demand forecasts & prep targets" />

      <div className="px-5 py-5 space-y-5">
        {/* Company selector — flat control */}
        <div>
          <label className="block text-[var(--fs-xs)] font-bold tracking-wider uppercase text-gray-400 mb-1.5">Company</label>
          <select
            value={companyId}
            onChange={e => setCompanyId(Number(e.target.value))}
            className="w-full h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-[var(--fs-base)] font-semibold text-gray-900"
          >
            {COMPANIES.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Stat chips */}
            <div>
              <KpiRow columns={3}>
                <KpiChip value={stats.activeItems} label="Active" />
                <KpiChip value={stats.tomorrowForecasts} label="Tomorrow" />
                <KpiChip value={runValue} label="Run" tone={stats.lastRunStatus === 'error' ? 'danger' : 'default'} />
              </KpiRow>
              <div className="mt-2 text-[var(--fs-xs)] text-gray-400 text-center">{runLabel}</div>
            </div>

            {/* Tiles */}
            <ActionGrid<Tile>
              items={tiles}
              getItemId={(t) => t.id}
              renderItem={(t) => (
                <ActionCard emoji={t.emoji} label={t.label} subtitle={t.sub} disabled={t.disabled} onClick={t.onClick} />
              )}
            />

            {runMsg && (
              <div className="px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-[var(--fs-sm)] text-gray-700">
                {runMsg}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
