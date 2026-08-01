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
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { processPdf, suggestRooms, buildRevisionFormData, countPdfPages } from '@/lib/inventory-floorplan/pdf-client';
import { allowedActionKeysForRole } from '@/lib/permissions';
// The marker styles live with the map, but the builder draws REAL markers in
// its preview and shape picker — without this import every shape rendered as
// a bare emoji (the stylesheet only loaded on the map screen).
import './floorplan.css';
import {
  LAYER_LABELS, MARKER_COLORS, MARKER_SHAPES, SHAPE_LABELS,
  type LocationLayer, type MarkerShape,
} from '@/lib/inventory-floorplan/marker-presets';
import type { FloorplanTypeInfo } from '@/lib/inventory-floorplan/manifest';

interface FloorRow {
  id: number;
  name: string;
  code: string;
  company_id: number;
  revision: { id: number; revision_no: number; published_at: string | null } | null;
}

/** Exactly how the marker will look on the plan. */
/** The real marker, drawn with the same CSS the map uses. */
const MarkerPreview = ({ shape, color, icon, label }: { shape: MarkerShape; color: string; icon: string; label: string }) => (
  shape === 'label' ? (
    <span
      className="inline-flex items-center gap-1 rounded-[7px] border-[1.5px] bg-white px-2.5 py-1 text-[12px] font-bold text-gray-900"
      style={{ borderColor: color }}
    >
      {icon || '📍'} {label || 'Name'}
    </span>
  ) : (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={`kw-fp-dot kw-fp-shape-${shape}`} style={{ ['--c' as string]: color }}>
        <span>{icon || '📍'}</span>
      </span>
      <span className="rounded-full border bg-white/95 px-1.5 text-[9.5px] font-bold text-gray-900" style={{ borderColor: color }}>
        {label || 'Name'}
      </span>
    </span>
  )
);

/** One field, your own keyboard: type it, paste it, or use ⌃⌘Space on a Mac. */
const IconField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-2">
    <input
      value={value}
      // Emoji are multi-codepoint (a bell carries a variation selector, a chef
      // is a ZWJ sequence) — never slice them apart. Keep what was typed,
      // capped; select-on-focus so typing simply replaces the old symbol.
      onChange={e => onChange(Array.from(e.target.value).slice(0, 8).join(''))}
      onFocus={e => e.target.select()}
      aria-label="Symbol"
      placeholder="📦"
      className="h-11 w-16 flex-shrink-0 rounded-xl border-[1.5px] border-gray-200 text-center text-[20px] outline-none focus:border-blue-600"
    />
    <span className="text-[11.5px] leading-snug text-gray-500">
      Type or paste any symbol — on a Mac press <b>⌃⌘Space</b> for the emoji picker.
    </span>
  </div>
);

/**
 * "It's just a marker."
 *
 * Ethan, 2026-07-31: "the central gas shut off valve is not a location but just
 * a location marker … for these items, we do not need any nesting nor should it
 * be displayed inside the location picker for product location." A type with
 * this on marks the thing itself — valve, fuse box, first aid kit — so nothing
 * is stored in it, nothing nests inside it, and it never appears when someone
 * says where a product lives.
 */
const MarkerOnlyToggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    aria-pressed={value}
    className={`mt-2.5 flex w-full items-start gap-2.5 rounded-xl border-[1.5px] p-3 text-left ${value ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200 bg-white'}`}
  >
    <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${value ? 'border-blue-600 bg-blue-600' : 'border-gray-300 bg-white'}`}>
      {value && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
    </span>
    <span className="min-w-0">
      <span className="block text-[13px] font-bold text-gray-900">It&rsquo;s just a marker</span>
      <span className="block text-[11.5px] leading-relaxed text-gray-500">
        Marks the thing itself — a shut-off valve, a fuse box. No products stored in it, nothing
        inside it, and it stays out of the &ldquo;where does it live?&rdquo; picker.
      </span>
    </span>
  </button>
);

const LayerPicker = ({ value, onChange }: { value: LocationLayer; onChange: (v: LocationLayer) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {([1, 2, 3, 4] as LocationLayer[]).map(l => (
      <button
        key={l}
        onClick={() => onChange(l)}
        className={`h-9 rounded-full border px-3 text-[11.5px] font-bold ${value === l ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700'}`}
      >
        {l}. {LAYER_LABELS[l]}
      </button>
    ))}
  </div>
);

