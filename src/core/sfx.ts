/** WebAudio blips only — no audio files. Context is created lazily on first user gesture (autoplay policy). */

export interface Sfx {
  click(): void;
  hit(): void;
  crit(): void;
  heal(): void;
  levelup(): void;
  thud(): void;
  coin(): void; // gold gained or spent
  chest(): void; // iron-bound lid creaks open
  descend(): void; // stairs swallow you
  trap(): void; // hidden blade springs
  avoided(): void; // trap stilled just in time
  encounter(): void; // foes drop into the corridor
  victory(): void; // combat won
  defeat(): void; // the party falls
  fanfare(): void; // medal earned
  secret(): void; // hidden alcove glimmers open
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
    coin: () => {
      if (!ensure()) return;
      tone({ freq: 1320, durMs: 70, type: "triangle", gain: 0.18 });
      tone({ freq: 1760, durMs: 90, type: "triangle", gain: 0.16 }, 55);
    },
    chest: () => {
      if (!ensure()) return;
      tone({ freq: 140, sweepTo: 88, durMs: 200, type: "sawtooth", gain: 0.2 });
      tone({ freq: 330, durMs: 50, type: "square", gain: 0.1 }, 190);
    },
    descend: () => ensure() && tone({ freq: 420, sweepTo: 140, durMs: 320, type: "sine", gain: 0.22 }),
    trap: () => {
      if (!ensure()) return;
      tone({ freq: 220, sweepTo: 70, durMs: 130, type: "sawtooth", gain: 0.3 });
      tone({ freq: 60, durMs: 90, type: "square", gain: 0.25 }, 90);
    },
    avoided: () => ensure() && tone({ freq: 520, sweepTo: 700, durMs: 110, type: "triangle", gain: 0.14 }),
    encounter: () => {
      if (!ensure()) return;
      tone({ freq: 160, sweepTo: 85, durMs: 230, type: "sawtooth", gain: 0.3 });
      tone({ freq: 95, sweepTo: 60, durMs: 160, type: "square", gain: 0.2 }, 70);
    },
    victory: () => {
      if (!ensure()) return;
      [392, 523, 659].forEach((f, i) => tone({ freq: f, durMs: 100, type: "triangle", gain: 0.2 }, i * 85));
      tone({ freq: 784, durMs: 180, type: "triangle", gain: 0.22 }, 255);
    },
    defeat: () => {
      if (!ensure()) return;
      tone({ freq: 220, sweepTo: 116, durMs: 420, type: "sawtooth", gain: 0.25 });
      tone({ freq: 110, sweepTo: 82, durMs: 380, type: "sine", gain: 0.3 }, 160);
    },
    fanfare: () => {
      if (!ensure()) return;
      [523, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, durMs: 130, type: "triangle", gain: 0.2 }, i * 100));
    },
    secret: () => {
      if (!ensure()) return;
      [880, 1175, 1568].forEach((f, i) => tone({ freq: f, durMs: 60, type: "sine", gain: 0.14 }, i * 60));
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
    },
  };
}
