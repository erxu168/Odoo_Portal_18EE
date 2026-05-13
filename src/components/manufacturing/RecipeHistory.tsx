'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppHeader from '@/components/ui/AppHeader';

interface RecipeHistoryProps {
  bomId: number;
  onBack: () => void;
  onOpenBom: (bomId: number) => void;
}

interface VersionRow {
  id: number;
  version_label: string;
  version_notes: string;
  parent_id: number | null;
  is_current_version: boolean;
  created_at: string;
  created_by: string | null;
  line_count: number;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function RecipeHistory({ bomId, onBack, onOpenBom }: RecipeHistoryProps) {
  const [productName, setProductName] = useState<string>('');
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingCurrent, setSettingCurrent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boms/${bomId}/versions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setProductName(data.product_tmpl_id?.[1] || 'Recipe');
      setVersions(data.versions || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [bomId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  async function setAsCurrent(v: VersionRow) {
    if (!confirm(`Use ${v.version_label} as the default recipe for new batches?`)) return;
    setSettingCurrent(v.id);
    try {
      const res = await fetch(`/api/boms/${v.id}/set-current`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      await fetchHistory();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to set current');
    } finally {
      setSettingCurrent(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="RECIPE HISTORY"
        title={productName}
        showBack
        onBack={onBack}
      />
      <div className="px-4 py-3">
        {loading && <div className="py-8 text-center text-gray-500">Loading…</div>}
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {!loading && !error && versions.length === 0 && (
          <div className="py-8 text-center text-gray-500">No versions yet.</div>
        )}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between">
                <button
                  onClick={() => onOpenBom(v.id)}
                  className="flex-1 text-left active:bg-orange-50 rounded-lg -mx-2 px-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{v.version_label}</span>
                    {v.is_current_version && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(v.created_at)}
                    {v.created_by ? ` · ${v.created_by}` : ''}
                    {' · '}{v.line_count} ingredients
                  </div>
                  {v.version_notes && (
                    <div className="mt-1 line-clamp-2 text-sm text-gray-700">
                      {v.version_notes}
                    </div>
                  )}
                </button>
                {!v.is_current_version && (
                  <button
                    onClick={() => setAsCurrent(v)}
                    disabled={settingCurrent === v.id}
                    className="ml-3 rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 disabled:opacity-50 active:bg-gray-50 whitespace-nowrap"
                  >
                    {settingCurrent === v.id ? '…' : 'Set as current'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