const ShapePicker = ({ value, onChange, color, icon }: { value: MarkerShape; onChange: (v: MarkerShape) => void; color: string; icon: string }) => (
  <div className="flex flex-wrap gap-1.5">
    {MARKER_SHAPES.map(sh => (
      <button
        key={sh}
        onClick={() => onChange(sh)}
        aria-pressed={value === sh}
        title={SHAPE_LABELS[sh]}
        className={`flex h-14 w-[68px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[10px] font-bold ${value === sh ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 bg-white text-gray-500'}`}
      >
        {sh === 'label' ? (
          <span className="rounded-[5px] border-[1.5px] bg-white px-1.5 py-0.5 text-[9px] font-bold text-gray-800" style={{ borderColor: color }}>
            {icon || '📍'} Aa
          </span>
        ) : (
          <span className={`kw-fp-dot kw-fp-shape-${sh}`} style={{ ['--c' as string]: color, width: 26, height: 26, fontSize: 11 }}>
            <span>{icon || '📍'}</span>
          </span>
        )}
        {SHAPE_LABELS[sh]}
      </button>
    ))}
  </div>
);

const ColorPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-wrap gap-1.5">
    {MARKER_COLORS.map(c => (
      <button
        key={c.hex}
        onClick={() => onChange(c.hex)}
        aria-label={c.name}
        aria-pressed={value.toLowerCase() === c.hex.toLowerCase()}
        className={`h-9 w-9 rounded-full border-2 ${value.toLowerCase() === c.hex.toLowerCase() ? 'border-gray-900 ring-2 ring-gray-300' : 'border-white'} active:scale-95`}
        style={{ background: c.hex }}
      />
    ))}
  </div>
);

