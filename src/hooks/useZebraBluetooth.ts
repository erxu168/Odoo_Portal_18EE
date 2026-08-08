/**
 * Zebra Printer Hook — dual-mode: Native BT Classic (Capacitor) + Web BLE fallback.
 *
 * PERSISTENT CONNECTION: When running in Capacitor, the BT Classic socket
 * stays open at the native Java layer even when React components unmount.
 * On mount, the hook checks if a connection already exists and restores state.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { DELIVERY_UNCERTAIN } from '@/lib/print-errors';

const ZEBRA_PARSER_SERVICE = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE_CHAR = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_FE79_SERVICE = '0000fe79-0000-1000-8000-00805f9b34fb';
const DIS_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
const ALL_OPTIONAL_SERVICES = [ZEBRA_PARSER_SERVICE, ZEBRA_FE79_SERVICE, DIS_SERVICE];
// Web Bluetooth never exposes the negotiated ATT MTU, and Chrome REJECTS a
// write whose payload exceeds MTU-3 — as little as 20 bytes on a link that
// never negotiated up. So this is a ceiling to start from, not a size to use.
const MAX_CHUNK = 512;
const MIN_CHUNK = 20;   // the guaranteed floor: MTU 23 - 3 ATT header bytes

/**
 * Did Chrome refuse this write because the PAYLOAD IS TOO LONG for the link?
 *
 * Only that answer makes resending the same bytes safe — the value is rejected
 * locally, before anything goes on the wire. A NetworkError (busy stack, the
 * connection changed, the operation was invalidated) can land AFTER the bytes
 * were transmitted, and a write-without-response is never acknowledged, so
 * retrying one of those can print the label twice. (Codex review of 627df661.)
 */
