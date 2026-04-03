/**
 * Web Bluetooth hook for Zebra BLE printers (ZD420T, ZD621, ZQ series).
 *
 * Confirmed Zebra BLE GATT UUIDs (from Zebra Link-OS AppNote + developer portal):
 * - Parser Service:     38eb4a80-c570-11e3-9507-0002a5d5c51b
 * - Write (To Printer): 38eb4a82-c570-11e3-9507-0002a5d5c51b
 * - Read (From Printer): 38eb4a81-c570-11e3-9507-0002a5d5c51b
 * - Connection advert:  0xFE79
 */
import { useState, useRef, useCallback } from 'react';

// Confirmed Zebra BLE UUIDs
const ZEBRA_PARSER_SERVICE = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE_CHAR = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_READ_CHAR = '38eb4a81-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_FE79_SERVICE = '0000fe79-0000-1000-8000-00805f9b34fb'; // Short UUID FE79
const DIS_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb'; // Device Information Service
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

  // All services we might want to access (must declare upfront for Web Bluetooth permissions)
  const ALL_OPTIONAL_SERVICES = [
    ZEBRA_PARSER_SERVICE,
    ZEBRA_FE79_SERVICE,
    DIS_SERVICE,
  ];

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

      // Strategy 1: filter by name prefix with all Zebra services as optional
      try {
        device = await nav.bluetooth.requestDevice({
          filters: [
            { namePrefix: 'ZD' },
            { namePrefix: 'Zebra' },
            { namePrefix: 'XXRZ' },
            { namePrefix: 'ZQ' },
            { namePrefix: 'ZT' },
          ],
          optionalServices: ALL_OPTIONAL_SERVICES,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('cancelled') || msg.includes('canceled')) {
          setStatus('idle');
          return false;
        }
        // Strategy 2: accept all devices
        try {
          device = await nav.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ALL_OPTIONAL_SERVICES,
          });
        } catch (e2: unknown) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          if (msg2.includes('cancelled') || msg2.includes('canceled')) {
            setStatus('idle');
            return false;
          }
          throw e2;
        }
      }

      if (!device) { setStatus('idle'); return false; }

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

      // Try the confirmed Zebra Parser Service UUID
      let writeChar: BleAny = null;
      let foundServiceUuid = '';

      try {
        const service = await server.getPrimaryService(ZEBRA_PARSER_SERVICE);
        writeChar = await service.getCharacteristic(ZEBRA_WRITE_CHAR);
        foundServiceUuid = ZEBRA_PARSER_SERVICE;
        console.log('Connected to Zebra Parser Service (38eb4a80)');
      } catch {
        console.log('Zebra Parser Service (38eb4a80) not found, trying FE79...');
      }

      // Try FE79 service
      if (!writeChar) {
        try {
          const service = await server.getPrimaryService(ZEBRA_FE79_SERVICE);
          // Look for any writable characteristic in FE79
          const chars = await service.getCharacteristics();
          for (const ch of chars) {
            if (ch.properties.writeWithoutResponse || ch.properties.write) {
              writeChar = ch;
              foundServiceUuid = ZEBRA_FE79_SERVICE;
              console.log(`Found writable char ${ch.uuid} on FE79 service`);
              break;
            }
          }
        } catch {
          console.log('FE79 service not found either');
        }
      }

      if (!writeChar) {
        // Log what services ARE available for debugging
        let availableServices = 'unknown';
        try {
          // This only works if we have permission for these services
          const services: BleAny[] = [];
          for (const svcId of ALL_OPTIONAL_SERVICES) {
            try {
              const svc = await server.getPrimaryService(svcId);
              services.push(svcId);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (_e: unknown) { /* not available */ }
          }
          availableServices = services.length > 0 ? services.join(', ') : 'none of the known Zebra services';
        } catch { /* ignore */ }

        setError(
          `Connected to ${device.name || 'printer'} but no print service found.\n` +
          `Available services: ${availableServices}\n\n` +
          `This may mean the ZD420T BLE is in config-only mode. ` +
          `Try: power-cycle the printer, or check if a BLE firmware update is needed.`
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
      if (msg.includes('cancelled') || msg.includes('canceled')) {
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

      if (msg.includes('GATT') || msg.includes('disconnected')) {
        try {
          if (deviceRef.current?.gatt && serviceUuidRef.current) {
            const server = await deviceRef.current.gatt.connect();
            const service = await server.getPrimaryService(serviceUuidRef.current);
            const chars = await service.getCharacteristics();
            let wc: BleAny = null;
            // Re-find the write characteristic
            for (const ch of chars) {
              if (ch.uuid === ZEBRA_WRITE_CHAR || ch.properties.writeWithoutResponse || ch.properties.write) {
                wc = ch;
                break;
              }
            }
            if (wc) {
              writeCharRef.current = wc;
              serverRef.current = server;
              const encoder = new TextEncoder();
              const retryData = encoder.encode(zpl);
              for (let offset = 0; offset < retryData.length; offset += CHUNK_SIZE) {
                const chunk = retryData.slice(offset, Math.min(offset + CHUNK_SIZE, retryData.length));
                if (wc.properties?.writeWithoutResponse) {
                  await wc.writeValueWithoutResponse(chunk);
                } else {
                  await wc.writeValue(chunk);
                }
              }
              setStatus('connected');
              return true;
            }
          }
        } catch { /* reconnect failed */ }
      }

      setError(`Print failed: ${msg}`);
      setStatus('error');
      return false;
    }
  }, []);

  return { connect, disconnect, print, isConnected, isSupported, printerName, status, error };
}
