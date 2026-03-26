'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ChangePasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isForced = searchParams.get('forced') === '1';
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError('');
    if (!currentPw || !newPw || !confirmPw) {
      setError('All fields are required.');
      return;
    }
    if (newPw.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (!/\d/.test(newPw)) {
      setError('New password must contain at least one number.');
      return;
    }
    if (newPw !== confirmPw) {
      setError('New passwords do not match.');
      return;
    }
    if (newPw === currentPw) {
      setError('New password must be different from current password.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to change password.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#2563EB] px-6 pt-14 pb-6 relative overflow-hidden rounded-b-[28px]">
          <h1 className="text-[22px] font-bold text-white">Password Changed</h1>
        </div>
        <div className="flex-1 px-6 pt-8 flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div className="text-[18px] font-bold text-gray-900 mb-2">All set!</div>
          <div className="text-[14px] text-gray-500 text-center mb-6">Your password has been updated.</div>
          <button onClick={() => router.push(isForced ? '/hr' : '/')}
            className="w-full max-w-[320px] py-4 rounded-xl bg-green-600 text-white text-[15px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700">
            {isForced ? 'Continue to Portal' : 'Back to Home'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#2563EB] px-6 pt-14 pb-6 relative overflow-hidden rounded-b-[28px]">
        <div className="flex items-center gap-3">
          {!isForced && (
            <button onClick={() => router.back()}
              className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          <h1 className="text-[20px] font-bold text-white">Change Password</h1>
        </div>
      </div>

      <div className="flex-1 px-6 pt-6 pb-20">
        {isForced && (
          <div className="mb-4 px-4 py-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-[13px] font-semibold text-amber-800">Password change required</div>
            <div className="text-[12px] text-amber-700 mt-1">You are using a temporary password. Please set a new password to continue.</div>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Current password</label>
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">New password</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              placeholder="At least 8 characters, 1 number"
              autoComplete="new-password"
              className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20" />
          </div>

          <div>
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Confirm new password</label>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Enter new password again"
              autoComplete="new-password"
              className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20" />
          </div>

          <button onClick={handleSubmit} disabled={loading || !currentPw || !newPw || !confirmPw}
            className="w-full h-14 rounded-xl bg-green-600 text-white font-bold text-[16px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 disabled:shadow-none mt-2 flex items-center justify-center gap-2">
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Update Password'
            )}
          </button>
        </div>

        <div className="mt-6 text-[12px] text-gray-400">
          <p>Password must be at least 8 characters and contain at least one number.</p>
        </div>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    }>
      <ChangePasswordForm />
    </Suspense>
  );
}
