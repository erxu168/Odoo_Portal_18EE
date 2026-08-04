'use client';

import React, { useEffect, useState } from 'react';
import { useCompany } from '@/lib/company-context';
import { Spinner } from '@/components/inventory/ui';

/**
 * "Give every product a code."
 *
 * 824 of WAJ's products have no barcode, so their shelf labels would print with
 * nothing to scan. This runs the assignment across a whole restaurant.
 *
 * IT SHOWS THE PLAN FIRST, ALWAYS. This writes to live Odoo master data, not a
 * portal setting — the dry run is not a nicety, it is the point. A supplier's
 * own barcode is never touched; only an empty field is filled.
 */

type Row = { product_id: number; name: string; code: string };
type Skip = { product_id: number; name: string; reason: string };

export default function BulkProductCodes() {
  const { companyId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState<Skip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ done: number; skipped: Skip[] } | null>(null);

  async function post(dryRun: boolean) {
    const res = await fetch('/api/inventory/product-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: dryRun, company_id: companyId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not reach Odoo.');
    return data;
  }

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null); setResult(null);
    (async () => {
      try {
        const d = await post(true);
        if (!live) return;
        setPlan(d.assigned || []);
        setSkipped(d.skipped || []);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the plan.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function runForReal() {
    if (running || !plan || plan.length === 0) return;
    setRunning(true); setError(null);
    try {
      const d = await post(false);
      setResult({ done: d.total || 0, skipped: d.skipped || [] });
      setPlan([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The run failed. Nothing further was changed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-[22px] font-extrabold text-gray-900">Give products a code</h1>
      <p className="text-[14px] text-gray-500 mt-1 leading-relaxed">
        A product with no barcode gets a shelf label with nothing to scan. This gives every
        one that needs it a house code.
      </p>

      {loading && <div className="py-10 flex justify-center"><Spinner /></div>}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-[13px]">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <div className="text-[15px] font-bold text-green-800">{result.done} products now have a code.</div>
          {result.skipped.length > 0 && (
            <div className="mt-2 text-[13px] text-amber-800">
              <div className="font-bold">{result.skipped.length} were left alone:</div>
              {result.skipped.slice(0, 8).map((s) => (
                <div key={s.product_id} className="text-[12px]">· {s.name} — {s.reason}</div>
              ))}
              {result.skipped.length > 8 && <div className="text-[12px]">· and {result.skipped.length - 8} more</div>}
            </div>
          )}
        </div>
      )}

      {!loading && plan && !result && (
        plan.length === 0 ? (
          <div className="mt-5 bg-white border border-gray-200 rounded-2xl px-4 py-6 text-center">
            <div className="text-[15px] font-bold text-gray-800">Every product already has a code.</div>
            <p className="text-[13px] text-gray-500 mt-1">Nothing to do here.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-4">
              <div className="text-[28px] font-extrabold text-gray-900 leading-none">{plan.length}</div>
              <div className="text-[12px] font-bold uppercase tracking-wider text-gray-400 mt-1">
                will be given a code
              </div>
              <p className="text-[13px] text-gray-500 mt-3 leading-relaxed">
                Nothing has been changed yet. A product that already has a barcode — a
                supplier’s own — is never touched.
              </p>
            </div>

            {skipped.length > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800">
                <span className="font-bold">{skipped.length} cannot be done:</span>
                {skipped.slice(0, 5).map((s) => (
                  <div key={s.product_id} className="text-[12px] mt-0.5">· {s.name} — {s.reason}</div>
                ))}
              </div>
            )}

            <div className="mt-3 bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {plan.slice(0, 60).map((r) => (
                <div key={r.product_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-[13px] font-semibold text-gray-800 [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="text-[12px] font-mono font-bold text-gray-500 flex-shrink-0">{r.code}</span>
                </div>
              ))}
              {plan.length > 60 && (
                <div className="px-4 py-2.5 text-[12px] text-gray-400">
                  … and {plan.length - 60} more, all in the same shape
                </div>
              )}
            </div>

            <button onClick={runForReal} disabled={running}
              className="w-full mt-4 py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold disabled:opacity-50">
              {running ? 'Writing codes…' : `Give all ${plan.length} a code`}
            </button>
            <p className="text-center text-[12px] text-gray-400 mt-2">
              This writes to Odoo. It can be undone by clearing the barcode field.
            </p>
          </>
        )
      )}
    </div>
  );
}
