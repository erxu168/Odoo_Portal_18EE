'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Reset failed.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Could not connect. Try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="flex-1 px-6 py-8 text-center">
        <div className="text-4xl mb-4">\u26A0\uFE0F</div>
        <h2 className="text-[20px] font-bold text-gray-900 mb-2">Invalid link</h2>
        <p className="text-[14px] text-gray-500 mb-6">This reset link is invalid or has expired.</p>
        <button
          onClick={() => router.push('/forgot-password')}
          className="w-full h-14 rounded-xl bg-orange-500 text-white font-bold text-[16px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all"
        >
          Request a new link
        </button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex-1 px-6 py-8 text-center">
        <div className="text-4xl mb-4">\u2705</div>
        <h2 className="text-[20px] font-bold text-gray-900 mb-2">Password reset</h2>
        <p className="text-[14px] text-gray-500 mb-6">Your password has been changed. You can now sign in.</p>
        <button
          onClick={() => router.push('/login')}
          className="w-full h-14 rounded-xl bg-orange-500 text-white font-bold text-[16px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 px-6 py-8">
      <h2 className="text-[20px] font-bold text-gray-900 mb-1">Set new password</h2>
      <p className="text-[13px] text-gray-500 mb-6">Choose a new password for your account.</p>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoFocus
            className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
          />
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">Confirm password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
            className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !password || !confirmPassword}
          className="w-full h-14 rounded-xl bg-orange-500 text-white font-bold text-[16px] shadow-lg shadow-orange-500/30 active:scale-[0.975] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Set new password'
          )}
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-6 pt-20 pb-10 text-center relative overflow-hidden">
        <div className="absolute -top-10 right-1/4 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.2)_0%,transparent_70%)]" />
        <div className="relative">
          <div className="text-[28px] font-bold text-white tracking-tight">KRAWINGS</div>
          <div className="text-[13px] text-white/40 mt-1 tracking-wider">SSAM KOREAN BBQ</div>
        </div>
      </div>
      <Suspense fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
        </div>
      }>
        <ResetForm />
      </Suspense>
    </div>
  );
}
