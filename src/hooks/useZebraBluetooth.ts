/**
 * Web Bluetooth hook for Zebra BLE printers.
 * Works with ZD420T and any Zebra printer with BLE.
 *
 * Zebra BLE GATT UUIDs (from Zebra Link-OS BLE AppNote):
 * - Parser Service:  38eb4a84-c570-11e3-9507-0002a5d5c51b
 * - Write (To Printer): 38eb4a82-c570-11e3-9507-0002a5d5c51b
 *
 * Usage:
 *   const { connect, disconnect, print, isConnected, printerName, status } = useZebraBluetooth();
 *   await connect();    // shows browser BLE picker
 *   await print(zpl);   // sends ZPL string to printer
 */
import { useState, useRef, useCallback } from 'react';

const ZEBRA_SERVICE_UUID = '38eb4a84-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE_CHAR_UUID = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
const CHUNK_SIZE = 512;

export type BleStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'printing' | 'error' | 'unsupported';

export interface UseZebraBluetoothReturn {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  print: (zpl: string) => Promise<boolean>;
  isConnected: boolean;
  isSupported: boolean;
  printerName: string | null;
  status: BleStatus;
  error: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BleAny = any;

export function useZebraBluetooth(): UseZebraBluetoothReturn {
  const [status, setStatus] = useState<BleStatus>('idle');
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BleAny>(null);
  const writeCharRef = useRef<BleAny>(null);
  const serverRef = useRef<BleAny>(null);

  const isSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const isConnected = status === 'connected' || status === 'printing';

  const connect = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setStatus('unsupported');
      setError('Web Bluetooth is not supported in this browser. Use Chrome on Android or desktop.');
      return false;
    }

    try {
      setStatus('scanning');
      setError(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;

      let device: BleAny = null;

      // Strategy 1: Try filtering by Zebra service UUID
      try {
        device = await nav.bluetooth.requestDevice({
          filters: [
            { services: [ZEBRA_SERVICE_UUID] },
            { namePrefix: 'ZD' },     // Zebra ZD-series
            { namePrefix: 'Zebra' },   // Other Zebra models
            { namePrefix: 'XXRZ' },    // Zebra serial prefix
          ],
          optionalServices: [ZEBRA_SERVICE_UUID, '0000180a-0000-1000-8000-00805f9b34fb'],
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // If user cancelled, stop
        if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
          setStatus('idle');
          return false;
        }
        // If no devices found with filter, try acceptAllDevices
        device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [ZEBRA_SERVICE_UUID, '0000180a-0000-1000-8000-00805f9b34fb'],
        });
      }

      if (!device) {
        setStatus('idle');
        return false;
      }

      deviceRef.current = device;
      setPrinterName(device.name || 'Zebra Printer');

      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle');
        writeCharRef.current = null;
        serverRef.current = null;
      });

      setStatus('connecting');

      const server = await device.gatt.connect();
      serverRef.current = server;

      // Try to get Zebra Parser Service
      let writeChar: BleAny = null;
      try {
        const service = await server.getPrimaryService(ZEBRA_SERVICE_UUID);
        writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
      } catch {
        // If Zebra-specific service not found, try to find any writable characteristic
        // This handles printers that expose data via a different GATT profile
        setError('Could not find Zebra print service. Make sure the printer BLE is enabled and discoverable.');
        setStatus('error');
        return false;
      }

      writeCharRef.current = writeChar;
      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
        setStatus('idle');
        return false;
      }
      setError(`Connection failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, [isSupported]);

  const disconnect = useCallback(() => {
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    deviceRef.current = null;
    writeCharRef.current = null;
    serverRef.current = null;
    setPrinterName(null);
    setStatus('idle');
    setError(null);
  }, []);

  const print = useCallback(async (zpl: string): Promise<boolean> => {
    if (!writeCharRef.current) {
      setError('Not connected to a printer');
      return false;
    }

    try {
      setStatus('printing');
      setError(null);

      const encoder = new TextEncoder();
      const data = encoder.encode(zpl);

      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.slice(offset, Math.min(offset + CHUNK_SIZE, data.length));
        await writeCharRef.current.writeValueWithoutResponse(chunk);
      }

      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Auto-reconnect on GATT disconnect
      if (msg.includes('GATT') || msg.includes('disconnected')) {
        try {
          if (deviceRef.current?.gatt) {
            const server = await deviceRef.current.gatt.connect();
            const service = await server.getPrimaryService(ZEBRA_SERVICE_UUID);
            const writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
            writeCharRef.current = writeChar;
            serverRef.current = server;

            const encoder = new TextEncoder();
            const retryData = encoder.encode(zpl);
            for (let offset = 0; offset < retryData.length; offset += CHUNK_SIZE) {
              const chunk = retryData.slice(offset, Math.min(offset + CHUNK_SIZE, retryData.length));
              await writeCharRef.current.writeValueWithoutResponse(chunk);
            }
            setStatus('connected');
            return true;
          }
        } catch {
          // Reconnect failed
        }
      }

      setError(`Print failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, []);

  return { connect, disconnect, print, isConnected, isSupported, printerName, status, error };
}
