/**
 * Turn a Bluetooth/printer failure into something a cook can act on.
 *
 * Every label screen used to show a bare "Print failed for label 1" — the
 * label number and nothing else. The reason was already known one layer down
 * (a broken socket, a rejected write, a printer that had gone to sleep) and
 * was thrown away on the way up, so the only honest answer anyone could give
 * was "try again". This is that reason, in plain language, with the next step.
 *
 * The raw text is kept on the end: it is what makes a report from the kitchen
 * diagnosable, and it costs one line on screen.
 *
 * ORDER MATTERS. A failure that was retried carries BOTH messages — e.g.
 * "Write failed: Broken pipe (reconnect also failed: Bluetooth permission
 * denied)". Matching on "broken pipe" first would tell someone to wake a
 * printer when the actual blocker is an Android permission, so the checks that
 * name a specific, fixable cause run before the generic link ones.
 * (Codex review of 627df661.)
 */

/**
 * The hook's marker for a print whose bytes may or may not have landed.
 * Exported so the hook stamps the same string this module strips — two copies
 * of a magic string is one rename away from silently losing the warning.
 */
export const DELIVERY_UNCERTAIN = '[delivery-uncertain]';

/** Did this failure leave it unknown whether the label came out? */
export function isDeliveryUncertain(raw: string | null | undefined): boolean {
  return (raw || '').includes(DELIVERY_UNCERTAIN);
}

/** What went wrong, and what to do about it. */
export function explainPrintFailure(raw: string | null | undefined): string {
  const msg = (raw || '').replace(DELIVERY_UNCERTAIN, '').trim();
  const low = msg.toLowerCase();

  // The link died mid-send. We genuinely do not know whether the label came
  // out, and saying "try again" could put a second sticker, carrying the same
  // lot number, on a second tub. Send them to look at the printer instead.
  if (isDeliveryUncertain(raw)) {
    // Deliberately does NOT promise the connection is back: the native path
    // reconnects before saying this, the Web Bluetooth path does not, and one
    // shared sentence cannot claim both. (Codex re-review of de32d7b8.)
    return `The connection dropped while the label was being sent, so it may or may not ` +
           `have come out. LOOK AT THE PRINTER first: print again only if nothing came out, ` +
           `otherwise you get a second sticker with the same lot number. (${msg})`;
  }

  if (!msg) {
    return 'The printer did not accept the label. Check it is on and awake, then tap Print again.';
  }

  // ── Specific, fixable causes first ──

  if (low.includes('permission')) {
    return `Android is blocking Bluetooth for this app. Open Settings → Apps → Krawings ` +
           `→ Permissions and allow Nearby devices, then try again. (${msg})`;
  }

  if (low.includes('bluetooth is turned off') || low.includes('bluetooth is disabled') ||
      low.includes('enable it in settings')) {
    return `Bluetooth is switched off on this device. Turn it on, then tap Connect. (${msg})`;
  }

  if (low.includes('no print service') || low.includes('config-only')) {
    return `This printer's Bluetooth cannot receive labels — only settings. Print from the ` +
           `Krawings app on the Android tablet instead. (${msg})`;
  }

  if (low.includes('web bluetooth not supported')) {
    return `This browser cannot talk to the printer. Use the Krawings app on the Android ` +
           `tablet. (${msg})`;
  }

  // ── Generic link problems ──

  // The socket died — printer asleep, powered off, or out of range.
  if (low.includes('broken pipe') || low.includes('socket') || low.includes('closed') ||
      low.includes('not connected') || low.includes('epipe')) {
    return `The printer dropped the connection — usually it went to sleep or is out of range. ` +
           `Wake it up, then tap Connect and print again. (${msg})`;
  }

  // Chrome refused the write: the Bluetooth link cannot carry a chunk that big.
  if (low.includes('attribute length') || low.includes('notsupported') || low.includes('gatt')) {
    return `This browser could not send the label over Bluetooth. Print from the Krawings app ` +
           `on the Android tablet, which uses the printer's serial connection. (${msg})`;
  }

  return `The printer refused the label: ${msg}. Check it is on and awake, then tap Print again.`;
}

/** The same, for a numbered label in a batch. */
export function printFailure(seq: number, raw: string | null | undefined): string {
  return `Label ${seq} did not print. ${explainPrintFailure(raw)}`;
}
