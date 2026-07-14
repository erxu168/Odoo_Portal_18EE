'use client';

import React, { useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { IDLE_MIN, IDLE_MAX, kioskStorageAvailable, type KioskSettings } from '@/lib/kiosk-settings';
import type { KioskCompany } from './KioskLoginGate';

interface Props {
  settings: KioskSettings;
  companies: KioskCompany[];
  managerName: string;
  onSave: (patch: Partial<KioskSettings>) => void;
  onClose: () => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-gray-100">
      <div className="min-w-0">
        <div className="text-[15px] font-bold text-gray-900">{label}</div>
        {hint && <div className="text-[13px] text-gray-500 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-[52px] h-[32px] rounded-full p-0.5 transition-colors ${on ? 'bg-green-600' : 'bg-gray-300'}`}
    >
      <span className={`block w-7 h-7 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

/**
 * The kiosk options, shown once a manager has unlocked settings. Changing the
 * restaurant asks for confirmation (it swaps which team the clock shows); the
 * other options save immediately.
 */
export default function KioskSettingsForm({ settings, companies, managerName, onSave, onClose }: Props) {
  const [pendingCompany, setPendingCompany] = useState<KioskCompany | null>(null);
  const [canPersist] = useState(() => kioskStorageAvailable());

  function chooseCompany(c: KioskCompany) {
    if (c.id === settings.companyId) return;
    setPendingCompany(c);
  }
  function confirmCompany() {
    if (pendingCompany) onSave({ companyId: pendingCompany.id, companyName: pendingCompany.name });
    setPendingCompany(null);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <div className="text-2xl font-extrabold text-gray-900">Tablet settings</div>
            <div className="text-gray-500 font-medium">Signed in as {managerName}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="w-11 h-11 shrink-0 rounded-full bg-gray-100 text-gray-600 text-xl font-bold active:bg-gray-200"
          >
            ✕
          </button>
        </div>

        {!canPersist && (
          <div className="rounded-2xl bg-amber-50 text-amber-800 p-4 text-sm font-medium mb-2">
            Heads up: this tablet can’t remember settings — they’ll reset when the page reloads. Ask an admin to allow storage for this site.
          </div>
        )}

        {/* Restaurant */}
        <div className="text-[12px] font-bold uppercase tracking-wide text-gray-400 mt-4 mb-2">Restaurant</div>
        {companies.length === 0 ? (
          <div className="rounded-2xl bg-amber-50 text-amber-800 p-4 text-sm font-medium">
            No restaurants are assigned to your account. Ask an admin to assign one.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {companies.map(c => {
              const active = c.id === settings.companyId;
              return (
                <button
                  key={c.id}
                  data-testid="kiosk-company"
                  onClick={() => chooseCompany(c)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border text-left transition-colors ${active ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white active:bg-gray-50'}`}
                >
                  <span className="text-[16px] font-bold text-gray-900">{c.name}</span>
                  {active && <span className="text-green-600 font-bold text-sm shrink-0 ml-3">● Current</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Options */}
        <div className="text-[12px] font-bold uppercase tracking-wide text-gray-400 mt-6 mb-1">Options</div>
        <Row label="Tablet name" hint="Shown in the header — e.g. WAJ Kitchen Tablet">
          <input
            value={settings.tabletName}
            onChange={e => onSave({ tabletName: e.target.value })}
            placeholder="Optional"
            maxLength={40}
            className="w-40 h-11 px-3 rounded-xl border border-gray-200 bg-white text-[15px] text-gray-900 outline-none focus:border-green-600"
          />
        </Row>
        <Row label="Full-screen lock" hint="Fill the screen, block the back button">
          <Toggle on={settings.fullscreenLock} onChange={v => onSave({ fullscreenLock: v })} label="Full-screen lock" />
        </Row>
        <Row label="Sound on clock in/out" hint="Short beep on each punch">
          <Toggle on={settings.sound} onChange={v => onSave({ sound: v })} label="Sound on clock in or out" />
        </Row>
        <Row label={'Show “working now” count'} hint="Green count at the bottom of the clock">
          <Toggle on={settings.showWorkingNow} onChange={v => onSave({ showWorkingNow: v })} label="Show working now count" />
        </Row>
        <Row label="Idle reset" hint={`Return to the name list after ${settings.idleSeconds}s`}>
          <input
            type="range"
            min={IDLE_MIN}
            max={IDLE_MAX}
            step={1}
            value={settings.idleSeconds}
            onChange={e => onSave({ idleSeconds: parseInt(e.target.value, 10) })}
            aria-label="Idle reset seconds"
            className="w-40 accent-green-600"
          />
        </Row>

        <button
          onClick={onClose}
          className="w-full mt-6 rounded-2xl bg-green-600 text-white text-lg font-bold py-4 active:bg-green-700"
        >
          Done
        </button>
      </div>

      {pendingCompany && (
        <ConfirmDialog
          title={`Set this tablet to ${pendingCompany.name}?`}
          message={'Staff shown on the clock will change to this restaurant’s team.'}
          confirmLabel="Yes, switch restaurant"
          cancelLabel="Cancel"
          onConfirm={confirmCompany}
          onCancel={() => setPendingCompany(null)}
        />
      )}
    </div>
  );
}
