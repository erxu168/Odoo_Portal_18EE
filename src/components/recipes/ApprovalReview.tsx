'use client';

import React, { useState, useEffect, useRef } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface StepData {
  id: number; sequence: number; step_type: string; instruction: string;
  timer_seconds: number; tip: string; image_count: number;
}

interface Props {
  versionId: number;
  recipeName: string;
  productTmplId?: number;
  bomId?: number;
  changeSummary: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onBack: () => void;
  approving: boolean;
}

const TYPE_EMOJI: Record<string, string> = { prep: '\ud83d\udd2a', cook: '\ud83d\udd25', plate: '\ud83c\udf7d\ufe0f' };

// FIX S3: Safe text rendering instead of dangerouslySetInnerHTML
function renderSafeHtml(html: string): React.ReactNode {
  if (!html) return null;
  // Strip all tags except <b>, render bold as <strong>
  const cleaned = html.replace(/<\/?p>/gi, '').replace(/<br\s*\/?>/gi, ' ');
  const parts = cleaned.split(/(<b>.*?<\/b>)/gi);
  return parts.map((part, i) => {
    const boldMatch = part.match(/^<b>(.*?)<\/b>$/i);
    if (boldMatch) return <strong key={i} className="font-bold">{boldMatch[1]}</strong>;
    // Strip any remaining HTML tags
    const safe = part.replace(/<[^>]*>/g, '');
    return <span key={i}>{safe}</span>;
  });
}

export default function ApprovalReview({ recipeName, productTmplId, bomId, changeSummary, onApprove, onReject, onBack, approving }: Props) {
  const [steps, setSteps] = useState<StepData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrolledAll, setScrolledAll] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const param = productTmplId ? `product_tmpl_id=${productTmplId}` : `bom_id=${bomId}`;
        const res = await fetch(`/api/recipes/steps?${param}`);
        if (res.ok) {
          const data = await res.json();
          setSteps(data.steps || []);
          if ((data.steps || []).length <= 3) setScrolledAll(true);
        }
      } catch (e) { console.error('Load error:', e); }
      finally { setLoading(false); }
    }
    load();
  }, [productTmplId, bomId]);

  // FIX L5: Use IntersectionObserver instead of scroll math
  useEffect(() => {
    if (!sentinelRef.current || steps.length <= 3) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setScrolledAll(true);
    }, { threshold: 0.1 });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [steps]);

  function handleApprove() {
    setShowApproveConfirm(true);
  }

  function handleReject() {
    if (!rejectReason.trim()) return;
    onReject(rejectReason.trim());
  }

  const totalTime = steps.reduce((s, st) => s + (st.timer_seconds || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Review Recipe</h1>
            <p className="text-[12px] text-white/50 mt-0.5">Pending approval</p>
          </div>
        </div>
      </div>
      <div ref={listRef} className="px-5 pt-4 pb-36 flex-1 overflow-y-auto">
        {changeSummary && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-[13px] text-amber-900">{changeSummary}</div>
        )}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <h2 className="text-[16px] font-bold text-gray-900">{recipeName}</h2>
          <div className="flex gap-4 mt-2 text-[12px] text-gray-500">
            <span>{steps.length} steps</span>
            <span>{totalTime > 0 ? `${Math.ceil(totalTime / 60)} min` : 'No timers'}</span>
          </div>
        </div>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && (
          <div>
            {!scrolledAll && steps.length > 3 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3 text-[12px] text-blue-800 text-center">
                Scroll through all steps to enable approval
              </div>
            )}
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-[14px] flex-shrink-0">
                      {TYPE_EMOJI[step.step_type] || '\ud83d\udc68\u200d\ud83c\udf73'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-bold text-gray-500">Step {i + 1}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{step.step_type}</span>
                        {step.timer_seconds > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">{Math.ceil(step.timer_seconds / 60)}m</span>}
                      </div>
                      <div className="text-[13px] text-gray-800">{renderSafeHtml(step.instruction)}</div>
                      {step.tip && <div className="text-[11px] text-amber-600 mt-1">{'\ud83d\udca1'} {step.tip}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Sentinel element for IntersectionObserver */}
            <div ref={sentinelRef} className="h-1" />
          </div>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        {!showReject ? (
          <div className="flex gap-3">
            <button onClick={() => setShowReject(true)}
              className="flex-1 py-3.5 rounded-2xl text-[15px] font-bold text-red-600 border border-red-200 bg-red-50 active:bg-red-100">Reject</button>
            <button onClick={handleApprove} disabled={!scrolledAll || approving}
              className={`flex-1 py-3.5 rounded-2xl text-[15px] font-bold text-white transition-all ${
                scrolledAll && !approving ? 'bg-green-600 active:bg-green-700 shadow-lg' : 'bg-gray-300 cursor-not-allowed'
              }`}>{approving ? 'Approving...' : scrolledAll ? 'Approve' : 'Scroll to approve'}</button>
          </div>
        ) : (
          <div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (required)..." rows={2}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[14px] mb-3 resize-none" />
            <div className="flex gap-3">
              <button onClick={() => { setShowReject(false); setRejectReason(''); }}
                className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-gray-600 border border-gray-200 active:bg-gray-50">Cancel</button>
              <button onClick={handleReject} disabled={!rejectReason.trim() || approving}
                className={`flex-1 py-3 rounded-2xl text-[14px] font-bold text-white ${
                  rejectReason.trim() ? 'bg-red-600 active:bg-red-700' : 'bg-gray-300'
                }`}>{approving ? 'Rejecting...' : 'Confirm reject'}</button>
            </div>
          </div>
        )}
      </div>
      {showApproveConfirm && (
        <ConfirmDialog
          title="Approve this recipe?"
          message="It will be published and visible to all cooks."
          confirmLabel="Approve"
          cancelLabel="Cancel"
          variant="primary"
          onConfirm={() => { setShowApproveConfirm(false); onApprove(); }}
          onCancel={() => setShowApproveConfirm(false)}
        />
      )}
    </div>
  );
}
