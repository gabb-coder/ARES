import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EventBus, ScheduledItem } from '../core/events.js';
import type { Logger } from '../core/types.js';

// setTimeout overflows past ~24.8 days; longer waits re-arm in steps.
const MAX_TIMEOUT = 2 ** 31 - 1;

export interface SchedulerOptions {
  /** JSON file for persistence; null keeps everything in memory. */
  file: string | null;
  bus: EventBus;
  log: Logger;
  /** Called when an item fires, e.g. to raise a desktop notification. */
  onFire?: (item: ScheduledItem, speech: string) => void;
  now?: () => number;
}

/**
 * Timers and reminders. Reminders persist across restarts (one missed while
 * ARES was off is announced at startup); timers are in-memory only.
 */
export class Scheduler {
  #items = new Map<string, ScheduledItem>();
  #handles = new Map<string, NodeJS.Timeout>();
  #saving: Promise<void> = Promise.resolve();
  readonly #now: () => number;

  constructor(private readonly options: SchedulerOptions) {
    this.#now = options.now ?? Date.now;
  }

  async load(): Promise<void> {
    if (!this.options.file) return;
    let saved: ScheduledItem[] = [];
    try {
      saved = JSON.parse(await fs.readFile(this.options.file, 'utf8')) as ScheduledItem[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.options.log.warn(`schedule unreadable: ${(err as Error).message}`);
      return;
    }
    for (const item of saved) {
      if (item.kind !== 'reminder') continue;
      this.#items.set(item.id, item);
      if (item.dueAt <= this.#now()) this.#fire(item, true);
      else this.#arm(item);
    }
    this.#changed();
  }

  add(kind: ScheduledItem['kind'], label: string, dueAt: number): ScheduledItem {
    const item: ScheduledItem = { id: randomUUID(), kind, label, dueAt, createdAt: this.#now() };
    this.#items.set(item.id, item);
    this.#arm(item);
    this.#changed();
    return item;
  }

  cancel(id: string): boolean {
    const existed = this.#items.delete(id);
    clearTimeout(this.#handles.get(id));
    this.#handles.delete(id);
    if (existed) this.#changed();
    return existed;
  }

  /** Upcoming items, soonest first. */
  list(kind?: ScheduledItem['kind']): ScheduledItem[] {
    return [...this.#items.values()].filter((i) => !kind || i.kind === kind).sort((a, b) => a.dueAt - b.dueAt);
  }

  close(): void {
    this.#handles.forEach((h) => clearTimeout(h));
    this.#handles.clear();
  }

  #arm(item: ScheduledItem) {
    const delay = item.dueAt - this.#now();
    const handle = setTimeout(
      () => {
        if (item.dueAt > this.#now()) this.#arm(item);
        else this.#fire(item, false);
      },
      Math.max(0, Math.min(delay, MAX_TIMEOUT)),
    );
    handle.unref();
    this.#handles.set(item.id, handle);
  }

  #fire(item: ScheduledItem, missed: boolean) {
    this.#items.delete(item.id);
    this.#handles.delete(item.id);
    const speech =
      item.kind === 'timer'
        ? `Time's up. ${item.label}.`
        : `${missed ? 'Missed reminder' : 'Reminder'}: ${item.label}.`;
    this.options.log.info(`${item.kind} fired: ${item.label}`);
    this.options.bus.emit({
      type: 'alert',
      id: item.id,
      kind: item.kind,
      speech,
      card: { title: item.kind === 'timer' ? 'Timer' : 'Reminder', body: item.label },
    });
    this.options.onFire?.(item, speech);
    this.#changed();
  }

  #changed() {
    this.options.bus.emit({ type: 'schedule', items: this.list() });
    // Serialize writes so overlapping changes can't race on the temp file.
    const reminders = this.list('reminder');
    this.#saving = this.#saving.then(() => this.#persist(reminders));
  }

  /** Resolves once pending writes are on disk. */
  flush(): Promise<void> {
    return this.#saving;
  }

  async #persist(reminders: ScheduledItem[]) {
    if (!this.options.file) return;
    try {
      await fs.mkdir(path.dirname(this.options.file), { recursive: true });
      const tmp = `${this.options.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(reminders, null, 2));
      await fs.rename(tmp, this.options.file);
    } catch (err) {
      this.options.log.warn(`could not save reminders: ${(err as Error).message}`);
    }
  }
}
