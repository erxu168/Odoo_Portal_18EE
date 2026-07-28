/**
 * YouTube URL parsing/validation for guided-tutorial video steps.
 *
 * Shared by the manager editor (validate before save), the save API (defence in
 * depth), and the staff player (build the embed). Mirrors the Odoo-side guard
 * `youtube_video_id()` in task_guide_step.py.
 *
 * Accept ONLY https URLs on known YouTube hosts/paths, and only an 11-char video
 * id (YouTube's id shape). Everything is rebuilt from the parsed id — we never
 * embed a user string — and playback uses the privacy-enhanced nocookie host.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extract the 11-char video id from an accepted YouTube URL, else null. */
export function youtubeVideoId(input: string | null | undefined): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.slice('/embed/'.length).split('/')[0];
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.slice('/shorts/'.length).split('/')[0];
  } else if (host === 'youtu.be') {
    id = u.pathname.replace(/^\//, '').split('/')[0];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** True if the string is an acceptable YouTube link. */
export function isValidYoutubeUrl(input: string | null | undefined): boolean {
  return youtubeVideoId(input) !== null;
}

/** Canonical stored form: https://www.youtube.com/watch?v=<id> (or null). */
export function canonicalYoutubeUrl(input: string | null | undefined): string | null {
  const id = youtubeVideoId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Privacy-enhanced embed URL for the player iframe (or null). */
export function youtubeEmbedUrl(input: string | null | undefined): string | null {
  const id = youtubeVideoId(input);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
}

/** Public watch link for the "Open in YouTube" fallback (or null). */
export function youtubeWatchUrl(input: string | null | undefined): string | null {
  return canonicalYoutubeUrl(input);
}
