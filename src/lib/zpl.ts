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

  // ── Storage Mode + temperature pictogram (icon left, text right) ──
  const storeText =
    data.storageMode === 'both' ? 'COOLED & FROZEN' :
    data.storageMode === 'chilled' ? 'COOLED' :
    data.storageMode === 'frozen' ? 'FROZEN' :
    data.storageMode === 'ambient' ? 'AMBIENT' : null;
  if (storeText && data.storageMode) {
    const iconSize = Math.round(body.h * 1.4);
    const iconGap = Math.round(scale * 1.5);
    lines.push(...drawStorageIcon(data.storageMode, margin, y, iconSize));
    const textY = y + Math.max(0, Math.round((iconSize - body.h) / 2));
    lines.push(`^A0N,${body.h},${body.w}`);
    lines.push(`^FO${margin + iconSize + iconGap},${textY}^FD${escapeZPL(storeText)}^FS`);
    y += iconSize + gap;
  }

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

/**
 * Draw a temperature pictogram in ZPL primitives at (x, y) within a `size` × `size` box.
 * - chilled / both: 8-arm snowflake
 * - frozen: 8-arm snowflake inside an outline box (Codex Alimentarius "deep frozen" mark)
 * - ambient: sun (circle + 8 rays)
 * Uses ^GB (filled rects for arms), ^GD (diagonals), ^GE (ellipse). No bitmap data.
 */
function drawStorageIcon(
  mode: 'chilled' | 'frozen' | 'ambient' | 'both',
  x: number,
  y: number,
  size: number,
): string[] {
  const out: string[] = [];
  const lt = Math.max(2, Math.round(size * 0.09));            // line thickness
  const cx = x + Math.round(size / 2);
  const cy = y + Math.round(size / 2);

  if (mode === 'ambient') {
    // Sun: outline circle in the center + 8 rays
    const rC = Math.round(size * 0.30);                       // circle radius
    const rayInner = Math.round(size * 0.36);                  // ray start (just outside circle)
    const rayOuter = Math.round(size * 0.48);                  // ray end (near bbox edge)
    // Circle outline
    out.push(`^FO${cx - rC},${cy - rC}^GE${rC * 2},${rC * 2},${lt},B^FS`);
    // 4 cardinal rays (as thin rectangles)
    out.push(`^FO${cx - Math.round(lt / 2)},${cy - rayOuter}^GB${lt},${rayOuter - rayInner},${lt}^FS`); // top
    out.push(`^FO${cx - Math.round(lt / 2)},${cy + rayInner}^GB${lt},${rayOuter - rayInner},${lt}^FS`); // bottom
    out.push(`^FO${cx - rayOuter},${cy - Math.round(lt / 2)}^GB${rayOuter - rayInner},${lt},${lt}^FS`); // left
    out.push(`^FO${cx + rayInner},${cy - Math.round(lt / 2)}^GB${rayOuter - rayInner},${lt},${lt}^FS`); // right
    // 4 diagonal rays via short ^GD strokes from rayInner→rayOuter on the diagonal
    const d = Math.round(rayInner * 0.707);
    const D = Math.round(rayOuter * 0.707);
    out.push(`^FO${cx - D},${cy - D}^GD${D - d},${D - d},${lt},B,L^FS`); // NW
    out.push(`^FO${cx + d},${cy - D}^GD${D - d},${D - d},${lt},B,R^FS`); // NE
    out.push(`^FO${cx - D},${cy + d}^GD${D - d},${D - d},${lt},B,R^FS`); // SW
    out.push(`^FO${cx + d},${cy + d}^GD${D - d},${D - d},${lt},B,L^FS`); // SE
    return out;
  }

  // Snowflake (chilled / frozen / both) — 8-arm star
  // Frozen draws the same snowflake inside an outline box (deep-frozen pictogram).
  const boxed = mode === 'frozen';
  const armRadius = Math.round(size * (boxed ? 0.34 : 0.46));
  // 4 orthogonal arms (filled thin rectangles)
  out.push(`^FO${cx - armRadius},${cy - Math.round(lt / 2)}^GB${armRadius * 2},${lt},${lt}^FS`); // horizontal
  out.push(`^FO${cx - Math.round(lt / 2)},${cy - armRadius}^GB${lt},${armRadius * 2},${lt}^FS`); // vertical
  // 2 diagonal arms (one full diagonal line each across the bounding square)
  const d = Math.round(armRadius * 0.707);
  out.push(`^FO${cx - d},${cy - d}^GD${d * 2},${d * 2},${lt},B,L^FS`); // \
  out.push(`^FO${cx - d},${cy - d}^GD${d * 2},${d * 2},${lt},B,R^FS`); // /

  if (boxed) {
    // Outline box around the snowflake
    const half = Math.round(size * 0.46);
    out.push(`^FO${cx - half},${cy - half}^GB${half * 2},${half * 2},${lt}^FS`);
  }
  return out;
}

