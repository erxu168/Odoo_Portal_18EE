'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { Sheet, apiGet, apiSend, fmtDayShort, shiftDayAdd } from './common';
import { CompanyPill } from './CompanyPill';
import { StorageTray, type StorageRow } from './StorageTray';
import { StorageItemDetail } from './StorageItemDetail';
import { EntryCard, type FeedEntry } from './EntryCard';
import { AddEntrySheet, type LogTypeChip, type NamedLookup } from './AddEntrySheet';
import { ManageTypes } from './ManageTypes';
import { ClearedHistory } from './ClearedHistory';

interface Feed {
  operational_date: string;
  is_today: boolean;
  recent_dates: string[];
  types: LogTypeChip[];
  prepped_items: NamedLookup[];
  units: NamedLookup[];
  storage: StorageRow[];
  entries: FeedEntry[];
  me: { actor_name: string; can_post: boolean; can_manage: boolean };
}

const REASONS: Array<{ key: string; label: string; emoji: string }> = [
  { key: 'moved_out', label: 'Moved out', emoji: '↗️' },
  { key: 'used_up', label: 'Used up', emoji: '✅' },
  { key: 'discarded', label: 'Discarded', emoji: '🗑️' },
];

function partOfDay(iso: string): string {
  const h = new Date(iso).getHours();
  if (isNaN(h)) return '';
  if (h >= 17) return 'Evening shift';
  if (h >= 11) return 'Afternoon';
  return 'Morning shift';
}
function sortStorage(arr: StorageRow[]): StorageRow[] {
  return [...arr].sort((a, b) => (b.use_first ? 1 : 0) - (a.use_first ? 1 : 0) || (a.added_at < b.added_at ? 1 : -1));
}

