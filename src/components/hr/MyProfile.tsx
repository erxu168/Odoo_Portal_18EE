"use client";

import React, { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import type { EmployeeData } from "@/types/hr";
import { calculateOnboardingPercent } from "@/types/hr";

interface Props {
  onBack: () => void;
  onHome: () => void;
  onEdit: () => void;
}

export default function MyProfile({ onBack, onEdit }: Props) {
  const [emp, setEmp] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoLoaded, setPhotoLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/hr/employee")
      .then((r) => r.json())
      .then((d) => setEmp(d.employee))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="My Profile" showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="My Profile" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Could not load profile.</div>
      </div>
    );
  }

  const pct = calculateOnboardingPercent(emp);
  const initials = emp.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const dept = emp.department_id ? (emp.department_id as [number, string])[1] : "No department";
  const isComplete = emp.kw_onboarding_status === "complete";

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <AppHeader title="My Profile" showBack onBack={onBack} />

      <div className="bg-white px-5 py-6 text-center border-b border-gray-200">
        <div className="w-[80px] h-[80px] rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold text-[26px] mx-auto mb-3 overflow-hidden border-3 border-green-100">
          {photoLoaded ? (
            <img src="/api/hr/employee/photo" alt="" className="w-full h-full object-cover" />
          ) : (
            initials
          )}
          <img src="/api/hr/employee/photo" alt="" className="hidden" onLoad={() => setPhotoLoaded(true)} onError={() => setPhotoLoaded(false)} />
        </div>
        <div className="text-[20px] font-bold">{emp.name}</div>
        <div className="text-[14px] text-gray-500">{dept}</div>
        <div className="flex gap-2 justify-center mt-2.5">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700">Onboarding complete</span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700">{pct}% complete</span>
          )}
        </div>
      </div>

      <SectionTitle text="Personal" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Birthday" value={emp.birthday || ""} mono />
        <Row label="Gender" value={emp.gender || ""} />
        <Row label="Nationality" value={emp.country_id ? (emp.country_id as [number, string])[1] : ""} />
        <Row label="Marital status" value={emp.marital || ""} />
        <Row label="Address" value={[emp.private_street, emp.private_zip, emp.private_city].filter(Boolean).join(", ")} />
        <Row label="Phone" value={emp.private_phone || ""} mono />
        <Row label="Email" value={emp.private_email || emp.work_email || ""} />
      </div>

      <SectionTitle text="Tax & Insurance" />
      <div className="mx-5 bg-white rounded-2xl p-4 border border-gray-200">
        <Row label="Tax ID" value={emp.kw_steuer_id || ""} mono />
        <Row label="Tax class" value={emp.kw_steuerklasse ? "Class " + emp.kw_steuerklasse : ""} />
        <Row label="SV-Nr." value={emp.ssnid || ""} mono />
        <Row label="Krankenkasse" value={emp.kw_krankenkasse_name || ""} />
        <Row label="IBAN" value={emp.bank_account_id ? "On file" : ""} />
        <Row label="Visa expires" value={emp.visa_expire || ""} mono />
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent">
        <button onClick={onEdit} className="w-full py-4 bg-white text-gray-900 font-semibold rounded-xl border border-gray-200 active:opacity-85">
          Edit my information
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <div className="px-5 pt-4 pb-1 text-[11px] font-bold tracking-widest uppercase text-gray-400">{text}</div>;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={"text-[13px] font-medium text-right max-w-[55%] " + (mono ? "font-mono " : "") + (missing ? "text-red-500 italic" : "")}>
        {missing ? "Not provided" : value}
      </span>
    </div>
  );
}
