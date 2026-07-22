'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { Spinner, EmptyState } from '@/components/inventory/ui';
import { apiGet, apiSend, fmtDayShort, shiftDayAdd } from './common';
import { CompanyPill } from './CompanyPill';
import { StorageTray, type StorageRow } from './StorageTray';
import { EntryCard, type FeedEntry } from './EntryCard';
import { AddEntrySheet, type LogTypeChip } from './AddEntrySheet';
import { ManageTypes } from './ManageTypes';

interface Feed {
  operational_date: string;
  is_today: boolean;
  recent_dates: string[];
  types: LogTypeChip[];
  storage: StorageRow[];
  entries: FeedEntry[];
  me: { actor_name: string; can_post: boolean; can_manage: boolean };
}

function partOfDay(iso: string): string {
  const h = new Date(iso).getHours();
  if (isNaN(h)) return '';
  if (h >= 17) return 'Evening shift';
  if (h >= 11) return 'Afternoon';
  return 'Morning shift';
}

export function ShiftHandoverApp() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [date, setDate] = useState<string>(''); // '' = today (server decides)
  const [screen, setScreen] = useState<'log' | 'types'>('log');
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<FeedEntry | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [ackBusy, setAckBusy] = useState<number | null>(null);
  const [storageBusy, setStorageBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((d?: string) => {
    const qd = d !== undefined ? d : date;
    apiGet(`/api/shift-handover/feed${qd ? `?date=${qd}` : ''}`)
      .then((f: Feed) => { setFeed(f); setDate(f.operational_date); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not open the shift log.'));
  }, [date]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goDate = (d: string) => { setFeed(null); setDate(d); load(d); };
  const onSwitched = useCallback(() => { setFeed(null); setDate(''); setScreen('log'); load(''); }, [load]);

  async function markUsed(id: number) {
    setStorageBusy(id);
    try { await apiSend(`/api/shift-handover/storage/${id}/used`, 'POST'); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update.'); }
    finally { setStorageBusy(null); }
  }
  async function ack(entry: FeedEntry) {
    setAckBusy(entry.id);
    try {
      await apiSend(`/api/shift-handover/entries/${entry.id}/acknowledge`, 'POST', { known_updated_at: entry.updated_at });
      load();
    } catch (e) {
      // 409 = the note was edited since it loaded; refresh so the fresh content shows.
      if ((e as { status?: number })?.status === 409) load();
      else setError(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally { setAckBusy(null); }
  }
  async function del(entry: FeedEntry) {
    if (!window.confirm('Delete this note?')) return;
    try { await apiSend(`/api/shift-handover/entries/${entry.id}`, 'DELETE'); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.'); }
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

  const nextDate = shiftDayAdd(feed.operational_date, 1);
  const nextAllowed = !feed.is_today;
  const empty = feed.storage.length === 0 && feed.entries.length === 0;

  let lastBucket = '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-28">
      <AppHeader
        supertitle="Shift Handover"
        title={feed.is_today ? 'Today’s log' : 'Shift log'}
        subtitle={fmtDayShort(feed.operational_date)}
        action={
          <div className="flex items-center gap-1.5">
            {feed.me.can_manage && (
              <button onClick={() => setScreen('types')} aria-label="Log types (setup)" className="w-10 h-10 rounded-xl bg-white/15 text-white grid place-items-center active:bg-white/25">
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
          <StorageTray items={feed.storage} canPost={feed.me.can_post} busyId={storageBusy} onUsed={markUsed} today={feed.operational_date} />
        )}

        {empty ? (
          <EmptyState icon="🗒️" title={feed.is_today ? 'Nothing logged yet' : 'Nothing logged this day'}
            body={feed.is_today ? 'Tap “Add to the log” to tell the next shift what you did.' : 'No notes were left on this day.'} />
        ) : (
          <div className="flex flex-col gap-2">
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
                  <EntryCard entry={e} canPost={feed.me.can_post} ackBusy={ackBusy === e.id}
                    onAck={() => ack(e)} onEdit={() => setEditEntry(e)} onDelete={() => del(e)} onViewPhoto={setViewer} />
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

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
          types={feed.types}
          editEntry={editEntry}
          onClose={() => { setAddOpen(false); setEditEntry(null); }}
          onSaved={() => { setAddOpen(false); setEditEntry(null); load(); }}
        />
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
