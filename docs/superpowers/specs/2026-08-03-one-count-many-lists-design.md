# 2026-08-03 - One count, credited to every list that asked

Status: **awaiting Ethan's sign-off**. No code written yet.

Origin: Ethan clarified the model - Daily = perishables, Weekly = packaging /
sauces / slow movers, and "Today's Count" is the union of every list due that
day so staff walk each location once. He chose (a) warn and offer to remove when
a new list duplicates products already on another list, and (b) make overlap
harmless FIRST, warnings second.

Designed by three independent approaches (store provenance / derive it / reframe
the reporting unit), judged on history integrity, correctness of the consumption
maths, and blast radius.

---

# Plan — "One count, credited to every list that asked"
### Synthesis: Design 3 (reframe) shipped in its own staged order, with grafts from 1 and 2

**Verified in `/Users/ethan/Odoo_Portal_18EE` before writing (read-only).** The facts the three designs disagreed on:

- **Spots are global.** `snapshotSessionFromProducts` (`src/lib/inventory-db.ts:2789`) resolves spots from `product_locations`; `template_product_locations` is retired by the `tpl_placements_to_home_spots` migration (`:753-780`). A list is a bare product set and can never ask for a product at only some of its spots. → **Design 3's product-grained key is right; Design 1's spot-grained key is verified redundant.** Adopted.
- **`foreign_keys = ON`** (`src/lib/db.ts:48`), and `session_source_templates` has `ON DELETE CASCADE` on `session_id` (`inventory-db.ts:609-616`). So a deleted list's rows in *other* sessions (the walks it fed) survive today. → the new table copies that shape exactly.
- **The skipped-spot bug is real.** `totals()` (`src/app/api/inventory/usage/route.ts:76-85`) reads `getSessionEntries` and knows nothing about `session_location_status` (`inventory-db.ts:183`). A product at two spots where one is skipped yields a *partial* sum with `complete: true` → usage silently overstated. Designs 1 and 2 both assert the opposite. → Design 3's diagnosis stands, fixed in its own step.
- **The picker blocks the pairing too**, not just the server: `ConsumptionReport.tsx:47-52` filters closing options to `s.template_id === opening.template_id`. Step 1 must touch both.

**Rejected from the runners-up, with reasons:** Design 1's spot-grained key (carries no information, drags in `reassignCountsForProduct` and the floorplan spot guard), its `throw` inside the count-creation transaction (a reporting feature must never be able to stop a count starting), and its "credit an unmatched line to *every* source" backfill (fabricates an ask into a table that by its own philosophy is never revised). Design 2's live-derived walk membership (`counting_templates.product_ids` is rewritten by the list editor *and* by `deleteProductPortalData:3655-3661`, so ordinary product deletion would retroactively rewrite what a signed-off count covered). Design 3's own free date-range mode and its permanent second API mode.

**Grafted in:** from Design 1 — frozen `name`/`frequency`/`origin` columns and the union-of-both-endpoints scope rule; from Design 2 — no throw on the write path (fail-soft + `console.warn`), history reads never gated on `INVENTORY_MERGED_WALK`, and the insight that **a solo session's frozen snapshot *is* that list's ask** — which is what lets Step 1 fix the live regression with **zero schema change and zero write-path change**.

---

## 1. Feature summary

Right now the Usage report can only compare two counts of the same list, so since combined walks started, 2 August can no longer be compared with 3 August. This change makes the report work on **a list over two days** instead of on two counts: you pick "Daily", pick the two days, and the portal works out which count covered that list on each day — whether it was a list of its own or part of a combined walk. A product that sits on several lists is still counted once by staff, and that one number is shown in every list's report, so no list ever has a hole and there is never a second answer.

## 2. User roles affected

| Role | Effect |
|---|---|
| **Manager / Admin** (`inventory.consumption.view`) | The only role that sees a change: the Usage report gains a list picker and works across combined days. |
| **Staff / counters** | **No visible change.** No change to the counting screen, the walk, offline entry, photos, or submit. |
| **Reviewers** (`inventory.review`) | No change in this scope. (Showing per-list chips on a walk in Review Submissions is a separate, later issue.) |

## 3. Entry points

- Inventory → **Usage** (`ConsumptionReport`) — the only place anything changes.
- `GET /api/inventory/usage` — behaviour changes; the URL and its two session parameters stay valid, so existing links keep working.
- `GET /api/inventory/usage/options` — new, read-only, feeds the pickers.
- Nothing new on the dashboard, no new nav drawer tile (per the nav-drawer-sync rule, nothing to sync — this lives inside Inventory).

