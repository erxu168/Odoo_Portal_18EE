/**
 * ZPL (Zebra Programming Language) template engine.
 *
 * Coordinate system: origin top-left, units = dots.
 * 203 DPI: 1mm = 8 dots
 *
 * CRITICAL: Always use ^A0N,height,width with EXPLICIT width.
 * Without width, Zebra auto-calculates incorrectly → garbled text.
 * Safe ratio: width = height * 0.55 (slightly wider than 0.5 for clarity)
 */
import { LABEL_SIZE_PRESETS, type LabelData } from '@/types/labeling';

const DPI_SCALE: Record<number, number> = { 203: 8, 300: 12, 600: 24 };

function dotsPerMm(dpi: number): number {
  return DPI_SCALE[dpi] ?? 8;
}

export function resolveLabelSize(
  sizeId: string,
  customWidthMm?: number | null,
  customHeightMm?: number | null,
): { widthMm: number; heightMm: number } {
  if (sizeId === 'custom' && customWidthMm && customHeightMm) {
    return { widthMm: customWidthMm, heightMm: customHeightMm };
  }
  const preset = LABEL_SIZE_PRESETS.find(p => p.id === sizeId);
  if (preset) return { widthMm: preset.widthMm, heightMm: preset.heightMm };
  return { widthMm: 55, heightMm: 75 };
}

export function generateZPL(data: LabelData, opts: {
  widthMm: number;
  heightMm: number;
  dpi?: number;
}): string {
  const dpi = opts.dpi ?? 203;
  const scale = dotsPerMm(dpi);
  const wDots = Math.round(opts.widthMm * scale);
  const hDots = Math.round(opts.heightMm * scale);
  const margin = Math.round(2 * scale); // 2mm
  const printW = wDots - margin * 2;
  const gap = Math.round(0.8 * scale); // 0.8mm tight gap

  // Font sizes with EXPLICIT width (height * 0.55)
  const titleH = Math.min(Math.round(7 * scale), 56);
  const titleW = Math.round(titleH * 0.55);
  const bodyH = Math.min(Math.round(4.5 * scale), 40);
  const bodyW = Math.round(bodyH * 0.55);
  const emphH = Math.min(Math.round(5.5 * scale), 48); // emphasis: qty + expiry
  const emphW = Math.round(emphH * 0.55);
  const metaH = Math.min(Math.round(3 * scale), 28);
  const metaW = Math.round(metaH * 0.55);

  // Product name wrapping (up to 5 lines)
  const charsPerLine = Math.max(6, Math.floor(printW / titleW));
  const nameLines = Math.min(5, Math.ceil(data.productName.length / charsPerLine));

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28',
  ];

  let y = margin;

  // ── PRODUCT NAME (large, wrapping) ──
  lines.push(`^A0N,${titleH},${titleW}`);
  lines.push(`^FO${margin},${y}^FB${printW},${nameLines},0,L^FD${escapeZPL(data.productName)}^FS`);
  y += titleH * nameLines + gap;

  // ── Separator ──
  lines.push(`^FO${margin},${y}^GB${printW},3,3^FS`);
  y += 3 + gap;

  // ── Production Date (normal) ──
  lines.push(`^A0N,${bodyH},${bodyW}`);
  lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
  y += bodyH + gap;

  // ── Quantity (emphasized — larger + bold) ──
  lines.push(`^A0N,${emphH},${emphW}`);
  lines.push(`^FO${margin},${y}^FDQty: ${data.qty} ${data.uom}^FS`);
  y += emphH + gap;

  // ── Expiry Date (emphasized — larger + bold) ──
  lines.push(`^FO${margin},${y}^FDExpiry: ${data.expiryDate}^FS`);
  y += emphH + gap + gap;

  // ── MO + Container (meta) ──
  lines.push(`^A0N,${metaH},${metaW}`);
  lines.push(`^FO${margin},${y}^FD${escapeZPL(data.moName)} | ${data.containerNumber}/${data.totalContainers}^FS`);
  y += metaH + gap;

  // ── Lot (meta) ──
  if (data.lotName) {
    lines.push(`^FO${margin},${y}^FDLot: ${escapeZPL(data.lotName)}^FS`);
    y += metaH + gap;
  }

  // ── Barcode: fill remaining bottom space ──
  const remainingDots = hDots - y - margin;
  if (remainingDots > (10 * scale) && data.barcodeValue) {
    y += gap;
    const barcodeH = Math.min(remainingDots - Math.round(4 * scale), Math.round(15 * scale));
    if (barcodeH > 16) {
      lines.push(`^FO${margin},${y}^BY2^BCN,${barcodeH},Y,N,N^FD${escapeZPL(data.barcodeValue)}^FS`);
    }
  }

  lines.push('^XZ');
  return lines.join('\n');
}

/** Escape special ZPL characters */
function escapeZPL(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/~/g, '\\~');
}

/**
 * Send raw ZPL to a Zebra printer via TCP socket (port 9100).
 */
export async function sendToZebra(ip: string, port: number, zpl: string): Promise<void> {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Printer connection timed out (${ip}:${port})`));
    }, 5000);

    socket.connect(port, ip, () => {
      socket.write(zpl, 'utf-8', (err) => {
        clearTimeout(timeout);
        if (err) { socket.destroy(); reject(err); }
        else { socket.end(); resolve(); }
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Printer error (${ip}:${port}): ${err.message}`));
    });
  });
}
