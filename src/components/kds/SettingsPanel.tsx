'use client';

import { useState } from 'react';
import { useKds } from '@/lib/kds/state';
import type { KdsSettings } from '@/types/kds';

export default function SettingsPanel() {
  const { settings, settingsOpen, closeSettings, updateSettings } = useKds();
  const [draft, setDraft] = useState<KdsSettings>(settings);

  if (!settingsOpen) return null;

  function handleSave() {
    updateSettings(draft);
    closeSettings();
  }

  function setField<K extends keyof KdsSettings>(key: K, value: KdsSettings[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <div className="kds-settings-overlay" onClick={closeSettings} />
      <div className="kds-settings-panel">
        <div className="kds-settings-title">KDS Settings</div>

        <div className="kds-settings-section">
          <div className="kds-settings-section-title">Timer Thresholds</div>
          <NumRow label="Takeaway boost (min)" value={draft.takeawayBoost} onChange={v => setField('takeawayBoost', v)} />
          <NumRow label="Dine-in warning (min)" value={draft.dineWarn} onChange={v => setField('dineWarn', v)} />
          <NumRow label="Dine-in urgent (min)" value={draft.dineUrg} onChange={v => setField('dineUrg', v)} />
          <NumRow label="Takeaway warning (min)" value={draft.taWarn} onChange={v => setField('taWarn', v)} />
          <NumRow label="Takeaway urgent (min)" value={draft.taUrg} onChange={v => setField('taUrg', v)} />
          <NumRow label="Pass warning (min)" value={draft.passWarn} onChange={v => setField('passWarn', v)} />
          <NumRow label="Pass critical (min)" value={draft.passCrit} onChange={v => setField('passCrit', v)} />
        </div>

        <div className="kds-settings-section">
          <div className="kds-settings-section-title">Sounds</div>
          <ToggleRow label="New order sound" checked={draft.sndNewOrder} onChange={v => setField('sndNewOrder', v)} />
          {draft.sndNewOrder && (
            <>
              <SelectRow label="Mode" value={draft.sndNewOrderMode} options={[['always', 'Always'], ['roundIdle', 'Round idle only']]} onChange={v => setField('sndNewOrderMode', v as 'always' | 'roundIdle')} />
              <RangeRow label="Volume" value={draft.sndNewOrderVol} onChange={v => setField('sndNewOrderVol', v)} />
            </>
          )}
          <ToggleRow label="Pass alert sound" checked={draft.sndPass} onChange={v => setField('sndPass', v)} />
          {draft.sndPass && (
            <>
              <SelectRow label="Mode" value={draft.sndPassMode} options={[['once', 'Once'], ['repeat', 'Repeat']]} onChange={v => setField('sndPassMode', v as 'once' | 'repeat')} />
              <RangeRow label="Volume" value={draft.sndPassVol} onChange={v => setField('sndPassVol', v)} />
            </>
          )}
          <ToggleRow label="Round done sound" checked={draft.sndRound} onChange={v => setField('sndRound', v)} />
          {draft.sndRound && (
            <RangeRow label="Volume" value={draft.sndRoundVol} onChange={v => setField('sndRoundVol', v)} />
          )}
        </div>

        <button className="kds-settings-save" onClick={handleSave}>
          Save Settings
        </button>
      </div>
    </>
  );
}

function NumRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="kds-settings-row">
      <span className="kds-settings-label">{label}</span>
      <input
        type="number"
        className="kds-settings-input"
        value={value}
        min={0}
        max={999}
        onChange={e => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="kds-settings-row">
      <span className="kds-settings-label">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 26, borderRadius: 100, border: 'none', cursor: 'pointer',
          background: checked ? 'var(--green)' : '#475569', position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: 'white', position: 'absolute', top: 3,
          left: checked ? 21 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="kds-settings-row">
      <span className="kds-settings-label">{label}</span>
      <select className="kds-settings-select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}

function RangeRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="kds-settings-row">
      <span className="kds-settings-label">{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range" min="0" max="1" step="0.1" value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ width: 80 }}
        />
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 30 }}>{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}