## 4. Main flow (numbered)

1. Manager opens Inventory → Usage.
2. The screen loads **lists that have counts** — real lists only (never the synthetic "Today's Count" walk template), company-scoped, including retired lists that still have history, marked *(no longer used)*.
3. Manager picks a list, e.g. **Daily Produce**. It defaults to the most recently counted list.
4. The screen loads **the days that list was actually counted**. Each option shows the day and, when that day was a combined walk, says so: `Sun 3 Aug — counted in Today's Count (Daily Produce + Weekly Packaging)`.
5. Manager picks a **start day** and an **end day** (defaults: the two most recent counted days).
6. The client resolves each day to the session that covered that list and calls `GET /api/inventory/usage?opening_session=…&closing_session=…&list=…`.
7. The server checks access and company, confirms **both counts credit that list**, and builds the product set = *products credited to that list at the start* ∪ *at the end*.
8. For each product: `used = start count + deliveries received − binned − end count`, exactly as today. Deliveries and waste use the same unchanged window.
9. The screen shows one row per product, the disclosure line naming which counts answered, and a footer for anything excluded (deliveries of products not on this list).

## 5. Alternative and error flows

| Situation | What happens |
|---|---|
| The two counts have **no list in common** | 400 — "These two counts have no list in common." |
| They share **more than one** list and none was named | 400 with the candidate lists; the picker never produces this because a list is always chosen. |
| **Both days were combined walks** *(before Step 4 ships)* | 400 — "Per-list usage across two combined days isn't available yet." After Step 4: works normally. |
| A count **credits the list zero products** | Refused as "that list wasn't counted that day" — never computed, because an empty start count would silently produce `used = deliveries − waste`, a large confidently-wrong number. |
| Either count is **rejected** or still **open** | Allowed, with a warning band naming the status. A `missed` day is never offered. |
| Either count's provenance was **reconstructed** (Step 3 backfill) | Amber band: "3 Aug's split between lists was worked out after the fact. If a list was edited since, a product could be missing." |
| A **legacy count with no frozen line snapshot** (old category list) | Falls back to today's exact rule — both counts must be of the same list. Unchanged behaviour, no guessing. |
| Product **not counted at one end** | Row shows the reason: *not counted* / *wasn't on this list then* / *couldn't be found* / *a spot was skipped* — never a number. |
| Product **delivered but not on this list** | Not a row. Named in a footer count so nothing is hidden. |
| Network / permission failure | Existing handling unchanged (401/403, "Network error. Try again."). |

## 6. Screen / component changes

**`src/components/inventory/ConsumptionReport.tsx`** — the only component changed.

- Replace the two opaque count select menus (`:100-118`) and the `closingOptions` template filter (`:45-52`) with: **List** select menu → **Start day** → **End day**.
- Disclosure line under the pickers: `2 Aug — Daily Produce · 3 Aug — Today's Count (Daily Produce + Weekly Packaging)`. The word "session" never appears.
- Status band (count not approved yet / was rejected) and confidence band (provenance reconstructed).
- The amber "not counted" badge (`:141-158`) becomes reason-aware.
- Footer: "4 products had deliveries in this period but aren't on this list."

Design standard: portal rules — white cards, **blue** header, **green** = action, **red** reserved for real problems, amber for gaps. Mobile-first; the three pickers stack full-width on smartphone, sit in a row from tablet up. No desktop-only styling added.

**Not changed:** `CountingSession.tsx`, `MyLists.tsx`, `DueCountCard.tsx`, `InventoryDashboard.tsx`, `ReviewSubmissions.tsx`, `session-route.ts`. `MyLists.tsx:172` uses `source_templates_json` being non-empty as its "this is a walk" signal, so that field keeps its exact current meaning and nothing new is written into it.

## 7. Data-model changes (exact)

**One new table**, placed immediately after the `session_source_templates` block (`src/lib/inventory-db.ts:~617`):

