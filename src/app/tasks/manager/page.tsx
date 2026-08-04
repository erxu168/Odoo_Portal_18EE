'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import PrimaryButton from '@/components/ui/PrimaryButton';
import ManagerTabs from '../_components/ManagerTabs';
import type { DashboardData, TaskListSummary } from '@/lib/odoo-tasks';

export default function ManagerDashboard() {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

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
    setSpawnError(null);
    try {
      const res = await fetch('/api/tasks/spawn-today', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Could not create today's lists");
      await load();
    } catch (e: unknown) {
      // In-page message, not alert(): the browser box shows the site's address to
      // staff and looks like a scam warning, and it blocks the whole tab.
      setSpawnError(e instanceof Error ? e.message : "Could not create today's lists");
    } finally {
      setSpawning(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* `root`, not `showBack`: the back arrow and the home button both pushed
          '/', so the header carried two buttons doing the same thing. This is a
          top-level screen — home-only is what `root` is for. */}
      <AppHeader
        supertitle="TASK MANAGER"
        title="Department Tasks"
        root
      />

      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-5">
        {loading ? (
          // Skeleton mirrors the real KPI row (4 across, chip height), so the
          // layout doesn't jump when the numbers land.
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-[58px] bg-gray-200 rounded-xl animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-[var(--fs-sm)]">{error}</div>
        ) : data ? (
          <>
            <StatGrid data={data} />
            <p className="text-[var(--fs-xs)] font-bold uppercase tracking-wider text-gray-400 mb-2.5">
              Today&apos;s lists
            </p>
            <DeptList lists={data.lists} />

            {/* The screen's ONE primary action, as a full-width green button.
                It used to be a small "Spawn" pill in the blue header — ERP
                jargon, and styled as header chrome rather than an action. */}
            {spawnError && (
              <div role="alert" className="mt-5 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-[var(--fs-sm)]">
                {spawnError}
              </div>
            )}
            <PrimaryButton
              onClick={handleSpawn}
              busy={spawning}
              className={`w-full ${spawnError ? 'mt-2' : 'mt-5'}`}
            >
              {spawning ? 'Creating…' : "Create today's lists"}
            </PrimaryButton>
            <p className="text-[var(--fs-xs)] text-gray-400 mt-1.5 text-center">
              Builds today&apos;s checklists from the active templates. Safe to tap again — it won&apos;t duplicate.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The four numbers, as the portal's standard KPI chips.
 *
 * Was four cards with a coloured stripe down the left edge, each number in its
 * own colour — green, green, red, amber. With everything shouting, a real "3
 * overdue" competed with a perfectly healthy "60%". The standard's rule is that
 * a number goes red ONLY when it is a problem you must act on, so red always
 * means look here. Overdue is red when there IS an overdue task; the rest stay
 * neutral, including Photos Pending — waiting to be reviewed is a queue, not a
 * fault. Tapping Photos Pending goes straight to the review screen.
 */
function StatGrid({ data }: { data: DashboardData }) {
  const router = useRouter();
  return (
    <KpiRow columns={4} className="mb-5">
      <KpiChip value={data.active_lists} label="Lists" />
      <KpiChip value={`${data.avg_completion}%`} label="Done" />
      <KpiChip
        value={data.total_overdue}
        label="Overdue"
        tone={data.total_overdue > 0 ? 'danger' : 'default'}
      />
      <KpiChip
        value={data.total_photos_pending}
        label="Photos"
        onClick={() => router.push('/tasks/manager/review')}
      />
    </KpiRow>
  );
}

/** Plain words for a list's state — never colour alone (design guide §4). */
const LIST_STATE_LABEL: Record<string, string> = {
  done: 'Done',
  in_progress: 'In progress',
};

function DeptList({ lists }: { lists: TaskListSummary[] }) {
  if (!lists.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-3xl mb-2">📋</p>
        <p className="font-semibold text-gray-700 text-[var(--fs-sm)]">No lists for today</p>
        <p className="text-[var(--fs-xs)] text-gray-400 mt-1">Use “Create today&apos;s lists” below to build them from the active templates.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {lists.map((l, i) => (
        <Link
          key={l.id}
          href={`/tasks/manager/dept/${l.department_id}`}
          className={`flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors ${i < lists.length - 1 ? 'border-b border-gray-100' : ''}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              l.state === 'done' ? 'bg-green-500' :
              l.state === 'in_progress' ? 'bg-amber-400' : 'bg-gray-300'
            }`} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-[var(--fs-sm)] text-gray-800 truncate">{l.department_name}</p>
              {/* The dot alone said nothing — a colour is not a status. The word
                  carries it now, and the photo count says what it counts
                  instead of leaving a bare camera glyph to be guessed at. */}
              <p className="text-[var(--fs-xs)] text-gray-400 mt-0.5">
                {LIST_STATE_LABEL[l.state] || 'Not started'}
                {' · '}{l.line_count} task{l.line_count === 1 ? '' : 's'}
                {l.overdue_count > 0 ? ` · ${l.overdue_count} overdue` : ''}
                {l.photo_pending_count > 0
                  ? ` · ${l.photo_pending_count} photo${l.photo_pending_count === 1 ? '' : 's'} to review`
                  : ''}
              </p>
            </div>
          </div>
          <span className={`text-[var(--fs-sm)] font-bold ${
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
