'use client';

import React from 'react';
import { Chip } from './common';
import { PREP_LABELS, AVAIL_LABELS, AVAIL_BADGE, FILL_LABELS } from '@/lib/shift-handover/labels';

export interface ContainerView {
  id: number;
  product_id: number;
  product_name?: string | null;
  container_code: string;
  container_type_name?: string | null;
  fill_level: number | null;
  preparation_state: string | null;
  availability_state: string | null;
  storage_location_id: number | null;
  storage_location_name?: string | null;
  use_first: number;
  next_action?: string | null;
  status: string;
  thumb?: string | null;
  photo_count?: number;
}

export function ContainerCard({ c, onTap }: { c: ContainerView; onTap?: () => void }) {
  const fill = c.fill_level != null ? FILL_LABELS[c.fill_level] ?? `${c.fill_level}%` : '—';
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left bg-white border border-gray-200 rounded-2xl p-3.5 active:bg-gray-50 active:scale-[0.99] transition-transform flex gap-3"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gray-900 text-white text-[var(--fs-xs)] font-bold flex-shrink-0">{c.container_code}</span>
          {c.product_name && <span className="text-[var(--fs-base)] font-bold text-gray-900 truncate">{c.product_name}</span>}
          {!!c.use_first && <Chip tone="due_soon">Use first</Chip>}
        </div>
        <div className="text-[var(--fs-sm)] text-gray-500 mb-1.5">
          {[c.container_type_name, fill].filter(Boolean).join(' · ')}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          {c.preparation_state && <Chip tone="draft">{PREP_LABELS[c.preparation_state] ?? c.preparation_state}</Chip>}
          {c.availability_state && <Chip tone={AVAIL_BADGE[c.availability_state] ?? 'draft'}>{AVAIL_LABELS[c.availability_state] ?? c.availability_state}</Chip>}
        </div>
        <div className="flex items-center gap-1 text-[var(--fs-xs)] text-gray-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
          <span className="truncate">{c.storage_location_name || 'No location set'}</span>
        </div>
        {c.next_action && (
          <div className="mt-1.5 text-[var(--fs-xs)] text-amber-700 bg-amber-50 rounded-lg px-2 py-1 inline-block">→ {c.next_action}</div>
        )}
      </div>
      {c.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.thumb} alt="" className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border border-gray-200" />
      ) : (
        <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 text-gray-300">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="9" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
        </div>
      )}
    </button>
  );
}