```sql
-- WHICH LIST ASKED FOR THIS PRODUCT IN THIS COUNT.
-- session_source_templates records which lists fed a walk; this records, per
-- product, which of them wanted it. A product on three lists is counted ONCE
-- and gets three rows here, so every list can be reported without a hole and
-- no list ever sees a second answer.
-- FROZEN at snapshot time: editing a list later must never rewrite what a
-- past count was about. Product-grained on purpose — spots are global home
-- spots (template_product_locations is retired), so a list can never ask for a
-- product at only some of its spots.
CREATE TABLE IF NOT EXISTS session_line_sources (
  session_id         INTEGER NOT NULL REFERENCES counting_sessions(id) ON DELETE CASCADE,
  odoo_product_id    INTEGER NOT NULL,
  source_template_id INTEGER NOT NULL,   -- deliberately NO FK: a deleted list
                                         -- must not erase the fact it fed a walk
  name               TEXT    NOT NULL,   -- frozen, so a rename can't rewrite history
  frequency          TEXT    NOT NULL,   -- frozen
  origin             TEXT    NOT NULL DEFAULT 'frozen',  -- 'frozen' | 'backfilled'
  PRIMARY KEY (session_id, odoo_product_id, source_template_id)
);
CREATE INDEX IF NOT EXISTS idx_line_sources_session  ON session_line_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_line_sources_template ON session_line_sources(source_template_id, session_id);
```

**Nothing else changes shape.** `session_count_items`, `count_entries`, `counting_sessions`, `session_source_templates`, `counting_templates` are untouched. In particular `session_count_items`' primary key stays `(session_id, odoo_product_id, count_location_id)` — widening it would break `lines_total` (`:1151`), the flat completeness gate (`sessions/route.ts:301-311`), the `idx_entries_line` UNIQUE (`:586`) and `resolveSessionRoute`.

**Housekeeping the new table needs (each in its existing transaction):**

| Function | Line | Add |
|---|---|---|
| `deleteSessionArtifacts` | `:1254-1267` | `DELETE FROM session_line_sources WHERE session_id = ?` (belt-and-braces, matching the sibling deletes) |
| `deleteTemplate` | `:1832-1838` | nothing — the FK cascade on `session_id` clears its own sessions; rows recording that it fed **someone else's** walk are **kept on purpose**, exactly as `session_source_templates` behaves today |
| `deleteProductPortalData` | `:3644-3652` | add `'session_line_sources'` to the `['session_count_items','session_packaging_levels']` loop; its open-status scoping is already the right rule |
| `reassignCountsForProduct` | `:2468+` | `UPDATE OR IGNORE … SET odoo_product_id = ?` then `DELETE` the leftovers — trivially simple because the key is product-grained, no spot dance |
| `src/lib/inventory-floorplan/db.ts:632` | — | **no change**; the table carries no `count_location_id`, so it is not a location-work table |

**Migrations** (both at the end of `initInventoryTables()`, after `freeze_legacy_sessions_flat` at `:844-869`, using `tx.immediate()` like `normalize_overlapping_home_spots` at `:836-838`, keys `attribute_solo_session_lines` / `attribute_walk_session_lines`): see Step 3.

## 8. Permission changes

**None.** No new permission keys, no role changes, no `/admin/permissions` update.

- Report + new options endpoint: existing `inventory.consumption.view` (`src/lib/permissions.ts:85`, default `manager`, `admin`).
- Both endpoints keep `requireAuth` → `roleCan` → `canAccessSession` on **both** sessions, plus the existing same-company check.
- The options endpoint is company-scoped from the user's own companies and, unlike `GET /api/inventory/sessions` (which generates today's sessions as a side effect at `sessions/route.ts:27-34`), it **must not create anything** — a report picker never writes.
- UI: the Usage entry point is already gated by the same key; nothing new to hide or show.

## 9. Acceptance criteria (Given / When / Then)

