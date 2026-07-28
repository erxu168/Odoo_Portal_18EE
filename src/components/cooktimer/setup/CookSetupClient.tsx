'use client';
import { useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { CookProfileAdmin, CookProfileInput, CookStationAdmin } from '@/types/cooktimer';
import ProfilesTab from './ProfilesTab';
import StationsTab from './StationsTab';
import ProfileEditor from './ProfileEditor';

type Tab = 'profiles' | 'stations';
interface ToastState { message: string; type: 'success' | 'error' | 'info'; visible: boolean; }
interface ConfirmState { title: string; message: string; confirmLabel: string; extra?: React.ReactNode; onConfirm: () => void; }

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    // Network drop / timeout — never leave a caller hanging on a rejected promise.
    return { ok: false, data: { error: 'Network problem — check the connection and try again.' } };
  }
}

export default function CookSetupClient() {
  const [tab, setTab] = useState<Tab>('profiles');
  const [profiles, setProfiles] = useState<CookProfileAdmin[] | null>(null);
  const [stations, setStations] = useState<CookStationAdmin[] | null>(null);
  const [editor, setEditor] = useState<{ profile: CookProfileAdmin | null } | null>(null);
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'info', visible: false });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Destination for "move dishes & delete" — a ref so picking it never re-renders the dialog.
  const moveTargetRef = useRef<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  // True when Odoo could not be reached for live dish names — shown as a banner
  // so a manager reads 'names unavailable', not 'these dishes were deleted'.
  const [namesUnavailable, setNamesUnavailable] = useState(false);

  function showToast(message: string, type: ToastState['type'] = 'info') {
    setToast({ message, type, visible: true });
  }

  async function reloadAll() {
    setLoadError(false);
    try {
      const [pr, sr] = await Promise.all([
        fetch('/api/cooktimer/profiles').then(r => (r.ok ? r.json() : Promise.reject(new Error('profiles')))),
        fetch('/api/cooktimer/stations').then(r => (r.ok ? r.json() : Promise.reject(new Error('stations')))),
      ]);
      if (!Array.isArray(pr.profiles) || !Array.isArray(sr.stations)) throw new Error('bad payload');
      setProfiles(pr.profiles);
      setStations(sr.stations);
      setNamesUnavailable(!!pr.productNameUnavailable);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => { void reloadAll(); }, []);

  // -- stations --
  async function addStation(name: string) {
    const { ok, data } = await call('/api/cooktimer/stations', 'POST', { name });
    if (ok && Array.isArray(data.stations)) { setStations(data.stations); showToast(`Added ${name}`, 'success'); }
    else showToast(data.error || 'Could not add station', 'error');
  }
  async function renameStation(id: number, name: string) {
    const { ok, data } = await call(`/api/cooktimer/stations/${id}`, 'PATCH', { name });
    if (ok && Array.isArray(data.stations)) setStations(data.stations);
    else { showToast(data.error || 'Could not rename station', 'error'); void reloadAll(); }
  }
  async function toggleStation(id: number, active: boolean) {
    const { ok, data } = await call(`/api/cooktimer/stations/${id}`, 'PATCH', { active });
    if (ok && Array.isArray(data.stations)) setStations(data.stations);
    else { showToast(data.error || 'Could not update station', 'error'); void reloadAll(); }
  }
  function reorderStations(orderedIds: number[]) {
    setStations(prev => (prev ? orderedIds.map(id => prev.find(s => s.id === id)).filter(Boolean) as CookStationAdmin[] : prev));
    void call('/api/cooktimer/stations', 'PATCH', { order: orderedIds }).then(({ ok, data }) => {
      if (ok && Array.isArray(data.stations)) setStations(data.stations);
      else { showToast(data.error || 'Could not reorder', 'error'); void reloadAll(); }
    });
  }
  function deleteStation(s: CookStationAdmin) {
    const others = (stations ?? []).filter(x => x.id !== s.id);
    const holdsDishes = s.profileCount > 0;

    // A station that still holds dishes is NOT a dead end: ask where they go and
    // move them as part of the same delete.
    if (holdsDishes && others.length === 0) {
      showToast(`${s.name} is your only station, so its dishes have nowhere to go. Add another station first.`, 'error');
      return;
    }
    moveTargetRef.current = others[0]?.id ?? null;

    setConfirm({
      title: `Delete ${s.name}?`,
      message: holdsDishes
        ? `${s.name} still has ${s.profileCount} dish${s.profileCount === 1 ? '' : 'es'} on it. Choose where they should go — they keep their cooking steps.`
        : 'This removes the station. It has no dishes on it. This cannot be undone.',
      confirmLabel: holdsDishes ? 'Move dishes & delete' : 'Delete station',
      extra: holdsDishes ? (
        <select
          aria-label="Move dishes to"
          defaultValue={String(others[0]?.id ?? '')}
          onChange={e => { moveTargetRef.current = Number(e.target.value); }}
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-[15px] min-h-[48px] bg-white focus:outline-none focus:border-green-500"
        >
          {others.map(o => <option key={o.id} value={o.id}>Move to {o.name}</option>)}
        </select>
      ) : undefined,
      onConfirm: async () => {
        const moveTo = holdsDishes ? moveTargetRef.current : null;
        setConfirm(null);
        const { ok, data } = await call(`/api/cooktimer/stations/${s.id}`, 'DELETE',
          moveTo != null ? { moveToStationId: moveTo } : undefined);
        if (ok && Array.isArray(data.stations)) {
          setStations(data.stations);
          if (Array.isArray(data.profiles)) setProfiles(data.profiles);
          const to = others.find(o => o.id === moveTo)?.name;
          showToast(holdsDishes && to
            ? `${s.profileCount} moved to ${to} · ${s.name} deleted`
            : `Deleted ${s.name}`, 'success');
        } else showToast(data.error || 'Could not delete station', 'error');
      },
    });
  }

  // -- profiles --
  // Profile mutations return the fresh stations too (their profileCount changed,
  // which gates station delete) — apply both so the Stations tab stays accurate.
  function applyProfileResponse(data: any) {
    if (Array.isArray(data.profiles)) setProfiles(data.profiles);
    if ('productNameUnavailable' in data) setNamesUnavailable(!!data.productNameUnavailable);
    if (Array.isArray(data.stations)) setStations(data.stations);
  }
  async function saveProfile(input: CookProfileInput, id: number | null): Promise<{ ok: boolean; error?: string }> {
    const { ok, data } = await call(id ? `/api/cooktimer/profiles/${id}` : '/api/cooktimer/profiles', id ? 'PATCH' : 'POST', input);
    if (ok && Array.isArray(data.profiles)) {
      applyProfileResponse(data);
      showToast(id ? 'Profile saved' : 'Profile created', 'success');
      return { ok: true };
    }
    return { ok: false, error: data.error || 'Could not save.' };
  }
  async function toggleProfile(p: CookProfileAdmin, active: boolean) {
    const { ok, data } = await call(`/api/cooktimer/profiles/${p.id}`, 'PATCH', { active });
    if (ok && Array.isArray(data.profiles)) applyProfileResponse(data);
    else { showToast(data.error || 'Could not update profile', 'error'); void reloadAll(); }
  }
  function deleteProfile(p: CookProfileAdmin) {
    setConfirm({
      title: `Delete ${p.name}?`,
      message: 'This removes the cook profile and its steps.',
      confirmLabel: 'Delete profile',
      onConfirm: async () => {
        setConfirm(null);
        const { ok, data } = await call(`/api/cooktimer/profiles/${p.id}`, 'DELETE');
        if (ok && Array.isArray(data.profiles)) { applyProfileResponse(data); showToast(`Deleted ${p.name}`, 'success'); }
        else showToast(data.error || 'Could not delete profile', 'error');
      },
    });
  }

  const loading = profiles === null || stations === null;

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-16">
      {/* Top-level module screen reached from the dashboard, so the single left
          control is HOME (a back arrow here just went to '/' as well). */}
      <AppHeader supertitle="Cooking Timer" title="Setup" subtitle="Dishes & stations" />

      {namesUnavailable && (
        <div className="mx-4 mt-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3 py-2.5">
          Could not reach the till just now, so some dish names may be missing. Everything else still works.
        </div>
      )}

      {/* tabs */}
      <div className="flex gap-1 px-4 pt-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        {(['profiles', 'stations'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 ${tab === t ? 'text-gray-900 border-green-500' : 'text-gray-400 border-transparent'}`}>
            {t === 'profiles' ? 'Dishes' : 'Stations'}
          </button>
        ))}
      </div>

      {loadError && loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 px-6 text-center">
          <div className="text-3xl">⚠️</div>
          <div className="font-semibold text-gray-700">Could not load the setup</div>
          <div className="text-sm text-gray-500">Check the connection and try again.</div>
          <button onClick={() => void reloadAll()} className="mt-1 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold">Retry</button>
        </div>
      ) : loading ? (
        <div className="text-center text-gray-400 py-20">Loading…</div>
      ) : tab === 'profiles' ? (
        <ProfilesTab
          profiles={profiles!}
          stations={stations!}
          onEdit={p => setEditor({ profile: p })}
          onNew={() => {
            if (!stations!.length) { showToast('Add a station first', 'error'); setTab('stations'); return; }
            setEditor({ profile: null });
          }}
          onToggleActive={toggleProfile}
          onDelete={deleteProfile}
        />
      ) : (
        <StationsTab
          stations={stations!}
          onReorder={reorderStations}
          onAdd={addStation}
          onRename={renameStation}
          onToggle={toggleStation}
          onDelete={deleteStation}
        />
      )}

      {editor && stations && (
        <ProfileEditor
          profile={editor.profile}
          stations={stations}
          onClose={() => setEditor(null)}
          onSave={saveProfile}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          extra={confirm.extra}
          variant="danger"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
          onDismiss={() => setConfirm(null)}
        />
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible}
        onDismiss={() => setToast(t => ({ ...t, visible: false }))} />
    </div>
  );
}
