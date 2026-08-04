/**
 * WAJ Radio — YouTube Music catalog adapter. THE ONLY FILE that touches
 * youtubei.js (unofficial InnerTube client) so breakage stays contained and the
 * library is replaceable (spec §2a/§16). Loaded lazily via a non-literal dynamic
 * import: the module compiles and deploys even where node_modules lacks the
 * package (it is installed by `npm ci` on staging from the pinned lockfile).
 *
 * Response shapes are UNOFFICIAL and drift a few times a year — every extraction
 * is defensive, and callers treat implausible/empty results as failure, never as
 * fresh truth (spec §8).
 */

export interface CatalogSong {
  videoId: string;
  title: string;
  artist: string;
  durationSeconds: number | null;
  thumbnail: string | null;
}

interface InnertubeLike {
  music: {
    search(q: string, opts: { type: string }): Promise<unknown>;
    getPlaylist(id: string): Promise<unknown>;
  };
}

let _yt: InnertubeLike | null = null;
let _loading: Promise<InnertubeLike | null> | null = null;

async function innertube(): Promise<InnertubeLike | null> {
  if (_yt) return _yt;
  if (!_loading) {
    _loading = (async () => {
      try {
        // Non-literal specifier + webpackIgnore: invisible to tsc (compiles even
        // where node_modules lacks the package) AND left untouched by the Next
        // bundler, so Node resolves it natively at runtime (ESM package).
        const modName = 'youtubei.js';
        const mod = (await import(/* webpackIgnore: true */ modName)) as { Innertube?: { create(opts?: Record<string, unknown>): Promise<unknown> } };
        if (!mod.Innertube) return null;
        _yt = (await mod.Innertube.create({ retrieve_player: false })) as InnertubeLike;
        return _yt;
      } catch (err: unknown) {
        console.error('[music] youtubei.js failed to load:', err instanceof Error ? err.message : err);
        return null;
      } finally {
        _loading = null;
      }
    })();
  }
  return _loading;
}

/** Best-effort text: youtubei.js wraps strings in Text objects with .text / toString(). */
function textOf(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const t = (x as { text?: unknown }).text;
    if (typeof t === 'string') return t;
    const s = String(x);
    if (s && s !== '[object Object]') return s;
  }
  return null;
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Map one unofficial item shape to a CatalogSong; null when it isn't song-like. */
export function mapCatalogItem(item: unknown): CatalogSong | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const videoId = (typeof o.id === 'string' && o.id.length >= 8 ? o.id : null)
    ?? (typeof o.video_id === 'string' ? o.video_id : null)
    ?? (typeof o.videoId === 'string' ? o.videoId : null);
  const title = textOf(o.title) ?? textOf(o.name);
  if (!videoId || !title) return null;

  let artist: string | null = null;
  const artists = o.artists;
  if (Array.isArray(artists)) {
    const names = artists.map((a) => textOf((a as Record<string, unknown>)?.name)).filter((x): x is string => !!x);
    if (names.length) artist = names.join(', ');
  }
  artist = artist ?? textOf(o.author) ?? textOf((o.author as Record<string, unknown> | undefined)?.name) ?? '';

  const duration = o.duration as Record<string, unknown> | number | string | undefined;
  const durationSeconds =
    typeof duration === 'number' ? duration
    : duration && typeof duration === 'object' ? num(duration.seconds)
    : null;

  let thumbnail: string | null = null;
  const thumbs = (o.thumbnails ?? o.thumbnail) as unknown;
  if (Array.isArray(thumbs) && thumbs.length) {
    const url = (thumbs[0] as Record<string, unknown>)?.url;
    if (typeof url === 'string') thumbnail = url;
  }

  return { videoId, title, artist: artist || 'Unknown artist', durationSeconds, thumbnail };
}

/** Pull song-like items out of an unofficial search/playlist response, wherever they sit. */
export function extractSongs(response: unknown, cap = 40): CatalogSong[] {
  const out: CatalogSong[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (out.length >= cap || depth > 8 || !node) return;
    if (Array.isArray(node)) { for (const x of node) visit(x, depth + 1); return; }
    if (typeof node !== 'object') return;
    const mapped = mapCatalogItem(node);
    if (mapped && !seen.has(mapped.videoId)) {
      seen.add(mapped.videoId);
      out.push(mapped);
      return; // don't descend into an item we already consumed
    }
    const o = node as Record<string, unknown>;
    for (const k of ['songs', 'contents', 'items', 'results', 'sections', 'shelves']) {
      if (k in o) visit(o[k], depth + 1);
    }
  };
  visit(response, 0);
  return out;
}

export async function searchSongs(q: string): Promise<CatalogSong[] | 'outage'> {
  const yt = await innertube();
  if (!yt) return 'outage';
  try {
    const res = await yt.music.search(q, { type: 'song' });
    return extractSongs(res, 12);
  } catch (err: unknown) {
    console.error('[music] catalog search failed:', err instanceof Error ? err.message : err);
    return 'outage';
  }
}

export async function fetchPlaylistVideos(playlistId: string): Promise<CatalogSong[] | 'outage'> {
  const yt = await innertube();
  if (!yt) return 'outage';
  try {
    const res = await yt.music.getPlaylist(playlistId);
    return extractSongs(res, 100);
  } catch (err: unknown) {
    console.error('[music] playlist fetch failed:', err instanceof Error ? err.message : err);
    return 'outage';
  }
}

/** Radio pools use search-type sources by default (robust, no playlist ids needed). */
export async function fetchSourceVideos(sourceType: 'playlist' | 'search', idOrQuery: string): Promise<CatalogSong[] | 'outage'> {
  return sourceType === 'playlist' ? fetchPlaylistVideos(idOrQuery) : (async () => {
    const yt = await innertube();
    if (!yt) return 'outage' as const;
    try {
      const res = await yt.music.search(idOrQuery, { type: 'song' });
      return extractSongs(res, 40);
    } catch (err: unknown) {
      console.error('[music] source search failed:', err instanceof Error ? err.message : err);
      return 'outage' as const;
    }
  })();
}
