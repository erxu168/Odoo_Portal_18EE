'use client';

import React, { useState } from 'react';
import type { useZebraBluetooth } from '@/hooks/useZebraBluetooth';

/**
 * THE printer bar — connection status, Connect / Change, the paired-device
 * picker, and the one-tap fix for a printer that prints code instead of a label.
 *
 * It exists because that last one only ever lived in LabelPrint. A
 * factory-fresh Zebra is in line-print mode and prints incoming ZPL as literal
 * text; the cure is a single SGD command over the open connection, and it
 * persists forever. LocationLabels and PackageLabel never had that button, so
 * anyone hitting the problem there had no way out of it — and adding a fourth
 * screen without extracting this would have made three stranded screens.
 *
 * Takes the hook's return value rather than calling the hook itself, so the
 * owning screen keeps ONE connection and can print from it.
 */

type Ble = ReturnType<typeof useZebraBluetooth>;

export default function ZebraPrinterBar({ ble, onError }: {
  ble: Ble;
  /** Bubble a connection failure up to the screen's own error banner. */
  onError?: (msg: string | null) => void;
}) {
  const [langFixMsg, setLangFixMsg] = useState<string | null>(null);

  return (
    <div className="px-4 pt-2">
      <div className="flex items-center gap-2 text-[var(--fs-xs)] text-gray-500">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          ble.isConnected ? 'bg-green-500'
            : ble.status === 'scanning' || ble.status === 'connecting' ? 'bg-amber-400 animate-pulse'
            : 'bg-gray-300'
        }`} />
        <span className="flex-1 truncate">
          {ble.isConnected ? ble.printerName
            : ble.status === 'scanning' ? 'Scanning…'
            : ble.status === 'connecting' ? 'Connecting…'
            : 'No printer connected'}
        </span>
        {ble.isConnected ? (
          <button onClick={ble.disconnect} className="text-blue-500 active:text-blue-700">Change</button>
        ) : (
          <button
            onClick={async () => { onError?.(null); const ok = await ble.connect(); if (!ok && ble.error) onError?.(ble.error); }}
            disabled={!ble.isSupported || ble.status === 'scanning' || ble.status === 'connecting'}
            className="text-blue-600 font-bold active:text-blue-800 disabled:opacity-50">
            Connect
          </button>
        )}
      </div>

      {/* One-time per printer, and it stays set. */}
      {ble.isConnected && !langFixMsg && (
        <button
          onClick={async () => {
            onError?.(null);
            const ok = await ble.print('! U1 setvar "device.languages" "zpl"\r\n');
            setLangFixMsg(ok
              ? 'Printer switched to label mode. Tap Print again — this was a one-time fix, it stays set.'
              : 'Could not reach the printer. Check the connection and tap again.');
          }}
          className="mt-1.5 text-[11px] text-gray-400 underline active:text-gray-600">
          Printer prints code instead of a label? Tap to fix
        </button>
      )}
      {langFixMsg && (
        <div className="mt-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-green-700 text-[var(--fs-xs)]">
          {langFixMsg}
          <button onClick={() => setLangFixMsg(null)} className="ml-2 text-green-400 font-bold">{'✕'}</button>
        </div>
      )}

      {/* A Zebra that advertises its SERIAL as its Bluetooth name (a ZD420 shows
          as "D2J203404050", the ZQ310 as "XXZEJ…") matches no name rule, so the
          only honest move is to show what IS paired and let the person point at
          their printer. */}
      {ble.paired.length > 0 && !ble.isConnected && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-500 mb-1.5">
            Paired devices — pick your printer
          </p>
          <div className="flex flex-wrap gap-2">
            {ble.paired.map((d: { address: string; name?: string }) => (
              <button key={d.address}
                onClick={async () => { onError?.(null); const ok = await ble.connectTo(d.address, d.name); if (!ok && ble.error) onError?.(ble.error); }}
                className="px-3 h-9 rounded-lg border border-gray-300 bg-white text-[13px] font-bold text-gray-800 active:bg-gray-100">
                {d.name || d.address}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
