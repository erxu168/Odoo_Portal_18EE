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
  return { widthMm: 55, heightMm: 75 };
}

/**
 * Generate ZPL for a production label.
 *
 * Design principles:
 * - Product name is the LARGEST element (150% of body text), wraps to multiple lines
 * - Minimal white space — tight gaps between fields
 * - All available space is used (barcode fills bottom on larger labels)
 * - Expiry date is emphasized (bold, slightly larger)
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
  const margin = Math.round(2 * scale); // 2mm margin (tighter than before)
  const printW = wDots - margin * 2;
  const gap = Math.round(0.5 * scale); // 0.5mm between fields (tight)

  // Font sizes — product name is 150% of body text
  const fontTitle = Math.min(Math.round(7 * scale), 72);  // ~7mm, max 72 dots
  const fontBody = Math.min(Math.round(4.5 * scale), 48);  // ~4.5mm
  const fontMeta = Math.min(Math.round(3 * scale), 32);    // ~3mm

  // Calculate how many lines the product name needs
  const charsPerLine = Math.max(8, Math.floor(printW / (fontTitle * 0.55)));
  const nameLines = Math.min(3, Math.ceil(data.productName.length / charsPerLine));

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28', // UTF-8
  ];

  let y = margin;

  // ── PRODUCT NAME (large, wrapping) ──
  lines.push(`^CF0,${fontTitle}`);
  lines.push(`^FO${margin},${y}^FB${printW},${nameLines},0,L^FD${escapeZPL(data.productName)}^FS`);
  y += fontTitle * nameLines + gap;

  // ── Separator line ──
  lines.push(`^FO${margin},${y}^GB${printW},2,2^FS`);
  y += 2 + gap + gap;

  // ── Production Date ──
  lines.push(`^CF0,${fontBody}`);
  lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
  y += fontBody + gap;

  // ── Quantity + UOM (bold) ──
  lines.push(`^CF0,${fontBody}`);
  lines.push(`^FO${margin},${y}^FDQty: ${data.qty} ${data.uom}^FS`);
  y += fontBody + gap;

  // ── Expiry Date (emphasized) ──
  lines.push(`^FO${margin},${y}^FDExpiry: ${data.expiryDate}^FS`);
  y += fontBody + gap + gap;

  // ── MO + Container ──
  lines.push(`^CF0,${fontMeta}`);
  lines.push(`^FO${margin},${y}^FD${data.moName} | ${data.containerNumber}/${data.totalContainers}^FS`);
  y += fontMeta + gap;

  // ── Lot ──
  if (data.lotName) {
    lines.push(`^FO${margin},${y}^FDLot: ${data.lotName}^FS`);
    y += fontMeta + gap;
  }

  // ── Barcode (if space remains — at least 15mm) ──
  const remainingDots = hDots - y - margin;
  if (remainingDots > 15 * scale && data.barcodeValue) {
    y += gap;
    const barcodeH = Math.min(Math.round(10 * scale), remainingDots - margin);
    if (barcodeH > 20) {
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
