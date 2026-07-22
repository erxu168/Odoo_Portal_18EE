'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import Toast from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { CookProfile, CookProfileInput, CookStationAdmin } from '@/types/cooktimer';
import ProfilesTab from './ProfilesTab';
import StationsTab from './StationsTab';
import ProfileEditor from './ProfileEditor';

type Tab = 'profiles' | 'stations';
interface ToastState { message: string; type: 'success' | 'error' | 'info'; visible: boolean; }
interface ConfirmState { title: string; message: string; confirmLabel: string; onConfirm: () => void; }

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
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('profiles');
  const [profiles, setProfiles] = useState<CookProfile[] | null>(null);
  const [stations, setStations] = useState<CookStationAdmin[] | null>(null);
  const [editor, setEditor] = useState<{ profile: CookProfile | null } | null>(null);
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'info', visible: false });
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [loadError, setLoadError] = useState(false);

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
    setConfirm({
      title: `Delete ${s.name}?`,
      message: 'This removes the station. Its profiles must be moved off first.',
      confirmLabel: 'Delete station',
      onConfirm: async () => {
        setConfirm(null);
        const { ok, data } = await call(`/api/cooktimer/stations/${s.id}`, 'DELETE');
        if (ok && Array.isArray(data.stations)) { setStations(data.stations); showToast(`Deleted ${s.name}`, 'success'); }
        else showToast(data.error || 'Could not delete station', 'error');
      },
    });
  }

  // -- profiles --
  // Profile mutations return the fresh stations too (their profileCount changed,
  // which gates station delete) — apply both so the Stations tab stays accurate.
  function applyProfileResponse(data: any) {
    if (Array.isArray(data.profiles)) setProfiles(data.profiles);
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
  async function toggleProfile(p: CookProfile, active: boolean) {
    const { ok, data } = await call(`/api/cooktimer/profiles/${p.id}`, 'PATCH', { active });
    if (ok && Array.isArray(data.profiles)) applyProfileResponse(data);
    else { showToast(data.error || 'Could not update profile', 'error'); void reloadAll(); }
  }
  function deleteProfile(p: CookProfile) {
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
      <AppHeader supertitle="Cooking Timer" title="Setup" subtitle="Stations & cook profiles"
        showBack onBack={() => router.push('/')} />

      {/* tabs */}
      <div className="flex gap-1 px-4 pt-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        {(['profiles', 'stations'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 ${tab === t ? 'text-gray-900 border-green-500' : 'text-gray-400 border-transparent'}`}>
            {t === 'profiles' ? 'Cook profiles' : 'Stations'}
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