export function ShiftHandoverApp() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [date, setDate] = useState<string>('');
  const [screen, setScreen] = useState<'log' | 'types' | 'cleared'>('log');
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<FeedEntry | null>(null);
  const [detailItem, setDetailItem] = useState<StorageRow | null>(null);
  const [reasonItem, setReasonItem] = useState<StorageRow | null>(null);
  const [undo, setUndo] = useState<StorageRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<FeedEntry | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [ackBusy, setAckBusy] = useState<number | null>(null);
  const [storageBusy, setStorageBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (fn: (f: Feed) => Feed) => setFeed((f) => (f ? fn(f) : f));

  const load = useCallback((d?: string) => {
    const qd = d !== undefined ? d : date;
    apiGet(`/api/shift-handover/feed${qd ? `?date=${qd}` : ''}`)
      .then((f: Feed) => { setFeed(f); setDate(f.operational_date); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not open the shift log.'));
  }, [date]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The Undo bar is transient — clear it after a few seconds (server keeps a
  // slightly longer real undo window, so a late tap fails gracefully).
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 8000); return () => clearTimeout(t); }, [undo]);

  const goDate = (d: string) => { setFeed(null); setDate(d); load(d); };
  const onSwitched = useCallback(() => { setFeed(null); setDate(''); setScreen('log'); load(''); }, [load]);

  // Clear an item with a reason — optimistic remove + Undo, no full reload.
  async function clearStorage(item: StorageRow, reason: string) {
    setReasonItem(null);
    setStorageBusy(item.id);
    patch((f) => ({ ...f, storage: f.storage.filter((s) => s.id !== item.id) }));
    try {
      await apiSend(`/api/shift-handover/storage/${item.id}/used`, 'POST', { reason });
      setUndo(item);
    } catch (e) {
      patch((f) => ({ ...f, storage: sortStorage([...f.storage, item]) }));
      setToast(e instanceof Error ? e.message : 'Could not clear it.');
    } finally { setStorageBusy(null); }
  }
  async function undoClear() {
    const u = undo; setUndo(null);
    if (!u) return;
    try {
      await apiSend(`/api/shift-handover/storage/${u.id}/restore`, 'POST');
      patch((f) => ({ ...f, storage: sortStorage([...f.storage, u]) }));
    } catch (e) { setToast(e instanceof Error ? e.message : 'Too late to undo.'); }
  }

  async function ack(entry: FeedEntry) {
    setAckBusy(entry.id);
    try {
      const r: any = await apiSend(`/api/shift-handover/entries/${entry.id}/acknowledge`, 'POST', { known_updated_at: entry.updated_at });
      patch((f) => ({ ...f, entries: f.entries.map((e) => e.id === entry.id
        ? { ...e, acknowledged_by_name: r.acknowledged_by_name, acknowledged_at: r.acknowledged_at, can_acknowledge: false } : e) }));
    } catch (e) {
      if ((e as { status?: number })?.status === 409) load(); // content changed — refresh
      else setToast(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally { setAckBusy(null); }
  }

  async function doDelete(entry: FeedEntry) {
    setConfirmDel(null);
    const storageItem = entry.storage_item_id ? feed?.storage.find((s) => s.id === entry.storage_item_id) : undefined;
    patch((f) => ({
      ...f,
      entries: f.entries.filter((e) => e.id !== entry.id),
      storage: entry.storage_item_id ? f.storage.filter((s) => s.id !== entry.storage_item_id) : f.storage,
    }));
    try {
      await apiSend(`/api/shift-handover/entries/${entry.id}`, 'DELETE');
    } catch (e) {
      // Re-add ONLY the removed rows, so anything else that changed meanwhile stays.
      patch((f) => ({
        ...f,
        entries: [...f.entries, entry].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
        storage: storageItem ? sortStorage([...f.storage, storageItem]) : f.storage,
      }));
      setToast(e instanceof Error ? e.message : 'Could not delete.');
    }
  }

  const pill = <CompanyPill onSwitched={onSwitched} />;

  if (error && !feed) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <AppHeader supertitle="Shift Handover" title="Shift log" action={pill} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Couldn’t open the shift log</p>
          <p className="text-[var(--fs-sm)] text-gray-500 mb-4">{error}</p>
          <button onClick={() => router.push('/')} className="text-green-700 font-semibold">Back to home</button>
        </div>
      </div>
    );
  }
  if (!feed) return <div className="min-h-screen bg-gray-50 pt-24"><Spinner /></div>;

  if (screen === 'types') {
    return <ManageTypes companyPill={pill} onBack={() => { setScreen('log'); load(); }} />;
  }
  if (screen === 'cleared') {
    return <ClearedHistory companyPill={pill} onBack={() => setScreen('log')} />;
  }

  const nextDate = shiftDayAdd(feed.operational_date, 1);
  const nextAllowed = !feed.is_today;
  const empty = feed.storage.length === 0 && feed.entries.length === 0;
  let lastBucket = '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-28">
      <Toast message={toast || ''} type="error" visible={!!toast} onDismiss={() => setToast(null)} />

      <AppHeader
        supertitle="Shift Handover"
        title={feed.is_today ? 'Today’s log' : 'Shift log'}
        subtitle={fmtDayShort(feed.operational_date)}
        action={
          <div className="flex items-center gap-1.5">
            <button onClick={() => setScreen('cleared')} aria-label="Cleared items history" className="w-10 h-10 rounded-xl bg-white/15 text-white grid place-items-center active:bg-white/25">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </button>
            {feed.me.can_manage && (
              <button onClick={() => setScreen('types')} aria-label="Setup lists" className="w-10 h-10 rounded-xl bg-white/15 text-white grid place-items-center active:bg-white/25">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
              </button>
            )}
            {pill}
          </div>
        }
      />

      {/* Date bar */}
      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-b border-gray-100">
        <button onClick={() => goDate(shiftDayAdd(feed.operational_date, -1))} aria-label="Previous day" className="w-9 h-9 rounded-lg text-gray-500 active:bg-gray-100 grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="text-[var(--fs-sm)] font-semibold text-gray-800 min-w-[120px] text-center">{feed.is_today ? 'Today' : fmtDayShort(feed.operational_date)}</span>
        <button onClick={() => nextAllowed && goDate(nextDate)} disabled={!nextAllowed} aria-label="Next day" className="w-9 h-9 rounded-lg text-gray-500 active:bg-gray-100 grid place-items-center disabled:opacity-30">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        {!feed.is_today && <button onClick={() => goDate('')} className="ml-1 text-[var(--fs-xs)] font-semibold text-green-700 active:opacity-70">Today</button>}
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-4">
        {feed.storage.length > 0 && (
          <StorageTray items={feed.storage} canPost={feed.me.can_post} busyId={storageBusy}
            onClear={(it) => setReasonItem(it)} onOpen={(it) => setDetailItem(it)} />
        )}

        {empty ? (
          <EmptyState icon="🗒️" title={feed.is_today ? 'Nothing logged yet' : 'Nothing logged this day'}
            body={feed.is_today ? 'Tap “Add to the log” to tell the next shift what you did.' : 'No notes were left on this day.'} />
        ) : (
          <div className="flex flex-col gap-2">
            {feed.entries.length > 0 && (
              <div className="flex items-center gap-1.5 px-1">
                <h3 className="text-[var(--fs-sm)] font-bold text-gray-700">📋 {feed.is_today ? 'Today’s log' : 'The log'}</h3>
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">what happened</span>
              </div>
            )}
            {feed.entries.map((e) => {
              const bucket = partOfDay(e.created_at);
              const showDivider = bucket && bucket !== lastBucket;
              lastBucket = bucket;
              return (
                <React.Fragment key={e.id}>
                  {showDivider && (
                    <div className="flex items-center gap-2.5 mt-2 mb-0.5 first:mt-0">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-[10px] font-bold tracking-wider uppercase text-gray-400">{bucket}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  )}
                  <EntryCard entry={e} ackBusy={ackBusy === e.id}
                    onAck={() => ack(e)} onEdit={() => setEditEntry(e)} onDelete={() => setConfirmDel(e)} onViewPhoto={setViewer} />
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Undo shows on ANY date (storage can be cleared while viewing history),
          sitting above the Add button on today, else at the bottom. */}
      {undo && (
        <div className={`fixed left-0 right-0 max-w-lg mx-auto px-4 z-40 ${feed.is_today && feed.me.can_post ? 'bottom-[74px]' : 'bottom-3 pb-[env(safe-area-inset-bottom)]'}`}>
          <div className="bg-gray-900 text-white rounded-xl px-4 py-3 flex items-center justify-between text-[var(--fs-sm)] shadow-lg">
            <span><b>{undo.name}</b> cleared</span>
            <button onClick={undoClear} className="font-bold text-green-300 active:opacity-70">Undo</button>
          </div>
        </div>
      )}
      {feed.is_today && feed.me.can_post && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={() => setAddOpen(true)} className="w-full h-[52px] rounded-2xl bg-green-600 text-white font-bold text-[var(--fs-base)] flex items-center justify-center gap-2 active:bg-green-700 shadow-lg shadow-green-600/25">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Add to the log
          </button>
        </div>
      )}

      {(addOpen || editEntry) && (
        <AddEntrySheet
          types={feed.types} preppedItems={feed.prepped_items} units={feed.units} editEntry={editEntry}
          onClose={() => { setAddOpen(false); setEditEntry(null); }}
          onSaved={() => { setAddOpen(false); setEditEntry(null); load(); }}
        />
      )}

      {detailItem && (
        <StorageItemDetail
          item={detailItem} preppedItems={feed.prepped_items} units={feed.units} canEdit={feed.me.can_post}
          onClose={() => setDetailItem(null)}
          onClear={(it) => { setDetailItem(null); setReasonItem(it); }}
          onSaved={(u) => { patch((f) => ({ ...f, storage: f.storage.map((s) => (s.id === u.id ? u : s)) })); setDetailItem(null); }}
          onDeleted={(id) => { patch((f) => ({ ...f, storage: f.storage.filter((s) => s.id !== id) })); setDetailItem(null); }}
        />
      )}

      {reasonItem && (
        <Sheet title={`${reasonItem.name} — what happened to it?`} onClose={() => setReasonItem(null)}>
          <div className="flex flex-col gap-2 pb-1">
            {REASONS.map((r) => (
              <button key={r.key} onClick={() => clearStorage(reasonItem, r.key)}
                className="flex items-center gap-3 min-h-[52px] px-4 rounded-xl border border-gray-200 bg-white text-left active:bg-gray-50">
                <span className="text-[20px]">{r.emoji}</span>
                <span className="text-[var(--fs-base)] font-semibold text-gray-900">{r.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmDialog title="Delete this note?" message="It will be removed from the log." confirmLabel="Delete" variant="danger"
          onConfirm={() => doDelete(confirmDel)} onCancel={() => setConfirmDel(null)} />
      )}

      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setViewer(null)} role="dialog" aria-label="Photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer} alt="" className="max-w-full max-h-full rounded-lg" />
          <button onClick={() => setViewer(null)} aria-label="Close" className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 text-white grid place-items-center active:bg-white/25">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
