'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/inventory/ui';
import { apiGet, type FlatLocation } from './common';
import { Dashboard, type Overview } from './Dashboard';
import { RecordProduction } from './RecordProduction';
import { CurrentProduction } from './CurrentProduction';
import { StorageOverview } from './StorageOverview';
import { HandoverScreen } from './HandoverScreen';
import { Tasks } from './Tasks';
import { History } from './History';
import { Configuration } from './Configuration';

type Screen = 'dashboard' | 'record' | 'current' | 'storage' | 'handover' | 'tasks' | 'history' | 'config';

interface Me { role: string; capabilities: string[]; is_shared_device: boolean }
interface Cfg { products: any[]; container_types: Array<{ id: number; name: string }>; locations: FlatLocation[]; shift_labels: string[] }

// Capability required to even SEE each tile/screen.
const SCREEN_CAP: Record<string, string> = {
  record: 'handover.production.record', current: 'handover.view', storage: 'handover.view',
  handover: 'handover.view', tasks: 'handover.view', history: 'handover.history.view', config: 'handover.configure',
};

export function ShiftHandoverApp() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [me, setMe] = useState<Me | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [operationalDate, setOperationalDate] = useState<string>('');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoverDetailId, setHandoverDetailId] = useState<number | null>(null);

  const loadOverview = useCallback(() => {
    apiGet('/api/shift-handover/overview')
      .then((d: any) => { setOverview(d.overview); setOperationalDate(d.operational_date); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    apiGet('/api/auth/me').then((d: any) => setMe(d.user)).catch(() => router.push('/login'));
    loadOverview();
    Promise.all([apiGet('/api/shift-handover/config'), apiGet('/api/shift-handover/locations')])
      .then(([c, l]: any[]) => setCfg({ products: c.products, container_types: c.container_types, shift_labels: c.shift_labels || [], locations: l.flat || [] }))
      .catch((e) => setError(e.message));
  }, [loadOverview, router]);

  const can = useCallback((s: string) => {
    const cap = SCREEN_CAP[s];
    return !cap || !me ? true : me.capabilities.includes(cap);
  }, [me]);
  const has = useCallback((cap: string) => !!me?.capabilities.includes(cap), [me]);

  function go(s: Screen) { setHandoverDetailId(null); setScreen(s); }
  const back = () => { loadOverview(); go('dashboard'); }; // refresh counts on return

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Couldn’t open Shift Handover</p>
        <p className="text-[var(--fs-sm)] text-gray-500 mb-4">{error}</p>
        <button onClick={() => router.push('/')} className="text-green-700 font-semibold">Back to home</button>
      </div>
    );
  }
  if (!me || !cfg) return <div className="min-h-screen bg-gray-50 pt-24"><Spinner /></div>;

  const cfgForForms = { container_types: cfg.container_types, locations: cfg.locations };

  switch (screen) {
    case 'record':
      return <RecordProduction cfg={cfg} operationalDate={operationalDate} onBack={back} onDone={() => go('current')} />;
    case 'current':
      return <CurrentProduction cfg={cfgForForms} operationalDate={operationalDate} canEdit={has('handover.production.record')} onBack={back} onRecord={() => go('record')} />;
    case 'storage':
      return <StorageOverview cfg={cfgForForms} canEdit={has('handover.production.record')} onBack={back} />;
    case 'handover':
      return <HandoverScreen operationalDate={operationalDate} shiftLabels={cfg.shift_labels} canSubmit={has('handover.submit')} canAcknowledge={has('handover.acknowledge')} initialDetailId={handoverDetailId} onBack={back} />;
    case 'tasks':
      return <Tasks operationalDate={operationalDate} canCreate={has('handover.action.create')} canManageCritical={has('handover.action.manage_critical')} onBack={back} />;
    case 'history':
      return <History canViewAudit={has('handover.history.view')} onBack={back} onOpenHandover={(id) => { setHandoverDetailId(id); setScreen('handover'); }} />;
    case 'config':
      return <Configuration onBack={back} />;
    default:
      return <Dashboard overview={overview} operationalDate={operationalDate} can={can} onOpen={(s) => go(s as Screen)} />;
  }
}
