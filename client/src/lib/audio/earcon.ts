let context: AudioContext | null = null;

/** Short, soft tones so hands-free mode has audible feedback without speech. */
export function earcon(kind: 'listen' | 'wake' | 'error'): void {
  try {
    context ??= new AudioContext();
    void context.resume();
    const notes = { listen: [880], wake: [660, 990], error: [330, 247] }[kind];
    const now = context.currentTime;
    notes.forEach((freq, i) => {
      const osc = context!.createOscillator();
      const gain = context!.createGain();
      const start = now + i * 0.09;
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
