/**
 * ZPL (Zebra Programming Language) template engine.
 * Generates ZPL strings dynamically based on label size and content.
 *
 * Coordinate system: origin top-left, units = dots.
 * 203 DPI: 1mm = 8 dots
 * 300 DPI: 1mm = 11.81 dots (~12)
 * 600 DPI: 1mm = 23.62 dots (~24)
 */
import { LABEL_SIZE_PRESETS, type LabelData } from '@/types/labeling';

const DPI_SCALE: Record<number, number> = {
  203: 8,
  300: 12,
  600: 24,
};

function dotsPerMm(dpi: number): number {
  return DPI_SCALE[dpi] ?? 8;
}

/** Resolve label dimensions in mm from preset ID or custom values */
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
  // fallback 4x4
  return { widthMm: 102, heightMm: 102 };
}

/**
 * Generate ZPL for a production label.
 * Layout adapts to label size:
 * - Small (height < 40mm): compact single-line fields, no barcode
 * - Medium (40-80mm): stacked fields with small barcode
 * - Large (>80mm): full layout with barcode + container info
 */
export function generateZPL(data: LabelData, opts: {
  widthMm: number;
  heightMm: number;
  dpi?: number;
}): string {
  const dpi = opts.dpi ?? 203;
  const scale = dotsPerMm(dpi);
  const wDots = Math.round(opts.widthMm * scale);
  const hDots = Math.round(opts.heightMm * scale);
  const margin = Math.round(3 * scale); // 3mm margin
  const printW = wDots - margin * 2;

  // Font sizes in dots (roughly: 203dpi, font 0, height)
  const fontLg = Math.min(Math.round(5 * scale), 56); // ~5mm or max 56 dots
  const fontMd = Math.min(Math.round(3.5 * scale), 40);
  const fontSm = Math.min(Math.round(2.5 * scale), 28);

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28', // UTF-8
  ];

  let y = margin;
  const lineGap = Math.round(1.5 * scale); // 1.5mm between fields

  // --- Product Name (always shown, large font) ---
  const maxChars = Math.floor(printW / (fontLg * 0.6));
  const productName = data.productName.length > maxChars
    ? data.productName.substring(0, maxChars - 1) + '.'
    : data.productName;
  lines.push(`^CF0,${fontLg}`);
  lines.push(`^FO${margin},${y}^FB${printW},1,0,L^FD${escapeZPL(productName)}^FS`);
  y += fontLg + lineGap;

  // --- Separator line ---
  if (opts.heightMm >= 40) {
    lines.push(`^FO${margin},${y}^GB${printW},2,2^FS`);
    y += 2 + lineGap;
  }

  // --- Production Date ---
  lines.push(`^CF0,${fontMd}`);
  lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
  y += fontMd + lineGap;

  // --- Quantity + UOM ---
  lines.push(`^FO${margin},${y}^FDQty: ${data.qty} ${data.uom}^FS`);
  y += fontMd + lineGap;

  // --- Expiry Date ---
  lines.push(`^FO${margin},${y}^FDExpiry: ${data.expiryDate}^FS`);
  y += fontMd + lineGap;

  // --- Container info (medium+ labels) ---
  if (opts.heightMm >= 51) {
    lines.push(`^CF0,${fontSm}`);
    lines.push(`^FO${margin},${y}^FD${data.moName} | Container ${data.containerNumber}/${data.totalContainers}^FS`);
    y += fontSm + lineGap;
  }

  // --- Lot (medium+ labels) ---
  if (opts.heightMm >= 51 && data.lotName) {
    lines.push(`^FO${margin},${y}^FDLot: ${data.lotName}^FS`);
    y += fontSm + lineGap;
  }

  // --- Barcode (large labels only, if space remains) ---
  if (opts.heightMm >= 76 && data.barcodeValue) {
    const barcodeH = Math.min(Math.round(12 * scale), hDots - y - margin); // max ~12mm
    if (barcodeH > 20) {
      y += lineGap;
      lines.push(`^FO${margin},${y}^BY2^BCN,${barcodeH},Y,N,N^FD${escapeZPL(data.barcodeValue)}^FS`);
    }
  }

  lines.push('^XZ');
  return lines.join('\n');
}

/** Escape special ZPL characters */
function escapeZPL(text: string): string {
  return text
    .replace(/\\/g, '\\\\') // backslash
    .replace(/\^/g, '\\^')  // caret
    .replace(/~/g, '\\~');  // tilde
}

/**
 * Send raw ZPL to a Zebra printer via TCP socket (port 9100).
 * Runs server-side only (Next.js API route).
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
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          socket.end();
          resolve();
        }
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Printer error (${ip}:${port}): ${err.message}`));
    });
  });
}
