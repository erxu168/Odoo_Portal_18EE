'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import GuidedTutorialPlayer from '../_components/GuidedTutorialPlayer';

interface TrainingGuide {
  id: number;
  name: string;
  step_count: number;
}

export default function TrainingPage() {
  const [guides, setGuides] = useState<TrainingGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openGuideId, setOpenGuideId] = useState<number | null>(null);

  // Staleness token: only the newest in-flight request may write state, so a slow
  // earlier fetch can't clobber a fresher one (see the async-load-lifecycle rule).
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/training/guides', {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (token !== reqRef.current) return; // a newer request has taken over
      if (!res.ok) {
        setError(body.error || 'Could not load training guides');
        return;
      }
      setGuides(Array.isArray(body.guides) ? body.guides : []);
    } catch (e: unknown) {
      if (token !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? guides.filter(g => g.name.toLowerCase().includes(q))
    : guides;

  return (
    // Width and bottom clearance both come from MainWrapper — see the staff
    // checklist for why this screen no longer caps itself at 430px.
    <div className="flex flex-col min-h-screen bg-gray-50">
      <AppHeader supertitle="LEARN" title="Training" />

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <p className="text-sm text-gray-500 mb-4">
          Step-by-step how-tos for common tasks. Watch any time &mdash; this is just for learning.
        </p>

        {/* Search bar */}
        <div className="relative mb-4">
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base"
          >
            &#x1F50D;
          </span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search guides…"
            aria-label="Search training guides"
            className="w-full pl-10 pr-3 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2" aria-hidden="true">&#x26A0;&#xFE0F;</p>
            <p className="font-semibold text-gray-600">Could not load</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">{error}</p>
            <button
              onClick={() => load()}
              className="mt-4 bg-green-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-green-700 active:bg-green-800"
            >
              Try again
            </button>
          </div>
        ) : guides.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2" aria-hidden="true">&#x1F393;</p>
            <p className="font-semibold text-gray-600">No training guides yet</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">
              No training guides yet &mdash; your manager can add them.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2" aria-hidden="true">&#x1F50D;</p>
            <p className="font-semibold text-gray-600">No matches</p>
            <p className="text-sm mt-1 max-w-xs mx-auto">
              No guides match &ldquo;{query.trim()}&rdquo;.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpenGuideId(g.id)}
                className="w-full flex items-center gap-3 min-h-[64px] bg-white border border-gray-200 rounded-2xl px-4 py-3 text-left active:bg-gray-50 motion-safe:transition-colors"
              >
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-xl"
                >
                  &#x1F4D8;
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-gray-800 truncate">
                    {g.name}
                  </span>
                  <span className="block text-sm text-gray-500">
                    {g.step_count} {g.step_count === 1 ? 'step' : 'steps'}
                  </span>
                </span>
                <span aria-hidden="true" className="flex-shrink-0 text-gray-300 text-lg">
                  &#x203A;
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {openGuideId !== null && (
        <GuidedTutorialPlayer
          source={{ kind: 'training', guideId: openGuideId }}
          onClose={() => setOpenGuideId(null)}
        />
      )}
    </div>
  );
}
