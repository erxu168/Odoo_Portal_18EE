/**
 * Web Bluetooth hook for Zebra BLE printers.
 * Works with ZD420T and any Zebra printer with BLE.
 *
 * Zebra BLE GATT UUIDs (from Zebra Link-OS BLE AppNote):
 * Multiple service UUIDs exist across Zebra models:
 * - 38eb4a80-c570-11e3-9507-0002a5d5c51b (Parser Service - primary)
 * - 38eb4a84-c570-11e3-9507-0002a5d5c51b (Parser Service - alt)
 * Write characteristic: 38eb4a82-c570-11e3-9507-0002a5d5c51b
 */
import { useState, useRef, useCallback } from 'react';

// All known Zebra BLE service UUIDs (try in order)
const ZEBRA_SERVICE_UUIDS = [
  '38eb4a80-c570-11e3-9507-0002a5d5c51b', // ZPS primary
  '38eb4a84-c570-11e3-9507-0002a5d5c51b', // ZPS alternate
];
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
  const serviceUuidRef = useRef<string>('');

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

      // Request device with broad filters — accept all devices and list
      // Zebra services as optional so we can discover them after connecting
      let device: BleAny = null;
      try {
        device = await nav.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'ZD' },
            { namePrefix: 'Zebra' },
            { namePrefix: 'XXRZ' },
            { namePrefix: 'ZQ' },
            { namePrefix: 'ZT' },
          ],
          optionalServices: [
            ...ZEBRA_SERVICE_UUIDS,
            '0000180a-0000-1000-8000-00805f9b34fb', // DIS
          ],
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('User cancelled')) {
          setStatus('idle');
          return false;
        }
        // Fallback: accept all devices
        device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            ...ZEBRA_SERVICE_UUIDS,
            '0000180a-0000-1000-8000-00805f9b34fb',
          ],
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

      // Try each known Zebra service UUID until one works
      let writeChar: BleAny = null;
      let foundServiceUuid = '';

      for (const svcUuid of ZEBRA_SERVICE_UUIDS) {
        try {
          const service = await server.getPrimaryService(svcUuid);
          writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
          foundServiceUuid = svcUuid;
          break;
        } catch {
          // This UUID not available, try next
          continue;
        }
      }

      // If no known service found, try to discover all services and find a writable one
      if (!writeChar) {
        try {
          const services = await server.getPrimaryServices();
          const serviceList = services.map((s: BleAny) => s.uuid).join(', ');
          console.log('Available BLE services:', serviceList);

          for (const svc of services) {
            try {
              const chars = await svc.getCharacteristics();
              for (const ch of chars) {
                if (ch.properties.writeWithoutResponse || ch.properties.write) {
                  writeChar = ch;
                  foundServiceUuid = svc.uuid;
                  console.log(`Found writable characteristic ${ch.uuid} on service ${svc.uuid}`);
                  break;
                }
              }
              if (writeChar) break;
            } catch {
              continue;
            }
          }
        } catch (discErr: unknown) {
          console.error('Service discovery failed:', discErr);
        }
      }

      if (!writeChar) {
        setError(
          'Connected to printer but could not find a print service. ' +
          'The printer BLE may be in configuration-only mode. ' +
          'Try power-cycling the printer, then reconnect.'
        );
        setStatus('error');
        return false;
      }

      serviceUuidRef.current = foundServiceUuid;
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
    serviceUuidRef.current = '';
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
        // Try writeWithoutResponse first (faster), fall back to write
        if (writeCharRef.current.properties?.writeWithoutResponse) {
          await writeCharRef.current.writeValueWithoutResponse(chunk);
        } else {
          await writeCharRef.current.writeValue(chunk);
        }
      }

      setStatus('connected');
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Auto-reconnect on GATT disconnect
      if (msg.includes('GATT') || msg.includes('disconnected')) {
        try {
          if (deviceRef.current?.gatt && serviceUuidRef.current) {
            const server = await deviceRef.current.gatt.connect();
            const service = await server.getPrimaryService(serviceUuidRef.current);
            const writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR_UUID);
            writeCharRef.current = writeChar;
            serverRef.current = server;

            const encoder = new TextEncoder();
            const retryData = encoder.encode(zpl);
            for (let offset = 0; offset < retryData.length; offset += CHUNK_SIZE) {
              const chunk = retryData.slice(offset, Math.min(offset + CHUNK_SIZE, retryData.length));
              if (writeCharRef.current.properties?.writeWithoutResponse) {
                await writeCharRef.current.writeValueWithoutResponse(chunk);
              } else {
                await writeCharRef.current.writeValue(chunk);
              }
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
