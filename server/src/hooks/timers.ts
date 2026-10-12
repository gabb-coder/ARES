import * as chrono from 'chrono-node';
import { DURATION_PATTERN, formatDuration, parseDuration } from '../core/duration.js';
import { patterns } from '../core/intent.js';
import { defineHook } from '../core/types.js';

const D = DURATION_PATTERN;
const MAX_TIMER_MS = 7 * 86_400_000;
const FILLER_NAMES = new Set(['new', 'quick', 'another', 'kitchen']);

export const setTimerHook = defineHook({
  name: 'timer.set',
  category: 'Timers',
  description: 'Start a countdown timer',
  examples: ['Set a timer for 10 minutes', 'Set a pasta timer for 12 minutes'],
  match: patterns(
    new RegExp(String.raw`^(?:set|start|create|make|put on)(?: me)?(?: an?| the)?(?: (?<name>[a-z][a-z ]*?))? timer (?:for|of|to) (?<duration>${D})$`, 'i'),
    new RegExp(String.raw`^(?:set|start|create|make)(?: me)?(?: an?)? (?<duration>${D})(?: (?<name>[a-z][a-z ]*?))? timer$`, 'i'),
    new RegExp(String.raw`^timer (?:for )?(?<duration>${D})$`, 'i'),
    new RegExp(String.raw`^(?<duration>${D}) timer$`, 'i'),
    new RegExp(String.raw`^count ?down (?:from |for )?(?<duration>${D})$`, 'i'),
  ),
  run: ({ duration, name }, ctx) => {
    const ms = parseDuration(duration ?? '');
    if (!ms) return { ok: false, speech: "I didn't catch the duration." };
    if (ms > MAX_TIMER_MS) return { ok: false, speech: 'Timers max out at 7 days. Use a reminder instead.' };

    const named = name && !FILLER_NAMES.has(name.toLowerCase()) ? name.toLowerCase() : null;
    // "10 minute timer": units are singular when used as an adjective.
    const label = named ? `${capitalize(named)} timer` : `${formatDuration(ms).replace(/(\d+ \w+?)s\b/g, '$1')} timer`;
    ctx.scheduler.add('timer', label, Date.now() + ms);
    return { speech: `${named ? `${capitalize(named)} timer` : 'Timer'} set for ${formatDuration(ms)}.` };
  },
});

