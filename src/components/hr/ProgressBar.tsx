'use client';

import React from 'react';

interface Props {
  currentStep: number;
  totalSteps: number;
  label: string;
}

export default function ProgressBar({ currentStep, totalSteps, label }: Props) {
  return (
    <div className="bg-white">
      <div className="flex gap-1 px-5 pt-3">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-1 rounded-full ${
              i < currentStep
                ? 'bg-green-600'
                : i === currentStep
                ? 'bg-green-600 opacity-50'
                : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <div className="px-5 py-2 text-[var(--fs-xs)] text-gray-400 font-medium">
        {label}
      </div>
    </div>
  );
}
