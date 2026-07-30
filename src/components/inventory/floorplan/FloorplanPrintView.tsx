'use client';
/**
 * A clean printable page of one floor: the plan raster, identity line and
 * date — for the wall or the office binder. The original PDF stays one tap
 * away for full vector quality.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface FloorInfo {
  id: number;
  name: string;
  code: string;
  revision: { id: number; revisionNo: number; rasterUrl: string; width: number; height: number } | null;
}

export default function FloorplanPrintView({ floorId }: { floorId: number }) {
  const router = useRouter();
  const [floor, setFloor] = useState<FloorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    fetch('/api/inventory/floorplan')
      .then(r => r.json())
      .then(d => {
        if (tokenRef.current !== token) return;
        const f = (d.manifest?.floors ?? []).find((x: FloorInfo) => x.id === floorId) ?? null;
        if (!f || !f.revision) setError('This floor has no published plan.');
        else setFloor(f);
      })
      .catch(() => { if (tokenRef.current === token) setError('Could not load the plan.'); });
  }, [floorId]);

  return (
    <div className="min-h-screen bg-white"><div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2 border-b border-gray-200 p-3 print:hidden">
        <button
          onClick={() => router.push('/inventory/floorplan/manage')}
          className="h-10 rounded-full border border-gray-200 px-4 text-[13px] font-bold text-gray-700"
        >
          ‹ Back
        </button>
        <span className="flex-1" />
        {floor?.revision && (
          <a
            href={`/api/inventory/floorplans/assets/${floor.revision.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="h-10 rounded-full border border-gray-200 px-4 text-[13px] font-bold leading-10 text-gray-700"
          >
            Original PDF
          </a>
        )}
        <button
          onClick={() => window.print()}
          className="h-10 rounded-full bg-green-600 px-5 text-[13px] font-bold text-white"
        >
          🖨 Print
        </button>
      </div>
      {error && <p className="p-6 text-[13px] text-gray-600">{error}</p>}
      {floor?.revision && (
        <div className="p-4">
          <h1 className="text-[18px] font-extrabold text-gray-900">
            {floor.name}{floor.code ? ` (${floor.code})` : ''}
          </h1>
          <p className="mb-3 text-[12px] text-gray-500">
            Plan version {floor.revision.revisionNo} · printed {new Date().toLocaleDateString('de-DE')}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={floor.revision.rasterUrl}
            alt={`Floor plan of ${floor.name}`}
            className="w-full border border-gray-200 print:border-0"
          />
        </div>
      )}
    </div>
    </div>
  );
}
