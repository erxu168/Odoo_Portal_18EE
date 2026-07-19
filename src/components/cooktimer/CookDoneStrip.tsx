'use client';

import type { DoneEntry } from '@/types/cooktimer';

/** Bottom "READY -> KDS" strip of recently-finished items. */
export default function CookDoneStrip({ done }: { done: DoneEntry[] }) {
  return (
    <div className="ct-donestrip">
      <span className="ct-dlabel">READY → KDS</span>
      {done.map(d => (
        <span key={d.timerId} className="ct-dpill">✓ {d.profileName} {d.orderRefs.join(' ')}</span>
      ))}
    </div>
  );
}
