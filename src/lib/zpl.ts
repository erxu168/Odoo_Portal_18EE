/**
 * ZPL (Zebra Programming Language) template engine.
 * Generates ZPL strings dynamically based on label size and content.
 *
 * Coordinate system: origin top-left, units = dots.
 * 203 DPI: 1mm = 8 dots
 *
 * IMPORTANT: Font 0 width must be explicitly set via ^A0N,height,width
 * to avoid garbled text. The printer auto-calculates width incorrectly
 * when only height is specified.
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

/**
 * Generate ZPL for a production label.
 * Uses large bold fonts with explicit width to prevent garbling.
 * Product name gets as many lines as needed (up to 5).
 * Fills available space — no wasted white space at bottom.
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
  const margin = Math.round(2 * scale); // 2mm
  const printW = wDots - margin * 2;
  const gap = Math.round(0.8 * scale); // tight 0.8mm gap

  // Large fonts — same size regardless of label width
  // The key fix: explicit width (50% of height) prevents garbling
  const titleH = Math.min(Math.round(7 * scale), 56); // ~7mm, big bold
  const titleW = Math.round(titleH * 0.5);             // explicit width!
  const bodyH = Math.min(Math.round(4.5 * scale), 40); // ~4.5mm
  const bodyW = Math.round(bodyH * 0.5);
  const metaH = Math.min(Math.round(3 * scale), 28);   // ~3mm
  const metaW = Math.round(metaH * 0.5);

  // Calculate product name wrapping — allow up to 5 lines
  const charsPerLine = Math.max(6, Math.floor(printW / titleW));
  const nameLines = Math.min(5, Math.ceil(data.productName.length / charsPerLine));

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28',
  ];

  let y = margin;

  // ── PRODUCT NAME (large, wraps as needed) ──
  lines.push(`^A0N,${titleH},${titleW}`);
  lines.push(`^FO${margin},${y}^FB${printW},${nameLines},0,L^FD${escapeZPL(data.productName)}^FS`);
  y += titleH * nameLines + gap;

  // ── Separator ──
  lines.push(`^FO${margin},${y}^GB${printW},2,2^FS`);
  y += 2 + gap;

  // ── Production Date ──
  lines.push(`^A0N,${bodyH},${bodyW}`);
  lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
  y += bodyH + gap;

  // ── Quantity ──
  lines.push(`^FO${margin},${y}^FDQty: ${data.qty} ${data.uom}^FS`);
  y += bodyH + gap;

  // ── Expiry ──
  lines.push(`^FO${margin},${y}^FDExpiry: ${data.expiryDate}^FS`);
  y += bodyH + gap;

  // ── MO + Container ──
  lines.push(`^A0N,${metaH},${metaW}`);
  lines.push(`^FO${margin},${y}^FD${data.moName} | ${data.containerNumber}/${data.totalContainers}^FS`);
  y += metaH + gap;

  // ── Lot ──
  if (data.lotName) {
    lines.push(`^FO${margin},${y}^FDLot: ${data.lotName}^FS`);
    y += metaH + gap;
  }

  // ── Barcode: fill remaining space at bottom ──
  const remainingDots = hDots - y - margin;
  if (remainingDots > (12 * scale) && data.barcodeValue) {
    y += gap;
    // Use all remaining space for the barcode
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
