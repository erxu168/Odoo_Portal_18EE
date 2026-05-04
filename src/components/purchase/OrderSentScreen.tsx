'use client';

import React from 'react';

interface OrderSentScreenProps {
  onPlaceAnother: () => void;
  onHistory: () => void;
  onHome: () => void;
}

export default function OrderSentScreen({ onPlaceAnother, onHistory, onHome }: OrderSentScreenProps) {
  return (
    <div className="px-4 py-3 flex flex-col items-center pt-16">
      <div className="w-16 h-16 rounded-[18px] bg-green-100 flex items-center justify-center mb-4">
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div className="text-[18px] font-bold text-gray-900 mb-2">Order sent!</div>
      <div className="text-[13px] text-gray-500 text-center max-w-[280px] leading-relaxed mb-6">
        Your order has been submitted.
      </div>
      <button
        onClick={onPlaceAnother}
        className="w-full max-w-[300px] py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 mb-3"
      >
        Place another order
      </button>
      <button
        onClick={onHistory}
        className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold mb-3"
      >
        View order history
      </button>
      <button
        onClick={onHome}
        className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold"
      >
        Back to dashboard
      </button>
    </div>
  );
}
