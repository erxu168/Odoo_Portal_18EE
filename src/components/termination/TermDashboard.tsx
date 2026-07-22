'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';

interface TermDashboardProps {
  onNavigate: (screen: string) => void;
}

interface Tile {
  id: string;
  emoji: string;
  label: string;
  sub: string;
}

export default function TermDashboard({ onNavigate }: TermDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ inProgress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const url = companyId
          ? `/api/termination?company_id=${companyId}&limit=500`
          : '/api/termination?limit=500';
        const res = await fetch(url);
        const json = await res.json();
        const records = json.data || [];
        setStats({
          inProgress: records.filter((r: any) => ['draft', 'confirmed', 'signed'].includes(r.state)).length,
          completed: records.filter((r: any) => ['delivered', 'archived'].includes(r.state)).length,
        });
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const tiles: Tile[] = [
    { id: 'new', emoji: '⏺️', label: 'New Termination', sub: 'Select employee' },
    { id: 'in_progress', emoji: '\u{1F4CB}', label: 'In Progress', sub: 'Draft, confirmed, signed' },
    { id: 'completed', emoji: '✅', label: 'Completed', sub: 'Delivered & archived' },
  ];

  return (
    <div className="px-5 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Counts — neutral (neither is a "problem" state) */}
          <KpiRow columns={2}>
            <KpiChip value={stats.inProgress} label="In progress" />
            <KpiChip value={stats.completed} label="Completed" />
          </KpiRow>

          {/* Tiles */}
          <ActionGrid<Tile>
            items={tiles}
            getItemId={(t) => t.id}
            renderItem={(t) => (
              <ActionCard emoji={t.emoji} label={t.label} subtitle={t.sub} onClick={() => onNavigate(t.id)} />
            )}
          />
        </div>
      )}
    </div>
  );
}
