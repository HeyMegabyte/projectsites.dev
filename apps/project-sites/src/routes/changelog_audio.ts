/**
 * @module routes/changelog_audio
 * @description AI-narrated changelog audio per iteration (1337 LAYER #4).
 *
 * Synthesizes a 60-90 second narrated walkthrough of what changed between
 * the previous build and the current build for a given site iteration.
 * Audio is cached forever in R2 (`changelog.mp3`) and the source script
 * is persisted alongside (`changelog.txt`) so we can re-render the audio
 * if the voice model changes without paying TTS twice.
 *
 * Contract (skill 15 build-breaking-rules.md, 1337 LAYER #4):
 * - Synthesis provider: ElevenLabs (`ELEVENLABS_API_KEY`).
 * - R2 keys per iteration: `sites/<slug>/iter-<N>/changelog.{mp3,txt}`.
 * - Persists `changelog_audio_r2_key` + `changelog_script_r2_key` to
 *   `iteration_snapshots`.
 * - GET endpoint serves audio inline with long Cache-Control (R2 hit).
 * - POST endpoint is idempotent — re-running with the same `(slug, iteration)`
 *   tuple short-circuits when assets already exist unless `?force=1`.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbExecute } from '../services/db.js';

const changelogAudio = new Hono<{ Bindings: Env; Variables: Variables }>();

interface SiteRow {
  id: string;
  slug: string;
  business_name: string;
  iteration_count: number | null;
}

interface SnapshotRow {
  id: number;
  site_id: string;
  iteration: number;
  changelog_audio_r2_key: string | null;
  changelog_script_r2_key: string | null;
  applied_goodies_json: string | null;
  lighthouse_perf: number | null;
  lighthouse_a11y: number | null;
  lighthouse_seo: number | null;
  delight_count: number | null;
}

interface GenerateRequest {
  voice_id?: string;
  model_id?: string;
  script?: string;
  applied_goodies?: string[];
  force?: boolean;
}

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';
const MAX_SCRIPT_CHARS = 1800;

function safeParseArray(input: string | null): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function buildDefaultScript(
  businessName: string,
  iteration: number,
  snapshot: SnapshotRow,
  applied: string[],
): string {
  const lines: string[] = [];
  lines.push(`Welcome to iteration ${iteration} of ${businessName}.`);
  if (snapshot.lighthouse_perf != null) {
    lines.push(
      `Performance landed at ${snapshot.lighthouse_perf}, accessibility ${
        snapshot.lighthouse_a11y ?? 'unknown'
      }, and search optimization ${snapshot.lighthouse_seo ?? 'unknown'} out of one hundred.`,
    );
  }
  if (applied.length > 0) {
    const head = applied.slice(0, 4);
    lines.push(
      `This pass shipped ${applied.length} new touches: ${head.join(', ')}${
        applied.length > head.length ? ', and more.' : '.'
      }`,
    );
  }
  if ((snapshot.delight_count ?? 0) > 0) {
    lines.push(`We logged ${snapshot.delight_count} delight moments along the way.`);
  }
  lines.push('Keep building. Each iteration unlocks another goody from the queue.');
  return lines.join(' ');
}

function clampScript(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_SCRIPT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SCRIPT_CHARS - 3) + '...';
}

async function synthesize(
  env: Env,
  script: string,
  voiceId: string,
  modelId: string,
): Promise<ArrayBuffer> {
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY missing');
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: script,
      model_id: modelId,
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`elevenlabs ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.arrayBuffer();
}

changelogAudio.post('/api/changelog-audio/:slug/:iteration/generate', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  if (!slug || !Number.isFinite(iteration) || iteration < 1) {
    return c.json({ error: 'bad params' }, 400);
  }

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, business_name, iteration_count FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);

  const snapshot = await dbQueryOne<SnapshotRow>(
    c.env.DB,
    `SELECT id, site_id, iteration, changelog_audio_r2_key, changelog_script_r2_key,
            applied_goodies_json, lighthouse_perf, lighthouse_a11y, lighthouse_seo, delight_count
     FROM iteration_snapshots WHERE site_id = ? AND iteration = ?`,
    [site.id, iteration],
  );
  if (!snapshot) return c.json({ error: 'iteration snapshot not found' }, 404);

  const body = await c.req.json<GenerateRequest>().catch(() => ({}) as GenerateRequest);
  const force = body.force === true || c.req.query('force') === '1';

  const audioKey = `sites/${slug}/iter-${iteration}/changelog.mp3`;
  const scriptKey = `sites/${slug}/iter-${iteration}/changelog.txt`;

  if (!force && snapshot.changelog_audio_r2_key && snapshot.changelog_script_r2_key) {
    return c.json({
      ok: true,
      cached: true,
      audio_key: snapshot.changelog_audio_r2_key,
      script_key: snapshot.changelog_script_r2_key,
    });
  }

  const applied =
    Array.isArray(body.applied_goodies) && body.applied_goodies.length > 0
      ? body.applied_goodies.filter((x): x is string => typeof x === 'string')
      : safeParseArray(snapshot.applied_goodies_json);

  const script = clampScript(body.script ?? buildDefaultScript(site.business_name, iteration, snapshot, applied));
  const voiceId = (body.voice_id ?? DEFAULT_VOICE_ID).slice(0, 64);
  const modelId = (body.model_id ?? DEFAULT_MODEL_ID).slice(0, 64);

  let audio: ArrayBuffer;
  try {
    audio = await synthesize(c.env, script, voiceId, modelId);
  } catch (err) {
    return c.json(
      { error: 'synthesis_failed', detail: err instanceof Error ? err.message : 'unknown' },
      502,
    );
  }

  await c.env.SITES_BUCKET.put(audioKey, audio, {
    httpMetadata: {
      contentType: 'audio/mpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { voice_id: voiceId, model_id: modelId, iteration: String(iteration) },
  });
  await c.env.SITES_BUCKET.put(scriptKey, script, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
  });

  await dbExecute(
    c.env.DB,
    `UPDATE iteration_snapshots
     SET changelog_audio_r2_key = ?, changelog_script_r2_key = ?
     WHERE id = ?`,
    [audioKey, scriptKey, snapshot.id],
  );

  return c.json({
    ok: true,
    cached: false,
    audio_key: audioKey,
    script_key: scriptKey,
    script_length: script.length,
    voice_id: voiceId,
    model_id: modelId,
  });
});

changelogAudio.get('/api/changelog-audio/:slug/:iteration', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  if (!slug || !Number.isFinite(iteration)) return c.json({ error: 'bad params' }, 400);

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, business_name, iteration_count FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);

  const snapshot = await dbQueryOne<SnapshotRow>(
    c.env.DB,
    `SELECT id, site_id, iteration, changelog_audio_r2_key, changelog_script_r2_key,
            applied_goodies_json, lighthouse_perf, lighthouse_a11y, lighthouse_seo, delight_count
     FROM iteration_snapshots WHERE site_id = ? AND iteration = ?`,
    [site.id, iteration],
  );
  if (!snapshot || !snapshot.changelog_audio_r2_key) {
    return c.json({ error: 'changelog audio not generated' }, 404);
  }

  return c.json({
    ok: true,
    iteration,
    audio_url: `/api/changelog-audio/${slug}/${iteration}/audio.mp3`,
    script_url: `/api/changelog-audio/${slug}/${iteration}/script.txt`,
    audio_key: snapshot.changelog_audio_r2_key,
    script_key: snapshot.changelog_script_r2_key,
  });
});

changelogAudio.get('/api/changelog-audio/:slug/:iteration/audio.mp3', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  if (!slug || !Number.isFinite(iteration)) return c.json({ error: 'bad params' }, 400);

  const key = `sites/${slug}/iter-${iteration}/changelog.mp3`;
  const obj = await c.env.SITES_BUCKET.get(key);
  if (!obj) return c.notFound();

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    },
  });
});

changelogAudio.get('/api/changelog-audio/:slug/:iteration/script.txt', async (c) => {
  const slug = c.req.param('slug');
  const iteration = Number.parseInt(c.req.param('iteration') ?? '', 10);
  if (!slug || !Number.isFinite(iteration)) return c.json({ error: 'bad params' }, 400);

  const key = `sites/${slug}/iter-${iteration}/changelog.txt`;
  const obj = await c.env.SITES_BUCKET.get(key);
  if (!obj) return c.notFound();

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

export { changelogAudio };
