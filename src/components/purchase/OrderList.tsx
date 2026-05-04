'use client';

import React, { useEffect, useState } from 'react';
import { ds, getBadgeClass } from '@/lib/design-system';

interface Order {
  id: number;
  name: string;
  partnerName: string;
  state: string;
  displayStatus: string;
  dateOrder: string;
  amountTotal: number;
  lineCount: number;
  deliveryChecked: boolean;
  userId: string;
}

interface Props {
  onSelect: (orderId: number) => void;
  onHome: () => void;
}

/**
 * OrderList — Orders grouped by status
 *
 * Groups: Drafts & Approval, Sent, To Receive
 * Past orders hidden behind toggle button.
 */
export default function OrderList({ onSelect }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    fetch('/api/purchase/orders')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setOrders(data.orders || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const drafts = orders.filter((o) => o.displayStatus === 'draft');
  const sent = orders.filter((o) => o.displayStatus === 'sent');
  const toReceive = orders.filter((o) => o.displayStatus === 'to_receive');
  const past = orders.filter((o) => o.displayStatus === 'completed');

  function formatDate(d: string): string {
    if (!d) return '';
    try {
      return new Date(d).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short',
      });
    } catch { return d; }
  }

  function renderGroup(title: string, items: Order[], badgeColor: string) {
    if (items.length === 0) return null;
    return (
      <>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className={ds.sectionLabel}>{title}</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}
          >
            {items.length}
          </span>
        </div>
        {items.map((o) => (
          <div
            key={o.id}
            className={`${ds.cardHover} mx-4 mb-2 overflow-hidden`}
            onClick={() => onSelect(o.id)}
          >
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[14px] font-bold text-gray-900 truncate">
                  {o.partnerName}
                </span>
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${getBadgeClass(
                    o.state
                  )}`}
                >
                  {o.displayStatus === 'draft'
                    ? '✏ Draft'
                    : o.displayStatus === 'sent'
                    ? '📦 Sent'
                    : o.displayStatus === 'to_receive'
                    ? '✓ Check delivery'
                    : 'Completed'}
                </span>
              </div>
              <div className="flex gap-3 text-[12px] text-gray-500">
                <span>{o.name}</span>
                <span>{o.lineCount} items</span>
                <span className="font-mono font-semibold text-gray-700">
                  €{o.amountTotal.toFixed(2)}
                </span>
                {o.dateOrder && (
                  <span className="text-gray-400">{formatDate(o.dateOrder)}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <div className={ds.topbar}>
        <div>
          <div className={ds.topbarTitle}>Orders</div>
          <div className={ds.topbarSub}>Active orders & deliveries</div>
        </div>
      </div>

      <div className={ds.scrollArea}>
        {loading && (
          <div className="px-4 space-y-3 pt-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`${ds.skeleton} h-20`} />
            ))}
          </div>
        )}

        {error && (
          <div className={ds.emptyState}>
            <div className={ds.emptyIcon}>⚠️</div>
            <div className={ds.emptyTitle}>Failed to load orders</div>
            <div className={ds.emptyBody}>{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {renderGroup('Drafts & Approval', drafts, 'bg-amber-100 text-amber-800')}
            {renderGroup('Sent', sent, 'bg-blue-100 text-blue-800')}
            {renderGroup('To Receive', toReceive, 'bg-green-100 text-green-800')}

            {past.length > 0 && (
              <div className="px-4 pt-4">
                <button
                  onClick={() => setShowPast(!showPast)}
                  className={ds.btnSecondary}
                >
                  {showPast ? '📂 Hide Past Orders' : `📂 Show Past Orders (${past.length})`}
                </button>
              </div>
            )}

            {showPast &&
              renderGroup('Past Orders', past, 'bg-gray-100 text-gray-500')}

            {orders.length === 0 && (
              <div className={ds.emptyState}>
                <div className={ds.emptyIcon}>📦</div>
                <div className={ds.emptyTitle}>No orders yet</div>
                <div className={ds.emptyBody}>
                  Create your first order from the Guides tab
                </div>
              </div>
            )}
          </>
        )}

        <div className="h-20" />
      </div>
    </>
  );
}
