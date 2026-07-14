'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { saveKioskSettings, type KioskSettings as KioskSettingsT } from '@/lib/kiosk-settings';
import KioskLoginGate, { type KioskCompany } from './KioskLoginGate';
import KioskSettingsForm from './KioskSettingsForm';

interface Props {
  settings: KioskSettingsT;
  onChange: (next: KioskSettingsT) => void;
  onClose: () => void;
}

// Auto-relock after this much inactivity so a shared tablet isn't left sitting in
// settings. Pointer AND keyboard activity count, so a manager mid-typing isn't kicked.
const IDLE_RELOCK_MS = 60_000;

/**
 * Full-screen kiosk settings overlay. Locked until a manager/admin signs in
 * (KioskLoginGate); then shows the options (KioskSettingsForm). Relocks on close
 * or after 60s of no interaction. No portal session is ever created.
 */
export default function KioskSettings({ settings, onChange, onClose }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [companies, setCompanies] = useState<KioskCompany[]>([]);
  const [managerName, setManagerName] = useState('');
  const [local, setLocal] = useState<KioskSettingsT>(settings);

  // Keep the latest onClose in a ref so parent re-renders (the kiosk re-renders on
  // its clock + 30s staff-refresh intervals) don't tear down and re-arm the idle
  // timer — otherwise the 60s deadline is reset before it can ever fire.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const lastActivity = useRef(Date.now());
  const bump = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    lastActivity.current = Date.now();
    const iv = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_RELOCK_MS) onCloseRef.current();
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  function handleUnlock(list: KioskCompany[], name: string) {
    setCompanies(list);
    setManagerName(name);
    setUnlocked(true);
  }

  function handleSave(patch: Partial<KioskSettingsT>) {
    const next = saveKioskSettings(patch);
    setLocal(next);
    onChange(next);
  }

  return (
    <div className="fixed inset-0 z-[120] bg-gray-50 flex flex-col" onPointerDown={bump} onKeyDown={bump}>
      <header className="bg-[#1A1F2E] text-white px-6 py-4 flex items-center justify-between">
        <div className="text-[18px] font-extrabold tracking-tight">⚙ Kiosk settings</div>
        <button onClick={onClose} className="text-white/80 font-semibold active:text-white">Close</button>
      </header>
      {unlocked ? (
        <KioskSettingsForm
          settings={local}
          companies={companies}
          managerName={managerName}
          onSave={handleSave}
          onClose={onClose}
        />
      ) : (
        <KioskLoginGate onUnlock={handleUnlock} onClose={onClose} />
      )}
    </div>
  );
}
