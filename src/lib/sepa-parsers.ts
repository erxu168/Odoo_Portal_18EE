// src/lib/sepa-parsers.ts
// SEPA bank statement parsers — camt.053 XML, MT940 text, CSV
// Krawings Portal · krawings_rentals v1.1.0
//
// All parsers return a normalized ParsedSepa with positive credits only.
// Negative amounts (debits, outgoing) are dropped — we only match incoming rent.

import { SepaFormat } from '@/types/rentals';

export interface ParsedTx {
  tx_date: string;              // YYYY-MM-DD
  amount: number;               // always positive
  counterparty_iban: string | null;
  counterparty_bic: string | null;
  counterparty_name: string | null;
  purpose: string | null;
  end_to_end_id: string | null;
}

export interface ParsedSepa {
  bank_name: string | null;
  iban: string | null;
  total_credits: number;
  tx_count: number;
  transactions: ParsedTx[];
}

// ============================================================================
// Format detection
// ============================================================================

export function detectFormat(filename: string, content: string): SepaFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml')) return 'camt053';
  if (lower.endsWith('.sta') || lower.endsWith('.mt940') || lower.endsWith('.txt')) {
    // Look for MT940 signature
    if (/:20:/.test(content) && /:25:/.test(content)) return 'mt940';
  }
  if (lower.endsWith('.csv')) return 'csv';

  // Content-based detection
  if (content.trimStart().startsWith('<?xml') || content.includes('<Document')) return 'camt053';
  if (/:20:[^\r\n]+[\r\n]+:25:/.test(content)) return 'mt940';
  return 'csv';
}

// ============================================================================
// camt.053 XML parser (regex-based, no external deps)
// Full spec is complex, we extract only what matching needs.
// ============================================================================

export function parseCamt053(xml: string): ParsedSepa {
  const txs: ParsedTx[] = [];

  // Statement-level IBAN
  const ibanMatch = xml.match(/<Acct>[\s\S]*?<IBAN>([^<]+)<\/IBAN>/);
  const bankIban = ibanMatch ? ibanMatch[1].replace(/\s/g, '') : null;

  // Bank name from BIC or RlPtyId
  const bankMatch = xml.match(/<Svcr>[\s\S]*?<Nm>([^<]+)<\/Nm>/);
  const bankName = bankMatch ? bankMatch[1] : null;

  // Entries — each <Ntry> is a transaction
  const entryRegex = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null) {
    const ntry = m[1];

    // Credit/Debit indicator
    const cdtDbt = (ntry.match(/<CdtDbtInd>(\w+)<\/CdtDbtInd>/) || [])[1];
    if (cdtDbt !== 'CRDT') continue; // skip debits

    // Amount
    const amtMatch = ntry.match(/<Amt[^>]*>([\d.]+)<\/Amt>/);
    if (!amtMatch) continue;
    const amount = parseFloat(amtMatch[1]);

    // Booking date
    const dateMatch = ntry.match(/<BookgDt>[\s\S]*?<Dt>([^<]+)<\/Dt>/) ||
                      ntry.match(/<ValDt>[\s\S]*?<Dt>([^<]+)<\/Dt>/);
    const txDate = dateMatch ? dateMatch[1].slice(0, 10) : '';

    // TxDtls block contains counterparty info — there may be multiple, split this Ntry
    const txDtlsRegex = /<TxDtls>([\s\S]*?)<\/TxDtls>/g;
    const details = [];
    let td: RegExpExecArray | null;
    while ((td = txDtlsRegex.exec(ntry)) !== null) details.push(td[1]);

    // If no TxDtls, fall back to a single entry using the Ntry-level info
    const blocks = details.length > 0 ? details : [ntry];

    for (const block of blocks) {
      // Counterparty IBAN from debtor side (money flowing in from debtor)
      const dbtrIban = (block.match(/<DbtrAcct>[\s\S]*?<IBAN>([^<]+)<\/IBAN>/) || [])[1] || null;
      // Counterparty name
      const dbtrName = (block.match(/<Dbtr>[\s\S]*?<Nm>([^<]+)<\/Nm>/) || [])[1] || null;
      // BIC
      const dbtrBic = (block.match(/<DbtrAgt>[\s\S]*?<BIC>([^<]+)<\/BIC>/) ||
                       block.match(/<DbtrAgt>[\s\S]*?<BICFI>([^<]+)<\/BICFI>/) || [])[1] || null;

      // Purpose / remittance info — can be Strd or Ustrd
      const ustrdMatches = Array.from(block.matchAll(/<Ustrd>([^<]+)<\/Ustrd>/g));
      const purpose = ustrdMatches.length > 0
        ? ustrdMatches.map((x) => x[1]).join(' ').trim()
        : null;

      // End-to-end ID
      const eteId = (block.match(/<EndToEndId>([^<]+)<\/EndToEndId>/) || [])[1] || null;

      // If there are multiple TxDtls, each gets its own amount; otherwise use entry amount
      let txAmount = amount;
      const subAmt = block.match(/<Amt[^>]*>([\d.]+)<\/Amt>/);
      if (details.length > 1 && subAmt) txAmount = parseFloat(subAmt[1]);

      txs.push({
        tx_date: txDate,
        amount: txAmount,
        counterparty_iban: dbtrIban ? dbtrIban.replace(/\s/g, '') : null,
        counterparty_bic: dbtrBic,
        counterparty_name: dbtrName,
        purpose,
        end_to_end_id: eteId,
      });
    }
  }

  const total = txs.reduce((s, t) => s + t.amount, 0);
  return {
    bank_name: bankName,
    iban: bankIban,
    total_credits: Math.round(total * 100) / 100,
    tx_count: txs.length,
    transactions: txs,
  };
}

