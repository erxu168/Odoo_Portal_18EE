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

## App bugs found during adversarial verification — all fixed same night

1. **Saved label sizes printed at the wrong dimensions.** `LabelPrint` sends
   `labelSizeId: 'saved-<id>'`, but `resolveLabelSize` only honored width/height for
   `sizeId === 'custom'` — any `saved-*` id silently fell back to 55 × 75 while the HTML
   preview (local state) looked correct. **Fixed `f9e4551`**: presets still win; any
   non-preset id uses the client-resolved dimensions.
2. **Code 128 barcode could not fit at 48 mm.** `^BY2` at 203 dpi with the 20-char
   `LBL-YYYYMMDD-HHMM-NN` payload needs ~64 mm → clipped right edge. **Fixed `38ae574`**:
   drops to `^BY1` when 2 dots/module exceeds the printable width.
3. **Factory ZQ300s sit in line-print mode** and print incoming ZPL as literal source text
   (confirmed on a physical strip: `^XA^PW384…` printed as characters). **Fixed `28564c5`**:
   LabelPrint's printer bar gained a one-tap "Printer prints code instead of a label?" button
   that sends `! U1 setvar "device.languages" "zpl"` over the open connection; the setting
   persists, so it is one tap per new printer. Follow-up: the button lives only in
   LabelPrint — extract a shared printer-bar component so PackageLabel/LocationLabels get it.

Also hit live: declaring the legacy Bluetooth permission trio with `maxSdkVersion="30"`
broke Android 12+ printing entirely (Capacitor validates the plugin's full annotated
permission list against the installed manifest) — reverted to Portal-manifest parity in
`7ca5270`; the trap is documented in `build-station.yml`.
3. Minor UX facts (runbook already matches reality): "Set as default" success shows a
   persistent green "✓ Default" (the "Saved!" flash is unreachable); connection does not
   persist across full app restarts (re-pick from "Paired devices" — two taps); the
   old-app-build symptom is a permanently disabled Connect button, not an error message.

## Verification

7-agent workflow (3 code extractors + 1 hardware researcher → draft → 2 adversarial
verifiers). The verifiers refuted 10 draft claims; all corrections are folded into the
delivered runbook. Codex cross-check intentionally skipped: no code diff to review.
