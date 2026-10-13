import type { HookInfo } from '../lib/api';

/** Every registered hook, grouped by category. Clicking an example runs it. */
export function Capabilities({ hooks, disabled, onRun }: { hooks: HookInfo[]; disabled: boolean; onRun: (text: string) => void }) {
  const groups = new Map<string, HookInfo[]>();
  for (const hook of hooks) groups.set(hook.category, [...(groups.get(hook.category) ?? []), hook]);

  return (
    <section className="panel p-5" aria-label="Commands">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="hud-label">Hooks</h2>
        <span className="font-mono text-[0.68rem] text-ink-500">{hooks.length} registered</span>
      </div>

      {hooks.length === 0 ? (
        <p className="text-sm text-ink-500">Connect to the ARES server to load commands.</p>
      ) : (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {[...groups].map(([category, items]) => (
            <div key={category}>
              <h3 className="mb-2 text-xs font-medium text-ink-300">{category}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {items.map((hook) => {
                  const example = hook.examples[0];
                  if (!example) return null;
                  return (
                    <li key={hook.name}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onRun(example)}
                        title={`${hook.description} · ${hook.name}`}
                        className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-1 text-left text-xs text-ink-300 transition hover:border-ares-500/40 hover:bg-ares-500/10 hover:text-ink-100 disabled:opacity-40"
                      >
                        {example}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