export default function FloorplanManage() {
  const router = useRouter();
  const [floors, setFloors] = useState<FloorRow[] | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [types, setTypes] = useState<FloorplanTypeInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // human-readable progress
  const [newFloor, setNewFloor] = useState('');
  const [newType, setNewType] = useState<{ label: string; icon: string; color: string; shape: MarkerShape; layer: LocationLayer; markerOnly: boolean }>(
    { label: '', icon: '📦', color: '#16A34A', shape: 'dot', layer: 3, markerOnly: false },
  );
  const [renameFloor, setRenameFloor] = useState<{ id: number; name: string } | null>(null);
  const [dragOverFloor, setDragOverFloor] = useState<number | null>(null);
  const [archiveFloor, setArchiveFloor] = useState<{ id: number; name: string } | null>(null);
  const [editType, setEditType] = useState<{ id?: number; key: string; label: string; icon: string; color: string; shape: MarkerShape; layer: LocationLayer; custom: boolean; markerOnly: boolean } | null>(null);
  const [deleteType, setDeleteType] = useState<{ id?: number; key: string; label: string; custom: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFloorRef = useRef<number | null>(null);
  const tokenRef = useRef(0);
  const [capabilities, setCapabilities] = useState<string[]>(() => allowedActionKeysForRole('staff', {}));
  const [capsLoaded, setCapsLoaded] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (Array.isArray(d.user?.capabilities)) setCapabilities(d.user.capabilities);
      setCapsLoaded(true);
    }).catch(() => setCapsLoaded(true));
  }, []);
  const canManage = capabilities.includes('inventory.location.manage');

  const load = useCallback(() => {
    const token = ++tokenRef.current;
    setError(null);
    Promise.all([
      fetch('/api/inventory/floorplans').then(r => r.ok ? r.json() : Promise.reject(new Error('floors'))),
      fetch('/api/inventory/floorplan').then(r => r.ok ? r.json() : Promise.reject(new Error('manifest'))),
    ]).then(([f, m]) => {
      if (tokenRef.current !== token) return;
      setFloors(f.floors ?? []);
      setCompanyId(f.company_id ?? m.manifest?.companyId ?? null);
      setTypes(m.manifest?.types ?? []);
    }).catch(() => {
      if (tokenRef.current !== token) return;
      setFloors([]); // never leave the card stuck on "Loading…"
      setError('Could not load the floor plans — check your connection.');
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const addFloor = async () => {
    if (!newFloor.trim()) return;
    if (!companyId) { setError('Pick a restaurant in the pill above first.'); return; }
    setError(null);
    // ALWAYS the company this screen is showing — never a silent fallback.
    const res = await fetch('/api/inventory/floorplans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newFloor.trim(), company_id: companyId }),
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
      processed.candidates = suggestRooms(processed.candidates, processed.meta.pageWidth, processed.meta.pageHeight);
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

  const saveFloorRename = async () => {
    if (!renameFloor || !renameFloor.name.trim()) return;
    const res = await fetch(`/api/inventory/floorplans/${renameFloor.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameFloor.name.trim() }),
    });
    if (!res.ok) { setError((await res.json()).error ?? 'Could not rename the floor'); }
    setRenameFloor(null);
    load();
  };

  const doArchiveFloor = async () => {
    if (!archiveFloor) return;
    const res = await fetch(`/api/inventory/floorplans/${archiveFloor.id}`, { method: 'DELETE' });
    if (!res.ok) { setError((await res.json()).error ?? 'Could not archive the floor'); }
    setArchiveFloor(null);
    load();
  };

  const saveTypeEdit = async () => {
    if (!editType || !editType.label.trim()) return;
    const res = await fetch('/api/inventory/location-kinds', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editType.id, kind: editType.key, label: editType.label.trim(), icon: editType.icon.trim(),
        color: editType.color, shape: editType.shape, layer: editType.layer,
        markerOnly: editType.markerOnly, company_id: companyId,
      }),
    });
    if (!res.ok) { setError((await res.json()).error ?? 'Could not save the type'); }
    setEditType(null);
    load();
  };

  const doDeleteType = async () => {
    if (!deleteType) return;
    const q = deleteType.custom && deleteType.id
      ? `id=${deleteType.id}`
      : `kind=${encodeURIComponent(deleteType.key)}`;
    const res = await fetch(`/api/inventory/location-kinds?${q}&company_id=${companyId ?? ''}`, { method: 'DELETE' });
    if (!res.ok) { setError((await res.json()).error ?? 'Could not remove the type'); }
    setDeleteType(null);
    load();
  };

  const restoreType = async (key: string) => {
    const res = await fetch('/api/inventory/location-kinds', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: key, label: key, hidden: false, company_id: companyId }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not restore the type');
    load();
  };

  const addType = async () => {
    if (!newType.label.trim()) return;
    if (!companyId) { setError('Pick a restaurant in the pill above first.'); return; }
    setError(null);
    const res = await fetch('/api/inventory/location-kinds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: newType.label.trim(), icon: newType.icon.trim(), color: newType.color,
        shape: newType.shape, layer: newType.layer, markerOnly: newType.markerOnly, company_id: companyId,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? 'Could not add the type'); return; }
    setNewType({ label: '', icon: '📦', color: '#16A34A', shape: 'dot', layer: 3, markerOnly: false });
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
      {capsLoaded && !canManage && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <div className="text-3xl">🔒</div>
          <p className="text-[14px] font-semibold text-gray-800">Managers only</p>
          <p className="text-[12.5px] text-gray-500">Managing floor plans needs the location-manage permission.</p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={e => onFile(e.target.files?.[0] ?? null)} />
      <div className={`mx-auto w-full max-w-2xl flex flex-col gap-3 p-4 pb-28 ${capsLoaded && !canManage ? 'hidden' : ''}`}>
        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 px-4 py-3">
            <span className="min-w-0 flex-1 text-[13px] font-medium text-red-700">{error}</span>
            <button onClick={load} className="h-9 flex-shrink-0 rounded-full border border-red-200 bg-white px-3.5 text-[12px] font-bold text-red-700">Try again</button>
          </div>
        )}
        {busy && <div className="rounded-xl bg-blue-50 px-4 py-3 text-[13px] font-medium text-blue-700">{busy}</div>}

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">FLOORS</p>
          {floors === null && <p className="py-2 text-[13px] text-gray-500">Loading…</p>}
          {floors?.length === 0 && (
            <p className="py-2 text-[12.5px] text-gray-500">No floors yet — add one below, then upload its plan PDF.</p>
          )}
          {floors?.map(f => (
            <div
              key={f.id}
              onDragOver={e => { e.preventDefault(); setDragOverFloor(f.id); }}
              onDragLeave={() => setDragOverFloor(d => (d === f.id ? null : d))}
              onDrop={e => {
                e.preventDefault();
                setDragOverFloor(null);
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                  setError('Drop the plan as a PDF file.');
                  return;
                }
                uploadFloorRef.current = f.id;
                void onFile(file);
              }}
              className={`flex min-h-[52px] items-center gap-3 border-b border-gray-50 py-2 last:border-b-0 rounded-xl transition-colors ${dragOverFloor === f.id ? 'bg-blue-50 outline outline-2 outline-dashed outline-blue-400' : ''}`}
            >
              {/* The badge shows a code only when one was actually set. It used
                  to fall back to the first three letters of the name, which
                  made "Ssam Basement" and "Ssam Ground Floor" both read "Ssa"
                  — an abbreviation nobody chose and nobody could read. */}
              <span className="flex h-11 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[13px] font-extrabold text-blue-700">
                {f.code || '🏢'}
              </span>
              <button className="min-w-0 flex-1 text-left" onClick={() => setRenameFloor({ id: f.id, name: f.name })} aria-label={`Rename ${f.name}`}>
                <span className="block truncate text-[13.5px] font-bold text-gray-900">
                  {f.name} <span className="text-[11px] font-semibold text-gray-300">✏️</span>
                  {f.revision && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[9.5px] font-extrabold text-green-700 align-middle">LIVE</span>}
                </span>
                <span className="block text-[11.5px] text-gray-500">
                  {f.revision ? `Plan v${f.revision.revision_no} · published` : 'No plan yet'}
                </span>
              </button>
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
              <button
                onClick={() => setArchiveFloor({ id: f.id, name: f.name })}
                aria-label={`Archive ${f.name}`}
                className="h-10 w-10 flex-shrink-0 rounded-full border-[1.5px] border-gray-200 text-[13px] text-gray-400 active:scale-95"
              >
                🗑
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
            Upload the Illustrator PDF exactly as you export it — or simply drag the PDF onto a floor row.
            Labels are detected automatically, and a new version of a floor keeps the old one available.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10.5px] font-bold tracking-[0.08em] text-gray-400">LOCATION TYPES</p>
          <div className="flex flex-wrap gap-1.5">
            {types.filter(t => !t.hidden).map(t => (
              <button
                key={t.key}
                onClick={() => setEditType({ id: t.id, key: t.key, label: t.label, icon: t.icon, color: t.color, shape: t.shape, layer: t.layer, custom: t.custom, markerOnly: !!t.markerOnly })}
                className="flex h-10 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-900 active:scale-95"
                aria-label={`Edit ${t.label}`}
              >
                <span>{t.icon}</span>
                <span className={t.shape === 'label' ? 'h-2.5 w-4 rounded-[3px]' : 'h-3 w-3 rounded-full'} style={{ background: t.color }} />
                {t.label}
                {/* A marker holds nothing, so its layer says nothing — the badge
                    says what it IS instead, and the library reads at a glance. */}
                {t.markerOnly
                  ? <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-blue-700">MARKER</span>
                  : <span className="text-[9.5px] font-bold text-gray-300">L{t.layer}</span>}
                <span className="text-[10px] text-gray-300">✏️</span>
              </button>
            ))}
          </div>
          {types.some(t => t.hidden) && (
            <div className="mt-2 rounded-xl bg-gray-50 p-2.5">
              <p className="mb-1.5 text-[11px] font-bold tracking-[0.06em] text-gray-400">REMOVED FROM YOUR LIBRARY</p>
              <div className="flex flex-wrap gap-1.5">
                {types.filter(t => t.hidden).map(t => (
                  <button
                    key={t.key}
                    onClick={() => restoreType(t.key)}
                    className="flex h-9 items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 text-[11.5px] font-semibold text-gray-400 line-through active:scale-95"
                  >
                    {t.icon} {t.label}
                    <span className="text-[10px] font-bold text-blue-600 no-underline">restore</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-3">
            <div className="mb-2 flex items-center gap-2">
              <p className="flex-1 text-[11px] font-bold tracking-[0.06em] text-gray-400">BUILD A NEW TYPE</p>
              <MarkerPreview shape={newType.shape} color={newType.color} icon={newType.icon} label={newType.label} />
            </div>
            <p className="mb-1 text-[11px] font-semibold text-gray-500">Shape</p>
            <ShapePicker value={newType.shape} onChange={v => setNewType(s2 => ({ ...s2, shape: v }))} color={newType.color} icon={newType.icon} />
            <p className="mb-1 mt-2.5 text-[11px] font-semibold text-gray-500">Colour</p>
            <ColorPicker value={newType.color} onChange={v => setNewType(s2 => ({ ...s2, color: v }))} />
            <p className="mb-1 mt-2.5 text-[11px] font-semibold text-gray-500">Symbol</p>
            <IconField value={newType.icon} onChange={v => setNewType(s2 => ({ ...s2, icon: v }))} />
            <p className="mb-1 mt-2.5 text-[11px] font-semibold text-gray-500">Where does it sit?</p>
            <LayerPicker value={newType.layer} onChange={v => setNewType(s2 => ({ ...s2, layer: v }))} />
            <MarkerOnlyToggle value={newType.markerOnly} onChange={v => setNewType(s2 => ({ ...s2, markerOnly: v }))} />
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={newType.label}
                onChange={e => setNewType(s2 => ({ ...s2, label: e.target.value }))}
                placeholder="Name it — e.g. First Aid"
                className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] outline-none focus:border-blue-600"
              />
              <button onClick={addType} className="h-11 flex-shrink-0 rounded-full bg-green-600 px-5 text-[13px] font-bold text-white active:scale-95">Add</button>
            </div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">
            Your library: shape, colour, icon, name and where it sits in the hierarchy. Tap ANY type —
            including the built-in ones — to change it or remove it from your library. The layer
            (1 Area → 2 Room → 3 Item → 4 Inside an item) is what tells the tool which parent to
            suggest when you place it, and the order staff are guided in.
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
      {renameFloor && (
        <ConfirmDialog
          title="Rename floor"
          message="The floor keeps its plan, spots and history — only the name changes."
          confirmLabel="Save name"
          onConfirm={saveFloorRename}
          onCancel={() => setRenameFloor(null)}
          extra={
            <input
              value={renameFloor.name}
              onChange={e => setRenameFloor(f => (f ? { ...f, name: e.target.value } : f))}
              aria-label="Floor name"
              className="h-11 w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] font-semibold outline-none focus:border-blue-600"
            />
          }
        />
      )}
      {archiveFloor && (
        <ConfirmDialog
          title={`Archive ${archiveFloor.name}?`}
          message="Staff will no longer see this floor. The plan, its spots and every version stay saved — ask me to restore it any time."
          confirmLabel="Archive floor"
          variant="danger"
          onConfirm={doArchiveFloor}
          onCancel={() => setArchiveFloor(null)}
        />
      )}
      {editType && (
        <ConfirmDialog
          title="Edit type"
          message="Renaming or recoloring updates every marker of this type. Delete is only possible while no location uses it."
          confirmLabel="Save type"
          onConfirm={saveTypeEdit}
          onCancel={() => setEditType(null)}
          extra={
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] font-semibold text-gray-500">Preview</span>
                <MarkerPreview shape={editType.shape} color={editType.color} icon={editType.icon} label={editType.label} />
              </div>
              <input
                value={editType.label}
                onChange={e => setEditType(t => (t ? { ...t, label: e.target.value } : t))}
                aria-label="Type name"
                className="h-11 w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 text-[14px] font-semibold outline-none focus:border-blue-600"
              />
              <ShapePicker value={editType.shape} onChange={v => setEditType(t => (t ? { ...t, shape: v } : t))} color={editType.color} icon={editType.icon} />
              <ColorPicker value={editType.color} onChange={v => setEditType(t => (t ? { ...t, color: v } : t))} />
              <IconField value={editType.icon} onChange={v => setEditType(t => (t ? { ...t, icon: v } : t))} />
              <LayerPicker value={editType.layer} onChange={v => setEditType(t => (t ? { ...t, layer: v } : t))} />
              <MarkerOnlyToggle value={editType.markerOnly} onChange={v => setEditType(t => (t ? { ...t, markerOnly: v } : t))} />
              <button
                onClick={() => { setDeleteType({ id: editType.id, key: editType.key, label: editType.label, custom: editType.custom }); setEditType(null); }}
                className="h-10 w-full rounded-xl border-[1.5px] border-red-200 text-[13px] font-bold text-red-600"
              >
                {editType.custom ? 'Delete this type…' : 'Remove from my library…'}
              </button>
            </div>
          }
        />
      )}
      {deleteType && (
        <ConfirmDialog
          title={deleteType.custom ? `Delete “${deleteType.label}”?` : `Remove “${deleteType.label}” from your library?`}
          message={deleteType.custom
            ? 'Only possible while no location uses this type — otherwise you’ll get a message telling you how many still do.'
            : 'It disappears from your tray and chips. Places already using it keep working, and you can restore it any time.'}
          confirmLabel={deleteType.custom ? 'Delete type' : 'Remove from library'}
          variant="danger"
          onConfirm={doDeleteType}
          onCancel={() => setDeleteType(null)}
        />
      )}
    </div>
  );
}
