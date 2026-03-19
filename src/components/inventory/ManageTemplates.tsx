'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FilterBar, FilterPill, StatusBadge, Spinner, EmptyState, SectionTitle } from './ui';
import TemplateForm from './TemplateForm';

interface ManageTemplatesProps {
  onBack: () => void;
}

export default function ManageTemplates({ onBack }: ManageTemplatesProps) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locFilter, setLocFilter] = useState('all');
  const [assignFilter, setAssignFilter] = useState('all');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, locRes] = await Promise.all([
        fetch('/api/inventory/templates').then((r) => r.json()),
        fetch('/api/inventory/locations').then((r) => r.json()),
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
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
    if (tpl.assign_type === 'person') return `Person #${tpl.assign_id}`;
    if (tpl.assign_type === 'department') {
      const dept = departments.find((d: any) => d.id === tpl.assign_id);
      return dept?.name || `Dept #${tpl.assign_id}`;
    }
    if (tpl.assign_type === 'shift') return `Shift #${tpl.assign_id}`;
    return 'Anyone';
  }

  async function handleSave(data: any) {
    try {
      if (data.id) {
        await fetch('/api/inventory/templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } else {
        await fetch('/api/inventory/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
      setEditing(null);
      setCreating(false);
      fetchData();
    } catch (err) {
      console.error('Save failed:', err);
    }
  }

  // Show form
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
          className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all">
          + New counting list
        </button>
      </div>

      {/* Location filter */}
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
                <button key={tpl.id} onClick={() => setEditing(tpl)}
                  className="bg-white border border-gray-200 rounded-2xl p-4 text-left active:scale-[0.98] transition-all">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[15px] font-bold text-gray-900">{tpl.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${tpl.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {tpl.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="text-[12px] text-gray-500 mb-2">{locName(tpl.location_id)}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={tpl.frequency} />
                    {tpl.assign_type && (
                      <StatusBadge status={tpl.assign_type} label={`${tpl.assign_type}: ${assignLabel(tpl)}`} />
                    )}
                    {catCount > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 font-semibold">
                        {catCount} categories
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
