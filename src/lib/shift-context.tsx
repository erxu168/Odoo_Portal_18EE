'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface ActivePerson { id: number; name: string; employee_id: number | null; since: number; }

interface ShiftCtx {
  activePerson: ActivePerson | null;
  signIn: (p: Omit<ActivePerson, 'since'>) => void;
  signOut: () => void;
}

const LS_KEY = 'kw_active_person';
const COOKIE = 'kw_acting'; // read server-side to credit work to the active person
const MAX_MS = 12 * 60 * 60 * 1000; // auto-clear after 12h (a shift never runs longer)

function setActingCookie(p: ActivePerson | null) {
  if (typeof document === 'undefined') return;
  if (!p) { document.cookie = `${COOKIE}=;path=/;max-age=0;SameSite=Lax`; return; }
  const val = encodeURIComponent(JSON.stringify({ id: p.id, employee_id: p.employee_id }));
  document.cookie = `${COOKIE}=${val};path=/;max-age=${12 * 60 * 60};SameSite=Lax`;
}

const ShiftContext = createContext<ShiftCtx>({ activePerson: null, signIn: () => {}, signOut: () => {} });
export function useShift() { return useContext(ShiftContext); }

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  const [activePerson, setActivePerson] = useState<ActivePerson | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as ActivePerson;
        if (p && p.since && (Date.now() - p.since) < MAX_MS) { setActivePerson(p); setActingCookie(p); }
        else { localStorage.removeItem(LS_KEY); setActingCookie(null); }
      }
    } catch { /* ignore */ }
  }, []);

  const signIn = useCallback((p: Omit<ActivePerson, 'since'>) => {
    const person: ActivePerson = { ...p, since: Date.now() };
    setActivePerson(person);
    setActingCookie(person);
    try { localStorage.setItem(LS_KEY, JSON.stringify(person)); } catch { /* ignore */ }
  }, []);

  const signOut = useCallback(() => {
    setActivePerson(null);
    setActingCookie(null);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  return <ShiftContext.Provider value={{ activePerson, signIn, signOut }}>{children}</ShiftContext.Provider>;
}
