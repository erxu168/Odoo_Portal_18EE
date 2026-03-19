'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MyLists from '@/components/inventory/MyLists';
import CountingSession from '@/components/inventory/CountingSession';
import QuickCount from '@/components/inventory/QuickCount';
import ManageTemplates from '@/components/inventory/ManageTemplates';
import ReviewSubmissions from '@/components/inventory/ReviewSubmissions';

type Tab = 'lists' | 'quick' | 'manage' | 'review';
type Screen =
  | { type: 'tabs' }
  | { type: 'session'; sessionId: number };

export default function InventoryPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'tabs' });
  const [tab, setTab] = useState<Tab>('lists');
  const [userRole, setUserRole] = useState<string>('staff');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  const canManage = userRole === 'manager' || userRole === 'admin';

  function goHome() {
    router.push('/');
  }

  // Full-screen session view
  if (screen.type === 'session') {
    return (
      <CountingSession
        sessionId={screen.sessionId}
        userRole={userRole}
        onBack={() => setScreen({ type: 'tabs' })}
        onSubmit={() => { setScreen({ type: 'tabs' }); setTab('lists'); }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {tab === 'lists' && (
          <MyLists
            userRole={userRole}
            onOpenSession={(id) => setScreen({ type: 'session', sessionId: id })}
            onHome={goHome}
          />
        )}
        {tab === 'quick' && (
          <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
              <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
              <div className="flex items-center gap-3 relative">
                <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div className="flex-1">
                  <h1 className="text-[20px] font-bold text-white">Quick Count</h1>
                  <p className="text-[12px] text-white/50 mt-0.5">Search any product, enter quantity</p>
                </div>
              </div>
            </div>
            <QuickCount userRole={userRole} />
          </div>
        )}
        {tab === 'manage' && canManage && (
          <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
              <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
              <div className="flex items-center gap-3 relative">
                <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div className="flex-1">
                  <h1 className="text-[20px] font-bold text-white">Manage Lists</h1>
                  <p className="text-[12px] text-white/50 mt-0.5">Create and manage counting templates</p>
                </div>
              </div>
            </div>
            <ManageTemplates onBack={() => setTab('lists')} />
          </div>
        )}
        {tab === 'review' && canManage && (
          <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
              <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
              <div className="flex items-center gap-3 relative">
                <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div className="flex-1">
                  <h1 className="text-[20px] font-bold text-white">Review</h1>
                  <p className="text-[12px] text-white/50 mt-0.5">Approve or reject submitted counts</p>
                </div>
              </div>
            </div>
            <ReviewSubmissions
              onViewSession={(id) => setScreen({ type: 'session', sessionId: id })}
            />
          </div>
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 flex max-w-lg mx-auto h-16">
        <TabButton active={tab === 'lists'} label="My Lists" onClick={() => { setScreen({ type: 'tabs' }); setTab('lists'); }}>
          <svg viewBox="0 0 22 22" fill="none" className="w-5 h-5"><rect x="3" y="3" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M7 8H15M7 11H15M7 14H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </TabButton>
        <TabButton active={tab === 'quick'} label="Quick Count" onClick={() => { setScreen({ type: 'tabs' }); setTab('quick'); }}>
          <svg viewBox="0 0 22 22" fill="none" className="w-5 h-5"><circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M15 15L19 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </TabButton>
        {canManage && (
          <TabButton active={tab === 'manage'} label="Manage" onClick={() => { setScreen({ type: 'tabs' }); setTab('manage'); }}>
            <svg viewBox="0 0 22 22" fill="none" className="w-5 h-5"><path d="M4 6H18M4 11H18M4 16H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="18" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.5"/></svg>
          </TabButton>
        )}
        {canManage && (
          <TabButton active={tab === 'review'} label="Review" onClick={() => { setScreen({ type: 'tabs' }); setTab('review'); }}>
            <svg viewBox="0 0 22 22" fill="none" className="w-5 h-5"><path d="M4 11L9 16L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </TabButton>
        )}
      </div>
    </div>
  );
}

// --- Tab Button ---
function TabButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
        active ? 'text-orange-600' : 'text-gray-400'
      }`}>
      {children}
      <span>{label}</span>
    </button>
  );
}