// ============================================================================
// MT940 parser
// MT940 is a line-oriented SWIFT format. Fields are :XX: tagged.
// :20: statement ref, :25: account, :60F: opening balance,
// :61: transaction (repeatable), :86: transaction description (follows :61:),
// :62F: closing balance.
// ============================================================================

export function parseMT940(text: string): ParsedSepa {
  const txs: ParsedTx[] = [];

  // Normalize line endings and join :86: wrapped lines
  const normalized = text.replace(/\r\n/g, '\n');

  // Account IBAN from :25:
  const acctMatch = normalized.match(/:25:([^\n]+)/);
  const iban = acctMatch ? acctMatch[1].trim().replace(/\s/g, '') : null;

  // Find all :61: + :86: pairs
  // :61: format: YYMMDD[MMDD]DC<amount>N<type>NONREF//<bank ref>
  // :86: is free-form multi-line until next :XX:
  const entries = Array.from(normalized.matchAll(/:61:([^\n]+)\n:86:((?:(?!:[0-9]{2}[A-Z]?:)[\s\S])*)/g));

  for (const e of entries) {
    const line61 = e[1];
    const block86 = e[2].replace(/\n/g, '').trim();

    // Parse :61:
    // value date YYMMDD
    const dateRaw = line61.slice(0, 6);
    const year = 2000 + parseInt(dateRaw.slice(0, 2), 10);
    const month = dateRaw.slice(2, 4);
    const day = dateRaw.slice(4, 6);
    const txDate = `${year}-${month}-${day}`;

    // D/C indicator after the date (possibly after optional entry date MMDD)
    // Simplify: find C or D followed by amount
    const dcMatch = line61.slice(6).match(/([CD])(\d+,\d{0,2})/);
    if (!dcMatch) continue;
    const dc = dcMatch[1];
    if (dc !== 'C') continue; // skip debits

    const amount = parseFloat(dcMatch[2].replace(',', '.'));

    // Parse :86: sub-fields — German banks use ?XX pattern
    // ?00 posting text, ?20-?29 purpose, ?32 name, ?33 name cont, ?31 BIC, ?30 BLZ / IBAN sometimes
    const subfield = (code: string): string | null => {
      const rx = new RegExp(`\\?${code}([^?]*)`, 'g');
      const matches = Array.from(block86.matchAll(rx));
      return matches.length > 0 ? matches.map((m) => m[1]).join('').trim() : null;
    };

    const purpose = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]
      .map((n) => subfield(String(n).padStart(2, '0')))
      .filter(Boolean)
      .join(' ')
      .trim();
    const name = [subfield('32'), subfield('33')].filter(Boolean).join(' ').trim() || null;
    const bic = subfield('30');

    // Try to extract IBAN from purpose (some banks embed it)
    const ibanInPurpose = purpose.match(/[A-Z]{2}\d{2}[A-Z0-9]{11,30}/);
    const counterpartyIban = ibanInPurpose ? ibanInPurpose[0] : null;

    txs.push({
      tx_date: txDate,
      amount,
      counterparty_iban: counterpartyIban,
      counterparty_bic: bic,
      counterparty_name: name,
      purpose: purpose || null,
      end_to_end_id: null,
    });
  }

  const total = txs.reduce((s, t) => s + t.amount, 0);
  return {
    bank_name: null,
    iban,
    total_credits: Math.round(total * 100) / 100,
    tx_count: txs.length,
    transactions: txs,
  };
}