function isLengthRejection(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ''} ${e?.message ?? String(err)}`.toLowerCase();
  return text.includes('notsupportederror')
    || text.includes('attribute length')
    || text.includes('value length')
    || text.includes('longer than')
    || text.includes('exceeds');
}

export type BleStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'printing' | 'error' | 'unsupported';

export interface UseZebraBluetoothReturn {
  connect: () => Promise<boolean>;
  /** Paired devices to choose from when the name rule recognised none. */
  paired: { name?: string; address: string }[];
  /** Connect to a device the user picked, whatever it calls itself. */
  connectTo: (address: string, name?: string) => Promise<boolean>;
  disconnect: () => void;
  print: (zpl: string) => Promise<boolean>;
  /**
   * Why the last connect() / connectTo() / print() returned false — read it
   * straight after awaiting the call.
   *
   * A function, not the `error` field, because `error` is React state: a screen
   * that does `const ok = await ble.print(z)` is holding the `ble` object from
   * the render that created the handler, so reading `ble.error` on the next
   * line gets the value from BEFORE the call. That is how every screen ended up
   * showing a bare "Print failed" while the real reason sat unread — and why
   * LocationLabels always said "the printer stopped responding" no matter what
   * happened. Covers CONNECT too: the same read follows every ble.connect(),
   * so "Bluetooth is off" and "permission denied" were vanishing the same way.
   */
  lastError: () => string | null;
  isConnected: boolean;
  isSupported: boolean;
  printerName: string | null;
  status: BleStatus;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BleAny = any;

function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as BleAny).Capacitor;
}

function getNativeBT(): BleAny | null {
  if (!isCapacitor()) return null;
  try {
    const cap = (window as BleAny).Capacitor;
    return cap.Plugins?.ZebraPrint || null;
  } catch {
    return null;
  }
}

export function useZebraBluetooth(): UseZebraBluetoothReturn {
  const [status, setStatus] = useState<BleStatus>('idle');
  const [printerName, setPrinterName] = useState<string | null>(null);
  // Paired devices found when the name rule matched nothing — offered as a picker.
  const [paired, setPaired] = useState<{ name?: string; address: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BleAny>(null);
  const writeCharRef = useRef<BleAny>(null);
  const serverRef = useRef<BleAny>(null);
  const serviceUuidRef = useRef<string>('');
  const nativeAddressRef = useRef<string>('');
  const lastErrorRef = useRef<string | null>(null);

  const nativeBT = getNativeBT();
  const isNative = !!nativeBT;
  const isBleSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const isSupported = isNative || isBleSupported;
  const isConnected = status === 'connected' || status === 'printing';

  // ═══════ CHECK EXISTING CONNECTION ON MOUNT ═══════
  // When the component remounts (e.g. navigating back), check if the
  // native Java plugin still has an open socket from a previous connection
  useEffect(() => {
    if (!nativeBT) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await nativeBT.isConnected();
        if (!cancelled && result.connected) {
          setPrinterName(result.name || 'Zebra Printer');
          nativeAddressRef.current = result.address || '';
          setStatus('connected');
          console.log('Restored existing BT connection to', result.name);
        }
      } catch {
        // Plugin doesn't support isConnected yet, or no connection — stay idle
      }
    })();
    return () => { cancelled = true; };
  }, [nativeBT]);

  // ═══════ NATIVE BT CLASSIC (Capacitor Android) ═══════
  const connectNative = useCallback(async (): Promise<boolean> => {
    if (!nativeBT) return false;
    try {
      // First check if already connected
      try {
        const check = await nativeBT.isConnected();
        if (check.connected) {
          setPrinterName(check.name || 'Zebra Printer');
          nativeAddressRef.current = check.address || '';
          setStatus('connected');
          return true;
        }
      } catch { /* isConnected not available */ }

      setStatus('scanning');
      setError(null);
      lastErrorRef.current = null;

      const { enabled } = await nativeBT.isEnabled();
      if (!enabled) {
        lastErrorRef.current = 'Bluetooth is turned off. Enable it in Settings.';
        setError(lastErrorRef.current);
        setStatus('error');
        return false;
      }

      const { devices } = await nativeBT.list();
      console.log('Paired BT devices:', devices);

      const zebra = devices.find((d: BleAny) => {
        const name = (d.name || '').toUpperCase();
        return name.startsWith('ZD') || name.startsWith('ZEBRA') ||
               name.startsWith('ZQ') || name.startsWith('ZT') || name.startsWith('XXRZ');
      });

      if (!zebra) {
        // Do NOT tell someone to pair a printer they have already paired. Many
        // Zebras advertise their SERIAL as the Bluetooth name (a ZD420 shows up
        // as e.g. "D2J203404050"), which no name rule can recognise. Say what
        // was actually found and let them point at the right one.
        setPaired(devices || []);
        lastErrorRef.current = (devices || []).length > 0
          ? 'None of the paired devices is named like a Zebra. Many printers use their serial number as the Bluetooth name — pick yours from the list.'
          : 'No paired Bluetooth devices at all. Pair the printer in Android Settings \u2192 Bluetooth first.';
        setError(lastErrorRef.current);
        setStatus('error');
        return false;
      }

      setStatus('connecting');
      setPrinterName(zebra.name || 'Zebra Printer');

      await nativeBT.connect({ address: zebra.address });
      nativeAddressRef.current = zebra.address;

      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErrorRef.current = msg;
      setError(`BT connection failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [nativeBT]);

  const disconnectNative = useCallback(async () => {
    if (!nativeBT) return;
    try { await nativeBT.disconnect(); } catch { /* ignore */ }
    nativeAddressRef.current = '';
    setPrinterName(null);
    setStatus('idle');
    setError(null);
  }, [nativeBT]);

  const printNative = useCallback(async (zpl: string): Promise<boolean> => {
    if (!nativeBT) return false;
    try {
      setStatus('printing');
      setError(null);
      lastErrorRef.current = null;
      await nativeBT.write({ data: zpl });
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Resend AUTOMATICALLY only when nothing can have reached the printer.
      //
      // The plugin's `outputStream == null` guard rejects with "Not connected"
      // BEFORE it writes a byte, so resending there is free. Anything else is
      // an IOException from write() or flush(), and an Android Bluetooth write
      // is asynchronous — it cannot confirm delivery, so the whole format may
      // already have reached the printer. Resending on that would put a second
      // sticker, with the same lot number, on a second tub. For a traceability
      // label that is worse than a wasted tap. (Codex review of 627df661; the
      // first cut resent on any failure, reasoning that a fresh ^XA discards a
      // half-written format. Zebra documents ~JX for that, not ^XA — the
      // assumption was mine, not the printer's.)
      // EXACT match, not a substring. The plugin's pre-write guard rejects with
      // precisely "Not connected"; a POSIX I/O failure can also SAY it —
      // ENOTCONN prints as "Transport endpoint is not connected" — and that one
      // comes from write()/flush(), where bytes may already have gone. If the
      // wording ever drifts we simply lose the free resend and fall through to
      // the honest "may or may not have printed" path. (Codex re-review.)
      const nothingSent = msg.trim().toLowerCase() === 'not connected';

      if (nativeAddressRef.current) {
        let reconnected = false;
        try {
          await nativeBT.connect({ address: nativeAddressRef.current });
          reconnected = true;
        } catch (retryErr: unknown) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          lastErrorRef.current = `${msg} (reconnect also failed: ${retryMsg})`;
          setError(`Print failed: ${lastErrorRef.current}`);
          setStatus('error');
          return false;
        }
        if (reconnected && nothingSent) {
          try {
            await nativeBT.write({ data: zpl });
            setStatus('connected');
            return true;
          } catch (retryErr: unknown) {
            // The RESEND can itself die after handing bytes over, so this is
            // uncertain too — it must not read as a clean "nothing printed".
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            const combined = `${msg} (resend also failed: ${retryMsg})`;
            lastErrorRef.current = `${DELIVERY_UNCERTAIN} ${combined}`;
            setError(`Print failed: ${combined}`);
            setStatus('error');
            return false;
          }
        }
        // Reconnected, but we cannot say whether the label came out. Say so —
        // the marker is what routes this to the "check the printer" message.
        lastErrorRef.current = `${DELIVERY_UNCERTAIN} ${msg}`;
        setError(`Print failed: ${msg}`);
        setStatus('connected');   // the link IS back; one tap should print
        return false;
      }
      lastErrorRef.current = msg;
      setError(`Print failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [nativeBT]);

  // ═══════ WEB BLUETOOTH BLE (Browser fallback) ═══════
  const connectBle = useCallback(async (): Promise<boolean> => {
    if (!isBleSupported) {
      setStatus('unsupported');
      lastErrorRef.current = 'Web Bluetooth not supported. Use the Krawings app on Android for BT Classic printing.';
      setError(lastErrorRef.current);
      return false;
    }
    try {
      setStatus('scanning');
      setError(null);
      lastErrorRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      let device: BleAny = null;
      try {
        // SHOW EVERYTHING and let the person choose.
        //
        // This used to filter on names beginning ZD / Zebra / ZQ / ZT / XXRZ,
        // and plenty of Zebras advertise their SERIAL instead — a ZD420 appears
        // as "D2J203404050". The chooser then opened EMPTY. There was an
        // accept-all fallback, but it only ran if requestDevice threw; an empty
        // chooser does not throw, it waits, and cancelling it was read as "the
        // user changed their mind", so the fallback was unreachable.
        //
        // Filtering by the Zebra service UUID is no better: a printer has to
        // ADVERTISE that service for it to match, and many do not. The person
        // holding the phone knows which printer is theirs — the same reason the
        // Android path now shows the paired list instead of guessing by name.
        device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ALL_OPTIONAL_SERVICES,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('cancelled') || msg.includes('canceled')) { setStatus('idle'); return false; }
        throw e;
      }
      if (!device) { setStatus('idle'); return false; }
      deviceRef.current = device;
      setPrinterName(device.name || 'Zebra Printer');
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle'); writeCharRef.current = null; serverRef.current = null;
      });
      setStatus('connecting');
      const server = await device.gatt.connect();
      serverRef.current = server;
      let writeChar: BleAny = null;
      let foundUuid = '';
      try {
        const svc = await server.getPrimaryService(ZEBRA_PARSER_SERVICE);
        writeChar = await svc.getCharacteristic(ZEBRA_WRITE_CHAR);
        foundUuid = ZEBRA_PARSER_SERVICE;
      } catch { /* not found */ }
      if (!writeChar) {
        try {
          const svc = await server.getPrimaryService(ZEBRA_FE79_SERVICE);
          const chars = await svc.getCharacteristics();
          for (const ch of chars) {
            if (ch.properties.writeWithoutResponse || ch.properties.write) {
              writeChar = ch; foundUuid = ZEBRA_FE79_SERVICE; break;
            }
          }
        } catch { /* not found */ }
      }
      if (!writeChar) {
        lastErrorRef.current =
          `Connected to ${device.name} but no print service found. ` +
          `The ZD420T base BLE is config-only. ` +
          `Use the Krawings Android app for BT Classic printing, or install the Ethernet module.`;
        setError(lastErrorRef.current);
        setStatus('error');
        return false;
      }
      serviceUuidRef.current = foundUuid;
      writeCharRef.current = writeChar;
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cancelled') || msg.includes('canceled')) { setStatus('idle'); return false; }
      lastErrorRef.current = msg;
      setError(`Connection failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [isBleSupported]);

  const disconnectBle = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
    deviceRef.current = null; writeCharRef.current = null; serverRef.current = null;
    serviceUuidRef.current = '';
    setPrinterName(null); setStatus('idle'); setError(null);
  }, []);

  const printBle = useCallback(async (zpl: string): Promise<boolean> => {
    if (!writeCharRef.current) {
      lastErrorRef.current = 'Not connected';
      setError('Not connected');
      return false;
    }
    try {
      setStatus('printing');
      setError(null);
      lastErrorRef.current = null;
      const encoder = new TextEncoder();
      const data = encoder.encode(zpl);
      // Chunk DOWN until the link accepts it, rather than sending a fixed 512.
      //
      // Web Bluetooth gives no way to ask what the MTU is, and Chrome rejects
      // an oversized payload outright ("GATT Error: attribute length invalid"
      // / NotSupportedError). A hard-coded 512 therefore failed on the FIRST
      // chunk of the FIRST label on any link that had not negotiated a large
      // MTU — which is what "Print failed for label 1" was.
      //
      // Retrying the SAME offset is safe: a rejected GATT write puts nothing
      // on the wire, so no part of the label is sent twice.
      let chunkSize = MAX_CHUNK;
      let off = 0;
      while (off < data.length) {
        const chunk = data.slice(off, Math.min(off + chunkSize, data.length));
        try {
          if (writeCharRef.current.properties?.writeWithoutResponse) {
            await writeCharRef.current.writeValueWithoutResponse(chunk);
          } else {
            await writeCharRef.current.writeValue(chunk);
          }
        } catch (writeErr: unknown) {
          // Shrink ONLY for a length rejection, and ONLY while nothing has
          // gone out yet. The MTU is a property of the link, so a too-big
          // chunk always fails on the first one.
          if (off === 0 && chunkSize > MIN_CHUNK && isLengthRejection(writeErr)) {
            chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
            continue;
          }
          // A length rejection is refused LOCALLY, so nothing was sent and the
          // caller may safely retry. Everything else — including on the very
          // first chunk — may have reached the printer before it failed: a
          // write-without-response is never acknowledged. `off === 0` says
          // nothing about what left the radio, only about what this loop
          // counted. (Codex re-review of de32d7b8; the first cut treated a
          // first-chunk failure as safe.)
          if (isLengthRejection(writeErr)) throw writeErr;
          const wm = writeErr instanceof Error ? writeErr.message : String(writeErr);
          lastErrorRef.current = `${DELIVERY_UNCERTAIN} ${wm}`;
          setError(`Print failed: ${wm}`);   // never the marker — screens render this raw
          setStatus('error');
          return false;
        }
        off += chunk.length;
      }
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErrorRef.current = msg;
      setError(`Print failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, []);

  // ═══════ ROUTER ═══════
  const connect = useCallback(async () => {
    return isNative ? connectNative() : connectBle();
  }, [isNative, connectNative, connectBle]);

  const disconnect = useCallback(() => {
    return isNative ? disconnectNative() : disconnectBle();
  }, [isNative, disconnectNative, disconnectBle]);

  const print = useCallback(async (zpl: string) => {
    return isNative ? printNative(zpl) : printBle(zpl);
  }, [isNative, printNative, printBle]);

  /** The reason the last print() returned false. Stable across renders. */
  const lastError = useCallback(() => lastErrorRef.current, []);

  /**
   * Connect to a device the user picked from the paired list.
   *
   * No name check: they are looking at the printer. A rule that guesses from
   * the Bluetooth name cannot cope with a Zebra that advertises its serial, and
   * guessing wrongly is worse than asking.
   */
  const connectTo = useCallback(async (address: string, name?: string): Promise<boolean> => {
    if (!nativeBT) { setError('Picking a paired device needs the Android app.'); return false; }
    try {
      setStatus('connecting');
      setError(null);
      lastErrorRef.current = null;
      await nativeBT.connect({ address });
      nativeAddressRef.current = address;
      setPrinterName(name || 'Zebra Printer');
      setPaired([]);
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErrorRef.current = msg;
      setError(`Could not connect to ${name || address}: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [nativeBT]);

  return { connect, connectTo, paired, disconnect, print, lastError, isConnected, isSupported, printerName, status, error };
}