function escapeZPL(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, '\\^')
    .replace(/~/g, '\\~');
}


/**
 * A LOCATION label — the QR a person scans, the place's name, and as much of
 * the path above it as they asked for.
 *
 * Separate from generateZPL because it is a different label, not a variant:
 * that one is a product/expiry/lot label with a Code128 barcode, this one is a
 * shelf sticker with a QR. Sharing a function would have meant a pile of
 * optional fields and two layouts fighting inside one set of percentages.
 * They live in the same file so ZPL is written in exactly one place.
 *
 * Everything is a fraction of the label, so the same code fills 57 × 32 mm and
 * 100 × 50 mm without a second template.
 */
/**
 * QR module count (side length) by byte-mode payload length at ECC M — the
 * mode ^BQ uses for our data. Longer payloads (floorplan deep-link URLs) land
 * in higher QR versions with more, therefore smaller, modules; the printed
 * square must still fit its box, so magnification is derived from this.
 */
function qrModules(payloadLen: number): number {
  // Byte-mode capacities at ECC **Q** — the level `^FDQA,` actually selects
  // (Codex finding #20): v2=20, v3=32, v4=46, v5=60, v6=74 bytes.
  if (payloadLen <= 20) return 25;  // v2 — classic KWLOC-<id>
  if (payloadLen <= 32) return 29;  // v3
  if (payloadLen <= 46) return 33;  // v4
  if (payloadLen <= 60) return 37;  // v5 — typical floorplan URL
  if (payloadLen <= 74) return 41;  // v6
  return 45;                        // v7 — very long base URLs
}

export function generateLocationZPL(
  label: { name: string; branch?: string; code: string; qrData?: string },
  opts: { widthMm: number; heightMm: number; dpi?: number },
): string {
  const dpi = opts.dpi ?? 203;
  const scale = dotsPerMm(dpi);
  const wDots = Math.round(opts.widthMm * scale);
  const hDots = Math.round(opts.heightMm * scale);
  const margin = Math.round(2 * scale);
  const printW = wDots - margin * 2;

  // The QR is the point of the label, so it is sized first and everything else
  // fits beside it. ^BQ magnification is an integer number of dots per module;
  // the module count follows the payload (KWLOC-123 = 25, a deep-link URL
  // more), and module count times magnification is the printed width.
  const qrPayload = label.qrData ?? label.code;
  const modules = qrModules(qrPayload.length);
  const qrTargetDots = Math.min(Math.round(hDots * 0.62), Math.round(printW * 0.42));
  const mag = Math.max(2, Math.min(10, Math.round(qrTargetDots / modules)));
  const qrDots = mag * modules;
  const qrY = Math.round((hDots - qrDots) / 2);

  const textX = margin + qrDots + Math.round(3 * scale);
  const textW = wDots - margin - textX;

  const branchF = font(Math.max(14, hDots * 0.085));
  const nameF = font(Math.max(20, hDots * 0.19));
  const codeF = font(Math.max(12, hDots * 0.065));

  // Name block is vertically centred against the QR.
  const blockH = (label.branch ? branchF.h + Math.round(2 * scale) : 0) + nameF.h + Math.round(2 * scale) + codeF.h;
  let y = Math.max(margin, Math.round((hDots - blockH) / 2));

  const lines: string[] = ['^XA', `^PW${wDots}`, `^LL${hDots}`, '^CI28', '^LH0,0'];

  lines.push(`^FO${margin},${Math.max(margin, qrY)}^BQN,2,${mag}^FDQA,${escapeZPL(qrPayload)}^FS`);

  if (label.branch) {
    lines.push(`^FO${textX},${y}^A0N,${branchF.h},${branchF.w}^FB${textW},1,0,L,0^FD${escapeZPL(label.branch)}^FS`);
    y += branchF.h + Math.round(2 * scale);
  }
  // Up to two lines for the name — a drawer called "Shelf R-side" must not be cut.
  lines.push(`^FO${textX},${y}^A0N,${nameF.h},${nameF.w}^FB${textW},2,0,L,0^FD${escapeZPL(label.name)}^FS`);
  y += nameF.h * 2 + Math.round(2 * scale);
  lines.push(`^FO${textX},${Math.min(y, hDots - margin - codeF.h)}^A0N,${codeF.h},${codeF.w}^FB${textW},1,0,L,0^FD${escapeZPL(label.code)}^FS`);

  lines.push('^XZ');
  return lines.join('\n');
}
