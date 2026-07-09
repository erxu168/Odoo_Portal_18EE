'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { useCompany } from '@/lib/company-context';
import ShiftsDashboard from '@/components/shifts/ShiftsDashboard';
import OpenShiftsList from '@/components/shifts/OpenShiftsList';
import MyShifts from '@/components/shifts/MyShifts';
import MyHours from '@/components/shifts/MyHours';
import MyPin from '@/components/shifts/MyPin';
import RequestsInbox from '@/components/shifts/RequestsInbox';
import CreateShift from '@/components/shifts/CreateShift';
import ManageShifts from '@/components/shifts/ManageShifts';
import Coverage from '@/components/shifts/Coverage';
import RosterCaps from '@/components/shifts/RosterCaps';
import Approvals from '@/components/shifts/Approvals';
import PresenceBoard from '@/components/shifts/PresenceBoard';
import Timesheet from '@/components/shifts/Timesheet';
import Punctuality from '@/components/shifts/Punctuality';
import ShiftSettings from '@/components/shifts/ShiftSettings';
import PatternManager from '@/components/shifts/PatternManager';
import ManagerOverview from '@/components/shifts/ManagerOverview';
import StaffAnnouncement from '@/components/shifts/StaffAnnouncement';
import { Spinner } from '@/components/shifts/ui';

/**
 * Shifts module router — single-file state machine (manufacturing pattern).
 * All screens are client-side state; no route params. Company comes from the
 * header company switcher (useCompany); role + employee link from /api/auth/me.
 */

interface CreatePrefill {
  date?: string;
  startHHMM?: string;
  endHHMM?: string;
  roleId?: number;
}

type Screen =
  | { type: 'dashboard' }
  | { type: 'open' }
  | { type: 'mine' }
  | { type: 'hours' }
  | { type: 'requests' }
  | { type: 'mypin' }
  | { type: 'create'; prefill?: CreatePrefill }
  | { type: 'manage'; focusDate?: string }
  | { type: 'coverage' }
  | { type: 'roster' }
  | { type: 'approvals' }
  | { type: 'presence' }
  | { type: 'timesheet' }
  | { type: 'punctuality' }
  | { type: 'settings' }
  | { type: 'patterns' }
  | { type: 'overview' };

// Deterministic navigation: each screen has ONE parent (create/manage flows nest
// under manage). Back always goes there — no in-memory history stack to desync.
const PARENT: Record<Screen['type'], Screen['type']> = {
  dashboard: 'dashboard',
  open: 'dashboard',
  mine: 'dashboard',
  hours: 'dashboard',
  requests: 'dashboard',
  mypin: 'dashboard',
  create: 'manage',
  manage: 'dashboard',
  coverage: 'dashboard',
  roster: 'dashboard',
  approvals: 'dashboard',
  presence: 'dashboard',
  timesheet: 'dashboard',
  punctuality: 'dashboard',
  settings: 'dashboard',
  patterns: 'settings',
  overview: 'dashboard',
};

