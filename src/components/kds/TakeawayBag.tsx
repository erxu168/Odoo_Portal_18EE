'use client';

import OrderTypePill from './OrderTypePill';

/**
 * Take-away marker for KDS order rows.
 *
 * Previously drew a small bag icon that was easy to miss on a busy line. Now
 * renders the shared, colour-coded "TAKE AWAY" pill so it reads as words and
 * stays consistent with the rest of the KDS. Kept as a thin wrapper so the
 * existing call sites keep working; the numeric `size` maps to the pill size.
 */
export default function TakeawayBag({ size = 16 }: { size?: number }) {
  return <OrderTypePill type="Takeaway" size={size < 16 ? 'sm' : 'md'} />;
}
