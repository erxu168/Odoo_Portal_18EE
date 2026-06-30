'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useKds } from '@/lib/kds/state';
import { buildTaskGroups, effectiveWait, mostUrgentOrderId, passTier } from '@/lib/kds/priority';
import { unlockAudio, playNewOrderSound, playPassAlert, playRoundDone } from '@/lib/kds/soundEngine';
import { useTaskReminders } from '@/lib/kds/taskReminders';
import TaskReminderOverlay from '@/components/kds/TaskReminderOverlay';
import KdsTopbar from '@/components/kds/KdsTopbar';
import KdsTabs from '@/components/kds/KdsTabs';
import FireBar from '@/components/kds/FireBar';
import TaskCard from '@/components/kds/TaskCard';
import TableStrip from '@/components/kds/TableStrip';
import OrderTypePill from '@/components/kds/OrderTypePill';
import ReadyGrid from '@/components/kds/ReadyGrid';
import DoneGrid from '@/components/kds/DoneGrid';
import Pipeline from '@/components/kds/Pipeline';
import ClassicView from '@/components/kds/ClassicView';
import SettingsPanel from '@/components/kds/SettingsPanel';

export default function KdsPage() {
  const { orders, currentTab, roundState, firedOrderIds, settings, muted, mode, connected, addToRound } = useKds();
  const { reminder, dismiss: dismissReminder, snooze: snoozeReminder } = useTaskReminders(settings.posConfigId, muted);
  const [toast, setToast] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const boost = settings.takeawayBoost;
  const prevCountRef = useRef<number>(orders.length);
  const seenOrdersRef = useRef(false); // suppress the "new order" chime on first load
  const prevRoundDoneRef = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const taskStripRef = useRef<HTMLDivElement>(null);
  const tableStripRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

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

  // Sound: new order (only while something is actually being prepared)
  useEffect(() => {
    const isNewOrder = orders.length > prevCountRef.current;
    const hasPrep = orders.some(o => o.status === 'prep');
    // The first poll that populates the board is a load, not a new order.
    const initialLoad = !seenOrdersRef.current && orders.length > 0;
    if (orders.length > 0) seenOrdersRef.current = true;
    if (isNewOrder && !initialLoad) dismissReminder(); // a new order takes the screen back from any reminder
    if (isNewOrder && !initialLoad && hasPrep && !muted && settings.sndNewOrder) {
      playNewOrderSound(settings.sndNewOrderVol);
      const newest = orders[orders.length - 1];
      showToast(`New order: ${newest.table}`);
    }
    prevCountRef.current = orders.length;
  }, [orders.length, muted, settings.sndNewOrder, settings.sndNewOrderVol, orders, dismissReminder]);

  // Sound: round done
  useEffect(() => {
    if (roundState !== 'active') {
      prevRoundDoneRef.current = false;
      return;
    }
    const roundOrders = orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep');
    const isComplete = roundOrders.length === 0 || roundOrders.every(o => o.items.every(i => i.done));
    // Only chime if the round actually had food being prepared (no empty-board sound).
    if (isComplete && roundOrders.length > 0 && !prevRoundDoneRef.current && !muted && settings.sndRound) {
      playRoundDone(settings.sndRoundVol);
    }
    prevRoundDoneRef.current = isComplete;
  }, [orders, roundState, firedOrderIds, muted, settings.sndRound, settings.sndRoundVol]);

  // Sound: pass alert (check every 15s) — only while the kitchen is busy
  useEffect(() => {
    if (!settings.sndPass || muted) return;
    const interval = setInterval(() => {
      // No order being prepared -> kitchen is idle -> stay silent.
      if (!orders.some(o => o.status === 'prep')) return;
      const readyOrders = orders.filter(o => o.status === 'ready' && o.readyAt);
      const hasCritical = readyOrders.some(o => passTier(o.readyAt!, settings) === 'red');
      if (hasCritical) playPassAlert(settings.sndPassVol);
    }, 15000);
    return () => clearInterval(interval);
  }, [orders, muted, settings]);

  // Auto-scroll: reset to most urgent order after inactivity
  useEffect(() => {
    if (!settings.autoScrollSec || settings.autoScrollSec <= 0) return;

    function resetActivity() {
      lastActivityRef.current = Date.now();
    }

    document.addEventListener('touchstart', resetActivity);
    document.addEventListener('click', resetActivity);
    document.addEventListener('scroll', resetActivity, true);

    const interval = setInterval(() => {
      const idle = (Date.now() - lastActivityRef.current) / 1000;
      if (idle >= settings.autoScrollSec) {
        taskStripRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
        tableStripRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
      }
    }, 2000);

    return () => {
      document.removeEventListener('touchstart', resetActivity);
      document.removeEventListener('click', resetActivity);
      document.removeEventListener('scroll', resetActivity, true);
      clearInterval(interval);
    };
  }, [settings.autoScrollSec]);

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }

  // Prep tab content
  const prepOrders = orders.filter(o => o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost));
  const displayOrders = roundState === 'active'
    ? orders.filter(o => firedOrderIds.includes(o.id) && o.status === 'prep').sort((a, b) => effectiveWait(b, boost) - effectiveWait(a, boost))
    : prepOrders;
  const tasks = buildTaskGroups(displayOrders, boost);
  const mui = mostUrgentOrderId(displayOrders, boost);

  // Orders that arrived after START COOKING locked the batch. They stay off the
  // cooking screen and are surfaced through the banner instead of appearing on
  // their own — so the layout doesn't shift under the cook mid-service.
  const queuedNew = roundState === 'active'
    ? orders.filter(o => o.status === 'prep' && !firedOrderIds.includes(o.id))
    : [];

  return (
    <>
      <KdsTopbar />
      {!connected && (
        <div className="kds-offline-banner">
          <span className="kds-offline-dot" />
          Offline — reconnecting. Orders on screen are still valid; new orders appear when the connection is back.
        </div>
      )}
      <div className="kds-toolbar">
        <KdsTabs />
        {currentTab === 'prep' && mode === 'smart' && <FireBar />}
      </div>

      {currentTab === 'prep' && (
        <>
          <div className="kds-main">
            {roundState === 'active' && queuedNew.length > 0 && (
              <div className="kds-newbatch">
                <div
                  className="kds-newbatch-banner"
                  role="button"
                  onClick={() => setPreviewOpen(o => !o)}
                >
                  <span className="kds-newbatch-msg">
                    <span className="kds-newbatch-spark">{'⚡'}</span>
                    <strong>{queuedNew.length} new {queuedNew.length === 1 ? 'order' : 'orders'}</strong> waiting
                    <span className={`kds-newbatch-chevron ${previewOpen ? 'open' : ''}`}>
                      {previewOpen ? 'Hide' : 'Preview'} {'▾'}
                    </span>
                  </span>
                  <button
                    className="kds-newbatch-add"
                    onClick={e => { e.stopPropagation(); addToRound(); setPreviewOpen(false); }}
                  >
                    + ADD TO BATCH
                  </button>
                </div>
                {previewOpen && (
                  <div className="kds-newbatch-preview">
                    {queuedNew.map(o => (
                      <div key={o.id} className="kds-newbatch-pv-order">
                        <div className="kds-newbatch-pv-head">
                          <span className="kds-newbatch-pv-num">{o.table}</span>
                          <OrderTypePill type={o.type} size="sm" />
                        </div>
                        <div className="kds-newbatch-pv-items">
                          {o.items.map(i => (
                            <span key={i.id} className="kds-newbatch-pv-item">
                              <span className="kds-newbatch-pv-qty">{i.qty}x</span> {i.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode === 'classic' ? (
              <ClassicView />
            ) : tasks.length === 0 ? (
              <div className="kds-task-strip">
                <div className="kds-empty">
                  <div className="kds-empty-icon">{'\u{1F389}'}</div>
                  <div>All orders served!</div>
                </div>
              </div>
            ) : (
              <div className="kds-task-strip" ref={taskStripRef}>
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
            {mode === 'smart' && <TableStrip ref={tableStripRef} />}
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

      <TaskReminderOverlay reminder={reminder} onSnooze={snoozeReminder} />

      {toast && <div className="kds-toast">{toast}</div>}
    </>
  );
}
