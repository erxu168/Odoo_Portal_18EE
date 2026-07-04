'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import HrDashboard from '@/components/hr/HrDashboard';
import OnboardingWizard from '@/components/hr/OnboardingWizard';
import MyProfile from '@/components/hr/MyProfile';
import MyDocuments from '@/components/hr/MyDocuments';
import EmployeeOverview from '@/components/hr/EmployeeOverview';
import EmployeeDetail from '@/components/hr/EmployeeDetail';
import EmployeeForm from '@/components/hr/EmployeeForm';
import DepartmentsRoles from '@/components/hr/DepartmentsRoles';
import DeptRoleForm from '@/components/hr/DeptRoleForm';
import CandidateStatus from '@/components/hr/CandidateStatus';

type DeptRoleKind = 'department' | 'role';

type Screen =
  | { type: 'dashboard' }
  | { type: 'onboarding'; step?: number }
  | { type: 'profile' }
  | { type: 'documents' }
  | { type: 'employees' }
  | { type: 'employee-detail'; employeeId: number }
  | { type: 'employee-edit'; employeeId: number | null }
  | { type: 'dept-roles' }
  | { type: 'dept-role-edit'; kind: DeptRoleKind; recordId: number | null }
  | { type: 'candidate-status' };

export default function HrPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [history, setHistory] = useState<Screen[]>([]);
  const [isCandidate, setIsCandidate] = useState(false);
  const [candidateChecked, setCandidateChecked] = useState(false);

  // Check if this user is a candidate (has applicant_id, no employee_id)
  React.useEffect(() => {
    fetch('/api/hr/applicant/status')
      .then((r) => {
        if (r.ok) {
          setIsCandidate(true);
          setScreen({ type: 'candidate-status' });
        }
      })
      .catch(() => {})
      .finally(() => setCandidateChecked(true));
  }, []);

  function navigate(s: Screen) {
    setHistory((h) => [...h, screen]);
    setScreen(s);
  }

  function goBack() {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) {
        setScreen(prev);
        return h.slice(0, -1);
      }
      setScreen({ type: 'dashboard' });
      return [];
    });
  }

  function goHome() {
    router.push('/');
  }

  function goDashboard() {
    setHistory([]);
    setScreen({ type: 'dashboard' });
  }

  function handleDashboardNav(tile: string) {
    if (tile === 'onboarding') navigate({ type: 'onboarding', step: 1 });
    else if (tile === 'profile') navigate({ type: 'profile' });
    else if (tile === 'documents') navigate({ type: 'documents' });
    else if (tile === 'employees') navigate({ type: 'employees' });
    else if (tile === 'departments') navigate({ type: 'dept-roles' });
  }

  switch (screen.type) {
    case 'dashboard':
      return <HrDashboard onNavigate={handleDashboardNav} onHome={goHome} />;
    case 'onboarding':
      return (
        <OnboardingWizard
          initialStep={screen.step}
          onBack={goBack}
          onHome={goHome}
          onDone={goDashboard}
        />
      );
    case 'profile':
      return (
        <MyProfile
          onBack={goDashboard}
          onHome={goHome}
          onEdit={() => navigate({ type: 'onboarding', step: 1 })}
        />
      );
    case 'documents':
      return <MyDocuments onBack={goDashboard} onHome={goHome} />;
    case 'employees':
      return (
        <EmployeeOverview
          onBack={goDashboard}
          onHome={goHome}
          onSelect={(id: number) => navigate({ type: 'employee-detail', employeeId: id })}
          onAdd={() => navigate({ type: 'employee-edit', employeeId: null })}
        />
      );
    case 'employee-detail':
      return (
        <EmployeeDetail
          employeeId={screen.employeeId}
          onBack={goBack}
          onHome={goHome}
          onEdit={() => navigate({ type: 'employee-edit', employeeId: screen.employeeId })}
          onDeactivated={goBack}
        />
      );
    case 'employee-edit':
      return (
        <EmployeeForm
          employeeId={screen.employeeId}
          onBack={goBack}
          onHome={goHome}
          onSaved={(id: number, isNew: boolean) => {
            if (isNew) {
              setHistory((h) => [...h, { type: 'employees' }]);
              setScreen({ type: 'employee-detail', employeeId: id });
            } else {
              goBack();
            }
          }}
        />
      );
    case 'dept-roles':
      return (
        <DepartmentsRoles
          onBack={goDashboard}
          onHome={goHome}
          onAdd={(kind) => navigate({ type: 'dept-role-edit', kind, recordId: null })}
          onEdit={(kind, id) => navigate({ type: 'dept-role-edit', kind, recordId: id })}
        />
      );
    case 'dept-role-edit':
      return (
        <DeptRoleForm
          kind={screen.kind}
          recordId={screen.recordId}
          onBack={goBack}
          onHome={goHome}
          onSaved={goBack}
        />
      );
    case 'candidate-status':
      return (
        <CandidateStatus
          onHome={goHome}
          onStartOnboarding={() => navigate({ type: 'onboarding', step: 1 })}
        />
      );
    default:
      return <HrDashboard onNavigate={handleDashboardNav} onHome={goHome} />;
  }
}
