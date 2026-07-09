'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface Props {
  onBack: () => void;
  onHome: () => void;
  onOpenEmployee: (id: number) => void;
}

interface MissingDoc { id: number; name: string; dept: string; missing: string[]; }
interface Expiring { id: number; name: string; dept: string; items: { label: string; date: string; days: number }[]; }
interface ContractEnding { id: number | null; name: string; dept: string; date: string; days: number; }
interface OverviewData {
  expiryDays: number;
  contractDays: number;
  totalStaff: number;
  missingDocs: MissingDoc[];
  expiring: Expiring[];
  contractsEnding: ContractEnding[];
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}
function daysLabel(days: number): string {
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'today';
  return `in ${days}d`;
}

export default function HrOverview({ onBack, onOpenEmployee }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    fetch('/api/hr/overview')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(() => setError('Could not load the overview.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <AppHeader title="Needs attention" showBack onBack={onBack} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-5">
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
        </div>
      ) : data ? (
        <div className="p-4 flex flex-col gap-4">
          <p className="text-[var(--fs-xs)] text-gray-400 px-1">Across {data.totalStaff} active staff you manage.</p>

          <Section title="Missing documents" count={data.missingDocs.length} empty="Everyone has their mandatory documents.">
            {data.missingDocs.map((m) => (
              <Row key={m.id} name={m.name} dept={m.dept} tone="red" onClick={() => onOpenEmployee(m.id)}
                detail={`${m.missing.length} missing: ${m.missing.join(', ')}`} />
            ))}
          </Section>

          <Section title={`Expiring within ${data.expiryDays} days`} count={data.expiring.length} empty="No permits, visas or cards expiring soon.">
            {data.expiring.map((e) => (
              <Row key={e.id} name={e.name} dept={e.dept} tone={e.items.some(i => i.days < 0) ? 'red' : 'amber'} onClick={() => onOpenEmployee(e.id)}
                detail={e.items.map(i => `${i.label} ${daysLabel(i.days)} (${fmtDate(i.date)})`).join(' · ')} />
            ))}
          </Section>

          <Section title={`Contracts ending within ${data.contractDays} days`} count={data.contractsEnding.length} empty="No fixed-term contracts ending soon.">
            {data.contractsEnding.map((c, i) => (
              <Row key={`${c.id || 0}-${i}`} name={c.name} dept={c.dept} tone={c.days < 0 ? 'red' : 'amber'}
                onClick={() => { if (c.id) onOpenEmployee(c.id); }}
                detail={`Ends ${fmtDate(c.date)} ${daysLabel(c.days)}`} />
            ))}
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="text-[var(--fs-base)] font-bold text-gray-900">{title}</div>
        <span className={'inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full text-[var(--fs-xs)] font-bold ' + (count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>{count}</span>
      </div>
      {count === 0
        ? <div className="px-4 py-4 text-[var(--fs-sm)] text-gray-400">{empty}</div>
        : <div className="divide-y divide-gray-100">{children}</div>}
    </div>
  );
}

function Row({ name, dept, detail, tone, onClick }: { name: string; dept: string; detail: string; tone: 'red' | 'amber'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-4 py-3 active:bg-gray-50 flex items-start gap-3">
      <span className={'mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ' + (tone === 'red' ? 'bg-red-500' : 'bg-amber-500')} />
      <div className="min-w-0 flex-1">
        <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">
          {name}{dept ? <span className="font-normal text-gray-400"> · {dept}</span> : null}
        </div>
        <div className="text-[var(--fs-xs)] text-gray-500">{detail}</div>
      </div>
    </button>
  );
}
