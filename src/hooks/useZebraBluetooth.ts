/**
 * Zebra Printer Hook — dual-mode: Native BT Classic (Capacitor) + Web BLE fallback.
 *
 * PERSISTENT CONNECTION: When running in Capacitor, the BT Classic socket
 * stays open at the native Java layer even when React components unmount.
 * On mount, the hook checks if a connection already exists and restores state.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

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
   * Why the LAST print returned false — read it AFTER awaiting print().
   *
   * A function, not the `error` field, because `error` is React state: a screen
   * that does `const ok = await ble.print(z)` is holding the `ble` object from
   * the render that created the handler, so reading `ble.error` on the next
   * line gets the value from BEFORE the print. That is how every screen ended
   * up showing a bare "Print failed" while the real reason sat unread.
   */
  printError: () => string | null;
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
  const printErrorRef = useRef<string | null>(null);

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

      const { enabled } = await nativeBT.isEnabled();
      if (!enabled) {
        setError('Bluetooth is turned off. Enable it in Settings.');
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
        setError(
          (devices || []).length > 0
            ? 'None of the paired devices is named like a Zebra. Many printers use their serial number as the Bluetooth name — pick yours from the list.'
            : 'No paired Bluetooth devices at all. Pair the printer in Android Settings \u2192 Bluetooth first.'
        );
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
      printErrorRef.current = null;
      await nativeBT.write({ data: zpl });
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // ONE reconnect-and-resend on ANY write failure we have an address for.
      //
      // This used to fire only when the message contained 'not connected',
      // 'socket' or 'closed'. A printer that has gone to sleep — far and away
      // the common case — fails the write with "Broken pipe", which matches
      // none of those, so the retry that exists precisely for a dead socket
      // was skipped and staff got a hard failure on a printer that was fine
      // two minutes earlier. Matching on an OS error string was never going
      // to hold; there is nothing to lose by simply trying once.
      //
      // Safe against double-printing: a broken socket delivered nothing, and
      // a partially-written format has no ^XZ, so the printer never renders
      // it — the retry's ^XA starts a fresh format and the fragment dies.
      if (nativeAddressRef.current) {
        try {
          await nativeBT.connect({ address: nativeAddressRef.current });
          await nativeBT.write({ data: zpl });
          setStatus('connected');
          return true;
        } catch (retryErr: unknown) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          printErrorRef.current = `${msg} (reconnect also failed: ${retryMsg})`;
          setError(`Print failed: ${printErrorRef.current}`);
          setStatus('error');
          return false;
        }
      }
      printErrorRef.current = msg;
      setError(`Print failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [nativeBT]);

  // ═══════ WEB BLUETOOTH BLE (Browser fallback) ═══════
  const connectBle = useCallback(async (): Promise<boolean> => {
    if (!isBleSupported) {
      setStatus('unsupported');
      setError('Web Bluetooth not supported. Use the Krawings app on Android for BT Classic printing.');
      return false;
    }
    try {
      setStatus('scanning');
      setError(null);
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
        setError(
          `Connected to ${device.name} but no print service found.\n` +
          `The ZD420T base BLE is config-only.\n` +
          `Use the Krawings Android app for BT Classic printing, or install the Ethernet module.`
        );
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
      printErrorRef.current = 'Not connected';
      setError('Not connected');
      return false;
    }
    try {
      setStatus('printing');
      setError(null);
      printErrorRef.current = null;
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
          if (chunkSize > MIN_CHUNK) {
            chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
            continue;
          }
          throw writeErr;
        }
        off += chunk.length;
      }
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      printErrorRef.current = msg;
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
  const printError = useCallback(() => printErrorRef.current, []);

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
      await nativeBT.connect({ address });
      nativeAddressRef.current = address;
      setPrinterName(name || 'Zebra Printer');
      setPaired([]);
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not connect to ${name || address}: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [nativeBT]);

  return { connect, connectTo, paired, disconnect, print, printError, isConnected, isSupported, printerName, status, error };
}
