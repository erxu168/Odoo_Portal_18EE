'use client';

import React, { useEffect, useState } from 'react';
import type { SyncState } from '@/hooks/useSyncQueue';

interface OfflineBannerProps {
  sync: SyncState;
}

/**
 * Sticky strip at the top of inventory screens. Shows three states:
 *  - Online + queue empty: nothing (returns null)
 *  - Offline: amber strip with pending count
 *  - Online + queue not empty OR currently syncing: blue "syncing" strip
 *  - Brief green "Synced N changes" toast after a successful drain
 */
export default function OfflineBanner({ sync }: OfflineBannerProps) {
  const { online, pending, syncing, lastSync } = sync;
  const [showSuccess, setShowSuccess] = useState(false);
  const [prevSyncAt, setPrevSyncAt] = useState<number | null>(null);

  useEffect(() => {
    if (lastSync && lastSync.synced > 0 && lastSync.at !== prevSyncAt) {
      setPrevSyncAt(lastSync.at);
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(t);
    }
  }, [lastSync, prevSyncAt]);

  if (!online) {
    return (
      <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-[var(--fs-sm)] font-semibold text-amber-900">
          Offline
        </span>
        {pending > 0 && (
          <span className="text-[var(--fs-xs)] text-amber-800">
            · {pending} change{pending !== 1 ? 's' : ''} saved locally
          </span>
        )}
        <span className="text-[var(--fs-xs)] text-amber-700 ml-auto">
          will sync when back online
        </span>
      </div>
    );
  }

  if (syncing || pending > 0) {
    return (
      <div className="bg-blue-100 border-b border-blue-300 px-4 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        <span className="text-[var(--fs-sm)] font-semibold text-blue-900">
          {syncing ? 'Syncing…' : `${pending} change${pending !== 1 ? 's' : ''} pending sync`}
        </span>
      </div>
    );
  }

  if (showSuccess && lastSync) {
    return (
      <div className="bg-green-100 border-b border-green-300 px-4 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-[var(--fs-sm)] font-semibold text-green-900">
          Synced {lastSync.synced} change{lastSync.synced !== 1 ? 's' : ''}
        </span>
      </div>
    );
  }

  return null;
}