1. **Given** 2 Aug is a Daily-only count and 3 Aug is a combined walk that absorbed Daily, **when** a manager picks Daily and those two days, **then** the report shows per-product usage instead of "Both counts must be of the same list".
2. **Given** the 3 Aug walk also absorbed Weekly, **when** the Daily report is shown, **then** Weekly-only products do not appear in it.
3. **Given** a product is on Daily, Weekly and Monthly and all three are due the same day, **when** staff count it, **then** they are asked for it once per physical spot, exactly one number per spot is stored, and Daily's, Weekly's and Monthly's reports all show that same total.
4. **Given** a count exists, **when** a manager later adds or removes a product from that list, **then** that past count's numbers **and** its list provenance are byte-identical to before the edit.
5. **Given** a manager removes a product from Daily after both endpoints were counted, **when** the Daily report for those days runs, **then** the product still appears with real numbers (scope is the union of both endpoints), not as a false "not counted".
6. **Given** a walk day where a list matched zero products, **when** it is chosen as an endpoint, **then** the report refuses it as "that list wasn't counted that day" and never computes `deliveries − waste`.
7. **Given** a product lives at two spots and one spot was skipped, **when** the report runs, **then** the product is reported as incomplete with reason "a spot was skipped" — not given a partial number.
8. **Given** a list is retired (deactivated) after it has history, **when** a manager opens Usage, **then** the list is still selectable, labelled *(no longer used)*, and its past days still report.
9. **Given** a walk whose provenance was reconstructed by the backfill, **when** it is an endpoint, **then** the screen shows the amber "worked out after the fact" band.
10. **Given** `INVENTORY_MERGED_WALK` is switched off, **when** a manager opens a past walk day in Usage, **then** it still resolves and reports — turning the flag off stops walks being *created*, never stops history being *read*.
11. **Given** an old count with no frozen line snapshot, **when** it is paired, **then** today's exact same-list rule applies and behaviour is unchanged.
12. **Given** any of these steps is reverted with `git revert`, **when** the app restarts, **then** counting and approval behave exactly as before that step.

## 10. Open assumptions

1. **`INVENTORY_MERGED_WALK` is on at staging out-of-band.** It appears nowhere in `deploy/` or `ops/`, and `tests/walkable-groups.unit.spec.ts:15` calls *off* "the shipping configuration". **Ethan/me action:** get the flag into deploy config so the code and the running server agree. Attribution writes and history reads are deliberately **not** gated on it either way.
2. **The 3 Aug walk's source lists have not been edited since this morning.** If true, Step 3's reconstruction is exact for it. I will not assume it — Step 3 ships with a read-only audit I run on staging and report in plain words before Step 4 relies on it.
3. **Roughly 11 pre-walk sessions exist**, all solo. Their backfill is exact by construction, not a guess.
4. **"Credited to every list" is per-report, not additive.** Daily's report and Weekly's report will show the same kilos for a shared product. Anything that ever *sums across lists* must dedupe by product. Nothing does today; I am not building one; the `counted with` chip makes the sharing visible.
5. **A date range is deliberately not offered** — only two days that were actually counted. A free range would silently ignore every count in between and let one mis-keyed delivery swamp the answer.
6. **Category-only lists are out of scope.** They freeze no lines (`hasUnknownCoverage`, `:1364-1373`), never merge, and keep today's exact rule.
7. Per-list **submit/approve** of a combined walk is *not* in scope. This makes per-list *reporting* correct; a walk is still one submit and one approval.
8. Per CLAUDE.md this is a complex task → a **Codex cross-check** (`gpt-5.6-sol`, `high`, `--sandbox read-only`) runs on the plan now and on the diff of each step; if Codex is unavailable I will say so explicitly rather than skip silently.

## 11. Implementation plan — small, independently shippable, independently revertible

Every step: branch, commit, revert with a single `git revert`. Steps 1 and 5 touch **no** write path at all. Only Step 2 writes anything new, and it cannot throw.

---

### Step 1 — Restore 2 Aug → 3 Aug *(no schema, no write path, ships first)*
`fix/usage-pair-across-combined-day` · `[FIX] inventory: usage report can pair a list count with a combined walk`
**Risk: low.** Read-only. Two files.

The insight that makes this free: **a solo session's frozen snapshot *is* that list's ask that day** — already stored, already frozen. And `session_source_templates` already records which lists fed a walk.

- `src/app/api/inventory/usage/route.ts`: replace the guard at `:50-52` with "both counts cover the same list L" (own `template_id`, or a `session_source_templates` row). Scope the product set to the **solo endpoint's frozen snapshot**. Both-solo → union of both snapshots (today's behaviour). Both-walk → 400 "not available yet" (Step 4). Either endpoint has no snapshot → fall back to today's exact rule, unchanged.
- `src/components/inventory/ConsumptionReport.tsx:45-52`: end-count options become "dated on/after the start **and covering the same list**", read from `source_templates_json`, which `listSessions` already returns (`:1153-1155`).

**Tests — `tests/usage-list-pairing.unit.spec.ts` (new):** 2 Aug solo Daily → 3 Aug walk pairs and computes; the walk's Weekly-only products are absent from the Daily report; no common list → 400; two common lists without `list` → 400 naming them; walk↔walk → the explicit "not yet" 400; a legacy no-snapshot pair keeps the old rule; the deliveries/waste window is byte-identical to before. Plus an existing-behaviour regression: same-list solo↔solo output unchanged.

