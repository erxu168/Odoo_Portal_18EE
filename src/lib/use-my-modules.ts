'use client';

import { useEffect, useState } from 'react';

/**
 * The modules the signed-in user may use, for CLIENT components.
 *
 * Returns `null` until it is known — treat that as "don't show it yet" rather
 * than guessing, so a module the user isn't granted never flashes up.
 *
 * Reads `/api/auth/modules`, NOT `/api/auth/me`: `me` does an Odoo RPC to fetch
 * the avatar, and the callers here render on every page (the tab bar) or once
 * per row (task lists), so `me` would put an Odoo round-trip on every page load.
 *
 * The in-flight promise is shared process-wide, so N components mounting
 * together make ONE request, not N.
 *
 * This is the client-side twin of `src/lib/module-access.ts` — same source of
 * truth (`userModuleIds`), just delivered over HTTP. It hides UI; the server
 * gates are what actually enforce access.
 */
let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function loadModules(): Promise<string[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    const request: Promise<string[]> = fetch('/api/auth/modules')
      .then((r) => (r.ok ? r.json() : { modules: [] }))
      .then((d) => {
        const ids: string[] = Array.isArray(d?.modules) ? d.modules : [];
        cache = ids;
        return ids;
      })
      .catch((): string[] => [])
      .finally(() => { inflight = null; });
    inflight = request;
    return request;
  }
  return inflight;
}

/** Forget the cached list — call after anything that can change a user's access. */
export function clearMyModulesCache() {
  cache = null;
}

export function useMyModules(): string[] | null {
  const [modules, setModules] = useState<string[] | null>(cache);

  useEffect(() => {
    if (cache) { setModules(cache); return; }
    let live = true;
    loadModules().then((m) => { if (live) setModules(m); });
    return () => { live = false; };
  }, []);

  return modules;
}

/**
 * `canSee('inventory')` — false while the list is still loading, so a link to a
 * module the user may not have is never rendered on spec.
 */
export function useCanSeeModule(): (moduleId: string) => boolean {
  const modules = useMyModules();
  return (moduleId: string) => (modules ?? []).includes(moduleId);
}
