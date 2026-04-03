/**
 * Web Bluetooth hook for Zebra BLE printers.
 * Works with ZD420T and any Zebra printer with BLE.
 *
 * Zebra BLE GATT UUIDs (from Zebra Link-OS BLE AppNote):
 * - Parser Service:  38eb4a84-c570-11e3-9507-0002a5d5c51b
 * - Write (To Printer): 38eb4a82-c570-11e3-9507-0002a5d5c51b
 * - Read (From Printer): 38eb4a81-c570-11e3-9507-0002a5d5c51b
 *
 * Usage:
 *   const { connect, disconnect, print, isConnected, printerName, status } = useZebraBluetooth();
 *   await connect();    // shows browser BLE picker
 *   await print(zpl);   // sends ZPL string to printer
 */
import { useState, useRef, useCallback } from 'react';

// Zebra BLE GATT UUIDs
const ZEBRA_SERVICE_UUID = '38eb4a84-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE_CHAR_UUID = '38eb4a82-c570-11e3-9507-0002a5d5c51b';

// Max bytes per BLE write (safe chunk size)
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

// Web Bluetooth types are not in default TS lib — use any for refs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BleDevice = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BleCharacteristic = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BleServer = any;

export function useZebraBluetooth(): UseZebraBluetoothReturn {
  const [status, setStatus] = useState<BleStatus>('idle');
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BleDevice>(null);
  const writeCharRef = useRef<BleCharacteristic>(null);
  const serverRef = useRef<BleServer>(null);

  const isSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const isConnected = status === 'connected' || status === 'printing';

  const connect = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setStatus('unsupported');
      setError('Web Bluetooth is not supported in this browser. Use Chrome on Android.');
      return false;
    }

    try {
      setStatus('scanning');
      setError(null);

      // Show browser BLE picker — filters for Zebra printers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        filters: [
          { services: [ZEBRA_SERVICE_UUID] },
        ],
        optionalServices: [ZEBRA_SERVICE_UUID, '0000180a-0000-1000-8000-00805f9b34fb'],
      });

      if (!device) {
        setStatus('idle');
        return false;
      }

      deviceRef.current = device;
      setPrinterName(device.name || 'Zebra Printer');

      // Handle disconnection
      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle');
        writeCharRef.current = null;
        serverRef.current = null;
      });

      setStatus('connecting');

      // Connect to GATT server
      const server = await device.gatt.connect();
      serverRef.current = server;

      // Get the Zebra Parser Service
      const service = await server.getPrimaryService(ZEBRA_SERVICE_UUID);

      // Get the write characteristic
      const writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
      writeCharRef.current = writeChar;

      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // User cancelled the picker — not an error
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

      // Encode ZPL to UTF-8 bytes
      const encoder = new TextEncoder();
      const data = encoder.encode(zpl);

      // Send in chunks (BLE link layer limit)
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        const chunk = data.slice(offset, Math.min(offset + CHUNK_SIZE, data.length));
        await writeCharRef.current.writeValueWithoutResponse(chunk);
      }

      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // If GATT disconnected, try to reconnect once
      if (msg.includes('GATT') || msg.includes('disconnected')) {
        try {
          if (deviceRef.current?.gatt) {
            const server = await deviceRef.current.gatt.connect();
            const service = await server.getPrimaryService(ZEBRA_SERVICE_UUID);
            const writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
            writeCharRef.current = writeChar;
            serverRef.current = server;

            // Retry the print
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

  return {
    connect,
    disconnect,
    print,
    isConnected,
    isSupported,
    printerName,
    status,
    error,
  };
}
