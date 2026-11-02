/** Procedural background music — tiny oscillator scheduler, zero audio assets.
 *  Tracks are note tables; a lookahead loop schedules short tones ahead of the
 *  AudioContext clock. Autoplay policy is respected: the context is created on
 *  first play and unlocked by the next real user gesture if still suspended. */

export type TrackName = "town" | "dungeon" | "battle";

/** Route → track (pure; unit-tested). Unknown/title routes stay silent. */
export function trackForRoute(route: string): TrackName | null {
  if (route === "combat") return "battle";
  if (route === "dungeon") return "dungeon";
  const townSide = new Set(["town", "party", "shop", "tavern", "temple", "codex", "chronicle", "gate"]);
  return townSide.has(route) ? "town" : null;
}

/** [midi note (-1 = rest), length in beats] */
type Step = [number, number];

interface TrackDef {
  bpm: number;
  type: OscillatorType;
  gain: number;
  lead: Step[];
  bass: Step[];
}

const A4 = 69;
const midiHz = (m: number): number => 440 * Math.pow(2, (m - A4) / 12);

// A-minor pentatonic stroll over a slow roots bass — the town hums.
const TOWN: TrackDef = {
  bpm: 96,
  type: "triangle",
  gain: 0.16,
  lead: [
    [69, 1], [72, 1], [76, 1], [79, 1], [76, 1], [74, 1], [72, 1], [69, 1],
    [64, 1], [67, 1], [69, 2], [-1, 1], [72, 1], [-1, 1], [69, 2], [-1, 1],
  ],
  bass: [[45, 4], [40, 4], [45, 4], [43, 4]],
};

// Low drone pairs a semitone apart — the dark breathes.
const DUNGEON: TrackDef = {
  bpm: 52,
  type: "sine",
  gain: 0.12,
  lead: [[45, 8], [44, 8], [45, 8], [39, 8], [44, 6], [-1, 2], [45, 8], [37, 8]],
  bass: [[33, 16], [32, 16]],
};

