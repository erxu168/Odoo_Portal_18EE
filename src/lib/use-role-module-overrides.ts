'use client';

import { useEffect, useState } from 'react';
import type { RoleModuleOverrides } from './modules';

/**
 * The admin's role→module grid, for screens that display what a role gets by
 * default (Manage Staff, the per-employee portal-access panel, shared tablets).
 *
 * Without this those screens would call `defaultModuleIds(role)` with no
 * overrides and show the BUILT-IN default — i.e. lie about what the person
 * actually gets as soon as an admin edits the grid.
 *
 * Returns `{}` until loaded, and `{}` for anyone not allowed to read it, which
 * degrades to the built-in default rather than to an error.
 */
let cache: RoleModuleOverrides | null = null;
let inflight: Promise<RoleModuleOverrides> | null = null;

function load(): Promise<RoleModuleOverrides> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    const request: Promise<RoleModuleOverrides> = fetch('/api/admin/role-modules')
      .then((r) => (r.ok ? r.json() : { overrides: {} }))
      .then((d) => {
        const o: RoleModuleOverrides = d?.overrides && typeof d.overrides === 'object' ? d.overrides : {};
        cache = o;
        return o;
      })
      .catch((): RoleModuleOverrides => ({}))
      .finally(() => { inflight = null; });
    inflight = request;
    return request;
  }
  return inflight;
}

/** Forget the cached grid — call after saving a change to it. */
export function clearRoleModuleOverridesCache() {
  cache = null;
}

export function useRoleModuleOverrides(): RoleModuleOverrides {
  const [overrides, setOverrides] = useState<RoleModuleOverrides>(cache ?? {});
  useEffect(() => {
    let live = true;
    load().then((o) => { if (live) setOverrides(o); });
    return () => { live = false; };
  }, []);
  return overrides;
}
