/**
 * Fetch a product photo from a URL the user pasted.
 *
 * "Copy image address" is one right-click away on any search-results page, so
 * accepting a URL saves the round trip through a download folder. But a URL the
 * user pastes is a URL the SERVER then requests, which turns this endpoint into
 * a way to reach anything the server can reach — the portal's own machine, the
 * database, cloud metadata endpoints. That is SSRF, and it is the whole reason
 * this file exists rather than a one-line fetch at the call site.
 *
 * The guard is deliberately strict and deny-by-default:
 *  - http/https only (no file:, no data:, no gopher:)
 *  - the resolved IP must be PUBLIC — every private, loopback, link-local and
 *    carrier-grade range is refused, checked AFTER DNS resolution so a hostname
 *    pointing at 127.0.0.1 cannot slip through
 *  - redirects are followed by hand, re-checking the address each hop, because
 *    a public URL is allowed to redirect to a private one
 *  - the response must actually be a raster image, and a small one
 */
import { lookup } from 'dns/promises';
import net from 'net';

const MAX_BYTES = 6_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const ALLOWED = /^image\/(png|jpe?g|webp|avif)$/i;

/** Every range that is not the public internet. */
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true;                          // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    // IPv4 mapped (::ffff:127.0.0.1) — judge the embedded address
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return true;   // unparseable → refuse
}

async function assertPublic(hostname: string): Promise<void> {
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new Error('That address could not be found.');
  }
  if (records.length === 0) throw new Error('That address could not be found.');
  // EVERY resolved address must be public — one private answer is enough to refuse.
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error('That address points inside a private network, so it was not fetched.');
    }
  }
}

export interface FetchedImage { dataUrl: string; mime: string; bytes: number }

export async function fetchImageFromUrl(raw: string): Promise<FetchedImage> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('That does not look like a web address.'); }

  let hops = 0;
  for (;;) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http and https addresses can be fetched.');
    }
    await assertPublic(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        redirect: 'manual',           // followed by hand so each hop is re-checked
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });
    } catch {
      throw new Error('That address could not be reached.');
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error('That address redirected nowhere.');
      if (++hops > MAX_REDIRECTS) throw new Error('That address redirects too many times.');
      url = new URL(next, url);       // re-checked at the top of the loop
      continue;
    }

    if (!res.ok) throw new Error(`The site returned ${res.status} for that image.`);

    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED.test(mime)) {
      throw new Error(mime
        ? `That link is ${mime}, not an image. Use “Copy image address”, not the page address.`
        : 'That link did not return an image.');
    }

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('That image is too large.');

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('That image was empty.');
    if (buf.length > MAX_BYTES) throw new Error('That image is too large.');

    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: buf.length };
  }
}
