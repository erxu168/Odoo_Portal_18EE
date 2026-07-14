'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import SignInSheet from '@/components/ui/SignInSheet';

export interface ActivePerson { id: number; name: string; employee_id: number | null; since: number; }

interface ShiftCtx {
  activePerson: ActivePerson | null;
  signIn: (p: Omit<ActivePerson, 'since'>) => void;
  signOut: () => void;
  /**
   * Open the "who's working?" sheet. If `after` is given it runs once, right
   * after a successful sign-in — used to "prompt when it matters" (e.g. gate
   * opening Tasks/Inventory on a shared device until someone identifies).
   */
  openSignIn: (after?: () => void) => void;
}

const LS_KEY = 'kw_active_person';
const MAX_MS = 12 * 60 * 60 * 1000; // auto-clear after 12h (a shift never runs longer)

// NOTE: `activePerson` here is CLIENT-SIDE state for the UI only ("Signed in as
// X"). Attribution is NOT trusted from the client — the server credits work via
// the httpOnly, station-bound `kw_actor` token minted at PIN verification (see
// lib/shift-attribution.ts + /api/station/pin-login).

const ShiftContext = createContext<ShiftCtx>({ activePerson: null, signIn: () => {}, signOut: () => {}, openSignIn: () => {} });
export function useShift() { return useContext(ShiftContext); }

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  const [activePerson, setActivePerson] = useState<ActivePerson | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const afterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as ActivePerson;
        if (p && p.since && (Date.now() - p.since) < MAX_MS) { setActivePerson(p); }
        else { localStorage.removeItem(LS_KEY); }
      }
    } catch { /* ignore */ }
  }, []);

  const signIn = useCallback((p: Omit<ActivePerson, 'since'>) => {
    const person: ActivePerson = { ...p, since: Date.now() };
    setActivePerson(person);
    try { localStorage.setItem(LS_KEY, JSON.stringify(person)); } catch { /* ignore */ }
    setSheetOpen(false);
    const after = afterRef.current;
    afterRef.current = null;
    if (after) after();
  }, []);

  const signOut = useCallback(() => {
    setActivePerson(null);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }, []);

  const openSignIn = useCallback((after?: () => void) => {
    afterRef.current = after ?? null;
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => { afterRef.current = null; setSheetOpen(false); }, []);

  return (
    <ShiftContext.Provider value={{ activePerson, signIn, signOut, openSignIn }}>
      {children}
      <SignInSheet
        open={sheetOpen}
        activePerson={activePerson}
        onClose={closeSheet}
        onSignedIn={signIn}
        onSignOut={() => { signOut(); setSheetOpen(false); }}
      />
    </ShiftContext.Provider>
  );
}
