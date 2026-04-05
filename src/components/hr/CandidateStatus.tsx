'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { parseOdooDate } from '@/lib/odoo';

interface StageInfo {
  key: string;
  label: string;
}

interface StatusData {
  name: string;
  job: { id: number; name: string } | null;
  department: { id: number; name: string } | null;
  stage: { key: string; label: string; index: number };
  pipeline: StageInfo[];
  gates: { can_view_status: boolean; can_onboard: boolean; is_hired: boolean };
  applied_date: string | null;
}

interface ContractStatusData {
  stage: string;
  contract: { state: string; name: string; date_start: string | false; date_end: string | false } | null;
  sign_url: string | null;
}

interface Props {
  onHome: () => void;
  onStartOnboarding: () => void;
}

export default function CandidateStatus({ onHome, onStartOnboarding }: Props) {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractStatus, setContractStatus] = useState<ContractStatusData | null>(null);

  useEffect(() => {
    fetch('/api/hr/applicant/status')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/hr/contract-status')
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((d) => { if (d) setContractStatus(d); })
      .catch(() => { /* non-critical */ });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Application Status" />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Application Status" />
        <div className="p-5">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-[var(--fs-sm)] text-red-700">
            Failed to load application status.
          </div>
        </div>
      </div>
    );
  }

  const stageColors: Record<string, string> = {
    new: 'bg-gray-400',
    screening: 'bg-blue-500',
    trial_shift: 'bg-amber-500',
    hireable: 'bg-green-500',
    contract_proposal: 'bg-green-600',
    contract_signed: 'bg-green-700',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Application Status" />

      <div className="p-5">
        {/* Welcome card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="text-[var(--fs-xxl)] font-bold text-gray-900 mb-1">
            Welcome, {data.name}
          </div>
          {data.job && (
            <div className="text-[var(--fs-sm)] text-gray-600">
              Applying for: <span className="font-semibold">{data.job.name}</span>
            </div>
          )}
          {data.department && (
            <div className="text-[var(--fs-xs)] text-gray-400 mt-0.5">{data.department.name}</div>
          )}
          {data.applied_date && (
            <div className="text-[var(--fs-xs)] text-gray-400 mt-2">
              Applied: {parseOdooDate(data.applied_date)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Pipeline progress */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-4">
            Your progress
          </div>

          <div className="relative">
            {data.pipeline.map((stage, idx) => {
              const isCurrent = idx === data.stage.index;
              const isPast = idx < data.stage.index;
              const isFuture = idx > data.stage.index;
              const color = stageColors[stage.key] || 'bg-gray-300';
              const isLast = idx === data.pipeline.length - 1;

              return (
                <div key={stage.key} className="flex items-start gap-3 relative">
                  {/* Vertical line */}
                  {!isLast && (
                    <div
                      className={`absolute left-[13px] top-[26px] w-[2px] h-[calc(100%-2px)] ${isPast ? 'bg-green-400' : 'bg-gray-200'}`}
                    />
                  )}

                  {/* Circle */}
                  <div className="relative z-10 flex-shrink-0">
                    {isPast ? (
                      <div className="w-[26px] h-[26px] rounded-full bg-green-500 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </div>
                    ) : isCurrent ? (
                      <div className={`w-[26px] h-[26px] rounded-full ${color} flex items-center justify-center ring-4 ring-green-100`}>
                        <div className="w-[8px] h-[8px] rounded-full bg-white" />
                      </div>
                    ) : (
                      <div className="w-[26px] h-[26px] rounded-full bg-gray-200 flex items-center justify-center">
                        <div className="w-[8px] h-[8px] rounded-full bg-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* Label */}
                  <div className={`pb-6 ${isFuture ? 'opacity-40' : ''}`}>
                    <div className={`text-[var(--fs-md)] font-bold ${isCurrent ? 'text-gray-900' : isPast ? 'text-green-700' : 'text-gray-400'}`}>
                      {stage.label}
                    </div>
                    {isCurrent && (
                      <div className="text-[var(--fs-xs)] text-green-600 font-medium mt-0.5">
                        Current stage
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Contract signing card */}
        {contractStatus?.contract && (contractStatus.contract.state === 'draft' || contractStatus.contract.state === 'open') && (
          contractStatus.contract.state === 'open' ? (
            /* Signed contract - success card */
            <div className="bg-green-50 rounded-2xl border border-green-200 p-5 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-[var(--fs-md)] font-bold text-green-900 mb-1">
                    Contract signed
                  </div>
                  <p className="text-[var(--fs-sm)] text-green-700 leading-relaxed">
                    You can now complete your final onboarding steps.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Draft/sent contract - action card */
            <div className="bg-green-50 rounded-2xl border-[1.5px] border-green-600 p-5 mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-[var(--fs-md)] font-bold text-green-900 mb-1">
                    Your contract is ready
                  </div>
                  <p className="text-[var(--fs-sm)] text-green-800 leading-relaxed mb-3">
                    Please review and sign your employment contract.
                  </p>
                  {contractStatus.sign_url ? (
                    <a
                      href={contractStatus.sign_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3.5 bg-green-600 text-white font-semibold rounded-xl text-[var(--fs-sm)] active:opacity-85 flex items-center justify-center gap-2 no-underline"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Review &amp; Sign Contract
                    </a>
                  ) : (
                    <p className="text-[var(--fs-xs)] text-green-600 italic">
                      The signing link will appear here once your contract is sent for signature.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {/* Onboarding CTA — only when gate allows */}
        {data.gates.can_onboard && (
          <div className="bg-green-50 rounded-2xl border-[1.5px] border-green-600 p-5 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-[var(--fs-xl)] flex-shrink-0">
                {'\u{1F389}'}
              </div>
              <div className="flex-1">
                <div className="text-[var(--fs-md)] font-bold text-green-900 mb-1">
                  {data.gates.is_hired ? 'Welcome aboard!' : 'Almost there!'}
                </div>
                <p className="text-[var(--fs-sm)] text-green-800 leading-relaxed mb-3">
                  {data.gates.is_hired
                    ? 'Your contract is signed. Please complete your onboarding to get started.'
                    : 'A contract proposal has been prepared for you. You can now start your onboarding paperwork.'}
                </p>
                <button
                  onClick={onStartOnboarding}
                  className="w-full py-3.5 bg-green-600 text-white font-semibold rounded-xl text-[var(--fs-sm)] active:opacity-85 flex items-center justify-center gap-2"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <path d="M9 14l2 2 4-4" />
                  </svg>
                  Start Onboarding
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info card for early stages */}
        {!data.gates.can_onboard && (
          <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5">
            <div className="flex items-start gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <div>
                <div className="text-[var(--fs-md)] font-bold text-blue-900 mb-1">What happens next?</div>
                <p className="text-[var(--fs-xs)] text-blue-700 leading-relaxed">
                  We are reviewing your application. You will be notified when your status changes.
                  Once you reach the contract stage, you can complete your onboarding paperwork here.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
