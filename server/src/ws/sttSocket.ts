import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Runtime } from '../runtime.js';
import { STT_SAMPLE_RATE } from '../services/stt.js';

const BYTES_PER_SECOND = STT_SAMPLE_RATE * 2;
const MAX_UTTERANCE_SECONDS = 30;
const MIN_UTTERANCE_SECONDS = 0.3;

/**
 * Microphone streaming for local speech-to-text.
 *
 * Client → server: binary frames of 16 kHz mono PCM16 (little-endian), plus
 *   JSON control frames {"type":"start"|"end"|"cancel"}.
 * Server → client: {"type":"ready"} | {"type":"transcript","text"} |
 *   {"type":"error","message"}.
 */
export function attachSttSocket(server: Server, rt: Runtime, checkHeaders: (h: IncomingMessage['headers']) => string | null) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws/stt') return; // leave other upgrades (e.g. Vite HMR) alone

    const problem = checkHeaders(req.headers);
    if (problem) {
      rt.log.warn(`ws rejected: ${problem}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, rt));
  });

  return wss;
}

function handleConnection(ws: WebSocket, rt: Runtime) {
  let chunks: Buffer[] = [];
  let bytes = 0;
  let recording = false;

  const send = (msg: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const reset = () => {
    chunks = [];
    bytes = 0;
  };

  async function finish() {
    recording = false;
    const pcm = Buffer.concat(chunks, bytes);
    reset();
    if (pcm.length < BYTES_PER_SECOND * MIN_UTTERANCE_SECONDS) {
      send({ type: 'transcript', text: '' });
      return;
    }
    try {
      const text = await rt.stt.transcribe(pcm);
      send({ type: 'transcript', text });
    } catch (err) {
      rt.log.warn(`stt failed: ${(err as Error).message}`);
      send({ type: 'error', message: (err as Error).message });
    }
  }

  if (!rt.stt.available) {
    send({ type: 'error', message: 'Local speech-to-text is not configured. Set LOCAL_STT_URL.' });
    ws.close(1011, 'stt unavailable');
    return;
  }
  send({ type: 'ready', sampleRate: STT_SAMPLE_RATE });

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      if (!recording) return;
      const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes >= BYTES_PER_SECOND * MAX_UTTERANCE_SECONDS) void finish();
      return;
    }

    let msg: { type?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send({ type: 'error', message: 'Malformed control frame' });
      return;
    }
    if (msg.type === 'start') {
      reset();
      recording = true;
    } else if (msg.type === 'end') {
      if (recording) void finish();
    } else if (msg.type === 'cancel') {
      recording = false;
      reset();
    }
  });
}
