# 2026-08-01 — Zebra ZQ310 (WAJ food-container labels): setup design + findings

## Context

Ethan bought a **Zebra ZQ310** mobile Bluetooth printer (part `ZQ31-A0E02TE-00`, serial
`XXZEJ210301609`) for What A Jerk, to print food-container labels via the existing
Label Print module (`/labels`, `src/components/manufacturing/LabelPrint.tsx`). He uses the
**Capacitor Android app** (native BT Classic via `ZebraPrintPlugin`), not Chrome.
Decision: **no new code** — setup + configuration only. A verified tap-by-tap runbook was
delivered as a Claude artifact ("Zebra ZQ310 Setup — WAJ Labels") on 2026-08-01.

## Printer constraints (verified against Zebra docs)

- 203 dpi direct thermal, ZPL + CPCL. Max media width **58 mm**, max **print width 48 mm**,
  max roll diameter ~40 mm.
- **This SKU has NO label-gap sensor** (sold as "no label sensor / outdoor"). It DOES have a
  black-mark sensor (marks on the FRONT of the media, ≥15 mm wide × ~5 mm) and a
  **linerless platen**. Gap calibration will never work on this unit → die-cut labels run in
  continuous mode (slight drift, acceptable for tear-off), or use linerless (Zebra 8000D
  58 mm, part 3013255) / front-black-mark media.
- Link-OS v6+ ships **Bluetooth non-discoverable by default**: hold FEED ~5 s → 2-minute
  pairing window. Advertises its **serial number** as BT name (the paired-device picker in
  `useZebraBluetooth` exists for exactly this).
- On first pairing the printer may **print** the 6-digit confirmation code — expected.
- Sleeps after ~20 min; BT-only model wakes on incoming job.

## Configuration decided

- Label size: **Custom 48 × 75 mm** selected in the Label Size card, then **Set as default**
  (custom-type defaults reload correctly). All built-in presets are ≥51 mm → too wide.
- Company scope: saved sizes + default preference are per user+company — must be set while
  active company = What A Jerk.

## App bugs found during adversarial verification (not yet fixed)

1. **Saved label sizes print at the wrong dimensions.** `LabelPrint` sends
   `labelSizeId: 'saved-<id>'`, but `resolveLabelSize` (`src/lib/zpl.ts:15–26`, used by
   `src/app/api/labels/generate/route.ts:50`) only honors width/height when
   `sizeId === 'custom'` — any `saved-*` id silently falls back to 55 × 75. The HTML preview
   renders from local state, hiding the mismatch. Workaround in the runbook: use
   `Custom size…` directly, never "Save this size for reuse". Fix direction: honor
   client-sent `widthMm`/`heightMm` for `saved-*` ids (or resolve them server-side).
2. **Code 128 barcode cannot fit at 48 mm.** `^BY2` at 203 dpi with the 20-char
   `LBL-YYYYMMDD-HHMM-NN` payload needs ~64 mm (~50 mm even in subset C) → clipped right
   edge, likely unscannable on this printer. Fix direction: drop to `^BY1` and/or shorten
   the payload when width < ~55 mm.
3. Minor UX facts (runbook already matches reality): "Set as default" success shows a
   persistent green "✓ Default" (the "Saved!" flash is unreachable); connection does not
   persist across full app restarts (re-pick from "Paired devices" — two taps); the
   old-app-build symptom is a permanently disabled Connect button, not an error message.

## Verification

7-agent workflow (3 code extractors + 1 hardware researcher → draft → 2 adversarial
verifiers). The verifiers refuted 10 draft claims; all corrections are folded into the
delivered runbook. Codex cross-check intentionally skipped: no code diff to review.
