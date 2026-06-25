'use client';

import type { OrderType } from '@/types/kds';

/**
 * A bold, unmistakable label for whether an order is eat-in or takeaway.
 * Replaces the easy-to-miss little bag icon with a colour-coded word.
 */
export default function OrderTypePill({ type, size = 'md' }: { type: OrderType; size?: 'sm' | 'md' }) {
  const isTa = type === 'Takeaway';
  return (
    <span className={`kds-type-pill ${isTa ? 'takeaway' : 'dinein'} kds-type-pill-${size}`}>
      {isTa ? 'TAKEAWAY' : 'DINE-IN'}
    </span>
  );
}
