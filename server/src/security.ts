import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import type { AppConfig } from './config.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * ARES executes commands on this machine, so the API only answers the
 * dashboard. Two checks stop other websites open in the same browser from
 * driving it:
 *  - Origin: browsers attach it to cross-site requests and WebSocket upgrades;
 *    it must be the dashboard (dev server or the server itself).
 *  - Host: blocks DNS-rebinding when bound to loopback.
 */
export function createGuard(config: AppConfig) {
  const origins = new Set(config.allowedOrigins);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const port of [config.port, 5173, 4173]) origins.add(`http://${host}:${port}`);
  }
  const enforceHost = LOOPBACK_HOSTS.has(config.host);

  function check(headers: IncomingMessage['headers']): string | null {
    const origin = headers.origin;
    if (origin && !origins.has(origin)) return `Origin ${origin} is not allowed`;
    if (enforceHost) {
      const hostname = (headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
      if (!LOOPBACK_HOSTS.has(hostname)) return `Host ${headers.host ?? '(none)'} is not allowed`;
    }
    return null;
  }

  const middleware: RequestHandler = (req, res, next) => {
    const problem = check(req.headers);
    if (problem) {
      res.status(403).json({ error: problem });
      return;
    }
    next();
  };

  return { check, middleware };
}
