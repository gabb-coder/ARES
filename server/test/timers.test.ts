import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { formatDuration, parseDuration } from '../src/core/duration.js';
import { EventBus, type AresEvent } from '../src/core/events.js';
import { formatWhen, parseReminder } from '../src/hooks/timers.js';
import { Scheduler } from '../src/services/scheduler.js';
import { silentLog, tempDir, testRuntime } from './helpers.js';

afterEach(() => vi.useRealTimers());

describe('parseDuration', () => {
  it.each([
    ['10 minutes', 600_000],
    ['an hour and a half', 5_400_000],
    ['1 hour and 30 minutes', 5_400_000],
    ['half an hour', 1_800_000],
    ['ninety seconds', 90_000],
    ['twenty five minutes', 1_500_000],
    ['2 hrs 5 mins', 7_500_000],
    ['a couple of minutes', 120_000],
    ['1.5 hours', 5_400_000],
  ])('%j → %d ms', (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it('formats for speech', () => {
    expect(formatDuration(330_000)).toBe('5 minutes 30 seconds');
    expect(formatDuration(3_661_000)).toBe('1 hour 1 minute');
    expect(formatDuration(1_000)).toBe('1 second');
  });
});

describe('parseReminder', () => {
  const now = new Date('2026-10-12T15:30:00');

  it.each([
    ['to call Sam at 3pm', 'call Sam', '2026-10-13T15:00'],
    ['at 3pm to call Sam', 'call Sam', '2026-10-13T15:00'],
    ['in 20 minutes to stretch', 'stretch', '2026-10-12T15:50'],
    ['tomorrow at 9 to submit the report', 'submit the report', '2026-10-13T09:00'],
    ['to water the plants tomorrow', 'water the plants', '2026-10-13T09:00'],
    ['to take out the trash tonight', 'take out the trash', '2026-10-12T22:00'],
    ['on friday at 10am to pay rent', 'pay rent', '2026-10-16T10:00'],
  ])('%j', (text, task, due) => {
    const parsed = parseReminder(text, now)!;
    expect(parsed.task).toBe(task);
    const local = new Date(parsed.due.getTime() - parsed.due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    expect(local).toBe(due);
  });

  it('needs a time', () => {
    expect(parseReminder('to call Sam', now)).toBeNull();
  });

  it('speaks times naturally', () => {
    expect(formatWhen(new Date('2026-10-12T15:50:00'), now)).toBe('in 20 minutes');
    expect(formatWhen(new Date('2026-10-12T18:15:00'), now)).toBe('at 6:15 PM');
    expect(formatWhen(new Date('2026-10-13T09:00:00'), now)).toBe('tomorrow at 9 AM');
    expect(formatWhen(new Date('2026-10-16T10:00:00'), now)).toBe('Friday at 10 AM');
  });
});

describe('timer hooks', () => {
  it('sets, reports and cancels timers', async () => {
    const { rt } = await testRuntime();
    expect((await rt.assistant.handle('set a timer for 10 minutes')).speech).toBe('Timer set for 10 minutes.');
    expect((await rt.assistant.handle('set a pasta timer for 12 minutes')).speech).toBe('Pasta timer set for 12 minutes.');
    expect((await rt.assistant.handle('how much time is left')).speech).toMatch(/^2 timers\. 10 minute timer, (?:9|10) minutes/);
    expect((await rt.assistant.handle('cancel the pasta timer')).speech).toBe('Timer cancelled.');
    expect((await rt.assistant.handle('5 minute timer')).speech).toBe('Timer set for 5 minutes.');
    expect((await rt.assistant.handle('cancel all timers')).speech).toBe('2 timers cancelled.');
    expect((await rt.assistant.handle('time left')).speech).toBe('No timers running.');
  });

  it('sets, lists and cancels reminders', async () => {
    const { rt } = await testRuntime();
    expect((await rt.assistant.handle('remind me in 20 minutes to stretch')).speech).toBe("I'll remind you in 20 minutes.");
    expect((await rt.assistant.handle('what are my reminders')).speech).toBe('One reminder. Next: stretch, in 20 minutes.');
    expect((await rt.assistant.handle('cancel my reminder to stretch')).speech).toBe('Reminder cancelled.');
    expect((await rt.assistant.handle('remind me to call Sam')).ok).toBe(false);
  });
});

describe('Scheduler', () => {
  it('fires alerts and desktop notifications on time', async () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const events: AresEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const fired: string[] = [];
    const scheduler = new Scheduler({ file: null, bus, log: silentLog, onFire: (_i, speech) => fired.push(speech) });

    scheduler.add('timer', '10 minute timer', Date.now() + 600_000);
    vi.advanceTimersByTime(599_000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(fired).toEqual(["Time's up. 10 minute timer."]);
    expect(events.find((e) => e.type === 'alert')).toMatchObject({ type: 'alert', kind: 'timer' });
    expect(scheduler.list()).toEqual([]);
  });

  it('re-arms waits longer than setTimeout allows', async () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const scheduler = new Scheduler({ file: null, bus: new EventBus(), log: silentLog, onFire: (i) => fired.push(i.label) });
    scheduler.add('reminder', 'renew passport', Date.now() + 40 * 86_400_000);
    vi.advanceTimersByTime(30 * 86_400_000);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(10 * 86_400_000);
    expect(fired).toEqual(['renew passport']);
  });

  it('persists reminders and announces ones missed while offline', async () => {
    const dir = await tempDir('ares-sched-');
    const file = path.join(dir, 'reminders.json');
    const first = new Scheduler({ file, bus: new EventBus(), log: silentLog });
    first.add('reminder', 'call Sam', Date.now() + 60_000);
    first.add('reminder', 'pay rent', Date.now() + 86_400_000);
    first.add('timer', 'tea timer', Date.now() + 60_000);
    await first.flush();
    first.close();
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toHaveLength(2); // timers aren't saved

    const fired: string[] = [];
    const later = Date.now() + 120_000;
    const second = new Scheduler({ file, bus: new EventBus(), log: silentLog, now: () => later, onFire: (_i, s) => fired.push(s) });
    await second.load();
    expect(fired).toEqual(['Missed reminder: call Sam.']);
    expect(second.list().map((i) => i.label)).toEqual(['pay rent']);
    second.close();
  });
});

describe('/api/events', () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it('streams the schedule and alerts', async () => {
    const { rt } = await testRuntime();
    server = http.createServer(createApp(rt));
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;

    const received: AresEvent[] = [];
    const done = new Promise<void>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n')) {
            if (line.startsWith('data: ')) received.push(JSON.parse(line.slice(6)));
          }
          if (received.some((e) => e.type === 'alert')) {
            res.destroy();
            resolve();
          }
        });
        rt.scheduler.add('timer', 'test timer', Date.now() + 10);
      });
    });
    await done;
    expect(received[0]).toEqual({ type: 'schedule', items: [] });
    expect(received.find((e) => e.type === 'alert')).toMatchObject({ speech: "Time's up. test timer." });
    server.closeAllConnections();
  });
});
