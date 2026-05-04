'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import ManagerTabs from '../_components/ManagerTabs';
import type { DashboardData, TaskListSummary } from '@/lib/odoo-tasks';

export default function ManagerDashboard() {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/manager/dashboard');
      const body = await res.json();
      if (!res.ok) setError(body.error || 'Failed');
      else setData(body);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSpawn() {
    setSpawning(true);
    try {
      const res = await fetch('/api/tasks/spawn-today', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Spawn failed');
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Spawn failed');
    } finally {
      setSpawning(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-sm text-gray-400 hover:text-orange-500 transition-colors">← Dashboard</Link>
        <h1 className="font-bold text-gray-800">Department Tasks</h1>
        <button
          onClick={handleSpawn}
          disabled={spawning}
          className="text-sm font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-50"
        >
          {spawning ? '…' : 'Spawn'}
        </button>
      </div>

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-5">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-gray-200 rounded-2xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">{error}</div>
        ) : data ? (
          <>
            <StatGrid data={data} />
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
              Today&apos;s lists
            </p>
            <DeptList lists={data.lists} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function StatGrid({ data }: { data: DashboardData }) {
  const stats = [
    { label: 'Active Lists',    value: data.active_lists,             color: 'text-orange-600', accent: 'border-orange-400' },
    { label: 'Avg Completion',  value: `${data.avg_completion}%`,     color: 'text-green-600',  accent: 'border-green-400'  },
    { label: 'Overdue',         value: data.total_overdue,            color: 'text-red-600',    accent: 'border-red-400'    },
    { label: 'Photos Pending',  value: data.total_photos_pending,     color: 'text-amber-600',  accent: 'border-amber-400'  },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      {stats.map(s => (
        <div key={s.label} className={`bg-white rounded-2xl border-l-4 ${s.accent} p-4 shadow-sm`}>
          <p className={`text-3xl font-extrabold leading-none ${s.color}`}>{s.value}</p>
          <p className="text-xs text-gray-400 font-medium mt-1.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function DeptList({ lists }: { lists: TaskListSummary[] }) {
  if (!lists.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-3xl mb-2">📋</p>
        <p className="font-semibold text-gray-700 text-sm">No lists for today</p>
        <p className="text-xs text-gray-400 mt-1">Tap “Spawn” above to create today&apos;s lists from active templates.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {lists.map((l, i) => (
        <Link
          key={l.id}
          href={`/tasks/manager/dept/${l.department_id}`}
          className={`flex items-center justify-between px-4 py-3.5 hover:bg-orange-50/30 transition-colors ${i < lists.length - 1 ? 'border-b border-gray-100' : ''}`}
        >
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              l.state === 'done' ? 'bg-green-500' :
              l.state === 'in_progress' ? 'bg-amber-400' : 'bg-gray-300'
            }`} />
            <div>
              <p className="font-semibold text-sm text-gray-800">{l.department_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {l.line_count} task{l.line_count === 1 ? '' : 's'}
                {l.overdue_count > 0 ? ` · ${l.overdue_count} overdue` : ''}
                {l.photo_pending_count > 0 ? ` · ${l.photo_pending_count} \u{1F4F8}` : ''}
              </p>
            </div>
          </div>
          <span className={`text-sm font-bold ${
            l.completion_rate === 100 ? 'text-green-600' :
            l.completion_rate >= 50 ? 'text-amber-500' : 'text-gray-400'
          }`}>
            {l.completion_rate}%
          </span>
        </Link>
      ))}
    </div>
  );
}
