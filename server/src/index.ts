import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './core/logger.js';
import { createRuntime } from './runtime.js';
import { createGuard } from './security.js';
import { attachSttSocket } from './ws/sttSocket.js';

const log = createLogger();

async function main() {
  const config = loadConfig();
  const rt = await createRuntime(config, log);
  const server = http.createServer(createApp(rt));
  const wss = attachSttSocket(server, rt, createGuard(config).check);

  server.listen(config.port, config.host, () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    log.info(`ARES online at ${url}`);
    log.info(`${rt.registry.size} hooks · filesystem root ${config.fsRoot}`);
    log.info(
      `tts ${rt.tts.provider}${rt.tts.provider !== 'browser' && !rt.tts.available ? ' (missing API key, browser fallback)' : ''}` +
        ` · stt ${rt.stt.available ? config.stt.url : 'browser'}` +
        ` · brain ${rt.brain ? `${rt.brain.provider}/${rt.brain.model}` : 'off'}` +
        (config.dryRun ? ' · DRY RUN' : ''),
    );
  });

  const shutdown = () => {
    log.info('Shutting down.');
    wss.clients.forEach((c) => c.terminate());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exit(1);
});
