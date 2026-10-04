/** WebAudio blips only — no audio files. Context is created lazily on first user gesture (autoplay policy). */

export interface Sfx {
  click(): void;
  hit(): void;
  crit(): void;
  heal(): void;
  levelup(): void;
  thud(): void;
  setVolume(v: number): void; // 0 = mute
}

interface ToneSpec {
  freq: number;
  durMs: number;
  type: OscillatorType;
  sweepTo?: number;
  gain?: number;
}

export function createSfx(initialVolume: number): Sfx {
  let volume = initialVolume;
  let ctx: AudioContext | null = null;

  const tone = (spec: ToneSpec, whenMs = 0) => {
    if (!ctx || volume <= 0) return;
    const t0 = ctx.currentTime + whenMs / 1000;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t0);
    if (spec.sweepTo) osc.frequency.exponentialRampToValueAtTime(spec.sweepTo, t0 + spec.durMs / 1000);
    const peak = (spec.gain ?? 0.25) * volume;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + spec.durMs / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + spec.durMs / 1000 + 0.02);
  };

  const ensure = () => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return volume > 0;
  };

  return {
    click: () => ensure() && tone({ freq: 440, durMs: 60, type: "square", gain: 0.12 }),
    hit: () => ensure() && tone({ freq: 180, durMs: 90, type: "sawtooth" }),
    crit: () => ensure() && tone({ freq: 90, sweepTo: 360, durMs: 140, type: "sawtooth", gain: 0.3 }),
    heal: () => ensure() && tone({ freq: 660, durMs: 120, type: "sine" }),
    levelup: () => {
      if (!ensure()) return;
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, durMs: 110, type: "triangle", gain: 0.2 }, i * 90));
    },
    thud: () => ensure() && tone({ freq: 70, durMs: 80, type: "sine", gain: 0.3 }),
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
    },
  };
}
