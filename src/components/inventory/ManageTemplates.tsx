'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState, SectionTitle } from './ui';
import RecordLink from '@/components/ui/RecordLink';
import TemplateForm from './TemplateForm';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useCompany } from '@/lib/company-context';

interface ManageTemplatesProps {
  onBack: () => void;
}

/** One product this list shares with another of the same restaurant's lists. */
type ClashRow = { product_id: number; template_id: number; template_name: string; frequency: string };

export default function ManageTemplates({ onBack }: ManageTemplatesProps) {
  const { companyId } = useCompany();
  const [templates, setTemplates] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locFilter, setLocFilter] = useState('all');
  const [assignFilter, setAssignFilter] = useState('all');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  // Products this list shares with another one, held with the save that hit
  // them so either answer can go straight back to the server.
  const [clash, setClash] = useState<{ data: any; rows: ClashRow[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);  // list pending delete confirmation
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Scope BOTH lists and the location pills to the active restaurant — the
      // company selector already picks it, so cross-company pills are noise.
      const cq = companyId ? `?company_id=${companyId}` : '';
      const [tplRes, locRes] = await Promise.all([
        fetch(`/api/inventory/templates${cq}`).then((r) => r.json()),
        fetch(`/api/inventory/locations${cq}`).then((r) => r.json()),
      ]);
      setTemplates(tplRes.templates || []);
      setLocations(locRes.locations || []);

      // Fetch departments for the form
      try {
        const deptRes = await fetch('/api/inventory/departments');
        if (deptRes.ok) {
          const deptData = await deptRes.json();
          setDepartments(deptData.departments || []);
        }
      } catch (e) { void e; }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Switching restaurants must clear a stale location filter — the old location
  // id won't exist here, and the filter UI hides at ≤1 location, which would
  // otherwise strand the user on a false "No templates" result.
  useEffect(() => { setLocFilter('all'); }, [companyId]);

  async function handleDelete() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/inventory/templates?id=${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Could not delete the list.');
        return;
      }
      setConfirmDelete(null);
      fetchData();
    } catch {
      alert('Network error — the list was not deleted.');
    } finally {
      setDeleting(false);
    }
  }

  // Filter templates
  const filtered = React.useMemo(() => {
    let list = [...templates];
    if (locFilter !== 'all') list = list.filter((t) => t.location_id === Number(locFilter));
    if (assignFilter !== 'all') {
      if (assignFilter === 'none') list = list.filter((t) => !t.assign_type);
      else list = list.filter((t) => t.assign_type === assignFilter);
    }
    return list;
  }, [templates, locFilter, assignFilter]);

  function locName(id: number) {
    const loc = locations.find((l: any) => l.id === id);
    return loc?.complete_name?.split('/')[0] || loc?.name || String(id);
  }

  function assignLabel(tpl: any) {
    if (!tpl.assign_type) return 'Anyone';
    if (tpl.assign_type === 'person') return tpl.assign_label || `Person #${tpl.assign_id}`;
    if (tpl.assign_type === 'department') {
      const dept = departments.find((d: any) => d.id === tpl.assign_id);
      return dept?.name || `Dept #${tpl.assign_id}`;
    }
    if (tpl.assign_type === 'shift') return `Shift #${tpl.assign_id}`;
    return 'Anyone';
  }

  async function handleSave(data: any) {
    try {
      const res = await fetch('/api/inventory/templates', {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.status === 409) {
        // Products already counted by another list. Not an error — a choice.
        const body = await res.json().catch(() => ({}));
        if (Array.isArray(body.clash) && body.clash.length > 0) {
          setClash({ data, rows: body.clash });
          return;
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Could not save the list. Please try again.');
        return;   // keep the form open so the manager can fix it
      }
      // A list can be created and still get no count today — say so, rather
      // than let it look like nothing happened.
      const ok = await res.json().catch(() => ({}));
      if (ok.deferred && ok.message) alert(ok.message);
      setClash(null);
      setEditing(null);
      setCreating(false);
      fetchData();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Network error — the list was not saved.');
    }
  }

const clashSheet = clash ? (
      <DuplicateProductsSheet
        rows={clash.rows}
        savingFrequency={clash.data.frequency}
        onRemove={() => {
          // Optional tidying only — the system already counts each product once.
          // A manager who wants the list to read exactly as it counts can strip
          // the shared products out.
          const drop = new Set(clash.rows.map((r) => r.product_id));
          const kept = (clash.data.product_ids || []).filter((id: number) => !drop.has(id));
          if (kept.length === 0) {
            // Removing them all would save a list that counts nothing, which
            // the form itself refuses — so say what to do instead of silently
            // creating an empty list (Codex, 2026-08-03).
            alert('That would leave this list empty \u2014 every product on it is also on another list. Pick different products, or just save the list as it is.');
            return;
          }
          const next = { ...clash.data, product_ids: kept };
          setClash(null);
          void handleSave(next);
        }}
        onKeep={() => {
          const next = { ...clash.data, allow_duplicates: true as const };
          setClash(null);
          void handleSave(next);
        }}
        onCancel={() => setClash(null)}
      />
    ) : null;

  // Show form. The duplicate sheet MUST render here too: a clash is raised BY
  // saving the form, so the form is always what's on screen when it happens.
  // Rendering the sheet only after this early return made the whole warning
  // dead on arrival — the save just appeared to do nothing (Codex, 2026-08-03).
  if (creating || editing) {
    return (
      <>
        <TemplateForm
          template={editing}
          locations={locations}
          departments={departments}
          onSave={handleSave}
          onCancel={() => {
            // Refetch even on cancel. The editor can DELETE a product, which the
            // server strips from every list — without this the stale template
            // object is reused on the next open and "Save changes" writes the
            // deleted id straight back.
            setEditing(null); setCreating(false); fetchData();
          }}
        />
        {clashSheet}
      </>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Primary action — one full-width green button (matches Task Manager Templates/Guides). */}
      <div className="px-4 pt-3 pb-1">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full min-h-[48px] rounded-xl bg-green-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-green-700 active:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          New counting list
        </button>
      </div>

      {/* Location filter — only when this restaurant actually has >1 location
          (the company is already chosen in the top-bar selector). */}
      {locations.length > 1 && (
        <div className="pt-2">
          <FilterBar>
            <FilterPill active={locFilter === 'all'} label="All locations" onClick={() => setLocFilter('all')} />
            {locations.map((loc: any) => (
              <FilterPill key={loc.id} active={locFilter === String(loc.id)}
                label={loc.complete_name?.split('/')[0] || loc.name}
                onClick={() => setLocFilter(String(loc.id))} />
            ))}
          </FilterBar>
        </div>
      )}

      {/* Assignment filter */}
      <FilterBar>
        {[{ id: 'all', label: 'All' }, { id: 'person', label: 'Person' }, { id: 'department', label: 'Dept' }, { id: 'shift', label: 'Shift' }, { id: 'none', label: 'Unassigned' }].map((a) => (
          <FilterPill key={a.id} active={assignFilter === a.id} label={a.label} onClick={() => setAssignFilter(a.id)} />
        ))}
      </FilterBar>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? <Spinner /> : filtered.length === 0 ? (
          <EmptyState icon="📋" title="No templates" body="Create your first counting list template" />
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((tpl: any) => {
              const catCount = (tpl.category_ids || []).length;
              return (
                <div key={tpl.id}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {/* Header row: edit-tap area + drill-down ↗ as SIBLINGS (no nested button) */}
                <div className="flex items-start">
                  <button onClick={() => setEditing(tpl)}
                    className="flex-1 min-w-0 p-4 text-left active:bg-gray-50 transition-all">
                    <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1.5 truncate">{tpl.name}</div>
                    <div className="text-[var(--fs-sm)] text-gray-500 mb-2">{locName(tpl.location_id)}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={tpl.frequency} />
                      {tpl.assign_type && (
                        <StatusBadge status={tpl.assign_type} label={`${tpl.assign_type}: ${assignLabel(tpl)}`} />
                      )}
                      {catCount > 0 && (
                        <span className="text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 font-semibold">
                          {catCount} categories
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex flex-col items-end gap-1 p-3 flex-shrink-0">
                    <span className={`text-[var(--fs-xs)] px-2 py-0.5 rounded-md font-semibold ${tpl.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {tpl.active ? 'Active' : 'Inactive'}
                    </span>
                    {/* Drill-down: the list's canonical page (roster → products → locations) */}
                    <RecordLink type="list" id={tpl.id} label={tpl.name} />
                  </div>
                </div>
                {/* Spots are now set inside the list (open it \u2192 "By location" \u2192
                    tap a product) or on the product's own page, so there's no
                    separate "Arrange spots" step \u2014 just the destructive action. */}
                <div className="flex justify-end border-t border-gray-100">
                  <button onClick={() => setConfirmDelete(tpl)}
                    className="px-4 py-2.5 text-[var(--fs-sm)] font-bold text-red-600 active:bg-red-50">
                    Delete
                  </button>
                </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation — destructive + irreversible, so an explicit step. */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this list?"
          message={`${confirmDelete.name} and all of its counts will be permanently removed. This can’t be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => { if (!deleting) setConfirmDelete(null); }}
        />
      )}
      {clashSheet}
    </div>
  );
}

/**
 * "4 of these are also on Daily Count — they'll be counted there."
 *
 * Overlap between lists used to be the manager's problem to fix by hand: a
 * product on both the daily and the weekly was counted twice, so the day ended
 * with two different answers for it (3 Aug: thyme read 0.03 on one list, 0.0 on
 * the other). It is now handled by the system — on any day both lists run, the
 * product is put on ONE of them, and the list that runs most often keeps it.
 *
 * So this sheet informs, it no longer demands. Saving is the main button;
 * removing the products is there for a manager who wants a tidy list, not
 * because anything is wrong.
 */
function DuplicateProductsSheet({ rows, savingFrequency, onRemove, onKeep, onCancel }: {
  rows: ClashRow[];
  savingFrequency: string;
  onRemove: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const [names, setNames] = useState<Record<number, string>>({});
  const ids = Array.from(new Set(rows.map((r) => r.product_id)));
  useEffect(() => {
    // Ids mean nothing to a person standing in a kitchen — show the products.
    fetch(`/api/inventory/products?ids=${ids.join(',')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.products) return;
        const m: Record<number, string> = {};
        d.products.forEach((p: any) => { m[p.id] = p.name; });
        setNames(m);
      })
      .catch(() => { /* names are a nicety; the count and the list still read */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  // Group by the list they clash with, so the sentence is true when there are two.
  const byList = new Map<string, number[]>();
  rows.forEach((r) => {
    const cur = byList.get(r.template_name) || [];
    if (!cur.includes(r.product_id)) cur.push(r.product_id);
    byList.set(r.template_name, cur);
  });
  const listNames = Array.from(byList.keys()).join(' and ');

  // WHICH list actually counts them, in the manager's words. The engine gives
  // the product to whichever of the day's lists freezes its lines first, and
  // generation freezes the most frequent list first — so the more often a list
  // runs, the more surely it keeps them. Equal cadence has no stable winner, so
  // say only what is true: one of the two, never both.
  const rank: Record<string, number> = { daily: 0, weekly: 1, monthly: 2, adhoc: 3 };
  const mine = rank[savingFrequency] ?? 99;
  const others = Array.from(new Set(rows.map((r) => r.frequency)));
  const it = ids.length === 1 ? 'it' : 'them';
  const they = ids.length === 1 ? 'it\u2019s' : 'they\u2019re';
  const where = others.every((f) => (rank[f] ?? 99) < mine)
    ? `On a day both lists run, ${they} counted on ${listNames} \u2014 this list counts the rest.`
    : others.every((f) => (rank[f] ?? 99) > mine)
      ? `On a day both lists run, this list counts ${it} and ${listNames} skips ${it}.`
      : `On a day both lists run, whichever starts first counts ${it} \u2014 never both.`;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[var(--fs-lg)] font-bold leading-snug">
          {ids.length} of these {ids.length === 1 ? 'is' : 'are'} also on {listNames}
        </h3>
        <p className="text-[var(--fs-sm)] text-gray-500 mt-1.5 mb-3 leading-relaxed">
          {where} Nobody counts the same shelf twice, and you never get two different
          answers for one product.
        </p>
        <ul className="mb-4 space-y-1.5">
          {ids.map((pid) => (
            <li key={pid} className="flex items-center gap-2.5 text-[var(--fs-sm)] font-semibold text-gray-900">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{names[pid] || `#${pid}`}</span>
            </li>
          ))}
        </ul>
        <button onClick={onKeep}
          className="w-full py-3.5 rounded-xl bg-[#16A34A] text-white font-bold active:scale-[0.98] transition-transform">
          Save the list
        </button>
        <button onClick={onRemove}
          className="w-full py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold mt-2 active:bg-gray-50">
          Remove {it} from this list
        </button>
        <button onClick={onCancel}
          className="w-full py-3 text-[var(--fs-sm)] text-gray-500 font-semibold mt-1">
          Back to the list
        </button>
      </div>
    </div>
  );
}
