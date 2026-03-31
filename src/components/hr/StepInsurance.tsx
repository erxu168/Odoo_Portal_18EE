"use client";

import React, { useState } from "react";
import InfoButton from "@/components/hr/InfoButton";
import type { EmployeeData } from "@/types/hr";
import { FIELD_EXPLAINERS } from "@/types/hr";

interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
}

export default function StepInsurance({ employee, onNext, onPrev, saving }: Props) {
  const [svNr, setSvNr] = useState(employee.ssnid || "");
  const [kkName, setKkName] = useState(employee.kw_krankenkasse_name || "");
  const [kvTyp, setKvTyp] = useState(employee.kw_kv_typ || "");
  const [acknowledged, setAcknowledged] = useState(false);

  const ex = FIELD_EXPLAINERS;

  function handleSubmit() {
    onNext({
      ssnid: svNr || false,
      kw_krankenkasse_name: kkName || false,
      kw_kv_typ: kvTyp || false,
    });
  }

  return (
    <div className="pb-40">
      <div className="p-5 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-500 uppercase tracking-wide">Social security number</span>
            <span className="text-[var(--fs-xs)] text-gray-400">(SV-Nummer)</span>
            <InfoButton title={ex.ssnid.title} text={ex.ssnid.text} url={ex.ssnid.url} urlLabel={ex.ssnid.urlLabel} />
          </div>
          <input className="form-input font-mono" value={svNr} onChange={e => setSvNr(e.target.value)} placeholder="e.g. 12 010194 Z 123" />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-500 uppercase tracking-wide">Health insurance</span>
            <span className="text-[var(--fs-xs)] text-gray-400">(Krankenkasse)</span>
            <InfoButton title={ex.kw_krankenkasse_name.title} text={ex.kw_krankenkasse_name.text} url={ex.kw_krankenkasse_name.url} urlLabel={ex.kw_krankenkasse_name.urlLabel} />
          </div>
          <input className="form-input" value={kkName} onChange={e => setKkName(e.target.value)} placeholder="e.g. Techniker Krankenkasse (TK)" />
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[var(--fs-sm)] font-semibold text-gray-500 uppercase tracking-wide">Insurance type</span>
          </div>
          <select className="form-input" value={kvTyp} onChange={e => setKvTyp(e.target.value as any)}>
            <option value="">Select type...</option>
            <option value="gesetzlich">Public insurance (Gesetzlich / GKV)</option>
            <option value="privat">Private insurance (Privat / PKV)</option>
            <option value="geringfuegig">Mini-job (employer-only contributions)</option>
          </select>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4 text-[var(--fs-sm)] text-amber-800 flex items-start gap-2">
          <span className="text-lg leading-none">&#9888;</span>
          <div>
            <strong>Important:</strong> Health insurance is mandatory in Germany. You must register with a public health insurer (e.g. TK, AOK, BARMER) or provide proof of other valid health insurance before your first payroll. Without proof of coverage, your employer cannot process your salary. Most employees do not meet the conditions for private insurance (PKV) and must join a public insurer (GKV). For mini-job employees (up to 603 EUR/month as of 2026): your employer pays a flat-rate health contribution, but this does NOT cover you. You must have your own health insurance (e.g. family insurance, student insurance, or voluntary public insurance) and provide proof.
            <a href="https://www.nomadenberlin.com/working-in-berlin" target="_blank" rel="noopener noreferrer" className="block mt-1.5 text-blue-600 font-semibold no-underline">Learn about health insurance for workers in Berlin &rarr;</a>
          </div>
        </div>
        <label className="flex items-start gap-3 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            className="w-5 h-5 mt-0.5 rounded border-gray-300 text-green-600 accent-green-600 flex-shrink-0"
          />
          <span className="text-[var(--fs-sm)] text-gray-700">I confirm that I have read and understood the health insurance requirements above and will provide proof of valid health insurance to my employer.</span>
        </label>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleSubmit} disabled={saving || !acknowledged} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
