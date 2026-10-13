import type { Hook, HookContext, HookInfo, HookParams } from './types.js';

// Hooks are heterogeneous in their params; the registry only passes them through.
export type AnyHook = Hook<any>;

export interface Resolution {
  hook: AnyHook;
  params: HookParams;
}

/** Holds every hook and decides which one handles an utterance. */
export class HookRegistry {
  /** Registration order (what list() shows). */
  #hooks: AnyHook[] = [];
  /** Match order: priority descending, then registration order. */
  #byPriority: AnyHook[] = [];

  register(...hooks: AnyHook[]): this {
    for (const hook of hooks) {
      assertValidHook(hook);
      const existing = this.#hooks.findIndex((h) => h.name === hook.name);
      if (existing >= 0) this.#hooks.splice(existing, 1, hook);
      else this.#hooks.push(hook);
    }
    this.#reorder();
    return this;
  }

  unregister(name: string): boolean {
    const index = this.#hooks.findIndex((h) => h.name === name);
    if (index < 0) return false;
    this.#hooks.splice(index, 1);
    this.#reorder();
    return true;
  }

  #reorder() {
    // Array#sort is stable, so equal priorities keep registration order.
    this.#byPriority = [...this.#hooks].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  get size(): number {
    return this.#hooks.length;
  }

  list(): HookInfo[] {
    return this.#hooks.map(({ name, category, description, examples }) => ({
      name,
      category,
      description,
      examples,
    }));
  }

  resolve(input: string, ctx: HookContext): Resolution | null {
    for (const hook of this.#byPriority) {
      const params = hook.match(input, ctx);
      if (params) return { hook, params };
    }
    return null;
  }
}

function assertValidHook(hook: AnyHook): void {
  const problems: string[] = [];
  if (!hook || typeof hook !== 'object') throw new Error('Hook must be an object');
  if (typeof hook.name !== 'string' || !hook.name) problems.push('name');
  if (typeof hook.category !== 'string' || !hook.category) problems.push('category');
  if (typeof hook.description !== 'string') problems.push('description');
  if (!Array.isArray(hook.examples)) problems.push('examples');
  if (typeof hook.match !== 'function') problems.push('match()');
  if (typeof hook.run !== 'function') problems.push('run()');
  if (problems.length) {
    throw new Error(`Invalid hook "${hook.name ?? '?'}": missing or bad ${problems.join(', ')}`);
  }
}
