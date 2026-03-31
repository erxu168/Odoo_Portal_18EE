"use client";

import React, { useState } from "react";

interface Props {
  onNext: () => void;
  onPrev: () => void;
}

interface SecondaryJob {
  id: number;
  type: string;
  employerName: string;
  industry: string;
  weeklyHours: string;
  schedule: string;
  startDate: string;
  isMinijob: boolean;
  isSelfEmployed: boolean;
  description: string;
}

let _nextJobId = 1;

export default function StepConcurrentEmployment({ onNext, onPrev }: Props) {
  const [hasSecondary, setHasSecondary] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<SecondaryJob[]>([]);
  const [editing, setEditing] = useState<SecondaryJob | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function addJob() {
    setEditing({
      id: _nextJobId++,
      type: "",
      employerName: "",
      industry: "",
      weeklyHours: "",
      schedule: "",
      startDate: "",
      isMinijob: false,
      isSelfEmployed: false,
      description: "",
    });
  }

  function saveJob(job: SecondaryJob) {
    setJobs((prev) => {
      const existing = prev.find((j) => j.id === job.id);
      if (existing) return prev.map((j) => (j.id === job.id ? job : j));
      return [...prev, job];
    });
    setEditing(null);
  }

  function removeJob(id: number) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const canContinue = hasSecondary === false || (hasSecondary === true && jobs.length > 0 && confirmed);

  // --- Editing form ---
  if (editing) {
    return (
      <div className="pb-40">
        <div className="p-5 space-y-4">
          <h3 className="text-[var(--fs-md)] font-bold text-gray-900">Secondary employment details</h3>
          <p className="text-[var(--fs-xs)] text-gray-500">
            Please provide details about your concurrent employment. This information is required by German working time law (ArbZG).
          </p>

          <FormField label="Type of activity" labelDe="Art der Tätigkeit">
            <select className="form-input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              <option value="">Select...</option>
              <option value="employed">Employed (angestellt)</option>
              <option value="minijob">Minijob (geringfügig)</option>
              <option value="self_employed">Self-employed (selbständig)</option>
              <option value="freelance">Freelance (freiberuflich)</option>
              <option value="volunteer">Volunteer (ehrenamtlich)</option>
            </select>
          </FormField>

          <FormField label="Employer / Client name" labelDe="Arbeitgeber">
            <input className="form-input" value={editing.employerName} onChange={(e) => setEditing({ ...editing, employerName: e.target.value })} placeholder="Company or client name" />
          </FormField>

          <FormField label="Industry" labelDe="Branche">
            <select className="form-input" value={editing.industry} onChange={(e) => setEditing({ ...editing, industry: e.target.value })}>
              <option value="">Select...</option>
              <option value="food_gastro">Food & Gastronomy</option>
              <option value="retail">Retail</option>
              <option value="it_tech">IT & Technology</option>
              <option value="education">Education & Training</option>
              <option value="healthcare">Healthcare</option>
              <option value="logistics">Logistics & Delivery</option>
              <option value="creative">Creative & Media</option>
              <option value="construction">Construction</option>
              <option value="office">Office & Administration</option>
              <option value="other">Other</option>
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Weekly hours" labelDe="Wochenstunden">
              <input className="form-input font-mono" type="number" min="0" max="48" value={editing.weeklyHours} onChange={(e) => setEditing({ ...editing, weeklyHours: e.target.value })} placeholder="e.g. 10" />
            </FormField>
            <FormField label="Start date" labelDe="Beginn">
              <input className="form-input font-mono" type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} />
            </FormField>
          </div>

          <FormField label="Work schedule" labelDe="Arbeitszeiten">
            <input className="form-input" value={editing.schedule} onChange={(e) => setEditing({ ...editing, schedule: e.target.value })} placeholder="e.g. Saturdays 10-16, some evenings" />
          </FormField>

          <FormField label="Description of tasks" labelDe="Beschreibung">
            <textarea className="form-input min-h-[80px]" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Brief description of what you do..." />
          </FormField>

          {editing.type === "minijob" && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-[var(--fs-xs)] text-blue-800">
                <strong>Minijob note:</strong> The first Minijob alongside your main employment is exempt from social insurance contributions. Additional Minijobs are not.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditing(null)} className="flex-1 py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
              Cancel
            </button>
            <button
              onClick={() => saveJob(editing)}
              disabled={!editing.type || !editing.employerName || !editing.weeklyHours}
              className="flex-1 py-3.5 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main screen ---
  return (
    <div className="pb-40">
      <div className="p-5">
        <p className="text-[var(--fs-sm)] text-gray-500 mb-2">
          German working time law (Arbeitszeitgesetz) requires employers to know about any secondary employment to ensure combined working hours do not exceed legal limits.
        </p>

        {/* Info card */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
          <p className="text-[var(--fs-xs)] text-blue-800 leading-relaxed">
            <strong>Why we ask:</strong> Under §3 ArbZG, total working hours across all employers may not exceed 48 hours/week on average. You must also have at least 11 hours of rest between working days (§5 ArbZG). This applies to all employment combined.
          </p>
        </div>

        {/* Yes/No question */}
        <div className="text-[var(--fs-md)] font-bold text-gray-900 mb-3">
          Do you currently have any other employment or self-employment?
        </div>
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => { setHasSecondary(true); setConfirmed(false); }}
            className={"flex-1 py-3.5 font-semibold rounded-xl border-[1.5px] transition-colors " +
              (hasSecondary === true ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-900 border-gray-200 active:bg-gray-50")}
          >
            Yes
          </button>
          <button
            onClick={() => { setHasSecondary(false); setJobs([]); setConfirmed(false); }}
            className={"flex-1 py-3.5 font-semibold rounded-xl border-[1.5px] transition-colors " +
              (hasSecondary === false ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-900 border-gray-200 active:bg-gray-50")}
          >
            No
          </button>
        </div>

        {/* No secondary employment */}
        {hasSecondary === false && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
            <p className="text-[var(--fs-xs)] text-green-800">
              Thank you. If you take on any secondary employment in the future, you are obligated to notify your employer before starting.
            </p>
          </div>
        )}

        {/* Yes — show jobs list */}
        {hasSecondary === true && (
          <>
            {jobs.length > 0 && (
              <div className="mb-4 space-y-2.5">
                {jobs.map((job) => (
                  <div key={job.id} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[var(--fs-md)] font-bold text-gray-900">{job.employerName}</div>
                        <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                          {job.type === "employed" ? "Employed" : job.type === "minijob" ? "Minijob" : job.type === "self_employed" ? "Self-employed" : job.type === "freelance" ? "Freelance" : "Volunteer"} &middot; {job.weeklyHours}h/week
                        </div>
                        {job.schedule && <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{job.schedule}</div>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditing(job)} className="text-[var(--fs-xs)] text-blue-600 font-semibold active:opacity-70">Edit</button>
                        <button onClick={() => removeJob(job.id)} className="text-[var(--fs-xs)] text-red-500 font-semibold active:opacity-70">Remove</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button onClick={addJob}
              className="w-full py-3.5 bg-white border-[1.5px] border-dashed border-gray-300 rounded-xl text-[var(--fs-sm)] font-semibold text-gray-600 active:bg-gray-50 flex items-center justify-center gap-2 mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {jobs.length > 0 ? "Add another employment" : "Add secondary employment"}
            </button>

            {/* Confirmation checkboxes */}
            {jobs.length > 0 && (
              <button
                onClick={() => setConfirmed(!confirmed)}
                className="w-full flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-white text-left active:bg-gray-50"
              >
                <div className={"w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors " +
                  (confirmed ? "bg-green-600 border-green-600" : "border-gray-300 bg-white")}>
                  {confirmed && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-[var(--fs-sm)] font-semibold text-gray-900 leading-snug">I confirm the above is complete and accurate</div>
                  <p className="text-[var(--fs-xs)] text-gray-500 leading-relaxed mt-1">
                    I confirm that my combined working hours across all employment do not exceed legal limits (48h/week average). I will notify my employer of any changes to my secondary employment.
                  </p>
                </div>
              </button>
            )}
          </>
        )}
      </div>

      <div className="fixed bottom-16 left-0 right-0 max-w-[430px] mx-auto p-5 bg-gradient-to-t from-[#f8faf9] via-[#f8faf9] to-transparent flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
          Back
        </button>
        <button onClick={onNext} disabled={!canContinue}
          className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          Continue
        </button>
      </div>
    </div>
  );
}

function FormField({ label, labelDe, children }: { label: string; labelDe?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[var(--fs-sm)] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {labelDe && <span className="text-[var(--fs-xs)] text-gray-400">({labelDe})</span>}
      </div>
      {children}
    </div>
  );
}
