'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState, SectionTitle } from './ui';
import RecordLink from '@/components/ui/RecordLink';
import TemplateForm from './TemplateForm';
import TemplatePlacementEditor from './TemplatePlacementEditor';
import { useCompany } from '@/lib/company-context';

interface ManageTemplatesProps {
  onBack: () => void;
}

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
  const [arranging, setArranging] = useState<any | null>(null);   // list whose spot layout is open
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || 'Could not save the list. Please try again.');
        return;   // keep the form open so the manager can fix it
      }
      setEditing(null);
      setCreating(false);
      fetchData();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Network error — the list was not saved.');
    }
  }

  // Show form
  if (arranging) {
    return (
      <TemplatePlacementEditor
        templateId={arranging.id}
        templateName={arranging.name}
        onBack={() => setArranging(null)}
      />
    );
  }

  if (creating || editing) {
    return (
      <TemplateForm
        template={editing}
        locations={locations}
        departments={departments}
        onSave={handleSave}
        onCancel={() => { setEditing(null); setCreating(false); }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Create button */}
      <div className="px-4 pt-3 pb-1">
        <button onClick={() => setCreating(true)}
          className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
          + New counting list
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
          <EmptyState icon="\uD83D\uDCCB" title="No templates" body="Create your first counting list template" />
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
                <div className="flex border-t border-gray-100">
                  <button onClick={() => setArranging(tpl)}
                    className="flex-1 px-4 py-2.5 text-left text-[var(--fs-sm)] font-bold text-green-700 active:bg-green-50">
                    {'\uD83D\uDCCD'} Arrange spots
                  </button>
                  <button onClick={() => setConfirmDelete(tpl)}
                    className="px-4 py-2.5 text-[var(--fs-sm)] font-bold text-red-600 active:bg-red-50 border-l border-gray-100">
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
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="text-[var(--fs-lg)] font-bold text-gray-900 mb-1">Delete this list?</h3>
            <p className="text-[var(--fs-sm)] text-gray-500 mb-4">
              <span className="font-semibold text-gray-700">{confirmDelete.name}</span> and all of its counts will be permanently removed. This can{'\''}t be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-bold active:bg-gray-200">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold active:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
