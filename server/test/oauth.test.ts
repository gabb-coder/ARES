import fs from 'node:fs/promises';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Runtime } from '../src/runtime.js';
import { testRuntime } from './helpers.js';

let remote: http.Server | undefined;
let rt: Runtime | undefined;
afterEach(async () => {
  remote?.close();
  await rt?.close();
});

/** A remote MCP server behind OAuth 2.1 (discovery, dynamic registration, PKCE). */
async function startProtectedServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  let base = '';
  const tokenRequests: Record<string, string>[] = [];

  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => {
    res.json({ resource: `${base}/mcp`, authorization_servers: [base] });
  });
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });
  app.post('/register', (req, res) => {
    res.status(201).json({ ...req.body, client_id: 'ares-client', client_id_issued_at: Math.floor(Date.now() / 1000) });
  });
  app.post('/token', (req, res) => {
    tokenRequests.push(req.body);
    if (req.body.code !== 'the-code' || !req.body.code_verifier) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    res.json({ access_token: 'good-token', token_type: 'Bearer', expires_in: 3600 });
  });

  app.all('/mcp', async (req, res) => {
    if (req.headers.authorization !== 'Bearer good-token') {
      res.set('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`).status(401).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    const server = new McpServer({ name: 'remote', version: '1.0.0' });
    server.registerTool('whoami', { description: 'Who is signed in', annotations: { readOnlyHint: true } }, async () => ({
      content: [{ type: 'text', text: 'gab' }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  remote = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => remote!.once('listening', r));
  base = `http://127.0.0.1:${(remote.address() as AddressInfo).port}`;
  return { base, tokenRequests };
}

async function waitFor(check: () => boolean, ms = 10_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('OAuth for remote integrations', () => {
  it('signs in through the browser callback and connects', async () => {
    const { base, tokenRequests } = await startProtectedServer();
    const ctx = await testRuntime();
    rt = ctx.rt;
    await fs.writeFile(path.join(ctx.dataDir, 'integrations.json'), JSON.stringify({ mcpServers: { remote: { url: `${base}/mcp` } } }));
    await rt.integrations.start();

    await waitFor(() => rt!.integrations.status()[0]?.state === 'needs-auth');
    const authUrl = new URL(rt.integrations.status()[0]!.authUrl!);
    expect(authUrl.origin + authUrl.pathname).toBe(`${base}/authorize`);
    expect(authUrl.searchParams.get('client_id')).toBe('ares-client');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/integrations/oauth/callback');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authUrl.searchParams.get('state')!;
    expect(state).toMatch(/^remote\.[0-9a-f]{32}$/);

    // A forged state is rejected.
    const app = createApp(rt);
    await request(app).get('/api/integrations/oauth/callback').query({ code: 'the-code', state: 'remote.forged' }).expect(400);

    // The provider redirects the browser back with a code.
    const callback = await request(app).get('/api/integrations/oauth/callback').query({ code: 'the-code', state }).expect(200);
    expect(callback.text).toContain('remote connected.');
    await waitFor(() => rt!.integrations.status()[0]?.state === 'connected');
    expect(rt.integrations.status()[0]).toEqual({ name: 'remote', state: 'connected', tools: 1 });
    expect(tokenRequests.at(-1)).toMatchObject({ grant_type: 'authorization_code', code: 'the-code' });

    // Credentials persist privately for the next start.
    const stored = path.join(ctx.dataDir, 'oauth', 'remote.json');
    expect(JSON.parse(await fs.readFile(stored, 'utf8')).tokens.access_token).toBe('good-token');
    if (process.platform !== 'win32') expect((await fs.stat(stored)).mode & 0o777).toBe(0o600);

    const [tool] = rt.integrations.tools('anything', 10);
    expect(await tool!.call({})).toEqual({ text: 'gab', isError: false });
  });
});