// Driving D-minor staccato riff under a pounding quarter-note bass.
const BATTLE: TrackDef = {
  bpm: 148,
  type: "square",
  gain: 0.1,
  lead: [
    [62, 0.5], [62, 0.5], [65, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [62, 1],
    [60, 0.5], [60, 0.5], [63, 0.5], [67, 0.5], [65, 0.5], [63, 0.5], [60, 1], [-1, 1],
  ],
  bass: [[38, 1], [38, 1], [41, 1], [36, 1]],
};

const TRACKS: Record<TrackName, TrackDef> = { town: TOWN, dungeon: DUNGEON, battle: BATTLE };

export interface Music {
  /** Live volume 0..1; future notes fade in at the new level. */
  setVolume(v: number): void;
  /** Switch (or stop) music for a route. Idempotent per track. */
  playFor(route: string): void;
  stop(): void;
  /** Fade the dungeon dark-layer drone in/out (0..1). Track-gated: only audible on "dungeon". */
  setDark(intensity: number): void;
  /** Effective audible intensity of the dark layer — smoke-test seam, like current(). */
  dark(): number;
  stop(): void;
  /** Currently audible-or-pending track — smoke-test seam, not for gameplay. */
  current(): TrackName | null;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Light turns at or below which the dark-layer drone starts breathing in. */
export const DARK_WARN = 10;

/** Pure ramp for the dark layer: silent above DARK_WARN, full when the flame dies (<=0).
 *  A gate without the field (legacy saves) reads as lit — same rule as isLit. */
export function darkIntensity(turns: number | undefined): number {
  if (turns === undefined || turns >= DARK_WARN) return 0;
  return clamp01((DARK_WARN - Math.max(0, turns)) / DARK_WARN);
}

export function createMusic(initialVolume: number): Music {
  let volume = clamp01(initialVolume);
  let track: TrackName | null = null;
  let def: TrackDef | null = null;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let leadIdx = 0;
  let bassIdx = 0;
  let nextLeadT = 0;
  let nextBassT = 0;
  let darkTarget = 0; // desired dark-layer intensity, kept across track switches
  let droneGain: GainNode | null = null; // live sub-drone whose gain ramps with the flame
  const DRONE_GAIN = 0.1; // continuous tone — quieter peak than a scheduled note

  function ensureContext(): boolean {
    if (ctx) return true;
    const AC = typeof AudioContext !== "undefined" ? AudioContext : undefined;
    if (!AC) return false; // node/vitest: no audio, bookkeeping still works
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    // Dark-layer drone: E0 fundamental + detuned octave partial, beating slowly like breath.
    droneGain = ctx.createGain();
    droneGain.gain.value = 0.0001;
    droneGain.connect(master);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = midiHz(28); // E0 ≈ 41 Hz — felt more than heard
    const shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = midiHz(40) * 1.007; // octave up, cents-detuned for the breathing beat
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.35;
    sub.connect(droneGain);
    shimmer.connect(shimmerGain).connect(droneGain);
    sub.start();
    shimmer.start();
    const wake = (): void => {
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    };
    // the first hashchange may land outside the click gesture — unlock on any later one
    document.addEventListener("pointerdown", wake, { passive: true });
    document.addEventListener("keydown", wake);
    wake();
    return true;
  }

  // The dark layer breathes in as the flame dies and out when relit; track-gated so it
  // never leaks into town or battle BGM. setTargetAtTime gives the exponential fade.
  function applyDark(): void {
    if (!ctx || !droneGain) return; // headless: dark() still reports intent
    const audible = track === "dungeon" ? darkTarget : 0;
    droneGain.gain.setTargetAtTime(Math.max(0.0001, audible * DRONE_GAIN * volume), ctx.currentTime, 0.7);
  }

  function tone(freq: number, t: number, durSec: number, gain: number): void {
    if (!ctx || !master || volume <= 0) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = def ? def.type : "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + durSec + 0.05);
  }

  function tick(): void {
    if (!ctx || !def) return;
    const now = ctx.currentTime;
    const spb = 60 / def.bpm;
    const horizon = now + 0.35; // schedule a third of a second ahead
    while (nextLeadT < horizon) {
      const [n, b] = def.lead[leadIdx];
      if (n >= 0) tone(midiHz(n), Math.max(nextLeadT, now + 0.02), b * spb * 0.9, def.gain);
      nextLeadT += b * spb;
      leadIdx = (leadIdx + 1) % def.lead.length;
    }
    while (nextBassT < horizon) {
      const [n, b] = def.bass[bassIdx];
      if (n >= 0) tone(midiHz(n), Math.max(nextBassT, now + 0.02), b * spb * 0.95, def.gain * 0.7);
      nextBassT += b * spb;
      bassIdx = (bassIdx + 1) % def.bass.length;
    }
  }

  function startTimer(): void {
    if (timer === null) timer = setInterval(tick, 120);
  }

  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // hidden tabs throttle timers into playback gaps — park the scheduler instead
  let parked = false;
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (timer !== null && def) {
          stopTimer();
          parked = true;
        }
      } else if (parked && def) {
        parked = false;
        const c = ctx!; // ensureContext ran before any track started
        nextLeadT = c.currentTime + 0.06;
        nextBassT = c.currentTime + 0.06;
        startTimer();
      }
    });
  }

  return {
    setVolume(v) {
      volume = clamp01(v);
      applyDark(); // mute must reach the drone too
    },
    playFor(route) {
      const next = trackForRoute(route);
      if (next === track) return; // idempotent across refresh-driven header updates
      stopTimer();
      track = next;
      def = next ? TRACKS[next] : null;
      applyDark(); // track gate: leaving "dungeon" fades the drone out, returning re-applies it
      if (!def) return;
      if (!ensureContext()) return; // headless: current() still reports intent
      const c = ctx!;
      leadIdx = 0;
      bassIdx = 0;
      nextLeadT = c.currentTime + 0.06;
      nextBassT = c.currentTime + 0.06;
      startTimer();
    },
    stop() {
      stopTimer();
      track = null;
      def = null;
      applyDark();
    },
    setDark(intensity) {
      darkTarget = clamp01(intensity);
      applyDark();
    },
    dark() {
      return track === "dungeon" ? darkTarget * volume : 0;
    },
    current() {
      return track;
    },
  };
}
