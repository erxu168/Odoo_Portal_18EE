'use client';
/**
 * The floorplan opened ON TOP of a counting session (never a navigation):
 * the session and its unsaved counts stay mounted underneath, so closing the
 * map drops staff exactly where they were, mid-count.
 */
import FloorplanApp from './FloorplanApp';

export default function FloorplanOverlay({ locationId, onClose }: { locationId: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-gray-50">
      <div className="flex flex-shrink-0 items-center gap-2 bg-gray-900 px-3 py-2 text-white">
        <button
          onClick={onClose}
          aria-label="Back to counting"
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-white/15 pl-2.5 pr-4 h-10 text-[14px] font-bold active:bg-white/25"
        >
          <span aria-hidden="true" className="text-[17px] leading-none">←</span> Back to count
        </button>
        <span className="min-w-0 flex-1 truncate text-right text-[12px] text-white/70">
          Your count is safe
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <FloorplanApp focusLocationId={locationId} onClose={onClose} />
      </div>
    </div>
  );
}
