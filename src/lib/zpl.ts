/**
 * ZPL (Zebra Programming Language) template engine.
 *
 * RESPONSIVE DESIGN: All sizes are percentages of label height.
 * CRITICAL: Always use ^A0N,height,width with EXPLICIT width (ratio 0.55).
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

function font(h: number): { h: number; w: number } {
  const fh = Math.round(h);
  return { h: fh, w: Math.round(fh * 0.55) };
}

/**
 * RESPONSIVE LAYOUT:
 * - Title:      9.3% per line, max 3 lines (product name)
 * - Body:       5.5% per line (produced date — normal)
 * - Qty:        9% per line (emphasized)
 * - Expiry:     18% per line (DOUBLE emphasized — biggest after title)
 * - Meta:       3.5% per line (MO, lot — compact)
 * - Gap:        1.2%
 * - Barcode:    fills remaining bottom
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
  const margin = Math.round(2 * scale);
  const printW = wDots - margin * 2;
  const gap = Math.max(4, Math.round(hDots * 0.012));

  // Responsive fonts — percentages of label height
  const title = font(hDots * 0.121);   // product name (was 0.093, +30%)
  const ref   = font(hDots * 0.0605);  // product reference — half of title
  const body  = font(hDots * 0.0715);  // produced date (was 0.055, +30%)
  const qty   = font(hDots * 0.09);
  const exp   = font(hDots * 0.144);   // expiry (was 0.18, -20%)
  const meta  = font(hDots * 0.035);
  const sepH  = Math.max(2, Math.round(hDots * 0.005));

  // Product name: max 3 lines
  const charsPerLine = Math.max(6, Math.floor(printW / title.w));
  const nameLines = Math.min(3, Math.ceil(data.productName.length / charsPerLine));

  const lines: string[] = [
    '^XA',
    `^PW${wDots}`,
    `^LL${hDots}`,
    '^CI28',
  ];

  let y = margin;

  // ── PRODUCT NAME (large, max 3 lines) ──
  lines.push(`^A0N,${title.h},${title.w}`);
  lines.push(`^FO${margin},${y}^FB${printW},${nameLines},0,L^FD${escapeZPL(data.productName)}^FS`);
  y += title.h * nameLines + gap;

  // ── Product reference (half title size, optional) ──
  if (data.productReference && data.productReference.trim()) {
    lines.push(`^A0N,${ref.h},${ref.w}`);
    lines.push(`^FO${margin},${y}^FD${escapeZPL(data.productReference)}^FS`);
    y += ref.h + gap;
  }

  // ── Separator ──
  lines.push(`^FO${margin},${y}^GB${printW},${sepH},${sepH}^FS`);
  y += sepH + gap;

  const hasProductionDate = !!(data.productionDate && String(data.productionDate).trim());
  const hasUom = !!(data.uom && String(data.uom).trim());
  const hasQty = data.qty !== 0 || hasUom;
  const hasExpiry = !!(data.expiryDate && String(data.expiryDate).trim());
  const hasMeta = !!data.moName && data.containerNumber != null && data.totalContainers != null;

  // ── Production Date (normal) ──
  if (hasProductionDate) {
    lines.push(`^A0N,${body.h},${body.w}`);
    lines.push(`^FO${margin},${y}^FDProduced: ${data.productionDate}^FS`);
    y += body.h + gap;
  }

  // ── Quantity (emphasized) ──
  if (hasQty) {
    lines.push(`^A0N,${qty.h},${qty.w}`);
    const qtyText = hasUom ? `Qty: ${data.qty} ${data.uom}` : `Qty: ${data.qty}`;
    lines.push(`^FO${margin},${y}^FD${qtyText}^FS`);
    y += qty.h + gap;
  }

  // ── Storage Mode (small, informational) ──
  const storeLabel = `STORE: ${data.storageMode.toUpperCase()}`;
  lines.push(`^A0N,${body.h},${body.w}`);
  lines.push(`^FO${margin},${y}^FB${printW},1,0,L^FD${escapeZPL(storeLabel)}^FS`);
  y += body.h + gap;

  // ── Expiry Date (HUGE — 2x emphasis) ──
  if (hasExpiry) {
    lines.push(`^A0N,${exp.h},${exp.w}`);
    lines.push(`^FO${margin},${y}^FDExp: ${data.expiryDate}^FS`);
    y += exp.h + gap;
  }

  // ── MO + Container (small meta) ──
  if (hasMeta) {
    lines.push(`^A0N,${meta.h},${meta.w}`);
    lines.push(`^FO${margin},${y}^FD${escapeZPL(data.moName)} | ${data.containerNumber}/${data.totalContainers}^FS`);
    y += meta.h + gap;
  }

  // ── Lot (small meta) ──
  if (data.lotName) {
    lines.push(`^A0N,${meta.h},${meta.w}`);
    lines.push(`^FO${margin},${y}^FDLot: ${escapeZPL(data.lotName)}^FS`);
    y += meta.h + gap;
  }

  // ── Barcode: fill remaining bottom ──
  const remainingDots = hDots - y - margin;
  if (remainingDots > (8 * scale) && data.barcodeValue) {
    y += gap;
    const barcodeH = Math.min(remainingDots - Math.round(4 * scale), Math.round(12 * scale));
    if (barcodeH > 16) {
      lines.push(`^FO${margin},${y}^BY2^BCN,${barcodeH},Y,N,N^FD${escapeZPL(data.barcodeValue)}^FS`);
    }
  }

  lines.push('^XZ');
  return lines.join('\n');
}

function escapeZPL(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/~/g, '\\~');
}

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
