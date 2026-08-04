/**
 * WAJ Radio — the genre gate (pure pipeline, adapters injected).
 *
 * Decision order (spec §6):
 *   1. manual decision        — a manager's word. Highest genre authority.
 *   2. playability            — embed-blocked / live / >15 min / kids / DE-blocked
 *                               refuse regardless of genre, even manual allows.
 *                               (Exception: a manual allow with NO metadata available
 *                               plays — the player's error handling enforces lazily,
 *                               otherwise every approved song dies with the Data API.)
 *   3. cached automatic verdict
 *   4. YouTube topic           — Electronic beats everything → deny.
 *                                Hip hop / Reggae → terminal allow.
 *                                R&B / Soul → strong hint, still confirmed by Claude.
 *   5. Claude classifier       — fixed label set; unsure → refuse + manager request.
 *
 * Outages fail CLOSED: verdict 'outage', nothing cached, no request created
 * (the route shows "try again in a minute" — spec §6).
 */
import {
  MAX_DURATION_SECONDS,
  getGateCache, setGateCache,
  getManualDecision,
  getMetadata, setMetadata,
  type GateDecision, type MusicGenre, type VideoMetadataInput,
} from '@/lib/music/db';

export interface RawVideoData {
  title: string; channelId: string; channelTitle: string;
  durationSeconds: number | null; embeddable: boolean; madeForKids: boolean;
  live: boolean; regionBlockedDe: boolean; topicCategories: string[];
}

export type ClassifierLabel = MusicGenre | 'electronic' | 'other' | 'unsure';
export interface ClassifierResult { label: ClassifierLabel; model: string; promptVersion: number }

export interface GateAdapters {
  fetchVideoData(ids: string[]): Promise<Map<string, RawVideoData> | 'outage'>;
  classify(input: { videoId: string; title: string; channel: string }): Promise<ClassifierResult | 'outage'>;
}

export type GateResult =
  | { verdict: 'allow'; genre: MusicGenre; source: string }
  | { verdict: 'deny'; reasonCode: string }
  | { verdict: 'unsure'; reasonCode: string }
  | { verdict: 'unplayable'; reasonCode: string }
  | { verdict: 'outage' };

/** Wikipedia-URL suffix → gate action. Only Electronic is a terminal deny by topic. */
export const TOPIC_MAP: Record<string, 'block' | MusicGenre | 'hint_rnb'> = {
  Electronic_music: 'block',
  Hip_hop_music: 'hip_hop_rap',
  Reggae: 'reggae_dancehall_dub',
  Rhythm_and_blues: 'hint_rnb',
  Soul_music: 'hint_rnb',
};

function topicSuffix(url: string): string {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(i + 1) : url;
}

function playabilityProblem(m: { embeddable: boolean; live: boolean; durationSeconds: number | null; madeForKids: boolean; regionBlockedDe: boolean }): string | null {
  if (!m.embeddable) return 'not_embeddable';
  if (m.live) return 'live';
  if (m.durationSeconds != null && m.durationSeconds > MAX_DURATION_SECONDS) return 'too_long';
  if (m.madeForKids) return 'made_for_kids';
  if (m.regionBlockedDe) return 'region_blocked';
  return null;
}

function fromCache(decision: GateDecision, genre: MusicGenre | null, reasonCode: string, source: string): GateResult {
  if (decision === 'allow' && genre) return { verdict: 'allow', genre, source };
  if (decision === 'deny') return { verdict: 'deny', reasonCode };
  return { verdict: 'unsure', reasonCode };
}

/**
 * Gate one video. `hint` carries the search-result title/channel so the
 * classifier can still judge during a Data-API outage; it comes from our own
 * catalog lookup, never from the client.
 */
