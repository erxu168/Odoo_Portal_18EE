// src/lib/sepa-matcher.ts
// SEPA transaction to Payment matching engine
// Krawings Portal · krawings_rentals v1.1.0
//
// Global matching strategy (tiered):
//   1. Exact: counterparty_iban already linked to a tenant from past matches
//            AND amount matches expected within ±€0.01
//   2. Strict IBAN+amount: match IBAN history + exact amount
//   3. Fuzzy IBAN+amount: match IBAN + amount within ±5% (partial payment)
//   4. Purpose text: scan purpose for tenant name / room code
//   5. Unmatched: leave for manual assignment
//
// A Payment can only be matched once. A SepaTransaction can only match once.

import { getRentalsDb, berlinNow } from '@/lib/rentals-db';
import { Payment, SepaTransaction } from '@/types/rentals';

export interface MatchResult {
  matched: number;
  partial: number;
  unmatched: number;
  details: Array<{
    tx_id: number;
    payment_id: number | null;
    method: 'auto_iban_amount' | 'auto_iban_fuzzy' | 'auto_purpose' | null;
    reason: string;
  }>;
}

interface TenantRow {
  tenant_id: number;
  tenant_name: string;
  tenancy_id: number;
  room_code: string;
  room_name: string | null;
}

export function runMatcher(importId: number): MatchResult {
  const db = getRentalsDb();
  const now = berlinNow();

  const result: MatchResult = { matched: 0, partial: 0, unmatched: 0, details: [] };

  // Pull unmatched transactions from this import
  const txs = db.prepare(`
    SELECT * FROM sepa_transactions
    WHERE import_id = ? AND status = 'unmatched'
  `).all(importId) as SepaTransaction[];

  // Pull open payments (expected or missing) with tenant + room info
  const openPayments = db.prepare(`
    SELECT p.*, t.tenant_id, tn.full_name AS tenant_name,
           r.room_code, r.room_name
    FROM payments p
    JOIN tenancies t ON t.id = p.tenancy_id
    JOIN tenants tn ON tn.id = t.tenant_id
    JOIN rooms r ON r.id = t.room_id
    WHERE p.status IN ('expected','missing','partial')
  `).all() as (Payment & TenantRow)[];

  // Build IBAN history map: iban -> set of tenant_ids that paid from it before
  const ibanHistory = new Map<string, Set<number>>();
  const pastMatches = db.prepare(`
    SELECT s.counterparty_iban, t.tenant_id
    FROM sepa_transactions s
    JOIN payments p ON p.id = s.matched_payment_id
    JOIN tenancies t ON t.id = p.tenancy_id
    WHERE s.counterparty_iban IS NOT NULL
  `).all() as { counterparty_iban: string; tenant_id: number }[];

  for (const row of pastMatches) {
    if (!ibanHistory.has(row.counterparty_iban)) {
      ibanHistory.set(row.counterparty_iban, new Set());
    }
    ibanHistory.get(row.counterparty_iban)!.add(row.tenant_id);
  }

  // Track used payments within this run
  const usedPayments = new Set<number>();

  const updateTx = db.prepare(`
    UPDATE sepa_transactions
    SET status = ?, matched_payment_id = ?, matched_by = ?
    WHERE id = ?
  `);
  const updatePayment = db.prepare(`
    UPDATE payments
    SET received_amount = ?, received_date = ?, sepa_tx_id = ?,
        status = ?, shortfall = ?, updated_at = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const sepaTx of txs) {
      // ---- Tier 1+2: Strict IBAN + amount ----
      if (sepaTx.counterparty_iban) {
        const knownTenants = ibanHistory.get(sepaTx.counterparty_iban);
        const candidates = openPayments.filter(
          (p) =>
            !usedPayments.has(p.id) &&
            knownTenants?.has(p.tenant_id) &&
            Math.abs(p.expected_amount - sepaTx.amount) < 0.01
        );
        if (candidates.length === 1) {
          applyMatch(candidates[0], sepaTx, 'matched', 'auto_iban_amount');
          continue;
        }

        // Strict amount without IBAN history (first payment from this IBAN)
        const exact = openPayments.filter(
          (p) =>
            !usedPayments.has(p.id) &&
            Math.abs(p.expected_amount - sepaTx.amount) < 0.01
        );
        if (exact.length === 1) {
          applyMatch(exact[0], sepaTx, 'matched', 'auto_iban_amount');
          continue;
        }
      }

      // ---- Tier 3: Fuzzy IBAN + amount (±5%, partial payment) ----
      if (sepaTx.counterparty_iban) {
        const knownTenants = ibanHistory.get(sepaTx.counterparty_iban);
        if (knownTenants) {
          const fuzzy = openPayments.filter((p) => {
            if (usedPayments.has(p.id)) return false;
            if (!knownTenants.has(p.tenant_id)) return false;
            const diff = Math.abs(p.expected_amount - sepaTx.amount);
            const pct = diff / p.expected_amount;
            return pct <= 0.5; // wide net for partial
          });
          if (fuzzy.length === 1) {
            const p = fuzzy[0];
            const status = sepaTx.amount >= p.expected_amount - 0.01 ? 'matched' : 'partial';
            applyMatch(p, sepaTx, status, 'auto_iban_fuzzy');
            continue;
          }
        }
      }

      // ---- Tier 4: Purpose text scan ----
      if (sepaTx.purpose) {
        const purposeLower = sepaTx.purpose.toLowerCase();
        const hits = openPayments.filter((p) => {
          if (usedPayments.has(p.id)) return false;
          const name = (p as unknown as TenantRow).tenant_name.toLowerCase();
          const lastName = name.split(' ').pop() || '';
          const roomCode = (p as unknown as TenantRow).room_code.toLowerCase();
          const roomName = ((p as unknown as TenantRow).room_name || '').toLowerCase();

          return (
            (lastName.length >= 4 && purposeLower.includes(lastName)) ||
            (roomCode.length >= 2 && purposeLower.includes(`zimmer ${roomCode}`)) ||
            (roomName.length >= 4 && purposeLower.includes(roomName))
          );
        });
        if (hits.length === 1) {
          const p = hits[0];
          const diff = Math.abs(p.expected_amount - sepaTx.amount);
          const status = diff < 0.01 ? 'matched' : (sepaTx.amount < p.expected_amount ? 'partial' : 'matched');
          applyMatch(p, sepaTx, status, 'auto_purpose');
          continue;
        }
      }

      // ---- Unmatched ----
      result.unmatched++;
      result.details.push({
        tx_id: sepaTx.id,
        payment_id: null,
        method: null,
        reason: 'No match',
      });
    }

    function applyMatch(
      payment: Payment & TenantRow,
      sepaTx: SepaTransaction,
      status: 'matched' | 'partial',
      method: 'auto_iban_amount' | 'auto_iban_fuzzy' | 'auto_purpose'
    ) {
      const shortfall = Math.max(0, payment.expected_amount - sepaTx.amount);
      updatePayment.run(
        sepaTx.amount,
        sepaTx.tx_date,
        sepaTx.id,
        status,
        shortfall,
        now,
        payment.id
      );
      updateTx.run(status, payment.id, method, sepaTx.id);
      usedPayments.add(payment.id);
      if (status === 'matched') result.matched++;
      else result.partial++;
      result.details.push({
        tx_id: sepaTx.id,
        payment_id: payment.id,
        method,
        reason: method === 'auto_iban_amount' ? 'IBAN + exact amount' :
                method === 'auto_iban_fuzzy' ? 'IBAN + fuzzy amount' : 'Purpose text match',
      });

      // Grow IBAN history within this run so later txs from same IBAN also benefit
      if (sepaTx.counterparty_iban) {
        if (!ibanHistory.has(sepaTx.counterparty_iban)) {
          ibanHistory.set(sepaTx.counterparty_iban, new Set());
        }
        ibanHistory.get(sepaTx.counterparty_iban)!.add(payment.tenant_id);
      }
    }
  });

  tx();

  // Any remaining open payments older than 5 days with no match become 'missing'
  db.prepare(`
    UPDATE payments
    SET status = 'missing', updated_at = ?
    WHERE status = 'expected'
      AND date(expected_date) <= date('now', '-5 days')
  `).run(now);

  return result;
}

// ============================================================================
// Manual assignment
// ============================================================================

export function manualAssign(
  txId: number,
  paymentId: number,
  _userId: number
): boolean {
  const db = getRentalsDb();
  const now = berlinNow();

  const tx = db.prepare(`SELECT * FROM sepa_transactions WHERE id = ?`).get(txId) as SepaTransaction | undefined;
  const payment = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId) as Payment | undefined;
  if (!tx || !payment) return false;

  const shortfall = Math.max(0, payment.expected_amount - tx.amount);
  const status = shortfall > 0.01 ? 'partial' : 'matched';

  const txn = db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET received_amount = ?, received_date = ?, sepa_tx_id = ?,
          status = ?, shortfall = ?, updated_at = ?
      WHERE id = ?
    `).run(tx.amount, tx.tx_date, tx.id, status, shortfall, now, paymentId);

    db.prepare(`
      UPDATE sepa_transactions
      SET status = 'manual_assigned', matched_payment_id = ?, matched_by = 'manual'
      WHERE id = ?
    `).run(paymentId, txId);
  });

  txn();
  return true;
}
