let context: AudioContext | null = null;

/** Short, soft tones so hands-free mode has audible feedback without speech. */
export function earcon(kind: 'listen' | 'wake' | 'error' | 'alert'): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    const notes = { listen: [880], wake: [660, 990], error: [330, 247], alert: [784, 988, 1175, 784, 988, 1175] }[kind];
    const now = context.currentTime;
    notes.forEach((freq, i) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      const start = now + i * (kind === 'alert' ? 0.14 : 0.09) + (kind === 'alert' && i >= 3 ? 0.25 : 0);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(context!.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch {
    // Audio feedback is a nicety; never let it break the flow.
  }
}
