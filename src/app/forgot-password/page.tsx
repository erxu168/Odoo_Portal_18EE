'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok && data.error) {
        setError(data.error);
        return;
      }
      setSent(true);
    } catch {
      setError('Could not connect. Check your internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#2563EB] px-6 pt-20 pb-10 text-center relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 right-1/4 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.2)_0%,transparent_70%)]" />
        <div className="relative">
          <div className="text-[28px] font-bold text-white tracking-tight">KRAWINGS</div>
          <div className="text-[13px] text-white/40 mt-1 tracking-wider">SSAM KOREAN BBQ</div>
        </div>
      </div>

      <div className="flex-1 px-6 py-8">
        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-green-50 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4l-10 8L2 4"/>
              </svg>
            </div>
            <h2 className="text-[20px] font-bold text-gray-900 mb-2">Check your email</h2>
            <p className="text-[14px] text-gray-500 leading-relaxed mb-6">
              If an account exists for <strong>{email}</strong>, we sent a reset link. Check your inbox (and spam folder).
            </p>
            <button
              onClick={() => router.push('/login')}
              className="w-full h-14 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all"
            >
              Back to login
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => router.push('/login')}
              className="flex items-center gap-1 mb-4 text-green-700 text-[13px] font-semibold active:opacity-70"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
              Back to login
            </button>

            <h2 className="text-[20px] font-bold text-gray-900 mb-1">Reset your password</h2>
            <p className="text-[13px] text-gray-500 mb-6">Enter your email and we will send you a reset link.</p>

            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-gray-500 tracking-wider uppercase mb-1.5">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" autoFocus
                  className="w-full h-14 px-4 rounded-xl bg-white border border-gray-200 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-all"
                />
              </div>

              <button
                onClick={handleSubmit} disabled={loading || !email}
                className="w-full h-14 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : 'Send reset link'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
