'use client';
/**
 * Manager home for floor plans: the company's floors (upload a PDF into a
 * floor slot — processing happens right here in the browser), plus the
 * editable location-type list (label + emoji + color) that feeds the map's
 * chips, pins and the edit-mode ADD tray.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { CompanyPill } from '@/components/ui/CompanyPill';
import { processPdf, suggestRooms, buildRevisionFormData, countPdfPages } from '@/lib/inventory-floorplan/pdf-client';
import type { FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';

interface FloorRow {
  id: number;
  name: string;
  code: string;
  company_id: number;
  revision: { id: number; revision_no: number; published_at: string | null } | null;
}

export default function FloorplanManage() {
  const router = useRouter();
  const [floors, setFloors] = useState<FloorRow[] | null>(null);
  const [types, setTypes] = useState<FloorplanTypeInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // human-readable progress
  const [newFloor, setNewFloor] = useState('');
  const [newType, setNewType] = useState({ label: '', icon: '', color: '#16A34A' });
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFloorRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(() => {
    const token = ++tokenRef.current;
    Promise.all([
      fetch('/api/inventory/floorplans').then(r => r.json()),
      fetch('/api/inventory/floorplan').then(r => r.json()),
    ]).then(([f, m]) => {
      if (tokenRef.current !== token) return;
      setFloors(f.floors ?? []);
      setTypes(m.manifest?.types ?? []);
    }).catch(() => { if (tokenRef.current === token) setError('Could not load — check your connection'); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const addFloor = async () => {
    if (!newFloor.trim()) return;
    setError(null);
    const res = await fetch('/api/inventory/floorplans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFloor.trim() }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? 'Could not add the floor'); return; }
    setNewFloor('');
    load();
  };

  const startUpload = (floorId: number) => {
    uploadFloorRef.current = floorId;
    fileRef.current?.click();
  };

  const onFile = async (file: File | null) => {
    const floorId = uploadFloorRef.current;
    uploadFloorRef.current = null;
    if (!file || floorId == null) return;
    setError(null);
    try {
      setBusy('Reading the PDF…');
      const pages = await countPdfPages(file);
      let pageNumber = 1;
      if (pages > 1) {
        const raw = window.prompt(`This PDF has ${pages} pages. Which page is this floor? (1–${pages})`, '1');
        pageNumber = Math.min(Math.max(parseInt(raw ?? '1', 10) || 1, 1), pages);
      }
      setBusy('Rendering the plan + reading your labels…');
      const processed = await processPdf(file, pageNumber);
      processed.candidates = suggestRooms(processed.candidates);
      setBusy(`Found ${processed.candidates.filter(c => c.proposedKind === 'spot').length} storage labels — uploading…`);
      const res = await fetch(`/api/inventory/floorplans/${floorId}/revisions`, {
        method: 'POST',
        body: buildRevisionFormData(file, processed),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? 'Upload failed'); setBusy(null); return; }
      setBusy(null);
      router.push(`/inventory/floorplan/review/${d.revisionId}`);
    } catch (e: unknown) {
      setBusy(null);
      setError(e instanceof Error ? e.message : 'Could not process that PDF');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const addType = async () => {
    if (!newType.label.trim()) return;
    setError(null);
    const res = await fetch('/api/inventory/location-kinds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newType.label.trim(), icon: newType.icon.trim(), color: newType.color }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? 'Could not add the type'); return; }
    setNewType({ label: '', icon: '', color: '#16A34A' });
    load();
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AppHeader
        supertitle="INVENTORY · FLOORPLAN"
        title="Manage plans"
        showBack
        onBack={() => router.push('/inventory/floorplan')}
        action={<CompanyPill onSwitched={load} />}
      />
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <div className="flex flex-col gap-3 p-4">
        {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</div>}
        {busy && <div className="rounded-xl bg-blue-50 px-4 py-3 text-[13px] font-medium text-blue-700">{busy}</div>}

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">FLOORS</p>
          {floors === null && <p className="py-2 text-[13px] text-gray-500">Loading…</p>}
          {floors?.length === 0 && (
            <p className="py-2 text-[12.5px] text-gray-500">No floors yet — add one below, then upload its plan PDF.</p>
          )}
          {floors?.map(f => (
            <div key={f.id} className="flex min-h-[52px] items-center gap-3 border-b border-gray-50 py-2 last:border-b-0">
              <span className="flex h-11 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[13px] font-extrabold text-blue-700">
                {f.code || f.name.slice(0, 3)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-gray-900">
                  {f.name}
                  {f.revision && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[9.5px] font-extrabold text-green-700 align-middle">LIVE</span>}
                </span>
                <span className="block text-[11.5px] text-gray-500">
                  {f.revision ? `Plan v${f.revision.revision_no} · published` : 'No plan yet'}
                </span>
              </span>
              {f.revision && (
                <button
                  onClick={() => router.push(`/inventory/floorplan/print?floor=${f.id}`)}
                  aria-label={`Print ${f.name}`}
                  className="h-10 w-10 flex-shrink-0 rounded-full border-[1.5px] border-gray-200 text-[14px] active:scale-95"
                >
                  🖨
                </button>
              )}
              <button
                onClick={() => startUpload(f.id)}
                disabled={busy != null}
                className="h-10 flex-shrink-0 rounded-full border-[1.5px] border-blue-600 px-3.5 text-[12px] font-bold text-blue-600 active:scale-95 disabled:opacity-50"
              >
                {f.revision ? '⬆ New version' : '⬆ Upload PDF'}
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <input
              value={newFloor}
              onChange={e => setNewFloor(e.target.value)}
              placeholder="Add a floor — e.g. Basement"
              className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] outline-none focus:border-blue-600"
            />
            <button onClick={addFloor} className="h-11 flex-shrink-0 rounded-full bg-green-600 px-4 text-[13px] font-bold text-white active:scale-95">Add</button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
            Upload the Illustrator PDF exactly as you export it — labels are detected automatically, and a new
            version of a floor keeps the old one available.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">LOCATION TYPES</p>
          <div className="flex flex-wrap gap-1.5">
            {types.map(t => (
              <span key={t.key} className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-900">
                <span>{t.icon}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={newType.icon}
              onChange={e => setNewType(s => ({ ...s, icon: e.target.value }))}
              placeholder="🔧"
              aria-label="Icon for the new type"
              className="h-11 w-14 flex-shrink-0 rounded-xl border-[1.5px] border-gray-200 text-center text-[16px] outline-none focus:border-blue-600"
            />
            <input
              value={newType.label}
              onChange={e => setNewType(s => ({ ...s, label: e.target.value }))}
              placeholder="Add your own type — e.g. First Aid"
              className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] outline-none focus:border-blue-600"
            />
            <input
              type="color"
              value={newType.color}
              onChange={e => setNewType(s => ({ ...s, color: e.target.value }))}
              aria-label="Color for the new type"
              className="h-11 w-12 flex-shrink-0 rounded-xl border-[1.5px] border-gray-200"
            />
            <button onClick={addType} className="h-11 flex-shrink-0 rounded-full bg-green-600 px-4 text-[13px] font-bold text-white active:scale-95">Add</button>
          </div>
          <p className="mt-2 text-[11.5px] text-gray-500">
            Types you add appear in the map chips, the edit-mode tray and the Locations screen.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-1 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">WHO CAN DO WHAT</p>
          <p className="text-[12.5px] leading-relaxed text-gray-600">
            Staff see the map and search. Managers and admins upload plans, review labels, edit the map and manage
            types — adjustable per person in Admin → Permissions.
          </p>
        </div>
      </div>
    </div>
  );
}
