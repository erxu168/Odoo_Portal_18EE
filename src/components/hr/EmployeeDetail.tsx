"use client";

import React, { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import type { EmployeeData } from "@/types/hr";
import { EMPLOYEE_READ_FIELDS, DOCUMENT_TYPES, calculateOnboardingPercent } from "@/types/hr";

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
}

export default function EmployeeDetail({ employeeId, onBack }: Props) {
  const [emp, setEmp] = useState<EmployeeData | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [empRes, docRes] = await Promise.all([
          fetch("/api/hr/employees"),
          fetch("/api/hr/documents?employee_id=" + employeeId),
        ]);
        if (empRes.ok) {
          const data = await empRes.json();
          const found = (data.employees || []).find((e: EmployeeData) => e.id === employeeId);
          setEmp(found || null);
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
      <div className="min-h-screen bg-[#f8faf9]">
        <AppHeader title="Employee" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="min-h-screen bg-[#f8faf9]">
        <AppHeader title="Employee" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Employee not found.</div>
      </div>
    );
  }

  const pct = calculateOnboardingPercent(emp);
  const initials = emp.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const dept = emp.department_id ? (emp.department_id as [number, string])[1] : "";

  function hasDoc(key: string): boolean {
    return docs.some((d) => d.doc_type_key === key);
  }

  return (
    <div className="min-h-screen bg-[#f8faf9] pb-40">
      <AppHeader title={emp.name} showBack onBack={onBack} />

      <div className="bg-white px-5 py-4 flex items-center gap-3.5 border-b border-gray-200">
        <div className="w-14 h-14 rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[20px] flex-shrink-0">
          {initials}
        </div>
        <div>
          <div className="text-[18px] font-bold">{emp.name}</div>
          <div className="text-[13px] text-gray-500">{dept}{emp.kw_beschaeftigungsbeginn ? " \u00B7 Started " + emp.kw_beschaeftigungsbeginn : ""}</div>
          <div className="flex gap-1.5 mt-1.5">
            <span className={"inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold " + (pct === 100 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700")}>{pct}% complete</span>
            {docs.length < 5 && <span className="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600">Missing docs</span>}
          </div>
        </div>
      </div>

      <STitle text="DATEV / Personalfragebogen" />
      <Section title="Personal">
        <Row label="Birthday" value={emp.birthday || ""} mono />
        <Row label="Gender" value={emp.gender || ""} />
        <Row label="Nationality" value={emp.country_id ? (emp.country_id as [number, string])[1] : ""} />
        <Row label="Place of birth" value={emp.place_of_birth || ""} />
        <Row label="Marital" value={emp.marital || ""} />
        <Row label="Address" value={[emp.private_street, emp.private_zip, emp.private_city].filter(Boolean).join(", ")} />
      </Section>

      <Section title="Tax">
        <Row label="Tax ID" value={emp.kw_steuer_id || ""} mono />
        <Row label="Tax class" value={emp.kw_steuerklasse ? "Class " + emp.kw_steuerklasse : ""} />
        <Row label="Church tax" value={emp.kw_konfession === "--" ? "None" : emp.kw_konfession || ""} />
        <Row label="IBAN" value={emp.bank_account_id ? "On file" : ""} />
      </Section>

      <Section title="Insurance">
        <Row label="SV-Nr." value={emp.ssnid || ""} mono />
        <Row label="Krankenkasse" value={emp.kw_krankenkasse_name || ""} />
        <Row label="Type" value={emp.kw_kv_typ || ""} />
      </Section>

      <Section title="Residence">
        <Row label="Permit type" value={emp.kw_aufenthaltstitel_typ || ""} />
        <Row label="Visa expires" value={emp.visa_expire || ""} mono />
        <Row label="Permit expires" value={emp.work_permit_expiration_date || ""} mono />
      </Section>

      <Section title="Gastro">
        <Row label="Health cert. date" value={emp.kw_gesundheitszeugnis_datum || ""} mono />
        <Row label="Health cert. expires" value={emp.kw_gesundheitszeugnis_ablauf || ""} mono />
        <Row label="Sofortmeldung" value={emp.kw_sofortmeldung_done ? "Done" : ""} />
      </Section>

      <STitle text="Documents" />
      <div className="px-5 space-y-2 pb-4">
        {DOCUMENT_TYPES.map((dt) => {
          const uploaded = hasDoc(dt.key);
          return (
            <div key={dt.key} className={"flex items-center gap-3 p-3 rounded-xl border " + (uploaded ? "border-green-600 bg-green-50" : "border-gray-200 bg-white")}>
              <div className={"w-10 h-10 rounded-lg flex items-center justify-center text-[20px] " + (uploaded ? "bg-green-100" : "bg-gray-100")}>
                {dt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold">{dt.label}</div>
                {uploaded ? (
                  <div className="text-[11px] text-green-600 font-medium">Uploaded</div>
                ) : (
                  <div className="text-[11px] text-gray-400">{dt.required ? "Required - Missing" : "Optional"}</div>
                )}
              </div>
              {uploaded ? (
                <span className="text-green-600 text-lg">{"\u2713"}</span>
              ) : dt.required ? (
                <span className="text-red-500 text-[13px] font-semibold">!</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button className="flex-1 py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">
          Export DATEV
        </button>
        <button className="flex-1 py-4 bg-green-600 text-white font-semibold rounded-xl active:opacity-85">
          Approve Data
        </button>
      </div>
    </div>
  );
}

function STitle({ text }: { text: string }) {
  return <div className="px-5 pt-4 pb-1 text-[11px] font-bold tracking-widest uppercase text-gray-400">{text}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200 mb-3">
      <div className="text-[13px] font-bold text-gray-400 uppercase tracking-wider mb-2">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={"text-[13px] font-medium text-right max-w-[55%] " + (mono ? "font-mono " : "") + (missing ? "text-red-500 italic" : "")}>
        {missing ? "Missing" : value}
      </span>
    </div>
  );
}
