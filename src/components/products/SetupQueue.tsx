'use client';

/**
 * Products waiting to be finished.
 *
 * Somebody scanned a barcode the system did not know during a count. Rather than
 * stopping the count, a product was created on the spot — inactive, holding only
 * that barcode and whatever name was typed. It is out of counts, orders and the
 * till until it is dealt with here.
 *
 * Three answers, because there are exactly three things it can be:
 *   Finish it        — a real new product. Opens its page to fill in the rest.
 *   Same as…         — it already exists under another name, or with no barcode
 *                      on it. The commonest answer. Moves the barcode across and
 *                      hands over anything already counted against the scan.
 *   Not a product    — a mis-scan, a shelf label, somebody's loyalty card.
 *
 * "Same as…" was withheld until 2026-07-30 because the endpoint could corrupt a
 * count three ways — it moved the Odoo barcode before the counts (so a database
 * failure stranded the draft with no barcode to retry from), it left the frozen
 * session scope naming the draft (so the moved line became unapprovable), and it
 * could hit the one-line-per-product-and-spot index. All three are fixed; a
 * genuine collision is now REFUSED and named rather than guessed at.
 *
 * Deliberately NOT a form. Editing a product's fields belongs on the product's
 * own page, which already owns every one of them; this screen only decides which
 * of the three a draft is.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner, EmptyState } from '@/components/inventory/ui';

interface Draft {
  id: number;
  barcode: string;
  scanned_at: string;
  name: string | null;
  categ_id: [number, string] | false | null;
  uom_id: [number, string] | false | null;
  missing: boolean;
  already_active: boolean;
  /** Set on the second pass: the endpoint's description of what would be lost. */
  _erases?: string;
}

