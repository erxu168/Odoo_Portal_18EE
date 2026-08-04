/**
 * WAJ Radio — Claude genre classifier (layer 3 of the gate).
 *
 * One question, once per video ever (the verdict is cached): which genre shelf
 * does this song belong on? Pinned model + prompt version are stored with each
 * verdict so old decisions stay explainable. Strict JSON schema output — no
 * free text to parse. Any failure (no key, timeout, bad JSON, unknown label)
 * is an 'outage': the gate fails closed and nothing is cached.
 *
 * Uses the official @anthropic-ai/sdk (installed on staging via the pinned
 * lockfile; loaded with a non-literal dynamic import so local builds without
 * the package still compile — same pattern as catalog.ts).
 */
import type { ClassifierResult, ClassifierLabel } from '@/lib/music/gate';

export const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';
export const PROMPT_VERSION = 1;

const LABELS: ClassifierLabel[] = [
  'hip_hop_rap', 'reggae_dancehall_dub', 'afrobeats_afro', 'rnb_soul_funk',
  'electronic', 'other', 'unsure',
];

export function validateLabel(x: unknown): ClassifierLabel | null {
  return typeof x === 'string' && (LABELS as string[]).includes(x) ? (x as ClassifierLabel) : null;
}

export function buildPrompt(i: { title: string; channel: string }): string {
  return [
    'You classify songs for a Jamaican restaurant jukebox that only plays these genres:',
    '- hip_hop_rap: hip hop, rap, trap, drill (any language)',
    '- reggae_dancehall_dub: reggae, dancehall, dub, ska, reggae fusion',
    '- afrobeats_afro: afrobeats, afropop, amapiano, highlife (NOT electronic afro house)',
    '- rnb_soul_funk: R&B, neo-soul, classic soul, funk',
    'Not allowed:',
    '- electronic: techno, house, EDM, trance, electro, afro house, DJ mixes of these',
    '- other: any other genre (rock, pop, schlager, country, classical, metal, jazz, latin...)',
    'If you genuinely cannot tell from the artist and title, answer unsure.',
    '',
    `Song title: ${i.title}`,
    `Channel/artist: ${i.channel}`,
  ].join('\n');
}

interface AnthropicClientLike {
  messages: {
    create(params: Record<string, unknown>, opts?: { timeout?: number }): Promise<{
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    }>;
  };
}

let _client: AnthropicClientLike | null = null;

async function client(): Promise<AnthropicClientLike | null> {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const modName = '@anthropic-ai/sdk';
    const mod = (await import(/* webpackIgnore: true */ modName)) as { default?: new (opts?: Record<string, unknown>) => AnthropicClientLike };
    if (!mod.default) return null;
    _client = new mod.default({ maxRetries: 1 });
    return _client;
  } catch (err: unknown) {
    console.error('[music] anthropic sdk failed to load:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function classify(i: { videoId: string; title: string; channel: string }): Promise<ClassifierResult | 'outage'> {
  const c = await client();
  if (!c) return 'outage';
  try {
    const res = await c.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 100,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { genre: { type: 'string', enum: LABELS } },
            required: ['genre'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: buildPrompt(i) }],
    }, { timeout: 8000 });
    if (res.stop_reason === 'refusal') return 'outage';
    const text = res.content?.find((b) => b.type === 'text')?.text;
    if (!text) return 'outage';
    const label = validateLabel((JSON.parse(text) as { genre?: unknown }).genre);
    if (!label) return 'outage';
    return { label, model: CLASSIFIER_MODEL, promptVersion: PROMPT_VERSION };
  } catch (err: unknown) {
    console.error('[music] classifier failed:', err instanceof Error ? err.message : err);
    return 'outage';
  }
}
