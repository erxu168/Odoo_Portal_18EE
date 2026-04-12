'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BackHeader,
  PickCircle,
  ProgressBar,
  TimerDisplay,
  SectionTitle,
  ActionButton,
} from './ui';

interface ActiveWorkOrderProps {
  moId: number;
  woId: number;
  onBack: () => void;
  onDone: () => void;
}

export default function ActiveWorkOrder({
  moId,
  woId,
  onBack,
  onDone,
}: ActiveWorkOrderProps) {
  const [wo, setWo] = useState<any>(null);
  const [allWos, setAllWos] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Pick state
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());

  // Consumption state
  const [consumedQtys, setConsumedQtys] = useState<Record<number, string>>({});

  // Timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchWorkOrder();
    fetchAllWos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((s) => s + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  async function fetchWorkOrder() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/work-orders/${woId}`,
      );
      const data = await res.json();
      setWo(data.work_order);
      setComponents(data.work_order?.components || []);

      const durationMinutes = data.work_order?.duration || 0;
      setTimerSeconds(Math.round(durationMinutes * 60));

      if (data.work_order?.state === 'progress') {
        setIsRunning(true);
      }

      const picked = new Set<number>();
      for (const c of data.work_order?.components || []) {
        if (c.picked) picked.add(c.id);
      }
      setPickedIds(picked);

      const qtys: Record<number, string> = {};
      for (const c of data.work_order?.components || []) {
        if (c.quantity > 0) {
          qtys[c.id] = String(Math.round(c.quantity * 10000) / 10000);
        }
      }
      setConsumedQtys(qtys);
    } catch (err) {
      console.error('Failed to fetch work order:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllWos() {
    try {
      const res = await fetch(
        `/api/manufacturing-orders/${moId}/work-orders`,
      );
      const data = await res.json();
      setAllWos(data.work_orders || []);
    } catch (err) {
      console.error('Failed to fetch all work orders:', err);
    }
  }

  const togglePick = useCallback(
    async (moveId: number) => {
      const newPicked = new Set(pickedIds);
      const isPicked = !newPicked.has(moveId);

      if (isPicked) newPicked.add(moveId);
      else newPicked.delete(moveId);
      setPickedIds(newPicked);

      try {
        await fetch(
          `/api/manufacturing-orders/${moId}/work-orders/${woId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pick_updates: [{ move_id: moveId, is_picked: isPicked }],
            }),
          },
        );
      } catch (err) {
        console.error('Failed to update pick status:', err);
      }
    },
    [pickedIds, moId, woId],
  );

  function updateConsumedQty(moveId: number, value: string) {
    setConsumedQtys((prev) => ({ ...prev, [moveId]: value }));
  }

  async function saveConsumedQtys() {
    const updates = Object.entries(consumedQtys)
      .filter(([, val]) => val && parseFloat(val) > 0)
      .map(([moveId, val]) => ({
        move_id: parseInt(moveId),
        consumed_qty: parseFloat(val),
      }));

    if (!updates.length) return;

    try {
      await fetch(
        `/api/manufacturing-orders/${moId}/work-orders/${woId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ component_updates: updates }),
        },
      );
    } catch (err) {
      console.error('Failed to save consumed quantities:', err);
    }
  }

  async function handleAction(action: string) {
    await saveConsumedQtys();

    try {
      await fetch(
        `/api/manufacturing-orders/${moId}/work-orders/${woId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );

      if (action === 'start') {
        setIsRunning(true);
      } else if (action === 'pause') {
        setIsRunning(false);
      } else if (action === 'done') {
        setIsRunning(false);
        onDone();
      }
    } catch (err) {
      console.error(`Failed to ${action} work order:`, err);
    }
  }

  if (loading || !wo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading...</p>
        </div>
      </div>
    );
  }

  const pickedCount = pickedIds.size;
  const totalCount = components.length;
  const filledCount = Object.values(consumedQtys).filter(
    (v) => v && parseFloat(v) > 0,
  ).length;
  const isPickMode = wo.name?.toLowerCase().includes('collect');
  const isWeighMode =
    wo.name?.toLowerCase().includes('weigh') ||
    wo.name?.toLowerCase().includes('measure');

  const currentWoIdx = allWos.findIndex((w: any) => w.id === woId);
  const totalSteps = allWos.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <BackHeader
        backLabel={wo.production_id?.[1] || 'Back'}
        onBack={onBack}
        title={wo.name}
        subtitle={`${wo.workcenter_id[1]} \u00b7 ${totalCount} components`}
      />

      {/* Timer bar */}
      <div className="flex items-center justify-center gap-5 py-5 bg-gray-100">
        <button
          onClick={() => handleAction(isRunning ? 'pause' : 'start')}
          className={`w-12 h-12 rounded-full flex items-center justify-center border ${
            isRunning
              ? 'bg-red-50 border-red-200'
              : 'bg-white border-gray-300'
          }`}
        >
          {isRunning ? (
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="rgb(220,38,38)" strokeWidth="2.5" strokeLinecap="round">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          ) : (
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>
        <TimerDisplay seconds={timerSeconds} isRunning={isRunning} />
        <button
          onClick={() => setIsRunning(!isRunning)}
          className="w-12 h-12 rounded-full bg-white border border-gray-300 flex items-center justify-center"
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="10" y1="6" x2="10" y2="18" />
            <line x1="14" y1="6" x2="14" y2="18" />
          </svg>
        </button>
      </div>

      {/* Step indicator dots */}
      {totalSteps > 1 && (
        <div className="flex items-center gap-1.5 px-5 py-2.5">
          {allWos.map((w: any) => (
            <span
              key={w.id}
              className={`rounded-full ${
                w.state === 'done'
                  ? 'w-2 h-2 bg-green-500'
                  : w.id === woId
                  ? 'w-2.5 h-2.5 bg-blue-500'
                  : 'w-2 h-2 bg-gray-300'
              }`}
            />
          ))}
          <span className="text-[var(--fs-xs)] text-gray-500 ml-1.5">
            Step {currentWoIdx + 1} of {totalSteps}
          </span>
        </div>
      )}

      {/* Progress */}
      <ProgressBar
        value={isWeighMode ? filledCount : pickedCount}
        max={totalCount}
        label={
          isWeighMode
            ? `Weighed: ${filledCount} of ${totalCount}`
            : `Picked: ${pickedCount} of ${totalCount}`
        }
        color="green"
      />

      <SectionTitle>
        {isPickMode
          ? 'Tap to mark as collected'
          : isWeighMode
          ? 'Enter actual weight'
          : 'Components'}
      </SectionTitle>

      {/* Component list */}
      <div className="px-4 pb-4 flex flex-col gap-1">
        {components.map((c: any) => {
          const isPicked = pickedIds.has(c.id);
          const consumed = consumedQtys[c.id] || '';
          const isFilled = consumed && parseFloat(consumed) > 0;
          const targetQty = Math.round(c.product_uom_qty * 10000) / 10000;
          const uom = c.product_uom?.[1] || 'kg';
          const onHand = c.on_hand_qty || 0;
          const availColor =
            onHand >= targetQty
              ? 'text-green-600'
              : onHand > 0
              ? 'text-amber-600'
              : 'text-red-600';

          return (
            <div
              key={c.id}
              className={`bg-white border border-gray-200 rounded-lg px-3.5 py-2 flex items-center gap-3 transition-opacity ${
                isPicked || isFilled ? 'opacity-45' : ''
              }`}
            >
              <PickCircle
                checked={isPicked || !!isFilled}
                onToggle={() => {
                  if (isWeighMode) return;
                  togglePick(c.id);
                }}
              />

              <div className="flex-1 min-w-0">
                <div className={`text-[var(--fs-xl)] font-bold text-gray-900 ${isPicked ? 'line-through' : ''}`}>
                  {c.product_id[1]}
                </div>
                <div className={`text-[var(--fs-sm)] mt-0.5 ${availColor}`}>
                  {isWeighMode
                    ? `Target: ${new Intl.NumberFormat('de-DE').format(targetQty)}${uom}`
                    : `${new Intl.NumberFormat('de-DE').format(onHand)} ${uom} on hand`}
                </div>
              </div>

              {isWeighMode ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={consumed}
                    onChange={(e) => updateConsumedQty(c.id, e.target.value)}
                    onBlur={() => {
                      if (consumed && parseFloat(consumed) > 0) {
                        const newPicked = new Set(pickedIds);
                        newPicked.add(c.id);
                        setPickedIds(newPicked);
                      }
                    }}
                    placeholder="0"
                    className={`w-16 px-2 py-2 text-right text-[var(--fs-xl)] font-bold rounded-lg border ${
                      isFilled
                        ? 'border-green-400 text-green-600'
                        : 'border-gray-200 text-gray-900'
                    } bg-white`}
                  />
                  <span className="text-xs text-gray-500 w-3">{uom}</span>
                </div>
              ) : (
                <div className="text-xs text-gray-400 flex-shrink-0">
                  {new Intl.NumberFormat('de-DE').format(targetQty)}{uom}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="px-4 pb-6 pt-3 bg-white border-t border-gray-200">
        <div className="flex gap-2">
          <div className="flex-1">
            <ActionButton
              variant="warning"
              onClick={() => handleAction('pause')}
            >
              Pause
            </ActionButton>
          </div>
          <div className="flex-1">
            <ActionButton
              variant="success"
              onClick={() => handleAction('done')}
            >
              {currentWoIdx < totalSteps - 1
                ? 'Next step'
                : 'Mark step done'}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}
