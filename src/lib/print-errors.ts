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
 */

/** What went wrong, and what to do about it. */
export function explainPrintFailure(raw: string | null | undefined): string {
  const msg = (raw || '').trim();
  const low = msg.toLowerCase();

  if (!msg) {
    return 'The printer did not accept the label. Check it is on and awake, then tap Print again.';
  }

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

  if (low.includes('permission')) {
    return `Android is blocking Bluetooth for this app. Open Settings → Apps → Krawings ` +
           `→ Permissions and allow Nearby devices, then try again. (${msg})`;
  }

  if (low.includes('bluetooth is turned off') || low.includes('disabled')) {
    return `Bluetooth is switched off on this device. Turn it on, then tap Connect. (${msg})`;
  }

  return `The printer refused the label: ${msg}. Check it is on and awake, then tap Print again.`;
}

/** The same, for a numbered label in a batch. */
export function printFailure(seq: number, raw: string | null | undefined): string {
  return `Label ${seq} did not print. ${explainPrintFailure(raw)}`;
}