export default function ShiftsPage() {
  const router = useRouter();
  const { companyId } = useCompany();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [role, setRole] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [badges, setBadges] = useState<{ requests: number; approvals: number }>({ requests: 0, approvals: 0 });

  // Who am I? Role decides which tiles/screens exist; employee link is needed
  // for all staff actions (claim, cover requests, sick reports).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.user) {
          setRole(data.user.role || 'staff');
          setEmployeeId(typeof data.user.employee_id === 'number' ? data.user.employee_id : null);
        } else {
          setRole('staff');
        }
      } catch (err: unknown) {
        console.warn('[shifts] auth/me fetch failed:', err instanceof Error ? err.message : String(err));
        setRole('staff');
      }
    })();
  }, []);

  const isManager = role === 'manager' || role === 'admin';

  // Dashboard tile badges — refetched every time we land back on the dashboard.
  const fetchSummary = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/shifts/summary?company_id=${companyId}`);
      if (!res.ok) return;
      const data = await res.json();
      setBadges({
        requests: data.staff?.requests ?? 0,
        approvals: data.manager?.approvals ?? 0,
      });
    } catch (err: unknown) {
      console.warn('[shifts] summary fetch failed:', err instanceof Error ? err.message : String(err));
    }
  }, [companyId]);

  useEffect(() => {
    if (screen.type === 'dashboard') fetchSummary();
  }, [screen.type, fetchSummary]);

  function navigate(s: Screen) {
    setScreen(s);
  }

  function goBack() {
    setScreen(prev => (prev.type === 'dashboard' ? prev : { type: PARENT[prev.type] } as Screen));
  }

  function goHome() {
    router.push('/');
  }

  function goDashboard() {
    setScreen({ type: 'dashboard' });
  }

  // Hardware/browser Back steps within the module instead of exiting it: push a
  // state entry on every non-dashboard screen and translate popstate to goBack.
  const screenTypeRef = React.useRef(screen.type);
  useEffect(() => {
    screenTypeRef.current = screen.type;
  }, [screen.type]);
  useEffect(() => {
    if (screen.type !== 'dashboard') {
      window.history.pushState({ shifts: screen.type }, '');
    }
  }, [screen]);
  useEffect(() => {
    const onPop = () => {
      if (screenTypeRef.current !== 'dashboard') {
        setScreen(prev => (prev.type === 'dashboard' ? prev : { type: PARENT[prev.type] } as Screen));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function handleTileNav(key: string) {
    if (key === 'open') navigate({ type: 'open' });
    else if (key === 'mine') navigate({ type: 'mine' });
    else if (key === 'hours') navigate({ type: 'hours' });
    else if (key === 'requests') navigate({ type: 'requests' });
    else if (key === 'mypin') navigate({ type: 'mypin' });
    else if (key === 'create') navigate({ type: 'create' });
    else if (key === 'manage') navigate({ type: 'manage' });
    else if (key === 'overview') navigate({ type: 'overview' });
    else if (key === 'coverage') navigate({ type: 'coverage' });
    else if (key === 'roster') navigate({ type: 'roster' });
    else if (key === 'approvals') navigate({ type: 'approvals' });
    else if (key === 'presence') navigate({ type: 'presence' });
    else if (key === 'timesheet') navigate({ type: 'timesheet' });
    else if (key === 'punctuality') navigate({ type: 'punctuality' });
  }

  const common = {
    companyId,
    isManager,
    employeeId,
    onBack: goBack,
    onHome: goDashboard,
  };

  function renderScreen() {
    switch (screen.type) {
      case 'dashboard':
        return (
          <>
            <AppHeader
              title="Planning"
              subtitle="Shifts, claims & covers"
              action={isManager ? (
                <button
                  onClick={() => navigate({ type: 'settings' })}
                  aria-label="Shift settings"
                  className="w-11 h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                  </svg>
                </button>
              ) : undefined}
            />
            <ShiftsDashboard
              companyId={companyId}
              isManager={isManager}
              badges={badges}
              onNavigate={handleTileNav}
              onSettings={() => navigate({ type: 'settings' })}
              onHome={goHome}
            />
            <StaffAnnouncement
              companyId={companyId}
              employeeId={employeeId}
              onGoOpen={() => navigate({ type: 'open' })}
            />
          </>
        );
      case 'open':
        return <OpenShiftsList {...common} onOpenMine={() => navigate({ type: 'mine' })} />;
      case 'mine':
        return <MyShifts {...common} onOpenRequests={() => navigate({ type: 'requests' })} />;
      case 'hours':
        return <MyHours {...common} />;
      case 'requests':
        return <RequestsInbox {...common} />;
      case 'mypin':
        return <MyPin {...common} />;
      case 'create':
        return (
          <CreateShift
            {...common}
            prefill={screen.prefill}
            onCreated={() => setScreen({ type: 'manage' })}
          />
        );
      case 'manage':
        return (
          <ManageShifts
            {...common}
            focusDate={screen.focusDate}
            onCreateShift={(prefill?: CreatePrefill) => navigate({ type: 'create', prefill })}
          />
        );
      case 'coverage':
        return <Coverage {...common} onOpenDay={(date: string) => navigate({ type: 'manage', focusDate: date })} />;
      case 'roster':
        return <RosterCaps {...common} />;
      case 'approvals':
        return <Approvals {...common} />;
      case 'presence':
        return <PresenceBoard {...common} />;
      case 'timesheet':
        return <Timesheet {...common} />;
      case 'punctuality':
        return <Punctuality {...common} />;
      case 'settings':
        return <ShiftSettings {...common} onOpenPatterns={() => navigate({ type: 'patterns' })} />;
      case 'patterns':
        return <PatternManager {...common} />;
      case 'overview':
        return <ManagerOverview {...common} />;
    }
  }

  if (role === null) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <AppHeader title="Planning" subtitle="Shifts, claims & covers" />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {renderScreen()}
    </div>
  );
}
