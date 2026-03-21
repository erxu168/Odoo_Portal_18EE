'use client';

import React, { useState, useEffect } from 'react';
import {
  BackHeader,
  Badge,
  TimerChip,
  ProgressBar,
} from './ui';

interface WorkOrderListProps {
  moId: number;
  onBack: () => void;
  onSelectWo: (woId: number) => void;
}

export default function WorkOrderList({
  moId,
  onBack,
  onSelectWo,
}: WorkOrderListProps) {
  const [mo, setMo] = useState<any>(null);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMoDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moId]);

  async function fetchMoDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/manufacturing-orders/${moId}`);
      const data = await res.json();
      setMo(data.order);
      setWorkOrders(data.order?.work_orders || []);
    } catch (err) {
      console.error('Failed to fetch MO:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleWoAction(woId: number, action: string) {
    try {
      await fetch(`/api/manufacturing-orders/${moId}/work-orders/${woId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchMoDetail();
    } catch (err) {
      console.error(`Failed to ${action} work order:`, err);
    }
  }

  function getStateBadge(state: string) {
    switch (state) {
      case 'done':
        return <Badge variant="done">Done</Badge>;
      case 'progress':
        return <Badge variant="progress">In progress</Badge>;
      case 'ready':
        return <Badge variant="ready">Ready</Badge>;
      case 'pending':
      case 'waiting':
        return <Badge variant="pending">Waiting</Badge>;
      case 'cancel':
        return <Badge variant="draft">Cancelled</Badge>;
      default:
        return <Badge variant="draft">{state}</Badge>;
    }
  }

  if (loading || !mo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading...</p>
        </div>
      </div>
    );
  }

  const doneCount = workOrders.filter((wo) => wo.state === 'done').length;
  const totalCount = workOrders.length;
  const uom = mo.product_uom_id?.[1] || 'kg';

  return (
    <div className="min-h-screen bg-gray-50">
      <BackHeader
        backLabel={mo.name}
        onBack={onBack}
        title={mo.product_id[1]}
        subtitle={`${new Intl.NumberFormat('de-DE').format(mo.product_qty)}${uom} \u00b7 ${totalCount} steps \u00b7 ${mo.state}`}
      />

      <ProgressBar
        value={doneCount}
        max={totalCount}
        label={`${doneCount} of ${totalCount} done`}
        color="green"
      />

      {/* Work order cards */}
      <div className="px-4 pb-6 flex flex-col gap-2">
        {workOrders.map((wo, idx) => {
          const isActive = wo.state === 'progress';
          const isDone = wo.state === 'done';
          const isReady = wo.state === 'ready';
          const componentNames = (wo.components || []).map(
            (c: any) => c.product_id[1],
          );
          const displayNames =
            componentNames.length > 5
              ? [
                  ...componentNames.slice(0, 5),
                  `+${componentNames.length - 5} more`,
                ]
              : componentNames;

          return (
            <div
              key={wo.id}
              className={`bg-white border rounded-xl px-4 py-3.5 ${
                isActive ? 'border-blue-200' : 'border-gray-200'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[15px] font-medium text-gray-900">
                    {idx + 1}. {wo.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {wo.workcenter_id[1]}
                  </div>
                </div>
                {getStateBadge(wo.state)}
              </div>

              <div className="flex justify-between items-center mt-2.5 pt-2.5 border-t border-gray-100">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  {wo.duration > 0 && <TimerChip minutes={wo.duration} />}
                  {wo.duration === 0 && wo.duration_expected > 0 && (
                    <span>Est. {Math.round(wo.duration_expected)} min</span>
                  )}
                  {componentNames.length > 0 && (
                    <span>{componentNames.length} items</span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {isReady && (
                    <button
                      onClick={() => handleWoAction(wo.id, 'start')}
                      className="w-9 h-9 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center"
                      title="Start"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="rgb(29,78,216)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="6,4 20,12 6,20" />
                      </svg>
                    </button>
                  )}
                  {isActive && (
                    <>
                      <button
                        onClick={() => handleWoAction(wo.id, 'pause')}
                        className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center"
                        title="Pause"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="rgb(180,83,9)" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="10" y1="6" x2="10" y2="18" />
                          <line x1="14" y1="6" x2="14" y2="18" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleWoAction(wo.id, 'done')}
                        className="w-9 h-9 rounded-full bg-green-50 border border-green-300 flex items-center justify-center"
                        title="Done"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="rgb(5,150,105)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {displayNames.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-100">
                  <div className="text-[11px] text-gray-400 mb-1.5">Assigned components</div>
                  <div className="flex flex-wrap gap-1">
                    {displayNames.map((name: string, i: number) => (
                      <span
                        key={i}
                        className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(isActive || isDone || isReady) && (
                <button
                  onClick={() => onSelectWo(wo.id)}
                  className="mt-2.5 w-full text-center text-xs text-green-600 py-1"
                >
                  {isActive
                    ? 'Open work order \u2192'
                    : isDone
                    ? 'View details \u2192'
                    : 'View components \u2192'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