export async function gateVideo(videoId: string, a: GateAdapters, hint?: { title: string; channel: string }): Promise<GateResult> {
  const manual = getManualDecision(videoId);
  if (manual?.decision === 'deny') return { verdict: 'deny', reasonCode: 'manual_deny' };

  // Cheap paths first: a cached verdict (or manual allow) must not cost an API
  // call on every tap. Playability is still enforced against any FRESH local
  // metadata; when none exists, the player's error handling enforces it lazily.
  const localMeta = getMetadata(videoId);
  const localProblem = localMeta ? playabilityProblem(localMeta) : null;

  if (manual?.decision !== 'allow') {
    const cached = getGateCache(videoId);
    if (cached) {
      if (cached.decision === 'allow' && localProblem) return { verdict: 'unplayable', reasonCode: localProblem };
      return fromCache(cached.decision, cached.genre as MusicGenre | null, cached.reason_code, cached.decision_source);
    }
  }

  // Resolve metadata: fresh local row, else one adapter fetch (refreshes the 30-day TTL).
  let meta = localMeta;
  let missing = false;
  if (!meta) {
    const fetched = await a.fetchVideoData([videoId]);
    if (fetched !== 'outage') {
      const raw = fetched.get(videoId);
      if (!raw) {
        missing = true;
      } else {
        const input: VideoMetadataInput = { videoId, ...raw };
        setMetadata(input);
        meta = getMetadata(videoId);
      }
    }
  }

  if (manual?.decision === 'allow' && manual.genre) {
    // Playability applies when we KNOW the video is unplayable; a Data-API
    // outage must not silence every manually approved song.
    if (missing) return { verdict: 'unplayable', reasonCode: 'not_found' };
    const problem = meta ? playabilityProblem(meta) : null;
    if (problem) return { verdict: 'unplayable', reasonCode: problem };
    return { verdict: 'allow', genre: manual.genre, source: 'manual' };
  }

  if (missing) return { verdict: 'unplayable', reasonCode: 'not_found' };
  if (meta) {
    const problem = playabilityProblem(meta);
    if (problem) return { verdict: 'unplayable', reasonCode: problem };
  }

  // Topic layer — only when we have metadata.
  if (meta) {
    const actions = meta.topicCategories.map((u) => TOPIC_MAP[topicSuffix(u)]).filter(Boolean);
    if (actions.includes('block')) {
      setGateCache({ videoId, decision: 'deny', genre: null, source: 'youtube_topic', reasonCode: 'topic_electronic', model: null, promptVersion: null });
      return { verdict: 'deny', reasonCode: 'topic_electronic' };
    }
    const terminal = actions.find((x): x is MusicGenre => x !== 'block' && x !== 'hint_rnb');
    if (terminal) {
      setGateCache({ videoId, decision: 'allow', genre: terminal, source: 'youtube_topic', reasonCode: 'topic_allow', model: null, promptVersion: null });
      return { verdict: 'allow', genre: terminal, source: 'youtube_topic' };
    }
  }

  // Classifier layer.
  const title = meta?.title ?? hint?.title;
  const channel = meta?.channelTitle ?? hint?.channel;
  if (!title || !channel) return { verdict: 'outage' };
  const c = await a.classify({ videoId, title, channel });
  if (c === 'outage') return { verdict: 'outage' };
  const { label, model, promptVersion } = c;
  if (label === 'electronic' || label === 'other') {
    const reasonCode = label === 'electronic' ? 'llm_electronic' : 'llm_other';
    setGateCache({ videoId, decision: 'deny', genre: null, source: 'claude', reasonCode, model, promptVersion });
    return { verdict: 'deny', reasonCode };
  }
  if (label === 'unsure') {
    setGateCache({ videoId, decision: 'unsure', genre: null, source: 'claude', reasonCode: 'llm_unsure', model, promptVersion });
    return { verdict: 'unsure', reasonCode: 'llm_unsure' };
  }
  setGateCache({ videoId, decision: 'allow', genre: label, source: 'claude', reasonCode: 'llm_allow', model, promptVersion });
  return { verdict: 'allow', genre: label, source: 'claude' };
}
