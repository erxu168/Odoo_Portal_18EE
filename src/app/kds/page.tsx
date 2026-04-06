'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useKds } from '@/lib/kds/state';
import { buildTaskGroups, effectiveWait, mostUrgentOrderId, passTier } from '@/lib/kds/priority';
import { unlockAudio, playNewOrderSound, playPassAlert, playRoundDone } from '@/lib/kds/soundEngine';
import KdsTopbar from '@/components/kds/KdsTopbar';
import KdsTabs from '@/components/kds/KdsTabs';
import FireBar from '@/components/kds/FireBar';
import TaskCard from '@/components/kds/TaskCard';
import TableStrip from '@/components/kds/TableStrip';
import ReadyGrid from '@/components/kds/ReadyGrid';
import DoneGrid from '@/components/kds/DoneGrid';
import Pipeline from '@/components/kds/Pipeline';
import ClassicView from '@/components/kds/ClassicView';
import SettingsPanel from '@/components/kds/SettingsPanel';

export default function KdsPage() {
  const { orders, currentTab, roundState, firedOrderIds, settings, muted, mode } = useKds();
  const [toast, setToast] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const boost = settings.takeawayBoost;
  const prevCountRef = useRef<number>(orders.length);
  const prevRoundDoneRef = useRef(false);

  // Unlock audio on first interaction
  const handleInteraction = useCallback(() => {
    if (!audioUnlocked) {
      unlockAudio();
      setAudioUnlocked(true);
    }
  }, [audioUnlocked]);

  useEffect(() => {
    document.addEventListener('click', handleInteraction, { once: true });
    document.addEventListener('touchstart', handleInteraction, { once: true });
    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
    };
  }, [handleInteraction]);

  // Sound: new order
  useEffect(() => {
    if (orders.length > prevCountRef.current && !muted && settings.sndNewOrder) {
      playNewOrderSound(settings.sndNewOrderVol);
      const newest = orders[orders.length - 1];
      showToast(`New order: ${newest.table}`);
    }
    prevCountRef.current = orders.length;
  }, [orders.length, muted, settings.sndNewOrder, settings.sndNewOrderVol, orders]);

  // Sound: round done
  useEffect(() => {
    if (roundState !== 'active') {
      prevRoundDoneRef.current = false;
      return;
    }
    const roundOrders = orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep');
    const isComplete = roundOrders.length === 0 || roundOrders.every(o => o.items.every(i => i.done));
    if (isComplete && !prevRoundDoneRef.current && !muted && settings.sndRound) {
      playRoundDone(settings.sndRoundVol);
    }
    prevRoundDoneRef.current = isComplete;
  }, [orders, roundState, firedOrderIds, muted, settings.sndRound, settings.sndRoundVol]);

  // Sound: pass alert (check every 15s)
  useEffect(() => {
    if (!settings.sndPass || muted) return;
    const interval = setInterval(() => {
      const readyOrders = orders.filter(o => o.status === 'ready' && o.readyAt);
      const hasCritical = readyOrders.some(o => passTier(o.readyAt!, settings) === 'red');
      if (hasCritical) playPassAlert(settings.sndPassVol);
    }, 15000);
    return () => clearInterval(interval);
  }, [orders, muted, settings]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // Prep tab content
  const prepOrders = orders.filter(o => o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));
  const displayOrders = roundState === 'active'
    ? orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost))
    : prepOrders;
  const tasks = buildTaskGroups(displayOrders, boost);
  const mui = mostUrgentOrderId(displayOrders, boost);

  return (
    <>
      <KdsTopbar />
      <KdsTabs />

      {currentTab === 'prep' && (
        <>
          {mode === 'smart' && <FireBar />}
          <div className="kds-main">
            {mode === 'classic' ? (
              <ClassicView />
            ) : tasks.length === 0 ? (
              <div className="kds-task-strip">
                <div className="kds-empty">
                  <div className="kds-empty-icon">{roundState === 'active' ? '\u2705' : '\u{1F389}'}</div>
                  <div>{roundState === 'active' ? 'Round complete -- mark tables Ready then tap Next Round' : 'All orders served!'}</div>
                </div>
              </div>
            ) : (
              <div className="kds-task-strip">
                {tasks.map((task, idx) => (
                  <TaskCard
                    key={task.name}
                    task={task}
                    isPriority={idx === 0 && !task.allDone}
                    mostUrgentId={mui}
                  />
                ))}
              </div>
            )}
            {mode === 'smart' && <TableStrip />}
          </div>
        </>
      )}

      {currentTab === 'pipeline' && (
        <div className="kds-main">
          <Pipeline />
        </div>
      )}

      {currentTab === 'ready' && (
        <div className="kds-main">
          <ReadyGrid />
        </div>
      )}

      {currentTab === 'done' && (
        <div className="kds-main">
          <DoneGrid />
        </div>
      )}

      <SettingsPanel />

      {toast && <div className="kds-toast">{toast}</div>}
    </>
  );
}
