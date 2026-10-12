import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { testConfig, testRuntime } from './helpers.js';

interface Captured {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: http.Server | undefined;
afterEach(() => server?.close());

/** Minimal stand-in for an LLM endpoint that records what ARES sends. */
async function fakeEndpoint(reply: (body: Record<string, unknown>) => unknown) {
  const captured: Captured[] = [];
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      captured.push({ url: req.url ?? '', headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply(body)));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, captured };
}

describe('LLM fallback', () => {
  it('stays out of the way when a hook matches', async () => {
    const { url, captured } = await fakeEndpoint(() => ({ message: { content: 'unused' } }));
    const base = testConfig().brain;
    const { rt } = await testRuntime({ brain: { ...base, provider: 'ollama', ollama: { url, model: 'llama3.2' } } });
    expect((await rt.assistant.handle('what time is it')).intent).toBe('system.time');
    expect(captured).toHaveLength(0);
  });

  it('asks Ollama with the ARES persona and keeps short history', async () => {
    const { url, captured } = await fakeEndpoint(() => ({
      message: { content: '<think>scratch</think>**Paris.** It is the capital of France.' },
    }));
    const base = testConfig().brain;
    const { rt } = await testRuntime({ brain: { ...base, provider: 'ollama', ollama: { url, model: 'llama3.2' } } });

    const first = await rt.assistant.handle('ARES, what is the capital of France?');
    expect(first).toMatchObject({ intent: 'brain', ok: true, speech: 'Paris. It is the capital of France.' });
    await rt.assistant.handle('and of Spain?');

    const [req1, req2] = captured;
    expect(req1!.url).toBe('/api/chat');
    expect(req1!.body).toMatchObject({ model: 'llama3.2', stream: false });
    const messages = req2!.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('You are ARES');
    expect(messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('calls Claude with low effort and server-side fallbacks', async () => {
    const { url, captured } = await fakeEndpoint((body) => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: 'Light from the Sun takes about eight minutes to reach Earth.' }],
      stop_reason: 'end_turn',
      stop_details: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 12 },
    }));
    process.env.ANTHROPIC_BASE_URL = url;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      const base = testConfig().brain;
      const { rt } = await testRuntime({ brain: { ...base, provider: 'anthropic', anthropic: { model: 'claude-opus-5-5' } } });
      const res = await rt.assistant.handle('how long does sunlight take to reach us');
      expect(res).toMatchObject({ intent: 'brain', ok: true });
      expect(res.speech).toMatch(/eight minutes/);

      const req = captured[0]!;
      expect(req.url).toMatch(/^\/v1\/messages/);
      expect(req.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(req.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low' } });
      expect(req.body.system).toContain('You are ARES');
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('answers a refusal in persona', async () => {
    const { url } = await fakeEndpoint((body) => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: null, explanation: null },
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    }));
    process.env.ANTHROPIC_BASE_URL = url;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      const base = testConfig().brain;
      const { rt } = await testRuntime({ brain: { ...base, provider: 'anthropic', anthropic: { model: 'claude-opus-5-5' } } });
      expect((await rt.assistant.handle('something declined')).speech).toBe("I can't help with that one.");
    } finally {
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('reports an unreachable brain briefly', async () => {
    const base = testConfig().brain;
    const { rt } = await testRuntime({ brain: { ...base, provider: 'ollama', ollama: { url: 'http://127.0.0.1:9', model: 'x' } } });
    const res = await rt.assistant.handle('tell me a story');
    expect(res).toMatchObject({ intent: 'brain', ok: false });
    expect(res.speech).toBe("That failed. Ollama isn't reachable at http://127.0.0.1:9.");
  });
});
