'use client';

import type { TimerTier } from '@/types/kds';

interface TimerProps {
  minutes: number;
  tier: TimerTier;
  size?: 'sm' | 'md';
}

export default function Timer({ minutes, tier, size = 'sm' }: TimerProps) {
  return (
    <span className={`kds-timer kds-timer-${size} kds-timer-${tier}`}>
      {minutes}m
    </span>
  );
}