// ============================================================================
// CSV parser — German bank export style
// Common columns: Buchungstag, Wertstellung, Auftraggeber/Empfänger,
//                 Buchungstext, Verwendungszweck, Betrag, Währung, IBAN, BIC
// We support comma or semicolon delimiters and € or plain amounts.
// ============================================================================

export function parseCSV(text: string): ParsedSepa {
  const txs: ParsedTx[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { bank_name: null, iban: null, total_credits: 0, tx_count: 0, transactions: [] };

  // Detect delimiter
  const delim = lines[0].includes(';') ? ';' : ',';

  // Parse header
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase().trim().replace(/"/g, ''));

  const idxDate = findCol(header, ['buchungstag', 'datum', 'valutadatum', 'date']);
  const idxAmount = findCol(header, ['betrag', 'amount']);
  const idxName = findCol(header, ['auftraggeber', 'empfänger', 'empfaenger', 'name', 'beguenstigter/zahlungspflichtiger']);
  const idxPurpose = findCol(header, ['verwendungszweck', 'purpose', 'buchungstext']);
  const idxIban = findCol(header, ['iban', 'kontonummer/iban']);
  const idxBic = findCol(header, ['bic', 'bic/swift']);

  if (idxDate < 0 || idxAmount < 0) {
    return { bank_name: null, iban: null, total_credits: 0, tx_count: 0, transactions: [] };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    if (cols.length < header.length / 2) continue;

    const amtRaw = (cols[idxAmount] || '').replace(/["€\s]/g, '').replace('.', '').replace(',', '.');
    const amount = parseFloat(amtRaw);
    if (isNaN(amount) || amount <= 0) continue; // skip debits / bad rows

    const txDate = normalizeDate(cols[idxDate] || '');
    if (!txDate) continue;

    txs.push({
      tx_date: txDate,
      amount,
      counterparty_iban: idxIban >= 0 ? cleanField(cols[idxIban]).replace(/\s/g, '') || null : null,
      counterparty_bic: idxBic >= 0 ? cleanField(cols[idxBic]) || null : null,
      counterparty_name: idxName >= 0 ? cleanField(cols[idxName]) || null : null,
      purpose: idxPurpose >= 0 ? cleanField(cols[idxPurpose]) || null : null,
      end_to_end_id: null,
    });
  }

  const total = txs.reduce((s, t) => s + t.amount, 0);
  return {
    bank_name: null,
    iban: null,
    total_credits: Math.round(total * 100) / 100,
    tx_count: txs.length,
    transactions: txs,
  };
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === delim && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function findCol(header: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = header.findIndex((h) => h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cleanField(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/^"|"$/g, '').trim();
}

function normalizeDate(s: string): string | null {
  s = s.trim().replace(/"/g, '');
  // DD.MM.YYYY
  const m1 = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // DD/MM/YYYY
  const m3 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return `${m3[3]}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`;
  return null;
}

// ============================================================================
// Master entry point
// ============================================================================

export function parseSepa(filename: string, content: string): { format: SepaFormat; parsed: ParsedSepa } {
  const format = detectFormat(filename, content);
  let parsed: ParsedSepa;
  switch (format) {
    case 'camt053': parsed = parseCamt053(content); break;
    case 'mt940': parsed = parseMT940(content); break;
    case 'csv': parsed = parseCSV(content); break;
  }
  return { format, parsed };
}
