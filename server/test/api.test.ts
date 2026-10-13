import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createGuard } from '../src/security.js';
import { attachSttSocket } from '../src/ws/sttSocket.js';
import { testConfig, testRuntime } from './helpers.js';

const DASHBOARD = 'http://localhost:5173';

describe('HTTP API', () => {
  it('reports health and a key-free config', async () => {
    const tts = testConfig().tts;
    const { rt } = await testRuntime({
      tts: { ...tts, provider: 'elevenlabs', elevenlabs: { ...tts.elevenlabs, apiKey: 'sk-secret' } },
    });
    const app = createApp(rt);

    await request(app).get('/api/health').expect(200).expect((res) => expect(res.body.ok).toBe(true));
    const config = await request(app).get('/api/config').expect(200);
    expect(config.body.tts).toEqual({ provider: 'elevenlabs', available: true });
    expect(JSON.stringify(config.body)).not.toContain('sk-secret');
  });

  it('lists hooks', async () => {
    const { rt } = await testRuntime();
    const res = await request(createApp(rt)).get('/api/hooks').expect(200);
    expect(res.body.map((h: { name: string }) => h.name)).toContain('fs.list');
  });

  it('runs commands', async () => {
    const { rt, launcher } = await testRuntime();
    const res = await request(createApp(rt))
      .post('/api/command')
      .set('Origin', DASHBOARD)
      .send({ text: 'Hey ARES, open github dot com' })
      .expect(200);
    expect(res.body).toMatchObject({ intent: 'web.open', ok: true, speech: 'Opening github.com.' });
    expect(launcher.calls).toEqual([{ kind: 'url', target: 'https://github.com/' }]);
  });

  it('answers unknown commands in persona', async () => {
    const { rt } = await testRuntime();
    const res = await request(createApp(rt)).post('/api/command').send({ text: 'sing me a song' }).expect(200);
    expect(res.body).toMatchObject({ intent: null, ok: false });
    expect(res.body.speech).toMatch(/No hook handles that/);
  });

  it('validates input', async () => {
    const { rt } = await testRuntime();
    const app = createApp(rt);
    await request(app).post('/api/command').send({}).expect(400);
    await request(app).post('/api/command').send({ text: 'x'.repeat(501) }).expect(413);
    await request(app).post('/api/tts').send({ text: 'hello' }).expect(409);
    await request(app).get('/api/nope').expect(404);
  });

  it('rejects other websites and DNS-rebinding hosts', async () => {
    const { rt, launcher } = await testRuntime();
    const app = createApp(rt);
    await request(app).post('/api/command').set('Origin', 'https://evil.example').send({ text: 'open youtube' }).expect(403);
    await request(app).get('/api/health').set('Host', 'evil.example:3001').expect(403);
    expect(launcher.calls).toEqual([]);
  });
});

describe('STT WebSocket', () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  async function listen() {
    const { rt } = await testRuntime({ stt: { url: 'http://stt.invalid', api: 'whisper.cpp', model: 'x', language: 'en' } });
    const received: number[] = [];
    rt.stt = { available: true, transcribe: async (pcm) => (received.push(pcm.length), 'what time is it') };
    server = http.createServer(createApp(rt));
    attachSttSocket(server, rt, createGuard(rt.config).check);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return { port: (server.address() as AddressInfo).port, received };
  }

  it('buffers PCM between start and end, then returns the transcript', async () => {
    const { port, received } = await listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stt`, { origin: DASHBOARD });
    const messages: Array<{ type: string; text?: string }> = [];
    const transcript = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.type === 'ready') {
          ws.send(JSON.stringify({ type: 'start' }));
          ws.send(Buffer.alloc(16_000));
          ws.send(Buffer.alloc(16_000));
          ws.send(JSON.stringify({ type: 'end' }));
        }
        if (msg.type === 'transcript') resolve();
      });
    });
    await transcript;
    ws.close();
    expect(received).toEqual([32_000]);
    expect(messages.at(-1)).toEqual({ type: 'transcript', text: 'what time is it' });
  });

  it('rejects upgrades from other origins', async () => {
    const { port } = await listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stt`, { origin: 'https://evil.example' });
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => resolve(-1));
    });
    expect(status === 403 || status === -1).toBe(true);
  });
});