export const timerStatusHook = defineHook({
  name: 'timer.status',
  category: 'Timers',
  description: 'Time left on running timers',
  examples: ['How much time is left?'],
  match: patterns(
    /^how (?:much time|long)(?: is| do i have)? (?:left|remaining)(?: on (?:the|my) (?:[a-z ]+ )?timers?)?$/i,
    /^(?:what(?:'s| is| are)|list|show(?: me)?|check)(?: my| the)? timers?(?: status)?$/i,
    /^time (?:left|remaining)$/i,
  ),
  run: (_params, ctx) => {
    const timers = ctx.scheduler.list('timer');
    if (timers.length === 0) return { speech: 'No timers running.' };
    const left = (dueAt: number) => formatDuration(dueAt - Date.now());
    const card = { title: 'Timers', fields: timers.map((t) => ({ label: t.label, value: left(t.dueAt) })) };
    if (timers.length === 1) return { speech: `${left(timers[0]!.dueAt)} left.`, card };
    const spoken = timers.slice(0, 3).map((t) => `${t.label}, ${left(t.dueAt)}`).join('; ');
    return { speech: `${timers.length} timers. ${spoken}.`, card };
  },
});

export const cancelTimerHook = defineHook({
  name: 'timer.cancel',
  category: 'Timers',
  description: 'Cancel timers',
  examples: ['Cancel the timer'],
  match: patterns(/^(?:cancel|stop|delete|clear|remove|kill|end|turn off)(?<all> all)?(?: the| my)?(?: (?<name>[a-z][a-z ]*?))? timers?$/i),
  run: ({ all, name }, ctx) => {
    const timers = ctx.scheduler.list('timer');
    if (timers.length === 0) return { speech: 'No timers running.' };
    const named = name ? timers.filter((t) => t.label.toLowerCase().startsWith(name.toLowerCase())) : [];
    const targets = named.length ? named : all || timers.length === 1 || !name ? timers : [];
    if (targets.length === 0) return { ok: false, speech: `No ${name} timer.` };
    targets.forEach((t) => ctx.scheduler.cancel(t.id));
    return { speech: targets.length === 1 ? 'Timer cancelled.' : `${targets.length} timers cancelled.` };
  },
});

export const setReminderHook = defineHook({
  name: 'reminder.set',
  category: 'Timers',
  description: 'Remind you about something at a time',
  examples: ['Remind me at 3pm to call Sam', 'Remind me in 20 minutes to stretch'],
  match: patterns(
    /^remind me(?: to| that| about| of)?\s+(?<rest>.+)$/i,
    /^(?:set|create|add|make)(?: me)?(?: an?| the)? reminder(?: for| at| on| to)?\s+(?<rest>.+)$/i,
  ),
  run: ({ rest }, ctx) => {
    const now = new Date();
    const parsed = parseReminder(rest ?? '', now);
    if (!parsed) return { ok: false, speech: "When? Try 'remind me at 3pm to call Sam'." };
    ctx.scheduler.add('reminder', parsed.task, parsed.due.getTime());
    return {
      speech: `I'll remind you ${formatWhen(parsed.due, now)}.`,
      card: { title: 'Reminder set', fields: [{ label: 'What', value: parsed.task }, { label: 'When', value: parsed.due.toLocaleString() }] },
    };
  },
});

export const listRemindersHook = defineHook({
  name: 'reminder.list',
  category: 'Timers',
  description: 'List upcoming reminders',
  examples: ['What are my reminders?'],
  match: patterns(
    /^(?:what(?:'s| is| are)|list|show(?: me)?|read(?: me)?)(?: all)?(?: my| the)?(?: upcoming)? reminders$/i,
    /^(?:do i have|are there) any reminders$/i,
  ),
  run: (_params, ctx) => {
    const reminders = ctx.scheduler.list('reminder');
    if (reminders.length === 0) return { speech: 'No reminders.' };
    const now = new Date();
    const first = reminders[0]!;
    const next = `Next: ${first.label}, ${formatWhen(new Date(first.dueAt), now)}.`;
    return {
      speech: reminders.length === 1 ? `One reminder. ${next}` : `${reminders.length} reminders. ${next}`,
      card: { title: 'Reminders', fields: reminders.map((r) => ({ label: new Date(r.dueAt).toLocaleString(), value: r.label })) },
    };
  },
});

export const cancelReminderHook = defineHook({
  name: 'reminder.cancel',
  category: 'Timers',
  description: 'Cancel reminders',
  examples: ['Cancel my reminder to call Sam'],
  match: patterns(/^(?:cancel|delete|clear|remove)(?<all> all)?(?: the| my)? reminders?(?: (?:to|about|for) (?<task>.+))?$/i),
  run: ({ all, task }, ctx) => {
    const reminders = ctx.scheduler.list('reminder');
    const targets = task
      ? reminders.filter((r) => r.label.toLowerCase().includes(task.toLowerCase()))
      : all || reminders.length === 1
        ? reminders
        : [];
    if (targets.length === 0) {
      return { ok: false, speech: reminders.length ? 'Which one? Say "cancel my reminder to …".' : 'No reminders.' };
    }
    targets.forEach((r) => ctx.scheduler.cancel(r.id));
    return { speech: targets.length === 1 ? 'Reminder cancelled.' : `${targets.length} reminders cancelled.` };
  },
});

/** Splits "to call Sam at 3pm" into the task and when. */
export function parseReminder(text: string, now: Date): { task: string; due: Date } | null {
  const result = chrono.parse(text, now, { forwardDate: true })[0];
  if (!result) return null;

  const due = result.start.date();
  // "tomorrow" or "on Friday" with no time: morning, unless the phrase implies one.
  if (!result.start.isCertain('hour') && !/tonight|evening|morning|afternoon|noon|midnight/i.test(result.text)) {
    due.setHours(9, 0, 0, 0);
  }
  if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);

  const task = `${text.slice(0, result.index)} ${text.slice(result.index + result.text.length)}`
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:at|on|in|by|for)\s+/i, '')
    .replace(/\s+(?:at|on|in|by|for)$/i, '')
    .replace(/^(?:to|that|about|of)\s+/i, '')
    .trim();
  return { task: task || 'Reminder', due };
}

/** "at 3:15 PM", "tomorrow at 9 AM", "Friday at 10 AM", "October 20 at 9 AM", "in 20 minutes". */
export function formatWhen(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime();
  if (ms < 60 * 60_000) return `in ${formatDuration(Math.round(ms / 60_000) * 60_000)}`;

  const time = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: due.getMinutes() ? '2-digit' : undefined });
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${due.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}`;
  return `${due.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} at ${time}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const timerHooks = [setTimerHook, timerStatusHook, cancelTimerHook, setReminderHook, listRemindersHook, cancelReminderHook];
