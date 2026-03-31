'use client';

import React, { useState, useEffect } from 'react';

interface DashboardProps {
  onNavigate: (screen: any) => void;
  onSelectTab: (tab: any) => void;
}

export default function Dashboard({ onNavigate, onSelectTab }: DashboardProps) {
  const [stats, setStats] = useState({ active: 0, inProgress: 0, done: 0, bomCount: 0 });
  const [recentMOs, setRecentMOs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [moRes, bomRes] = await Promise.all([
        fetch('/api/manufacturing-orders?limit=10').then((r) => r.json()),
        fetch('/api/boms').then((r) => r.json()),
      ]);
      const mos = moRes.orders || [];
      const active = mos.filter((m: any) => m.state === 'confirmed' || m.state === 'progress');
      const progress = mos.filter((m: any) => m.state === 'progress');
      const done = mos.filter((m: any) => m.state === 'done');
      setStats({ active: active.length, inProgress: progress.length, done: done.length, bomCount: bomRes.total || 0 });
      setRecentMOs(mos.slice(0, 4));
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  const stateColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    confirmed: 'bg-blue-50 text-blue-700',
    progress: 'bg-amber-50 text-amber-700',
    done: 'bg-green-50 text-green-700',
    cancel: 'bg-red-50 text-red-700',
  };
  const stateLabels: Record<string, string> = {
    draft: 'Draft', confirmed: 'Confirmed', progress: 'In Progress', done: 'Done', cancel: 'Cancelled',
  };
  const stateDots: Record<string, string> = {
    draft: 'bg-gray-400', confirmed: 'bg-blue-500', progress: 'bg-amber-500', done: 'bg-green-500', cancel: 'bg-red-500',
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">Krawings SSAM</h1>
        <p className="text-xs text-gray-500 mt-0.5">Dashboard</p>
      </div>

      {/* Greeting */}
      <div className="px-5 pt-5 pb-2">
        <div className="text-xl font-bold text-gray-900">{greeting} \uD83D\uDC4B</div>
        <div className="text-[var(--fs-xs)] text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {/* Stats strip */}
      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">ACTIVE</div>
            <div className="text-xl font-bold text-blue-500 mt-1">{stats.active}</div>
          </div>
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">IN PROGRESS</div>
            <div className="text-xl font-bold text-amber-500 mt-1">{stats.inProgress}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">COMPLETED</div>
            <div className="text-xl font-bold text-green-500 mt-1">{stats.done}</div>
          </div>
        </div>
      </div>

      {/* Module tiles */}
      <div className="px-4">
        <div className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest mb-2">MODULES</div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Production */}
          <button onClick={() => onSelectTab('production')} className="bg-white border border-gray-200 rounded-xl p-4 text-left active:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F6AF5" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>
              </div>
              <span className="text-base font-bold text-gray-900">Production</span>
            </div>
            <div className="text-2xl font-bold text-blue-500">{stats.active}</div>
            <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">active orders</div>
          </button>

          {/* Recipes */}
          <button onClick={() => onNavigate({ type: 'bom-list' })} className="bg-white border border-gray-200 rounded-xl p-4 text-left active:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>
              </div>
              <span className="text-base font-bold text-gray-900">Recipes</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{stats.bomCount}</div>
            <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">BOMs</div>
          </button>

          {/* My Tasks */}
          <button onClick={() => onSelectTab('tasks')} className="bg-white border border-gray-200 rounded-xl p-4 text-left active:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </div>
              <span className="text-base font-bold text-gray-900">My Tasks</span>
            </div>
            <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">Work orders assigned</div>
          </button>

          {/* Inventory */}
          <button onClick={() => onSelectTab('inventory')} className="bg-white border border-gray-200 rounded-xl p-4 text-left active:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <span className="text-base">\uD83D\uDCE6</span>
              </div>
              <span className="text-base font-bold text-gray-900">Inventory</span>
            </div>
            <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">Component needs</div>
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-4 pb-8">
        <div className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest mb-2">RECENT ACTIVITY</div>
        <div className="flex flex-col gap-1.5">
          {recentMOs.map((mo: any) => (
            <button
              key={mo.id}
              onClick={() => onNavigate({ type: 'mo-detail', moId: mo.id })}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 text-left active:bg-gray-50 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full ${stateDots[mo.state] || 'bg-gray-300'} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{mo.product_id[1]}</div>
                <div className="text-[var(--fs-xs)] text-gray-400">{mo.name}</div>
              </div>
              <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-semibold ${stateColors[mo.state] || 'bg-gray-100 text-gray-600'}`}>
                {stateLabels[mo.state] || mo.state}
              </span>
            </button>
          ))}
          {recentMOs.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-[var(--fs-sm)]">No manufacturing orders yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
