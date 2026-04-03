/**
 * ZPL (Zebra Programming Language) template engine.
 *
 * RESPONSIVE DESIGN: Layout adapts proportionally to ANY label size.
 * Font sizes and spacing scale with label dimensions.
 * 
 * CRITICAL: Always use ^A0N,height,width with EXPLICIT width.
 * Without width, Zebra auto-calculates incorrectly → garbled text.
 * Safe ratio: width = height * 0.55
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

/** Helper: font height + explicit width (0.55 ratio) */
function font(h: number): { h: number; w: number } {
  const fh = Math.round(h);
  return { h: fh, w: Math.round(fh * 0.55) };
}

/**
 * Generate ZPL for a production label.
 *
 * RESPONSIVE LAYOUT — scales to any label size:
 * - Title:  ~13% of label height per line (large, bold)
 * - Body:   ~7% per line (produced date)
 * - Emph:   ~9% per line (qty + expiry — emphasized)
 * - Meta:   ~5% per line (MO, lot — small)
 * - Gap:    ~1.5% between fields
 * - Barcode: fills whatever space remains at the bottom
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
  const margin = Math.round(2 * scale); // 2mm margin
  const printW = wDots - margin * 2;

  // Responsive font sizes — proportional to label height
  const title = font(hDots * 0.093);  // ~7mm on 75mm label
  const body  = font(hDots * 0.06);   // ~4.5mm on 75mm label
  const emph  = font(hDots * 0.073);  // ~5.5mm on 75mm label
  const meta  = font(hDots * 0.04);   // ~3mm on 75mm label
  const gap   = Math.max(4, Math.round(hDots * 0.013)); // ~1mm on 75mm label

  // Product name wrapping — calculate lines needed, max 5
  const charsPerLine = Math.max(6, Math.floor(printW / title.w));
  const nameLines = Math.min(5, Math.ceil(data.productName.length / charsPerLine));

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28',
  ];

  let y = margin;

  // ── PRODUCT NAME (large, wrapping) ──
  lines.push(`^A0N,${title.h},${title.w}`);
  lines.push(`^FO${margin},${y}^FB${printW},${nameLines},0,L^FD${escapeZPL(data.productName)}^FS`);
  y += title.h * nameLines + gap;

  // ── Separator ──
  const sepH = Math.max(2, Math.round(hDots * 0.005));
  lines.push(`^FO${margin},${y}^GB${printW},${sepH},${sepH}^FS`);
  y += sepH + gap;

  // ── Production Date (normal body size) ──
  lines.push(`^A0N,${body.h},${body.w}`);
  lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
  y += body.h + gap;

  // ── Quantity (emphasized — larger) ──
  lines.push(`^A0N,${emph.h},${emph.w}`);
  lines.push(`^FO${margin},${y}^FDQty: ${data.qty} ${data.uom}^FS`);
  y += emph.h + gap;

  // ── Expiry Date (emphasized — larger) ──
  lines.push(`^FO${margin},${y}^FDExpiry: ${data.expiryDate}^FS`);
  y += emph.h + gap + gap;

  // ── MO + Container (meta — small) ──
  lines.push(`^A0N,${meta.h},${meta.w}`);
  lines.push(`^FO${margin},${y}^FD${escapeZPL(data.moName)} | ${data.containerNumber}/${data.totalContainers}^FS`);
  y += meta.h + gap;

  // ── Lot (meta — small) ──
  if (data.lotName) {
    lines.push(`^FO${margin},${y}^FDLot: ${escapeZPL(data.lotName)}^FS`);
    y += meta.h + gap;
  }

  // ── Barcode: fill remaining bottom space ──
  const remainingDots = hDots - y - margin;
  if (remainingDots > (8 * scale) && data.barcodeValue) {
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