/** "3 days ago" reads better here than a date: the age is the point. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'} ago`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return 'just now';
}

export default function SetupQueue({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmReject, setConfirmReject] = useState<Draft | null>(null);
  const [toast, setToast] = useState('');
  // "Same as…" — search the catalog and move the barcode onto the real product.
  const [linkFor, setLinkFor] = useState<Draft | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkHits, setLinkHits] = useState<{ id: number; name: string; category: string }[]>([]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState('');

  const load = useCallback(() => {
    setError('');
    fetch('/api/products/setup')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setDrafts(d.drafts || []))
      .catch(() => { setDrafts([]); setError('Could not load the list. Pull down to try again.'); });
  }, []);
  useEffect(load, [load]);

  /**
   * Remove a draft. Two steps, because the endpoint is built that way and it is
   * built that way for a good reason.
   *
   * The first call is unconfirmed. If anything has already been counted against
   * the draft the endpoint refuses with the actual work named, which is then
   * shown before asking again — a draft normally EXISTS because someone counted
   * it, so this is the common path, not the edge case.
   */
  async function reject(d: Draft, confirmed: boolean) {
    setBusy(d.id);
    setConfirmReject(null);
    try {
      const res = await fetch(
        `/api/inventory/products/${d.id}/reject${confirmed ? '?confirm=1' : ''}`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'WOULD_ERASE_COUNTS') {
        // Ask again, this time saying exactly what goes.
        setConfirmReject({ ...d, _erases: body.error || 'Counts have been recorded against this.' });
        return;
      }
      if (!res.ok) { setError(body.error || 'Could not remove that one.'); return; }
      // Removed from the list rather than reloaded: the rest of the queue keeps
      // its place, so working down a list of five does not jump under you.
      setDrafts((prev) => (prev || []).filter((x) => x.id !== d.id));
      setToast(`"${d.name || d.barcode}" removed.`);
      setTimeout(() => setToast(''), 2500);
    } catch { setError('Network error — nothing was changed.'); }
    finally { setBusy(null); }
  }

  // Debounced, so typing a product name is not one request per keystroke.
  useEffect(() => {
    if (!linkFor) return;
    const q = linkQuery.trim();
    if (q.length < 2) { setLinkHits([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=15`)
        .then((r) => (r.ok ? r.json() : { products: [] }))
        .then((d) => { if (!stale) setLinkHits(d.products || []); })
        .catch(() => { if (!stale) setLinkHits([]); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [linkQuery, linkFor]);

  async function linkTo(d: Draft, targetId: number, targetName: string) {
    setLinkBusy(true);
    setLinkErr('');
    try {
      const res = await fetch(`/api/inventory/products/${d.id}/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_product_id: targetId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A collision is shown IN the sheet, not as a toast — the manager has to
        // go and clear a count before this can work, so the message must stay put.
        setLinkErr(body.error || 'Could not join those two.');
        return;
      }
      setDrafts((prev) => (prev || []).filter((x) => x.id !== d.id));
      setLinkFor(null); setLinkQuery(''); setLinkHits([]);
      setToast(`Barcode moved onto "${targetName}".`);
      setTimeout(() => setToast(''), 3000);
    } catch { setLinkErr('Network error — nothing was changed.'); }
    finally { setLinkBusy(false); }
  }

  if (drafts === null) return <Spinner />;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <button onClick={onBack} aria-label="Back"
          className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h1 className="text-[var(--fs-xl)] font-bold text-gray-900">Needs setup</h1>
      </div>

      <p className="px-4 pb-3 text-[var(--fs-xs)] text-gray-500 leading-snug">
        A barcode the system didn&rsquo;t know was scanned during a count, so a product was started
        for it. Until one of these is finished it stays out of counts, orders and the till.
      </p>

      {error && (
        <div className="mx-4 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-[var(--fs-sm)] font-semibold text-red-700">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {drafts.length === 0 ? (
          <EmptyState title="Nothing waiting"
            body="Every scanned product has been finished or removed. New ones turn up here when somebody scans a barcode the system doesn’t recognise." />
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => (
              <div key={d.id} className="bg-white border border-gray-200 rounded-2xl p-3.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[var(--fs-base)] font-bold text-gray-900 truncate">
                      {d.name || 'No name yet'}
                    </div>
                    <div className="text-[var(--fs-xs)] text-gray-500 font-mono mt-0.5">{d.barcode}</div>
                    <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">Scanned {ago(d.scanned_at)}</div>
                  </div>
                </div>

                {d.missing && (
                  <p className="mt-2 text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    This one no longer exists in Odoo {'—'} somebody deleted it there. It cannot be
                    finished or removed from here yet; tell me and I will clear it.
                  </p>
                )}
                {d.already_active && !d.missing && (
                  <p className="mt-2 text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    This one is already live in Odoo but still shows here, so a previous finish only
                    half-completed. It is safe to use {'—'} it just needs clearing off this list, which
                    cannot be done from here yet.
                  </p>
                )}

                {/* No buttons for the two broken states: reject 404s on a
                    product Odoo no longer has, and approve refuses one that is
                    already active. A button that always fails is worse than none. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!d.missing && !d.already_active && (
                    <button
                      onClick={() => router.push(`/products/${d.id}?new=1`)}
                      className="flex-1 min-w-[120px] h-10 px-4 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700">
                      Finish it
                    </button>
                  )}
                  {!d.missing && !d.already_active && (
                    <button
                      onClick={() => { setLinkFor(d); setLinkQuery(d.name || ''); setLinkErr(''); }}
                      className="flex-1 min-w-[120px] h-10 px-4 rounded-xl border border-gray-300 text-gray-800 text-[var(--fs-sm)] font-bold active:bg-gray-50">
                      Same as{'…'}
                    </button>
                  )}
                  {!d.missing && !d.already_active && (
                  <button
                    onClick={() => setConfirmReject(d)}
                    disabled={busy === d.id}
                    className="flex-1 min-w-[120px] h-10 px-4 rounded-xl border border-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold active:bg-gray-50 disabled:opacity-50">
                    {busy === d.id ? 'Removing…' : 'Not a product'}
                  </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmReject && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end justify-center" onClick={() => setConfirmReject(null)}>
          <div className="w-full max-w-md bg-white rounded-t-2xl p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Remove this one?</h3>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-3">
              &ldquo;{confirmReject.name || confirmReject.barcode}&rdquo; will be dropped. Use this when the
              scan was a mistake {'—'} a shelf label, or the wrong side of a box.
            </p>
            {confirmReject._erases && (
              <p className="text-[var(--fs-sm)] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                {confirmReject._erases}
                {/* Deliberately precise: the endpoint only clears lines on counts
                    that are still open. A line on a count already submitted or
                    approved stays, so promising otherwise would be a lie. */}
                <span className="block mt-1.5 text-[var(--fs-xs)] text-red-700">
                  Counts still open lose their line. Anything already submitted or approved keeps its
                  history {'—'} that is a record of what was on the shelf and is not rewritten.
                </span>
              </p>
            )}
            <button onClick={() => reject(confirmReject, !!confirmReject._erases)}
              className="w-full h-12 rounded-xl bg-red-600 text-white font-bold active:bg-red-700 mb-2">
              {confirmReject._erases ? 'Yes, remove it anyway' : 'Yes, remove it'}
            </button>
            <button onClick={() => setConfirmReject(null)}
              className="w-full h-12 rounded-xl border border-gray-200 text-gray-600 font-bold active:bg-gray-50">
              Keep it
            </button>
          </div>
        </div>
      )}

      {linkFor && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-end justify-center"
          role="dialog" aria-modal="true" aria-label="Which product is this?"
          onClick={() => { if (!linkBusy) { setLinkFor(null); setLinkQuery(''); setLinkHits([]); setLinkErr(''); } }}>
          <div className="w-full max-w-md bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Which product is this?</h3>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-3">
              The barcode <span className="font-mono">{linkFor.barcode}</span> moves onto the product you
              pick, and anything already counted against the scan goes with it.
            </p>
            {linkErr && (
              <p className="text-[var(--fs-sm)] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3 mb-3">{linkErr}</p>
            )}
            <input autoFocus value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="Search the catalog…" disabled={linkBusy}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 h-11 text-[var(--fs-base)] outline-none focus:border-green-500 mb-3" />

            {linkQuery.trim().length < 2 ? (
              <p className="text-[var(--fs-xs)] text-gray-400">Type at least two letters.</p>
            ) : linkHits.length === 0 ? (
              <p className="text-[var(--fs-xs)] text-gray-400">
                Nothing matches. If it really is new, use &ldquo;Finish it&rdquo; instead.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {linkHits.map((h) => (
                  <button key={h.id} disabled={linkBusy}
                    onClick={() => linkTo(linkFor, h.id, h.name)}
                    className="w-full py-3 text-left flex items-center gap-3 active:bg-gray-50 disabled:opacity-50">
                    <div className="min-w-0 flex-1">
                      <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">{h.name}</div>
                      <div className="text-[var(--fs-xs)] text-gray-500 truncate">{h.category}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5" strokeLinecap="round" className="flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setLinkFor(null); setLinkQuery(''); setLinkHits([]); setLinkErr(''); }} disabled={linkBusy}
              className="w-full h-12 mt-3 rounded-xl border border-gray-200 text-gray-600 font-bold active:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] bg-gray-900 text-white text-[var(--fs-sm)] font-semibold px-4 py-2 rounded-full shadow-lg max-w-[92vw] truncate">
          {toast}
        </div>
      )}
    </div>
  );
}
