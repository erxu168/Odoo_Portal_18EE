# 2026-08-03 — Android keyboard & numeric entry: portal-wide design

**Status:** Approach + design approved verbally by Ethan 2026-08-03. Spec revised after adversarial review; awaiting his written sign-off.
**Scope decision (Ethan):** ALL number-only fields portal-wide open the in-app numpad — **except** the named exemptions in §5.3 (phone, OTP, date/time, masked authentication PIN pads). Text-field visibility is fixed centrally, portal-wide.
**Cross-checks folded in:** OpenAI Codex (gpt-5.6-sol, high) converged independently on this architecture. A 3-lens adversarial review (consistency / process / mobile-web engineering) then produced 31 findings against the first draft; the verified ones are incorporated and called out as **[AR]** where they changed a decision.

---

## 1. Problem

On Android phones/tablets (the portal's primary devices):

1. **Number fields** summon the OS keypad, which covers roughly the bottom half of the screen — frequently the field being typed into. The portal already owns a numpad, but there are **four** separate implementations of one and 93 raw numeric inputs across ~47 files (plus 23 files using `type="number"`).
2. **Text fields** rely on default browser behavior. Since Chrome 108, Android shrinks only the *visual* viewport, not the layout viewport, so fixed-position sheets and low-on-screen fields end up behind the keyboard. The codebase has no `visualViewport` handling, no `interactive-widget` setting, and no `dvh` units.

**Existing numpad implementations (complete inventory) [AR]:**

| Where | State |
|---|---|
| `ui/Numpad.tsx` | The nominal shared pad. Used by Purchase, `WoDetail`, `BatchSize`. |
| `inventory/NumpadModal.tsx` | Second full implementation; different key grid, different empty/zero contract. 8 consumers. |
| `recipes/RecipeDetail.tsx` | **Third, fully hand-rolled inline pad** (own buffer at ~L95, own overlay at ~L277). Invisible to any grep for `type="number"`/`inputMode`. |
| `ui/PurchaseNumpad.tsx` | Dead fork, zero importers. |

Plus a separate family of **masked authentication PIN pads** (`ui/SignInSheet`, `tablet/PinPad`, `station/StationSignIn`, kiosk, `shifts/MyPin`) which are deliberately **out of scope** (§5.3).

## 2. Feature summary

Two shared mechanisms, both in `src/components/ui/` + `src/lib/`, both registered in `ASSETS.md` in the same commit that creates them:

- **A. One canonical numpad for every number field.** A shared `NumberField` (plus a hook for bespoke markup) renders the field, suppresses the OS keyboard on touch devices, and opens the one canonical pad hosted by a portal-wide provider.
- **B. One portal-wide keyboard-visibility guard for text fields.** A single client component in the root layout keeps the focused text control visible above the OS keyboard, with no per-screen work.

## 3. Users, roles, permissions, data

- Affects **all roles**. It is input ergonomics, not features.
- **No permission changes, no new routes, no API changes, no server changes, no data-model changes.**
- **Saved-value contract:** what reaches the API/database must be identical to today for every migrated screen, **with one documented exception**: `ui/Numpad`'s current `parseFloat(value) || 0` collapses an empty buffer into `0`. That is corrected to preserve empty-vs-zero — but the correction lands **per screen, at that screen's migration**, never portal-wide in one step (§9). **[AR — the first draft claimed "bit-identical" while also mandating this change.]**

## 4. Main flow — numeric entry (touch device)

1. Staff taps a number field (e.g. "Minimum order" on a supplier).
2. The OS keyboard does not appear — `inputMode="none"` on an editable `type="text"` input.
3. The canonical pad slides up as a bottom sheet: field label, optional sublabel, unit (kg, €, h…), current value in large digits.
4. Staff types. `C` clears, backspace deletes, one decimal separator allowed — both `,` and `.` accepted (German keyboards), stored normalized with `.`.
5. Staff taps **Confirm**. If the screen's commit is asynchronous, the pad **stays open showing a spinner** until it resolves; on success it closes and focus returns to the field, on failure it stays open and shows the error. **[AR — `WoDetail` already depends on this; a synchronous close would swallow failed work-order saves.]**
6. The screen's own save semantics run as they do today.

`virtualkeyboardpolicy="manual"` is **not** used: it only takes effect on `contenteditable` elements and is a no-op on `<input>`. Suppression rests on `inputMode="none"` (Chrome/WebView 66+, iOS Safari 14.5+). **[AR — the first draft treated it as a second defense layer that does not exist.]**

## 5. Alternative flows

### 5.1 Cancel, desktop, hardware keyboards

- **Cancel:** backdrop tap / Escape closes the pad; the field keeps its previous value; nothing commits.
- **Android system Back:** closes the pad **without navigating away**. The provider pushes a history entry on open and cancels on `popstate`. Without this, staff dismissing the pad by muscle-memory Back would leave the screen and lose a half-filled form. **[AR]**
- **Desktop / fine pointer:** a normal typed input; the pad does not auto-open. Capability detection (pointer/touch media queries + feature detection), never user-agent sniffing.
- **Bluetooth/hardware keyboard:** the pad opens on tap and hardware digits, `,`/`.`, Backspace, Enter (=Confirm), Escape (=Cancel) drive the pad's buffer. **Mechanism:** on open, focus moves to a sentinel inside the pad (restored to the field on close) **and** a capture-phase `keydown` handler `preventDefault()`s those keys while the pad is open. Without this, `inputMode="none"` still lets hardware keys type into the underlying input (double entry) and Enter submits the enclosing form — firing a save before Confirm. **[AR]**
- **Barcode scanners** (goods-received, counting) are HID keyboards that emit a digit burst + Enter. The provider discards bursts faster than human typing (>4 keys within ~50 ms), so a stray scan cannot commit a 13-digit EAN as a quantity. **[AR]**
- **Hardware Enter is ignored while Confirm is disabled** (out-of-range), so validation cannot be bypassed. **[AR]**

### 5.2 Value semantics

- **`allowEmpty: true`** (counting-style): an empty buffer commits `null` ("not counted"); a typed `0` commits the number zero ("there is none"). Never collapse these.
- **`allowEmpty: false`** (the default): an empty buffer **disables Confirm**. It never silently commits `0` or `NaN`. **[AR — unspecified in the first draft, and "commit 0" would have reintroduced the exact bug being fixed.]**
- **`digit-string` mode** (postcode, barcode, employee number, PIN-*setting* forms): returns the raw string, preserves leading zeros, no decimal key, never parsed as a number.
- `src/lib/numeric-input.ts` carries an explicit truth table for `C` / backspace / `.` / leading zeros per mode × `allowEmpty`, unit-tested. The two existing pads disagree today (`ui/Numpad` floors at `'0'`; `NumpadModal` reaches `''`), and the canonical buffer must reconcile them deliberately rather than by accident. **[AR]**

### 5.3 Exemptions (do not convert)

| Field type | Why | Still gets |
|---|---|---|
| Phone numbers | Need `+`, country codes, native autofill | Mechanism B |
| OTP codes | Native autofill from SMS | Mechanism B |
| Date / time | OS pickers already correct | — |
| **Masked authentication PIN pads** (`SignInSheet`, `tablet/PinPad`, `StationSignIn`, kiosk) | They mask input as dots and auto-submit on the last digit. The canonical pad shows the value in large digits and requires Confirm — converting them is a security and UX regression. **[AR]** | Mechanism B |

## 6. Error & recovery flows

- **Out of range (`min`/`max`/`step`/`fractionDigits`):** the pad shows the allowed range inline and disables Confirm. It never silently clamps. Range validation is written **fresh** in `numeric-input.ts` — it must **not** copy the existing tolerance rule's `currentNum > 0` escape (`Numpad.tsx:85`), which would let `0` pass a field whose minimum is 1 (e.g. the `EmployeeContract` pilot). The `> 0` escape stays only inside the demand±tolerance rule, if Manufacturing confirms it is intentional. **[AR]**
- **Blur-triggered saves:** screens that save on input blur must not fire when the pad opens (opening blurs the trigger). Their migration moves the save to the pad's commit callback. Named review point on every conversion.
- **Suppression unsupported** (old WebView / older iOS): the pad is still frontmost and usable, and mechanism B keeps the field visible. Degraded, not broken.
- **Floating/split keyboards:** viewport geometry is unreliable; the guard scrolls conservatively and never fights user scrolling.

## 7. Text-field visibility (mechanism B)

**Keyboard detection is geometric, not focus-based [AR]:** a text control is focused **AND** `window.innerHeight − visualViewport.height − visualViewport.offsetTop > ~150px`, with the baseline re-derived on orientation/resize while nothing is focused. Focus events alone misfire in three in-scope cases: tablet split-screen resizes (no keyboard), a Capacitor WebView with `windowSoftInputMode=adjustResize` (delta ≈ 0, guard inert), and Android's Back-dismisses-keyboard-while-field-stays-focused.

**Occlusion math is explicit [AR]:** a control is occluded when `rect.bottom > visualViewport.offsetTop + visualViewport.height − 16`. That is the *same* 16px threshold as the guarantee, so trigger and acceptance criterion cannot diverge. Recomputed on `visualViewport` resize **and** scroll.

**Scrolling:** Chrome performs its own scroll-into-view first; the guard corrects only the residual occlusion after geometry settles, using instant (non-smooth) scrolling. Nearest scrollable ancestor first, then the page. Only when occluded — a field already visible never causes a jump (per the no-scroll-jump rule).

**Fixed overlays without a scroll container cannot be scrolled at all [AR].** Page scrolling does not move `position: fixed` elements and the layout viewport no longer shrinks. Concrete case: `NumpadModal`'s note textarea (`autoFocus`, inside a `mt-auto` block in a `fixed inset-0 flex flex-col` with **no** scrollable region) would sit behind the keyboard with the guard powerless. So Wave 0a adds a rule and an audit: **every fixed overlay hosting text controls must either consume `--keyboard-inset-bottom` or wrap its content in an `overflow-y:auto` container.** `NumpadModal`'s note area is explicitly in Wave 0a scope; the other `z-[60]`/`z-[100]` overlays (`CameraCaptureModal`, `SignInSheet`, the 39 hand-rolled sheets ASSETS.md flags) are audited there.

**Published state:** `--keyboard-inset-bottom`, `--visual-viewport-height`, and `data-keyboard-open` on `<html>`. `AppTabBar` hides while `data-keyboard-open` (debounced, so rapid focus changes don't flicker). **The numpad does not set `data-keyboard-open`** — it renders above `AppTabBar` and hides it by its own overlay. **[AR]**

**Opt-out:** `data-keyboard-scroll="off"` (e.g. the barcode scanner's hidden input).

`interactive-widget=resizes-content` is **not** enabled at launch — it is a follow-up experiment after real-device testing across Chrome tab, installed PWA, and the Capacitor WebView. The guard must work without it.

## 8. Component changes

**New (all in `ASSETS.md`, same commit):**

| File | What |
|---|---|
| `src/lib/numeric-input.ts` | Pure buffer/validation: modes `integer`/`decimal`/`digit-string`, empty-vs-zero truth table, comma normalization, min/max/step/precision. Unit-tested. |
| `src/lib/modal-stack.ts` | The overlay stack extracted from `BottomSheet`'s module-level `sheetStack`, so only the top-most overlay consumes Escape. **[AR]** |
| `src/components/ui/NumpadCore.tsx` | The canonical pad body (embedded, non-modal), consumed by the provider and by wrappers. **[AR — introduced so `Numpad.tsx` can stay a compat shell; see §9.]** |
| `src/components/ui/NumpadProvider.tsx` | Single pad host, mounted once in `layout.tsx`. Owns open state, hardware-key capture, history entry, focus restoration. Renders via `createPortal(document.body)` above `z-[100]`, and registers with `modal-stack` so Escape closes only the pad, never a sheet beneath it. Reuses `ui/BottomSheet` chrome. **[AR — without this, Escape fires both the pad and the underlying sheet's `onClose`, discarding the sheet's edits.]** |
| `src/components/ui/NumberField.tsx` | Drop-in field. Props: `mode`, `value`, `onValueChange`, `onCommit`, `allowEmpty`, `min`, `max`, `step`, `fractionDigits`, `unit`, `label`, `sublabel`, `confirmLabel`, `quickActions` (the "Match" fill), tolerance config, `disabled`. **`onValueChange` fires only for desktop typing; while the pad is open, edits stay in the pad's buffer and the parent updates only via `onCommit` at Confirm** — otherwise autosave-on-change screens would save mid-edit and Cancel could not restore. `onCommit` may return a Promise (§4 step 5). **[AR]** |
| `src/components/ui/useNumpadField.ts` | Hook for bespoke markup: trigger props + `openNumpad()`. |
| `src/components/ui/KeyboardViewportManager.tsx` | Mechanism B, mounted once in `layout.tsx`. |

**Modified:**

- `ui/Numpad.tsx` — becomes a **thin compatibility wrapper** over `NumpadCore`, keeping its current public props (both modes, `onConfirm(number)`, modal shell, tolerance, Match, `loading`) so its live importers keep working untouched until their own wave. Deleted once the last importer migrates.
- `inventory/NumpadModal.tsx` — becomes a workflow wrapper composing `NumpadCore`, **keeping its exact key grid and Clear/Save row** (layout is caller-supplied) and its `null`-on-empty contract. Its 8 consumers — `CountingSession`, `QuickCount`, `WasteTracker`, `GoodsReceived`, `MoIngredients`, `ReviewSubmissions`, `CrateCountSheet`, `PackCountSheet` — are all verified before the change, per the "every dependency of a shared component" rule. **[AR — none were enumerated in the first draft.]**
- `src/app/layout.tsx` — mounts `NumpadProvider` + `KeyboardViewportManager`.
- `ui/AppTabBar.tsx` — hides while `data-keyboard-open`.
- `ui/BottomSheet.tsx` — consumes `--keyboard-inset-bottom` (its `92vh` body is keyboard-blind today); its `sheetStack` moves to `lib/modal-stack.ts`.
- `ASSETS.md` — new entries; `NumpadModal` and `Numpad` notes updated.

**Deleted:** `ui/PurchaseNumpad.tsx` (zero importers, re-verified at delete time).

**Guard:** a grep-based check in the existing build gate flags new raw `type="number"` / `inputMode="numeric|decimal"` outside the shared components. It is enabled **at the end of Wave 1 with an explicit exempt list of not-yet-converted files**, shrinking each wave — not introduced at the end, or weeks of parallel sessions would keep adding to the sweep it exists to end. **[AR]** The guard **cannot see hand-rolled `<button>` key grids** (that is how `RecipeDetail` hid), so Wave 4 also runs a one-time manual audit for pad-shaped markup (digit-array `.map`, `handleNumpadKey`-style handlers). **[AR]**

## 9. Rollout waves

Each wave is one push of one or more commits; **rollback = revert that wave's commit range** (waves are deliberately multi-commit). **[AR — the first draft's "one commit per wave, `git revert <sha>`" contradicted its own per-module-commit plan.]**

- **Wave 0a — mechanism B only.** `KeyboardViewportManager`, `AppTabBar`, `BottomSheet` inset, the fixed-overlay audit incl. `NumpadModal`'s note area. Independently revertible; touches no numeric logic.
- **Wave 0b — mechanism A foundation.** `numeric-input.ts`, `modal-stack.ts`, `NumpadCore`, `NumpadProvider`, `NumberField`, `useNumpadField`, `Numpad.tsx` compat wrapper, `NumpadModal` wrapper. **Behavior-neutral by construction:** every existing importer keeps its current committed values, including the legacy empty→0 behavior, until its own wave. **[AR — splitting 0a/0b keeps a misbehaving keyboard guard from forcing a revert of the counting-flow work, and vice versa; the first draft's Wave 0 would have broken live Purchase and Manufacturing entry on push.]**
- **Wave 1 — existing pad flows to the provider:** Purchase order quantities, `WoDetail`, `BatchSize`, **and `RecipeDetail`'s hand-rolled pad [AR]**. Empty-vs-zero correction lands here, per screen, with each screen's empty handling specified and tested. `WoDetail`'s tolerance hard-block, Match button and async `loading` must survive; note it currently passes `value` without `onChange`, so the pad ignores it and always opens at `0` — the migration **fixes** that rather than porting it. **[AR]** Delete `PurchaseNumpad.tsx`.
- **Wave 2 — pilots (deliberately the hard cases):** supplier minimum order (simple decimal), `EmployeeContract` (min/max/precision, incl. min=1 vs buffer `0`), `ShiftSettings` (blur-save migration), `ProductDetail` prices (multiple fields + blur-saves).
- **Wave 3 — module sweep, busiest first:** Inventory extras (goods-received, drinks, packaging, floorplan, label sizes) → HR → Shifts → Rentals → Prep planner → KDS/Admin/Settings. Small per-module commits.
- **Wave 4 — cleanup:** stragglers, exempt list emptied, manual button-grid audit, `ASSETS.md` user counts refreshed.

## 10. Acceptance criteria

**Numeric**
- Given a migrated number field on a touch device, when staff tap it, then on supported Chrome/WebView the OS keyboard does not appear and the pad opens with label, unit and current value; on unsupported versions the pad is still frontmost and usable (§6). **[AR — the first draft's unconditional wording would fail a release the spec itself deems acceptable.]**
- Given the pad is open, when staff tap Confirm, then exactly the displayed value commits once; when they cancel (backdrop, Escape, or Android Back), then the field is unchanged, no save fires, and the route is unchanged.
- Given `allowEmpty: true` and an empty buffer at Confirm, then `null` commits (not `0`); a typed `0` commits `0`. Given `allowEmpty: false` and an empty buffer, then Confirm is disabled.
- Given a blur-save screen post-migration, when the pad opens, then no save fires until Confirm.
- Given a `digit-string` field, when `0301` is entered, then the committed value is the string `"0301"`.
- Given a field with `min: 1`, when the buffer is `0`, then Confirm is disabled.
- Given a hardware keyboard with the pad open, then digits/Enter/Escape type/confirm/cancel the pad, **the underlying input does not also receive them, and Enter does not submit the enclosing form**.
- Given a barcode scan while the pad is open, then the value is unchanged.
- Given the pad opened from inside a `BottomSheet`, when Escape is pressed, then only the pad closes and the sheet keeps its edits.
- Given an async `onCommit`, when it rejects, then the pad stays open and shows the error.

**Counting/waste (the count-touching path) [AR — absent from the first draft]**
- Given a counting session using the rewrapped `NumpadModal`, when a count, a "Nothing here", or a cancel is performed, then the API payload is identical to pre-change — including `null` for "Nothing here" and a real `0` for a physical stockout.
- Given the Waste Tracker, then the pad still reads "Bin it" and records identically.

**Text**
- Given any text field — page, bottom sheet, or fixed full-screen overlay — on Android, when the keyboard opens, then the control's bottom sits ≥16px above the visible viewport bottom, the page does not jump when it was already visible, and `AppTabBar` is hidden until the keyboard closes.
- Given `NumpadModal`'s note textarea, when it autofocuses, then it is fully visible above the keyboard.

**Platforms**
- Given the pad opens on all coarse-pointer touch devices **including iOS** (capability detection, not UA), then iOS and desktop show no regressions beyond the mechanisms above — focus, autofill, tab order and scrolling behave as today; desktop typing is unchanged and no pad auto-opens. **[AR — the first draft promised iOS was "unchanged", which capability detection makes impossible.]**

## 11. Verification

- **Unit:** `numeric-input.ts` — buffer truth table, empty/zero per `allowEmpty`, limits (incl. min=1 vs `0`), precision, comma normalization, leading zeros.
- **Playwright on staging** (binding rule): pad opens on tap; Confirm round-trips into the field **and the save payload**; cancel is a no-op; no save-on-open on the blur-save pilots; browser Back with the pad open leaves the route unchanged; hardware Enter confirms without submitting the form; Escape above a `BottomSheet` closes only the pad; `inputMode="none"` present on migrated fields; tab bar hides when `data-keyboard-open` is forced. Counting and waste flows run on **Wave 0b**, not deferred.
- **Real device (Ethan, ~2 min per wave).** Named screens:
  - *Wave 0a (text):* inventory counting note (`NumpadModal` textarea), shift-handover `AddEntrySheet`, product create sheet, a task/checklist note, HR onboarding free-text.
  - *Wave 0b:* a counting session end-to-end + a waste entry (numbers must behave exactly as before).
  - *Wave 1:* purchase order quantity, work-order pick (tolerance + Match), recipe batch size.
  - *Wave 2–3:* the migrated screens of that wave, plus one Bluetooth-keyboard check and one floating-Gboard check.
  - Also record the Capacitor wrapper's `windowSoftInputMode` — it decides whether mechanism B is active inside the app shell at all.
- **Desktop spot-check:** typing, tab order, autofill unchanged.
- **Codex review of every wave's diff** before push (Design Principle 5 — counting flows are touched in Wave 0b/1).

## 12. Assumptions & out of scope

- Exemptions per §5.3.
- The pad's visual design stays as-is (green sheet, DESIGN_GUIDE) — this changes *when* it appears, not how it looks.
- `userScalable: false` predates this work and stays (separate accessibility discussion).
- Odoo-side screens untouched; portal-only.
- Android is the target; iOS must not regress but is secondary.
- Consolidating the masked PIN pads (`SignInSheet`'s inline grid vs `tablet/PinPad`) is a known duplication left for separate cleanup.

## 13. Risks

| Risk | Mitigation |
|---|---|
| `inputMode="none"` ignored on some WebView versions | Pad still frontmost; guard keeps field visible; `readonly`-until-commit fallback decided per device only if seen in the field |
| A converted screen's save semantics drift (empty/zero, blur) | Named review point per conversion; pilots chosen as the hard cases; Codex diff review per wave; counting ACs explicit |
| Escape / z-order collisions with existing sheets | Shared `modal-stack`, portal to body, z-index above `100`; explicit AC |
| Android Back read as data loss | History-entry pattern + Playwright case |
| Hardware keys double-entering or submitting forms | Sentinel focus + capture-phase handler; explicit AC |
| Barcode scan committing an EAN as a quantity | Burst detection (>4 keys / ~50 ms discarded); real-device step |
| Keyboard guard misfires (split-screen, Capacitor `adjustResize`, Back-dismiss) | Geometric detection with a ~150px threshold and re-derived baseline |
| Fixed overlays the guard cannot scroll | Wave 0a rule + audit: consume `--keyboard-inset-bottom` or add a scroll container |
| Wave 3 is wide (~50 files) | Mechanical conversions in small per-module commits, each revertible; guard active from Wave 1 to stop new debt |
