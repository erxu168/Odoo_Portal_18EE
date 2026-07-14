'use client';

import { useKds } from '@/lib/kds/state';
import type { KdsTab } from '@/types/kds';

const TABS: { key: KdsTab; label: string }[] = [
  { key: 'prep', label: 'In Preparation' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'ready', label: 'Ready' },
  { key: 'done', label: 'Done' },
];

export default function KdsTabs() {
  const { currentTab, setTab, orders } = useKds();

  function count(tab: KdsTab): number {
    switch (tab) {
      case 'prep':
      case 'pipeline':
        return orders.filter(o => o.status === 'prep').length;
      case 'ready':
        return orders.filter(o => o.status === 'ready').length;
      case 'done':
        return orders.filter(o => o.status === 'done').length;
    }
  }

  return (
    <div className="kds-tabs">
      {TABS.map(t => (
        <button
          key={t.key}
          className={`kds-tab ${currentTab === t.key ? 'active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.label}
          <span className="kds-tab-n">{count(t.key)}</span>
        </button>
      ))}
    </div>
  );
}
