/**
 * OCR abstraction for delivery-note scanning.
 *
 * Adapters:
 *   - MockOcr  — echoes the order's lines back with slight variance so the
 *                scan-and-match UX can be exercised without Azure credentials.
 *   - AzureOcr — Azure AI Document Intelligence, prebuilt-invoice model.
 *
 * Choose via env:
 *   OCR_MODE=mock|azure                           (default: mock)
 *   AZURE_DOC_INTEL_ENDPOINT=https://<resource>.cognitiveservices.azure.com
 *   AZURE_DOC_INTEL_KEY=<key>
 *   AZURE_DOC_INTEL_API_VERSION=2024-07-31        (optional, default shown)
 */

export interface OcrLine {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

export interface OcrResult {
  lines: OcrLine[];
  mode: 'mock' | 'azure';
  supplier_name?: string;
  invoice_date?: string;
  invoice_total?: number;
}

export interface MockHintLine {
  name: string;
  qty: number;
  price: number;
}

export interface OcrAdapter {
  scan(bytes: Buffer, opts?: { mockHint?: MockHintLine[] }): Promise<OcrResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Mock adapter — produces plausible OCR output derived from the order
// ─────────────────────────────────────────────────────────────────────
class MockOcr implements OcrAdapter {
  async scan(_bytes: Buffer, opts?: { mockHint?: MockHintLine[] }): Promise<OcrResult> {
    const hint = opts?.mockHint || [];
    if (hint.length === 0) return { lines: [], mode: 'mock' };

    const lines: OcrLine[] = hint.map((h, idx) => {
      // 20% of lines come in slightly short to simulate a real delivery mismatch
      const short = idx % 5 === 0;
      const qty = short ? Math.max(0, h.qty - 1) : h.qty;
      // OCR occasionally picks up a noisy last digit
      const priceNoise = idx % 4 === 0 ? 0.01 : 0;
      return {
        description: h.name,
        quantity: qty,
        unit_price: +(h.price + priceNoise).toFixed(2),
        amount: +(qty * h.price).toFixed(2),
      };
    });

    // Toss in one "extra" line not on the PO so the unmatched-banner UX shows up
    lines.push({
      description: 'Sonderposten Gewuerzmischung 500g',
      quantity: 2,
      unit_price: 4.9,
      amount: 9.8,
    });

    return { lines, mode: 'mock', supplier_name: '(mock supplier)', invoice_total: lines.reduce((s, l) => s + (l.amount || 0), 0) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Azure AI Document Intelligence adapter — prebuilt-invoice model
// ─────────────────────────────────────────────────────────────────────
class AzureOcr implements OcrAdapter {
  constructor(private endpoint: string, private key: string, private apiVersion: string) {}

  async scan(bytes: Buffer): Promise<OcrResult> {
    const base = this.endpoint.replace(/\/$/, '');
    const analyzeUrl = `${base}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=${this.apiVersion}`;

    const start = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(bytes),
    });
    if (start.status !== 202) {
      const body = await start.text().catch(() => '');
      throw new Error(`Azure analyze start failed (${start.status}): ${body.slice(0, 300)}`);
    }
    const opLoc = start.headers.get('operation-location');
    if (!opLoc) throw new Error('Azure analyze returned no operation-location');

    // Poll — Azure typically finishes in 2-8s
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const pollRes = await fetch(opLoc, { headers: { 'Ocp-Apim-Subscription-Key': this.key } });
      if (!pollRes.ok) throw new Error(`Azure poll failed: ${pollRes.status}`);
      const data = (await pollRes.json()) as any;
      if (data.status === 'failed') throw new Error(`Azure analysis failed: ${JSON.stringify(data.error || {}).slice(0, 300)}`);
      if (data.status !== 'succeeded') continue;

      const doc = data.analyzeResult?.documents?.[0];
      const items = doc?.fields?.Items?.valueArray || [];
      const lines: OcrLine[] = items.map((it: any) => {
        const obj = it.valueObject || {};
        return {
          description: obj.Description?.valueString || obj.ProductCode?.valueString || '',
          quantity: obj.Quantity?.valueNumber ?? null,
          unit_price: obj.UnitPrice?.valueCurrency?.amount ?? obj.UnitPrice?.valueNumber ?? null,
          amount: obj.Amount?.valueCurrency?.amount ?? obj.Amount?.valueNumber ?? null,
        };
      });
      const supplierName = doc?.fields?.VendorName?.valueString;
      const invoiceDate = doc?.fields?.InvoiceDate?.valueDate;
      const invoiceTotal = doc?.fields?.InvoiceTotal?.valueCurrency?.amount;

      return {
        lines,
        mode: 'azure',
        supplier_name: supplierName,
        invoice_date: invoiceDate,
        invoice_total: invoiceTotal,
      };
    }
    throw new Error('Azure analysis timed out after 60s');
  }
}

export function getOcr(): OcrAdapter {
  const mode = (process.env.OCR_MODE || 'mock').toLowerCase();
  if (mode === 'azure') {
    const ep = process.env.AZURE_DOC_INTEL_ENDPOINT;
    const key = process.env.AZURE_DOC_INTEL_KEY;
    const apiVersion = process.env.AZURE_DOC_INTEL_API_VERSION || '2024-07-31';
    if (!ep || !key) throw new Error('OCR_MODE=azure but AZURE_DOC_INTEL_ENDPOINT or AZURE_DOC_INTEL_KEY is missing');
    return new AzureOcr(ep, key, apiVersion);
  }
  return new MockOcr();
}

// ─────────────────────────────────────────────────────────────────────
// Matcher — correlate OCR lines to ordered lines
// ─────────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((w) => w.length >= 3));
}

export interface MatcherOrderLine {
  line_id: number;
  product_name: string;
  product_uom: string;
  ordered_qty: number;
  price: number;
}

export interface MatchedLine {
  line_id: number;
  product_name: string;
  received_qty: number;
  ocr_description: string;
  ocr_price: number | null;
  confidence: 'high' | 'medium' | 'low';
  price_flag: boolean;
}

export interface UnmatchedOcrLine {
  description: string;
  quantity: number | null;
  unit_price: number | null;
}

export interface MatchResult {
  matched: MatchedLine[];
  unmatched_ocr: UnmatchedOcrLine[];
  missing_ordered: { line_id: number; product_name: string; ordered_qty: number }[];
}

export function matchOcrToOrder(ocr: OcrLine[], ordered: MatcherOrderLine[]): MatchResult {
  const matched: MatchedLine[] = [];
  const unmatched_ocr: UnmatchedOcrLine[] = [];
  const matchedOrderedIds = new Set<number>();

  for (const o of ocr) {
    if (!o.description) {
      unmatched_ocr.push({ description: '', quantity: o.quantity, unit_price: o.unit_price });
      continue;
    }
    const ocrTokens = tokens(o.description);
    const ocrNorm = normalize(o.description);

    let bestScore = 0;
    let bestLine: MatcherOrderLine | null = null;
    for (const line of ordered) {
      if (matchedOrderedIds.has(line.line_id)) continue;
      const lineNorm = normalize(line.product_name);
      const lineTokens = tokens(line.product_name);

      let score = 0;
      if (ocrNorm === lineNorm) score = 1000;
      else if (ocrNorm.includes(lineNorm) || lineNorm.includes(ocrNorm)) score = 500;
      else {
        // Token overlap
        let overlap = 0;
        Array.from(ocrTokens).forEach((t) => { if (lineTokens.has(t)) overlap++; });
        const denom = Math.max(1, Math.min(ocrTokens.size, lineTokens.size));
        score = (overlap / denom) * 100;
      }
      if (score > bestScore) { bestScore = score; bestLine = line; }
    }

    if (bestLine && bestScore >= 50) {
      matchedOrderedIds.add(bestLine.line_id);
      const priceDelta = o.unit_price != null && bestLine.price > 0 ? Math.abs(o.unit_price - bestLine.price) / bestLine.price : 0;
      const confidence: 'high' | 'medium' | 'low' = bestScore >= 500 ? 'high' : bestScore >= 100 ? 'medium' : 'low';
      matched.push({
        line_id: bestLine.line_id,
        product_name: bestLine.product_name,
        received_qty: o.quantity ?? 0,
        ocr_description: o.description,
        ocr_price: o.unit_price,
        confidence,
        price_flag: priceDelta > 0.3,
      });
    } else {
      unmatched_ocr.push({ description: o.description, quantity: o.quantity, unit_price: o.unit_price });
    }
  }

  const missing_ordered = ordered
    .filter((l) => !matchedOrderedIds.has(l.line_id))
    .map((l) => ({ line_id: l.line_id, product_name: l.product_name, ordered_qty: l.ordered_qty }));

  return { matched, unmatched_ocr, missing_ordered };
}