---

### Step 2 — Freeze per-line list provenance for **new** counts
`feat/inventory-line-provenance` · `[ADD] inventory: record which list asked for each counted product`
**Risk: medium** (only step touching the count-write path). **Nothing reads the table yet**, so reverting is a pure no-op for behaviour.

- New table + indexes (§7).
- Write from the **two callers**, not from inside `snapshotSessionItems` — that function stays byte-identical:
  - `insertMergedWalkSession` (`:1342-1362`), inside its existing transaction, beside the `session_source_templates` insert: `DELETE` this session's rows, then one row per (member list × its product ids).
  - `snapshotSessionFromTemplate` (`:2776-2781`): the degenerate single-source case, so every reader asks one question with no fallback branch.
- **Fail-soft, never throws.** Wrapped in `try/catch` with `console.warn('[inventory] …')`. A reporting feature must never be able to stop staff starting a count. If a future third caller appears, provenance is simply absent and readers fall back to the Step 1 rule.
- The caller-side `DELETE` also covers `snapshotSessionFromProducts`' early return at `:2817` (zero lines), which the alternative placement would have missed.
- Housekeeping added: `deleteSessionArtifacts`, `deleteProductPortalData`, `reassignCountsForProduct` (§7).

**Tests — `tests/line-provenance.unit.spec.ts` (new, real SQLite file + `INVENTORY_MERGED_WALK='on'`, harness copied from `tests/merged-walk.unit.spec.ts:14-19`):** a solo count credits every line to its own list; a walk credits each product to every list that asked; **a product on three due lists at two spots = 2 snapshot lines, 2 entries, 3 credits**; re-snapshotting replaces rather than accumulates; a dissolved walk leaves no rows; deleting a list keeps the rows recording it fed someone else's walk; deleting a product strips credits from **open** counts only; linking a draft product moves credits without a key violation; **a provenance write failure does not fail session creation**. Plus: all 13 existing `merged-walk.unit.spec.ts` invariants still pass unchanged.

---

### Step 3 — Backfill provenance for counts that predate Step 2
`feat/inventory-provenance-backfill` · `[ADD] inventory: backfill list provenance for existing counts`
**Risk: low-medium.** Writes only to the new table; never touches entries, snapshots or status, so it is safe over an in-progress count.

