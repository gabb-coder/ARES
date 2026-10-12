import express, { type ErrorRequestHandler, type Router } from 'express';
import { MAX_UTTERANCE_CHARS } from '../core/assistant.js';
import type { Runtime } from '../runtime.js';
import { PERSONA } from '../persona.js';

const MAX_TTS_CHARS = 1000;

export function apiRouter(rt: Runtime): Router {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  router.get('/health', (_req, res) => {
    res.json({ ok: true, name: PERSONA.name, uptime: Math.round(process.uptime()) });
  });

  /** Client-safe view of the configuration. Never includes keys. */
  router.get('/config', (_req, res) => {
    res.json({
      persona: PERSONA,
      tts: { provider: rt.tts.provider, available: rt.tts.available },
      stt: { local: rt.stt.available },
      brain: rt.brain ? { provider: rt.brain.provider, model: rt.brain.model } : { provider: 'none' },
      dryRun: rt.config.dryRun,
      hooks: rt.registry.size,
    });
  });

  router.get('/hooks', (_req, res) => {
    res.json(rt.registry.list());
  });

  router.post('/command', async (req, res) => {
    const text: unknown = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Body must be { "text": string }' });
      return;
    }
    if (text.length > MAX_UTTERANCE_CHARS) {
      res.status(413).json({ error: `Commands are limited to ${MAX_UTTERANCE_CHARS} characters` });
      return;
    }
    res.json(await rt.assistant.handle(text));
  });

  router.post('/tts', async (req, res) => {
    const text: unknown = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TTS_CHARS) {
      res.status(400).json({ error: `Body must be { "text": string } up to ${MAX_TTS_CHARS} characters` });
      return;
    }
    if (!rt.tts.available) {
      res.status(409).json({ error: `Server TTS is not configured (provider: ${rt.tts.provider})` });
      return;
    }
    try {
      const { audio, contentType } = await rt.tts.synthesize(text);
      res.set({ 'Content-Type': contentType, 'Cache-Control': 'no-store' }).send(audio);
    } catch (err) {
      rt.log.warn(`tts failed: ${(err as Error).message}`);
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) rt.log.error(err?.stack ?? String(err));
    res.status(status).json({ error: status >= 500 ? 'Internal error' : err.message });
  };
  router.use(onError);

  return router;
}
