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
      <div className="flex flex-shrink-0 items-center gap-2 bg-gray-900 px-4 py-2 text-white">
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold">
          Finding the spot — your count is safe, close to continue
        </span>
        <button
          onClick={onClose}
          aria-label="Close the map and continue counting"
          className="h-9 w-9 flex-shrink-0 rounded-full bg-white/15 text-[14px]"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <FloorplanApp focusLocationId={locationId} onClose={onClose} />
      </div>
    </div>
  );
}
