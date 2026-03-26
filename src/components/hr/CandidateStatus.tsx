'use client';

import React, { useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';

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

interface Props {
  onHome: () => void;
  onStartOnboarding: () => void;
}

export default function CandidateStatus({ onHome, onStartOnboarding }: Props) {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8faf9]">
        <AppHeader title="Application Status" />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f8faf9]">
        <AppHeader title="Application Status" />
        <div className="p-5">
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
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
    <div className="min-h-screen bg-[#f8faf9]">
      <AppHeader title="Application Status" />

      <div className="p-5">
        {/* Welcome card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="text-[18px] font-bold text-gray-900 mb-1">
            Welcome, {data.name}
          </div>
          {data.job && (
            <div className="text-[14px] text-gray-600">
              Applying for: <span className="font-semibold">{data.job.name}</span>
            </div>
          )}
          {data.department && (
            <div className="text-[12px] text-gray-400 mt-0.5">{data.department.name}</div>
          )}
          {data.applied_date && (
            <div className="text-[11px] text-gray-400 mt-2">
              Applied: {new Date(data.applied_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Pipeline progress */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="text-[11px] font-bold tracking-widest uppercase text-gray-400 mb-4">
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
                    <div className={`text-[14px] font-semibold ${isCurrent ? 'text-gray-900' : isPast ? 'text-green-700' : 'text-gray-400'}`}>
                      {stage.label}
                    </div>
                    {isCurrent && (
                      <div className="text-[12px] text-green-600 font-medium mt-0.5">
                        Current stage
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Onboarding CTA — only when gate allows */}
        {data.gates.can_onboard && (
          <div className="bg-green-50 rounded-2xl border-[1.5px] border-green-600 p-5 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-[20px] flex-shrink-0">
                {'\u{1F389}'}
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-bold text-green-900 mb-1">
                  {data.gates.is_hired ? 'Welcome aboard!' : 'Almost there!'}
                </div>
                <p className="text-[13px] text-green-800 leading-relaxed mb-3">
                  {data.gates.is_hired
                    ? 'Your contract is signed. Please complete your onboarding to get started.'
                    : 'A contract proposal has been prepared for you. You can now start your onboarding paperwork.'}
                </p>
                <button
                  onClick={onStartOnboarding}
                  className="w-full py-3.5 bg-green-600 text-white font-semibold rounded-xl text-[14px] active:opacity-85 flex items-center justify-center gap-2"
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
                <div className="text-[14px] font-semibold text-blue-900 mb-1">What happens next?</div>
                <p className="text-[12px] text-blue-700 leading-relaxed">
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
