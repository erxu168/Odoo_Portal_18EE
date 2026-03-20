'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'input' | 'confirm' | 'pending' | 'error';

interface Employee {
  id: number;
  name: string;
  department: string | null;
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('input');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contact, setContact] = useState('Ethan');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [existingEmail, setExistingEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLookup() {
    if (!identifier.trim()) return;
    setLoading(true);
    setError('');
    setErrorCode('');
    try {
      const res = await fetch(`/api/auth/register?identifier=${encodeURIComponent(identifier.trim())}`);
      const data = await res.json();

      if (res.ok && data.employee) {
        setEmployee(data.employee);
        setStep('confirm');
      } else if (data.code === 'NO_MATCH') {
        setError('No employee found with that email or phone number. Make sure you are using the same email you gave when you were hired.');
        setErrorCode('NO_MATCH');
        setStep('error');
      } else if (data.code === 'DUPLICATE_EMAIL') {
        setError('An account with this email already exists. Try logging in instead.');
        setErrorCode('DUPLICATE_EMAIL');
        setStep('error');
      } else if (data.code === 'DUPLICATE_EMPLOYEE') {
        setExistingEmail(data.existing_email || '');
        setError('An account for this employee already exists. Try logging in with your registered email.');
        setErrorCode('DUPLICATE_EMPLOYEE');
        setStep('error');
      } else if (data.code === 'REJECTED') {
        setError('This account was previously rejected. Contact your manager to clear the rejection before registering again.');
        setErrorCode('REJECTED');
        setStep('error');
      } else {
        setError(data.error || 'Something went wrong.');
        setStep('error');
      }
    } catch (err) {
      setError('Connection failed. Please try again.');
      setStep('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (password !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!/\d/.test(password)) {
      setError('Password must contain at least one number.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();

      if (res.ok || res.status === 201) {
        setContact(data.contact || 'Ethan');
        setStep('pending');
      } else {
        setError(data.error || 'Registration failed.');
      }
    } catch (err) {
      setError('Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ===== INPUT STEP =====
  if (step === 'input') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#1A1F2E] px-6 pt-14 pb-6 relative overflow-hidden">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
          <h1 className="text-[22px] font-bold text-white relative">Register</h1>
          <p className="text-[13px] text-white/50 mt-1 relative">Use the email or phone you gave when you were hired</p>
        </div>
        <div className="flex-1 px-6 pt-5 pb-20">
          <div className="mb-5">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Your email or phone number</label>
            <input type="text" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              placeholder="e.g. name@gmail.com or +49 170..."
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-orange-400" />
            <p className="text-[12px] text-gray-400 mt-1.5">We'll match this against our employee records</p>
          </div>
          <button onClick={handleLookup} disabled={loading || !identifier.trim()}
            className="w-full py-4 rounded-2xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all disabled:opacity-40 disabled:shadow-none">
            {loading ? 'Searching...' : 'Find my account'}
          </button>
          <div className="text-center mt-5">
            <span className="text-[13px] text-gray-400">Already have an account? </span>
            <button onClick={() => router.push('/login')} className="text-[13px] font-semibold text-orange-600">Log in</button>
          </div>
        </div>
      </div>
    );
  }

  // ===== CONFIRM STEP =====
  if (step === 'confirm' && employee) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
          <button onClick={() => { setStep('input'); setError(''); }}
            className="flex items-center gap-1 text-orange-600 text-[13px] font-semibold mb-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          <h1 className="text-[18px] font-bold text-gray-900">Confirm your identity</h1>
        </div>
        <div className="flex-1 px-6 pt-5 pb-28">
          {/* Employee confirmation card */}
          <div className="bg-white border-2 border-orange-300 rounded-2xl p-5 text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center mx-auto mb-3">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#F5800A" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div className="text-[13px] font-semibold text-orange-600 mb-1">Is this you?</div>
            <div className="text-[18px] font-bold text-gray-900">{employee.name}</div>
            {employee.department && (
              <div className="text-[13px] text-gray-500 mt-1">{employee.department}</div>
            )}
          </div>

          <div className="text-[14px] font-semibold text-gray-900 mb-4">Set your password</div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-[13px] text-red-700">{error}</div>
          )}

          <div className="mb-4">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters, 1 number"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-orange-400" />
          </div>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Confirm password</label>
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Enter password again"
              className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3.5 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-orange-400" />
          </div>
          <div className="text-[12px] text-gray-400">
            Not you? <button onClick={() => { setStep('input'); setEmployee(null); }} className="text-orange-600 font-semibold">Try a different email</button>
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-4 bg-white border-t border-gray-200 z-50">
          <button onClick={handleRegister} disabled={loading || !password || !confirmPw}
            className="w-full py-4 rounded-2xl bg-orange-500 text-white text-[16px] font-bold shadow-xl shadow-orange-500/40 active:bg-orange-600 active:scale-[0.975] transition-all disabled:opacity-40">
            {loading ? 'Creating account...' : 'Create my account'}
          </button>
        </div>
      </div>
    );
  }

  // ===== PENDING STEP =====
  if (step === 'pending') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#1A1F2E] px-6 pt-14 pb-6 relative overflow-hidden">
          <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.15)_0%,transparent_70%)]" />
          <h1 className="text-[22px] font-bold text-white relative">Almost there!</h1>
          <p className="text-[13px] text-white/50 mt-1 relative">Your account is being reviewed</p>
        </div>
        <div className="flex-1 px-6 pt-8 flex flex-col items-center">
          <div className="w-[72px] h-[72px] rounded-[20px] bg-orange-50 flex items-center justify-center mb-4">
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="#F5800A" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div className="text-[18px] font-bold text-gray-900 mb-2 text-center">Waiting for approval</div>
          <div className="text-[14px] text-gray-500 text-center max-w-[280px] leading-relaxed mb-6">
            Your account has been created. A manager will review and approve your access shortly.
          </div>

          {employee && (
            <div className="w-full max-w-[320px] bg-white border border-gray-200 rounded-xl p-4 mb-6">
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-[13px] text-gray-500">Name</span>
                <span className="text-[13px] font-semibold">{employee.name}</span>
              </div>
              {employee.department && (
                <div className="flex justify-between items-center mb-2.5">
                  <span className="text-[13px] text-gray-500">Department</span>
                  <span className="text-[13px] font-semibold">{employee.department}</span>
                </div>
              )}
              <div className="flex justify-between items-center mb-2.5">
                <span className="text-[13px] text-gray-500">Email</span>
                <span className="text-[12px] font-semibold font-mono">{identifier}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[13px] text-gray-500">Status</span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-700">Pending approval</span>
              </div>
            </div>
          )}

          <div className="text-[13px] text-gray-400 text-center mb-6">
            Contact <span className="font-semibold text-gray-600">{contact}</span> for faster approval.
          </div>

          <button onClick={() => router.push('/login')}
            className="w-full max-w-[320px] py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-[14px] font-semibold">
            Back to login
          </button>
        </div>
      </div>
    );
  }

  // ===== ERROR STEP =====
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
        <button onClick={() => { setStep('input'); setError(''); setErrorCode(''); }}
          className="flex items-center gap-1 text-orange-600 text-[13px] font-semibold mb-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
      </div>
      <div className="flex-1 px-6 pt-16 flex flex-col items-center">
        {errorCode === 'NO_MATCH' && (
          <>
            <div className="w-full max-w-[320px] bg-red-50 border border-red-200 rounded-2xl p-5 text-center mb-5">
              <div className="w-12 h-12 rounded-[14px] bg-red-100 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#DC2626" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div className="text-[15px] font-bold text-gray-900 mb-1">Employee not found</div>
              <div className="text-[13px] text-gray-600 leading-relaxed">{error}</div>
            </div>
            <button onClick={() => { setStep('input'); setError(''); }}
              className="w-full max-w-[320px] py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-[14px] font-semibold mb-3">
              Try again
            </button>
            <div className="text-[12px] text-gray-400 text-center">Still having trouble? Ask your manager.</div>
          </>
        )}

        {(errorCode === 'DUPLICATE_EMAIL' || errorCode === 'DUPLICATE_EMPLOYEE') && (
          <>
            <div className="w-full max-w-[320px] bg-white border-2 border-orange-300 rounded-2xl p-5 text-center mb-5">
              <div className="w-12 h-12 rounded-[14px] bg-orange-50 flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#F5800A" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div className="text-[15px] font-bold text-gray-900 mb-1">Account already exists</div>
              <div className="text-[13px] text-gray-600 leading-relaxed">{error}</div>
              {existingEmail && (
                <div className="text-[12px] font-mono text-gray-500 mt-2">Registered as: {existingEmail}</div>
              )}
            </div>
            <button onClick={() => router.push('/login')}
              className="w-full max-w-[320px] py-4 rounded-2xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30 mb-3">
              Go to login
            </button>
            <button onClick={() => router.push('/forgot-password')} className="text-[13px] font-semibold text-orange-600">
              Forgot your password?
            </button>
          </>
        )}

        {errorCode === 'REJECTED' && (
          <>
            <div className="w-full max-w-[320px] bg-red-50 border border-red-200 rounded-2xl p-5 text-center mb-5">
              <div className="text-[15px] font-bold text-gray-900 mb-1">Registration not approved</div>
              <div className="text-[13px] text-gray-600 leading-relaxed">{error}</div>
            </div>
            <button onClick={() => { setStep('input'); setError(''); }}
              className="w-full max-w-[320px] py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-[14px] font-semibold">
              Back
            </button>
          </>
        )}

        {!errorCode && error && (
          <>
            <div className="w-full max-w-[320px] bg-red-50 border border-red-200 rounded-2xl p-5 text-center mb-5">
              <div className="text-[15px] font-bold text-gray-900 mb-1">Something went wrong</div>
              <div className="text-[13px] text-gray-600">{error}</div>
            </div>
            <button onClick={() => { setStep('input'); setError(''); }}
              className="w-full max-w-[320px] py-3.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-[14px] font-semibold">
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
