'use client';

import React from 'react';

interface OrderSentScreenProps {
  onPlaceAnother: () => void;
  onHistory: () => void;
  onHome: () => void;
  whatsappUrl?: string;
  emailed?: boolean;
  sendMethod?: string;
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.5 14.4c-.3-.15-1.7-.84-2-.94-.27-.1-.47-.15-.66.15-.2.3-.76.94-.93 1.13-.17.2-.34.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.34.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.6-.9-2.18-.24-.57-.48-.5-.66-.5h-.56c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.2 1.87.12.57-.08 1.7-.7 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.27-.2-.56-.34zM12 2a10 10 0 00-8.5 15.3L2 22l4.8-1.5A10 10 0 1012 2z" />
    </svg>
  );
}

export default function OrderSentScreen({ onPlaceAnother, onHistory, onHome, whatsappUrl, emailed, sendMethod }: OrderSentScreenProps) {
  const status = emailed
    ? 'Emailed to the supplier.'
    : whatsappUrl
      ? 'One more tap sends it to the supplier on WhatsApp.'
      : sendMethod === 'email'
        ? 'Recorded — but the email to the supplier didn’t go out. Check the supplier’s email address or the mail settings.'
        : 'Recorded in your orders. Send it to the supplier the way you normally do.';

  return (
    <div className="px-4 py-3 flex flex-col items-center pt-16">
      <div className="w-16 h-16 rounded-[18px] bg-green-100 flex items-center justify-center mb-4">
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div className="text-[18px] font-bold text-gray-900 mb-2">Order sent!</div>
      <div className="text-[13px] text-gray-500 text-center max-w-[300px] leading-relaxed mb-6">{status}</div>

      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full max-w-[300px] py-3.5 rounded-xl bg-[#25D366] text-white text-[14px] font-bold shadow-lg shadow-[#25D366]/30 mb-3 flex items-center justify-center gap-2 active:opacity-90"
        >
          <WhatsAppIcon /> Send on WhatsApp
        </a>
      )}

      <button
        onClick={onPlaceAnother}
        className="w-full max-w-[300px] py-3.5 rounded-xl bg-[#F5800A] text-white text-[14px] font-bold shadow-lg shadow-[#F5800A]/30 mb-3 active:bg-[#E86000]"
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
