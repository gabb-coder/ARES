import express, { type ErrorRequestHandler, type Router } from 'express';
import { MAX_UTTERANCE_CHARS } from '../core/assistant.js';
import type { AresEvent } from '../core/events.js';
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
      brain: rt.agent ? { provider: rt.agent.provider, model: rt.agent.model } : { provider: 'none' },
      integrations: rt.integrations.configured,
      dryRun: rt.config.dryRun,
      hooks: rt.registry.size,
    });
  });

  router.get('/hooks', (_req, res) => {
    res.json(rt.registry.list());
  });

  /** Server-sent events: alerts from timers/reminders and live state for the dashboard. */
  router.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: AresEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: 'schedule', items: rt.scheduler.list() });
    send({ type: 'integrations', servers: rt.integrations.status() });
    const unsubscribe = rt.bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  /** Confirm or cancel an action the agent is holding. Body: { approve: boolean }. */
  router.post('/pending/:id', async (req, res) => {
    const approve: unknown = req.body?.approve;
    if (typeof approve !== 'boolean') {
      res.status(400).json({ error: 'Body must be { "approve": boolean }' });
      return;
    }
    res.json(await rt.assistant.resolvePending(req.params.id, approve));
  });

  router.get('/integrations', (_req, res) => {
    res.json({ servers: rt.integrations.status(), error: rt.integrations.loadError });
  });

  router.post('/integrations/:name/reconnect', async (req, res) => {
    try {
      await rt.integrations.reconnect(req.params.name);
      res.json({ servers: rt.integrations.status() });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  /** OAuth providers send the browser back here after sign-in. */
  router.get('/integrations/oauth/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const page = (title: string, detail: string) =>
      res
        .type('html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>ARES</title><body style="font:16px system-ui;background:#07080b;color:#e8ebf1;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ff5c69;letter-spacing:.3em;font-family:monospace">ARES</h1><p>${escapeHtml(title)}</p><p style="color:#8a93a6">${escapeHtml(detail)}</p></div>`,
        );
    if (error || !code || !state) {
      res.status(400);
      page('Sign-in was not completed.', error ?? 'Missing code.');
      return;
    }
    try {
      const name = await rt.integrations.completeOAuth(state, code);
      page(`${name} connected.`, 'You can close this tab.');
    } catch (err) {
      res.status(400);
      page('Sign-in failed.', (err as Error).message);
    }
  });

  router.delete('/schedule/:id', (req, res) => {
    if (!rt.scheduler.cancel(req.params.id)) {
      res.status(404).json({ error: 'No such timer or reminder' });
      return;
    }
    res.status(204).end();
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