- **Solo sessions — exact, no guessing.** One SQL insert: every line of a non-walk session is credited to that session's own template. Covers essentially all ~11 existing counts. Marked `origin = 'backfilled'` anyway, because it was reconstructed even though the reconstruction is exact.
- **Walk sessions — a reconstruction, and it is marked as one.** From `session_source_templates` × the *live* `counting_templates.product_ids`, per member list. Two residue rules, chosen to never invent:
  - a line no surviving list claims → **credited to nobody** (Design 1's "credit it to everyone" is rejected: it fabricates an ask into a record that is never revised);
  - a source list matching nothing → **zero rows**, and Step 4 then refuses that endpoint rather than computing from an empty set.
- Idempotent, `INSERT OR IGNORE`, `tx.immediate()`, never overwrites `origin='frozen'`.
- **Plus a read-only audit** (`scripts/audit-line-provenance.mjs`): rows by session and origin, so I can eyeball the single existing walk against what those lists contain right now and tell Ethan the result in plain words instead of letting a migration quietly decide what 3 August meant.

**Tests — `tests/provenance-backfill.unit.spec.ts` (new):** solo backfill is exact; walk backfill is marked `'backfilled'`; an unmatched line is credited to nobody; a source list matching nothing gets no rows and produces no phantom pairing; running twice changes nothing; `'frozen'` rows are never overwritten; the migration runs **after** `freeze_legacy_sessions_flat` so legacy sessions have lines to attribute.

---

### Step 4 — The report uses provenance; walk ↔ walk works
`feat/usage-per-list-scope` · `[IMP] inventory: usage report scopes products to the chosen list`
**Risk: low.** Read-only.

- Scope = *credited to L at the start* **∪** *credited to L at the end*. The union is what stops a later list edit turning a real number into a false "not counted".
- Falls back to Step 1's solo-snapshot rule for any session with no rows, so nothing regresses.
- Refuse a zero-credit endpoint (§5).
- Response gains `list`, per-endpoint `{ session_id, date, kind, shared_with, status, origin }`, and per-row `counted_with`. Row shape otherwise unchanged.
- The Step 1 "both walks — not yet" 400 is deleted here.

**Tests — extend `tests/usage-list-pairing.unit.spec.ts`:** walk↔walk pairs, scoped per list; a product removed from the list after both counts still reports real numbers (the union rule); a zero-credit endpoint is refused, not computed; a product at two spots is summed once per endpoint; "couldn't find it" still suppresses a number; the deliveries/waste window is still unchanged.

---

### Step 5 — The picker: a list and two counted days
`feat/usage-pick-list-and-days` · `[IMP] inventory: usage report is chosen by list and day, not by count`
**Risk: low.** Read-only; one new GET endpoint, one component.

- `GET /api/inventory/usage/options` → lists with history (real lists only, company-scoped, inactive-with-history included) and, per list, the days it was counted with the session id, its status, and whether the day was a walk plus which lists shared it. **Generates nothing.**
- `ConsumptionReport.tsx` rebuilt per §6. The client still calls `/api/inventory/usage` with two session ids plus `list` — so there is **exactly one server code path**, no second API mode and no permanent debt.

**Tests:** `tests/usage-options.unit.spec.ts` — options are company-scoped, exclude the synthetic walk template, include retired-with-history lists, mark walk days with their sharers, never create a session. `tests/usage-report.e2e.spec.ts` (Playwright, staging, per the binding real-browser rule) — pick Daily, pick 2 Aug and 3 Aug, rows render, the disclosure line names "Today's Count (Daily + Weekly)".

---

### Step 6 — Fix the skipped-spot undercount *(its own commit; it affects every report)*
`fix/usage-skipped-spot-undercount` · `[FIX] inventory: a skipped spot must not silently lower a usage figure`
**Risk: low.** Read-only, but it changes numbers that are wrong today, so it ships alone and is called out to Ethan.

A product found at one spot and skipped at another currently returns a partial sum with `complete: true`, overstating usage by whatever sat at the skipped spot — and on a combined day that one skip now corrupts Daily's, Weekly's and Monthly's reports at once. Fix exactly as `not_found` is already handled (`usage/route.ts:79-84`): drop the product from `qty`, report it as incomplete with reason `spot_skipped`.

**Tests:** a skipped spot marks the product incomplete instead of lowering the figure; a fully-counted multi-spot product is unaffected; a single-spot skip behaves as it does today.

---

### Step 7 — Copy polish *(optional, last)*
`feat/usage-report-copy` · `[IMP] inventory: clearer reasons on the usage report`
Reason-aware badges (*not counted* / *wasn't on this list then* / *couldn't be found* / *a spot was skipped*), the per-list completeness line ("38 of Daily Produce's 41 products have a number at both ends"), and the "deliveries not on this list" footer.
**Tests:** each reason renders for its cause; the completeness line counts only this list's products.

---

**Verification for every step (per CLAUDE.md):** `npm run test:unit` → `npm run build` → Codex review of the uncommitted diff fired the moment the last edit is saved, in parallel — `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" --sandbox read-only -C /Users/ethan/Odoo_Portal_18EE -o /tmp/codex-verdict.md "…" </dev/null` — then commit, push to `main`, staging autodeploys (~2 min), then a real-browser Playwright pass on staging before the step is called done. **Rollback for any step: `git revert <hash> && git push`.** The new table is additive and, until Step 4, unread — so reverting Steps 2 or 3 leaves rows on disk that nothing consults.

---

## PLAIN_ENGLISH

The Usage report broke when combined walks started: because 3 August was counted as one combined walk rather than as "the Daily list", the report refuses to compare it with 2 August. This plan changes the report so you pick **a list and two days** — "Daily Produce, Saturday to Sunday" — and the portal works out for itself which count covered that list on each day, whether it stood alone or was folded into a combined walk. Your staff see no change at all: they still count a shared product once, and that one number is then shown in every list that asked for it, so no list has a gap and no two lists ever disagree. Editing a list later never rewrites what an old count was about — each count remembers, permanently, which lists asked for what on the day it happened. The cost is roughly six small releases, the first of which is a two-file fix that gets 2 August versus 3 August working again straight away with no database change, and each one can be undone on its own if it misbehaves. Two things I need to be straight about: for the 3 August walk I have to reconstruct the list split after the fact, and the screen will say so out loud rather than pretend it knows; and along the way I found a genuine existing bug where a skipped shelf makes usage read too high for products stored in two places, which I will fix as its own separate change.
