'use client';

import { useState } from 'react';
import { useKds } from '@/lib/kds/state';
import type { KdsSettings, SourceStation, PrepType } from '@/types/kds';
import { STATION_META, PREP_TYPE_META } from '@/types/kds';

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
          <div className="kds-settings-section-title">Odoo POS Connection</div>
          <NumRow label="POS Config ID" value={draft.posConfigId} onChange={v => setField('posConfigId', v)} />
          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 0 4px' }}>
            Set to the Odoo POS config ID for What a Jerk. Set to 0 for mock data.
          </div>
          <SyncProductsRow disabled={!draft.posConfigId} />
        </div>

        <ProductMappingSection />

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
          <div className="kds-settings-section-title">Display</div>
          <NumRow label="Auto-scroll after (sec)" value={draft.autoScrollSec} onChange={v => setField('autoScrollSec', v)} />
          <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 0 4px' }}>
            Scrolls back to the most urgent order after inactivity. Set to 0 to disable.
          </div>
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

function SyncProductsRow({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSync() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/kds/products/sync', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setStatus(`Synced ${data.count} products. Reload to apply.`);
      } else {
        setStatus(`Failed: ${data.error || 'unknown'}`);
      }
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : 'network'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={handleSync}
        disabled={disabled || busy}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none',
          background: disabled ? '#475569' : '#3b82f6',
          color: 'white', fontWeight: 600, cursor: disabled || busy ? 'not-allowed' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Syncing…' : 'Sync products from POS'}
      </button>
      {status && (
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '6px 0 0' }}>{status}</div>
      )}
    </div>
  );
}

function ProductMappingSection() {
  const { productConfig } = useKds();
  const [edits, setEdits] = useState<Record<string, { station: SourceStation; prep: PrepType }>>({});
  const [savingName, setSavingName] = useState<string | null>(null);

  if (productConfig.length === 0) return null;

  const sorted = [...productConfig].sort((a, b) => a.productName.localeCompare(b.productName));

  async function save(name: string, station: SourceStation, prep: PrepType) {
    setSavingName(name);
    try {
      await fetch('/api/kds/products/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName: name, sourceStation: station, prepType: prep }),
      });
    } finally {
      setSavingName(null);
    }
  }

  return (
    <div className="kds-settings-section">
      <div className="kds-settings-section-title">Product Mapping</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', padding: '0 0 8px' }}>
        Where each dish is cooked and how it&apos;s prepped. Set this once per product.
      </div>
      {sorted.map(p => {
        const current = edits[p.productName] ?? { station: p.sourceStation, prep: p.prepType };
        const dirty = current.station !== p.sourceStation || current.prep !== p.prepType;
        return (
          <div key={p.productName} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productName}</span>
            <select
              className="kds-settings-select"
              style={{ fontSize: 11, padding: '2px 4px' }}
              value={current.station}
              onChange={e => setEdits(prev => ({ ...prev, [p.productName]: { ...current, station: e.target.value as SourceStation } }))}
            >
              {(Object.keys(STATION_META) as SourceStation[]).map(s => (
                <option key={s} value={s}>{STATION_META[s].label}</option>
              ))}
            </select>
            <select
              className="kds-settings-select"
              style={{ fontSize: 11, padding: '2px 4px' }}
              value={current.prep}
              onChange={e => setEdits(prev => ({ ...prev, [p.productName]: { ...current, prep: e.target.value as PrepType } }))}
            >
              {(Object.keys(PREP_TYPE_META) as PrepType[]).map(t => (
                <option key={t} value={t}>{PREP_TYPE_META[t].label}</option>
              ))}
            </select>
            {dirty && (
              <button
                onClick={() => save(p.productName, current.station, current.prep)}
                disabled={savingName === p.productName}
                style={{
                  padding: '2px 8px', borderRadius: 4, border: 'none',
                  background: '#3b82f6', color: 'white', fontSize: 11, cursor: 'pointer',
                }}
              >
                {savingName === p.productName ? '…' : 'Save'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
