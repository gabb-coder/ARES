import { useEffect, useRef } from 'react';
import type { Status } from '../lib/assistant';
import { MicIcon, StopIcon } from './icons';

interface MicButtonProps {
  status: Status;
  wakeMode: boolean;
  awaitingCommand: boolean;
  /** Mic analyser while listening, speaker analyser while speaking. */
  getAnalyser: () => AnalyserNode | null;
  onPress: () => void;
}

const LABEL: Record<Status, string> = {
  idle: 'Start listening',
  listening: 'Stop listening',
  thinking: 'Processing',
  speaking: 'Stop speaking',
};

export function MicButton({ status, wakeMode, awaitingCommand, getAnalyser, onPress }: MicButtonProps) {
  const active = status === 'listening' || awaitingCommand;

  return (
    <div className="relative grid aspect-square w-[min(78vw,320px)] place-items-center">
      <RadialVisualizer status={status} getAnalyser={getAnalyser} />

      {/* Ambient glow */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-[22%] rounded-full blur-2xl transition-all duration-700 ${
          active
            ? 'bg-ares-500/45'
            : status === 'speaking'
              ? 'bg-ember-500/35'
              : status === 'thinking'
                ? 'bg-ember-500/25'
                : 'animate-breathe bg-ares-600/20'
        }`}
      />

      {/* Ripples while speaking or listening */}
      {(status === 'speaking' || active) && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-[27%] animate-ripple rounded-full border border-ares-400/50" />
          <span aria-hidden className="pointer-events-none absolute inset-[27%] animate-ripple rounded-full border border-ember-400/40 [animation-delay:1.2s]" />
        </>
      )}

      {/* Spinning arc while thinking */}
      {status === 'thinking' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[25%] animate-spin-slow rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0 65%, var(--color-ember-400) 92%, transparent 100%)',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
          }}
        />
      )}

      <button
        type="button"
        onClick={onPress}
        disabled={status === 'thinking'}
        aria-label={LABEL[status]}
        aria-pressed={active}
        className={`relative z-10 grid aspect-square w-[46%] place-items-center rounded-full border transition-all duration-300 ease-out
          focus-visible:outline-offset-4 disabled:cursor-wait
          ${
            active
              ? 'scale-105 border-ares-300/60 bg-gradient-to-br from-ares-500 to-ember-500 text-white shadow-[0_0_60px_-8px] shadow-ares-500'
              : status === 'speaking'
                ? 'border-ember-400/50 bg-gradient-to-br from-ares-600 to-ember-500 text-white shadow-[0_0_50px_-10px] shadow-ember-500'
                : 'border-ares-500/40 bg-gradient-to-br from-ink-800 to-ink-900 text-ares-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_20px_50px_-20px_rgb(0_0_0/0.8)] hover:border-ares-400/70 hover:text-ares-300 active:scale-95'
          }`}
      >
        {status === 'speaking' ? (
          <StopIcon className="size-[34%]" />
        ) : status === 'thinking' ? (
          <span className="flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-2 animate-pulse rounded-full bg-ember-400" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
          </span>
        ) : (
          <MicIcon className="size-[36%]" strokeWidth={1.6} />
        )}
        {wakeMode && status !== 'speaking' && status !== 'thinking' && (
          <span className="absolute -bottom-1 rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 font-mono text-[0.6rem] tracking-widest text-ink-300">
            {awaitingCommand ? 'GO' : 'AUTO'}
          </span>
        )}
      </button>
    </div>
  );
}

const BARS = 72;
const CRIMSON = [255, 59, 74] as const;
const EMBER = [255, 154, 77] as const;
const DIM = [70, 78, 96] as const;

/** Radial frequency bars around the button, drawn on a canvas each frame. */
function RadialVisualizer({ status, getAnalyser }: { status: Status; getAnalyser: () => AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const levels = new Float32Array(BARS);
    let data = new Uint8Array(0);
    let size = 0;
    let frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = canvas.clientWidth;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (t: number) => {
      const s = statusRef.current;
      const analyser = s === 'listening' || s === 'speaking' ? getAnalyser() : null;
      if (analyser) {
        if (data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
      }

      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const inner = size * 0.32;
      const reach = size * 0.15;
      const half = BARS / 2;

      for (let i = 0; i < BARS; i++) {
        let target: number;
        if (analyser && data.length) {
          // Mirror the voice band around the circle, log-ish so low bins get more bars.
          const k = i < half ? i : BARS - 1 - i;
          target = (data[Math.floor((k / half) ** 1.6 * data.length * 0.35)] ?? 0) / 255;
        } else if (s === 'speaking') {
          target = 0.3 + 0.28 * Math.sin(t / 170 + i * 0.55) * Math.sin(t / 410 + i * 0.12);
        } else if (s === 'thinking') {
          const head = ((t / 900) % 1) * BARS;
          const d = Math.min(Math.abs(i - head), BARS - Math.abs(i - head));
          target = Math.max(0, 1 - d / 12) * 0.55;
        } else if (s === 'listening') {
          target = 0.07 + 0.05 * Math.sin(t / 260 + i * 0.7);
        } else {
          target = 0.035;
        }
        levels[i]! += (target - levels[i]!) * 0.22;
        const level = levels[i]!;

        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const len = 2 + level * reach;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const from = s === 'idle' ? DIM : s === 'thinking' ? EMBER : CRIMSON;
        const to = s === 'idle' ? DIM : EMBER;
        const mix = Math.min(1, level * 1.6);
        const rgb = from.map((v, j) => Math.round(v + (to[j]! - v) * mix));

        ctx.strokeStyle = `rgba(${rgb.join(',')},${s === 'idle' ? 0.45 : 0.35 + level * 0.65})`;
        ctx.lineWidth = Math.max(1.5, size / 150);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(c + cos * inner, c + sin * inner);
        ctx.lineTo(c + cos * (inner + len), c + sin * (inner + len));
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [getAnalyser]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}
