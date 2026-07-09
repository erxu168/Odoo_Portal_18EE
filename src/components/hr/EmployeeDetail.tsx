"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/ui/AppHeader";
import DocumentViewer from "@/components/ui/DocumentViewer";
import type { EmployeeData } from "@/types/hr";
import { EMPLOYEE_READ_FIELDS, DOCUMENT_TYPES, calculateOnboardingPercent, aufenthaltstitelLabel } from "@/types/hr";

interface Doc {
  id: number;
  name: string;
  doc_type_key: string;
  size_kb: number;
}

interface Props {
  employeeId: number;
  onBack: () => void;
  onHome: () => void;
  onContract: () => void;
  onDeactivated: () => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  onEditSection: (section: string) => void;
  onEditDocument: (docTypeKey: string) => void;
}

export default function EmployeeDetail({ employeeId, onBack, onContract, onDeactivated, editMode, onToggleEditMode, onEditSection, onEditDocument }: Props) {
  const router = useRouter();
  const [emp, setEmp] = useState<EmployeeData | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deactivating, setDeactivating] = useState(false);
  const [viewerData, setViewerData] = useState<{ base64: string; mimetype: string; name: string } | null>(null);
  const [openingDocId, setOpeningDocId] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [empRes, docRes] = await Promise.all([
          fetch("/api/hr/employee/" + employeeId),
          fetch("/api/hr/documents?employee_id=" + employeeId),
        ]);
        if (empRes.ok) {
          const data = await empRes.json();
          setEmp(data.employee || null);
        }
        if (docRes.ok) {
          const data = await docRes.json();
          setDocs(data.documents || []);
        }
      } catch (_e: unknown) {
        console.error("Failed to load employee detail");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [employeeId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Employee" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Employee" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Employee not found.</div>
      </div>
    );
  }

  const pct = calculateOnboardingPercent(emp);
  const initials = emp.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const dept = emp.department_id ? (emp.department_id as [number, string])[1] : "";

  function docFor(key: string): Doc | undefined {
    return docs.find((d) => d.doc_type_key === key);
  }

  async function handleOpenDoc(doc: Doc) {
    setOpeningDocId(doc.id);
    try {
      const res = await fetch("/api/hr/documents/" + doc.id);
      if (!res.ok) throw new Error("open failed");
      const data = await res.json();
      setViewerData({ base64: data.data_base64, mimetype: data.mimetype, name: data.name || doc.name });
    } catch (_e: unknown) {
      window.alert("Could not open this document.");
    } finally {
      setOpeningDocId(null);
    }
  }

  function handleOffboard() {
    router.push("/termination?employee=" + employeeId);
  }

  async function handleDeactivate() {
    if (!emp) return;
    const ok = window.confirm("Mark " + emp.name + " as left? They will be removed from your active staff. You can reactivate them later.");
    if (!ok) return;
    setDeactivating(true);
    try {
      const res = await fetch("/api/hr/employee/" + employeeId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update.");
      onDeactivated();
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Could not update.");
      setDeactivating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <AppHeader
        title={emp.name}
        showBack
        onBack={onBack}
        action={
          <button
            onClick={onToggleEditMode}
            className="px-3 py-1.5 rounded-lg bg-white/15 text-white font-bold text-[13px] active:bg-white/25"
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        }
      />
      {editMode && (
        <div className="px-5 py-2 bg-green-50 text-green-700 text-[var(--fs-xs)] font-semibold text-center">
          Tap any section or document to edit.
        </div>
      )}

      <div className="bg-white px-5 py-4 flex items-center gap-3.5 border-b border-gray-200">
        <div className="w-14 h-14 rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[var(--fs-xl)] flex-shrink-0">
          {initials}
        </div>
        <div>
          <div className="text-[var(--fs-xxl)] font-bold">{emp.name}</div>
          <div className="text-[var(--fs-sm)] text-gray-500">{dept}{emp.kw_beschaeftigungsbeginn ? " \u00B7 Started " + emp.kw_beschaeftigungsbeginn : ""}</div>
          <div className="flex gap-1.5 mt-1.5">
            <span className={"inline-flex px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold " + (pct === 100 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>{pct}% complete</span>
            {docs.length < 5 && <span className="inline-flex px-2.5 py-0.5 rounded-full text-[var(--fs-xs)] font-semibold bg-red-50 text-red-600">Missing docs</span>}
          </div>
        </div>
      </div>

      <Section title="Basics" onEdit={editMode ? () => onEditSection('basics') : undefined}>
        <Row label="Role" value={emp.job_title || ''} optional />
        <Row label="Restaurant" value={emp.company_id ? (emp.company_id as [number, string])[1] : ''} optional />
        <Row label="Department" value={dept} optional />
        <Row label="Mobile" value={emp.mobile_phone || ''} optional />
        <Row label="Work email" value={emp.work_email || ''} optional />
      </Section>

      <STitle text="DATEV / Personalfragebogen" />
      <Section title="Personal & address" onEdit={editMode ? () => onEditSection('personal') : undefined}>
        <Row label="Birthday" value={emp.birthday || ''} mono />
        <Row label="Gender" value={emp.gender || ''} />
        <Row label="Nationality" value={emp.country_id ? (emp.country_id as [number, string])[1] : ''} />
        <Row label="Place of birth" value={emp.place_of_birth || ''} />
        <Row label="Marital" value={emp.marital || ''} />
        <Row label="Address" value={[emp.private_street, emp.private_zip, emp.private_city].filter(Boolean).join(', ')} />
      </Section>

      <Section title="Tax" onEdit={editMode ? () => onEditSection('tax') : undefined}>
        <Row label="Tax ID" value={emp.kw_steuer_id || ''} mono />
        <Row label="Tax class" value={emp.kw_steuerklasse ? 'Class ' + emp.kw_steuerklasse : ''} />
        <Row label="Church tax" value={emp.kw_konfession === '--' ? 'None' : emp.kw_konfession || ''} />
      </Section>

      <Section title="Bank" onEdit={editMode ? () => onEditSection('bank') : undefined}>
        <Row label="IBAN" value={emp.bank_account_id ? 'On file' : ''} optional />
      </Section>

      <Section title="Insurance" onEdit={editMode ? () => onEditSection('insurance') : undefined}>
        <Row label="SV-Nr." value={emp.ssnid || ''} mono />
        <Row label="Krankenkasse" value={emp.kw_krankenkasse_name || ''} />
        <Row label="Type" value={emp.kw_kv_typ || ''} />
      </Section>

      <Section title="Residence & work" onEdit={editMode ? () => onEditSection('residence') : undefined}>
        <Row label="Permit type" value={aufenthaltstitelLabel(emp.kw_aufenthaltstitel_typ)} optional />
        <Row label="Exact permit / paragraph" value={emp.kw_aufenthaltstitel_paragraph || ''} optional />
        <Row label="Visa expires" value={emp.visa_expire || ''} mono optional />
        <Row label="Permit expires" value={emp.work_permit_expiration_date || ''} mono optional />
        <Row label="Health cert. date" value={emp.kw_gesundheitszeugnis_datum || ''} mono />
        <Row label="Health cert. expires" value={emp.kw_gesundheitszeugnis_ablauf || ''} mono />
        <Row label="Sofortmeldung" value={emp.kw_sofortmeldung_done ? 'Done' : ''} />
      </Section>

      <STitle text="Documents" />
      <div className="px-5 space-y-2 pb-4">
        {DOCUMENT_TYPES.filter((dt) => !dt.studentOnly || (emp as unknown as { is_university_student?: boolean }).is_university_student === true).map((dt) => {
          const doc = docFor(dt.key);
          const uploaded = !!doc;
          const opening = uploaded && openingDocId === doc!.id;
          return (
            <button
              key={dt.key}
              type="button"
              disabled={editMode ? false : !uploaded}
              onClick={editMode ? () => onEditDocument(dt.key) : (uploaded ? () => handleOpenDoc(doc!) : undefined)}
              className={"w-full text-left flex items-center gap-3 p-3 rounded-xl border disabled:cursor-default " + (uploaded ? "border-green-600 bg-green-50 active:bg-green-100" : (editMode ? "border-gray-300 bg-white active:bg-gray-50" : "border-gray-200 bg-white"))}
            >
              <div className={"w-10 h-10 rounded-lg flex items-center justify-center text-[var(--fs-xl)] " + (uploaded ? "bg-green-100" : "bg-gray-100")}>
                {dt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-sm)] font-semibold">{dt.label}</div>
                {uploaded ? (
                  <div className="text-[var(--fs-xs)] text-green-600 font-medium">{editMode ? 'Uploaded · Tap to replace or delete' : 'Uploaded · Tap to view'}</div>
                ) : (
                  <div className="text-[var(--fs-xs)] text-gray-400">{editMode ? (dt.required ? 'Required · Tap to upload' : 'Tap to upload') : (dt.required ? 'Required - Missing' : 'Optional')}</div>
                )}
              </div>
              {editMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
              ) : uploaded ? (
                opening ? (
                  <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )
              ) : dt.required ? (
                <span className="text-red-500 text-[var(--fs-sm)] font-semibold">!</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="px-5 pt-4 pb-8 space-y-2.5">
        <button onClick={onContract} className="w-full py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85 flex items-center justify-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="12" y1="17" x2="8" y2="17"/></svg>
          Contract &amp; hours
        </button>
        <div className="flex gap-3">
          <button onClick={handleOffboard} className="flex-1 py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
            Offboard / Terminate
          </button>
          <button onClick={handleDeactivate} disabled={deactivating} className="flex-1 py-3.5 bg-white text-red-600 font-bold text-[var(--fs-sm)] rounded-xl border border-red-200 active:opacity-85 disabled:opacity-50">
            {deactivating ? "…" : "Mark as left"}
          </button>
        </div>
      </div>

      {viewerData && (
        <DocumentViewer
          base64={viewerData.base64}
          mimetype={viewerData.mimetype}
          name={viewerData.name}
          onClose={() => setViewerData(null)}
        />
      )}
    </div>
  );
}

function STitle({ text }: { text: string }) {
  return <div className="px-5 pt-4 pb-1 text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400">{text}</div>;
}

function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[var(--fs-sm)] font-bold text-gray-400 uppercase tracking-wider">{title}</div>
        {onEdit && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
        )}
      </div>
      {children}
    </>
  );
  return (
    <div className="mx-5 mb-3">
      {onEdit ? (
        <button type="button" onClick={onEdit} className="w-full text-left bg-white rounded-2xl p-4 border border-green-600 active:bg-green-50">{body}</button>
      ) : (
        <div className="bg-white rounded-2xl p-4 border border-gray-200">{body}</div>
      )}
    </div>
  );
}

function Row({ label, value, mono, optional }: { label: string; value: string; mono?: boolean; optional?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[var(--fs-sm)] text-gray-500">{label}</span>
      <span className={"text-[var(--fs-sm)] font-medium text-right max-w-[55%] " + (mono ? "font-mono " : "") + (missing && !optional ? "text-red-500 italic" : "") + (missing && optional ? "text-gray-300" : "")}>
        {missing ? (optional ? "—" : "Missing") : value}
      </span>
    </div>
  );
}
