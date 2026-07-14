'use client';

import React from 'react';

interface Props {
  mode: 'cooking' | 'production';
  recipeName: string;
  stepCount: number;
  elapsedSeconds: number;
  batch: number;
  onDashboard: () => void;
  onCookAnother: () => void;
}

export default function CookComplete({ mode, recipeName, stepCount, elapsedSeconds, batch, onDashboard, onCookAnother }: Props) {
  const unit = mode === 'cooking' ? 'srv' : 'kg';
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-[#1C1C1E] flex flex-col items-center justify-center px-8">
      <div className="w-24 h-24 rounded-full bg-green-600 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(22,163,74,0.3)]">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <h1 className="text-[20px] font-bold text-white mb-2">Dish Complete!</h1>
      <p className="text-[14px] text-zinc-400 mb-8">{recipeName} ready to serve</p>
      <div className="flex items-center gap-8 mb-10">
        <div className="text-center">
          <div className="text-[20px] font-bold text-white font-mono">{stepCount}</div>
          <div className="text-[11px] text-zinc-400 font-semibold uppercase">Steps</div>
        </div>
        <div className="text-center">
          <div className="text-[20px] font-bold text-white font-mono">{timeStr}</div>
          <div className="text-[11px] text-zinc-400 font-semibold uppercase">Time</div>
        </div>
        <div className="text-center">
          <div className="text-[20px] font-bold text-white font-mono">{batch}{unit === 'srv' ? '\u00d7' : ''}</div>
          <div className="text-[11px] text-zinc-400 font-semibold uppercase">Batch</div>
        </div>
      </div>
      <button onClick={onDashboard}
        className="w-full max-w-xs py-4 rounded-2xl text-[16px] font-bold text-white bg-green-600 active:bg-green-700 shadow-lg mb-3">
        Back to dashboard
      </button>
      <button onClick={onCookAnother}
        className="w-full max-w-xs py-4 rounded-2xl text-[16px] font-bold text-white bg-zinc-700 border border-zinc-600 active:bg-zinc-600">
        Cook another
      </button>
    </div>
  );
}
