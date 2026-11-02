import { describe, expect, it } from "vitest";
import { createMusic, DARK_WARN, darkIntensity, trackForRoute } from "../music";

describe("trackForRoute", () => {
  it("maps every known route to a deliberate choice", () => {
    for (const r of ["town", "party", "shop", "tavern", "temple", "codex", "chronicle", "gate"]) {
      expect(trackForRoute(r)).toBe("town");
    }
    expect(trackForRoute("dungeon")).toBe("dungeon");
    expect(trackForRoute("combat")).toBe("battle");
    for (const r of ["title", "", "nonsense"]) expect(trackForRoute(r)).toBeNull();
  });

  it("the music object follows playFor/stop bookkeeping even without WebAudio", () => {
    const m = createMusic(0.35); // node has no AudioContext: intent is tracked, nothing throws
    expect(m.current()).toBeNull();
    m.playFor("town");
    expect(m.current()).toBe("town");
    m.playFor("combat"); // idempotence guard must not block real switches
    expect(m.current()).toBe("battle");
    m.stop();
    expect(m.current()).toBeNull();
  });
});

describe("dark layer", () => {
  it("ramps in below the warning threshold and peaks when the flame dies", () => {
    expect(darkIntensity(undefined)).toBe(0); // legacy gate without the field reads as lit
    expect(darkIntensity(DARK_WARN + 5)).toBe(0);
    expect(darkIntensity(DARK_WARN)).toBe(0); // at the threshold it is still silent
    expect(darkIntensity(DARK_WARN - 1)).toBeCloseTo(0.1);
    expect(darkIntensity(5)).toBeCloseTo(0.5);
    expect(darkIntensity(0)).toBe(1); // dead flame — full drone
    expect(darkIntensity(-4)).toBe(1); // clamped, never past full
  });

  it("headless bookkeeping gates the drone to the dungeon track and respects mute", () => {
    const m = createMusic(0.5);
    m.setDark(0.8);
    expect(m.dark()).toBe(0); // no track yet — nothing audible
    m.playFor("dungeon");
    expect(m.dark()).toBeCloseTo(0.4); // 0.8 intensity × 0.5 volume
    m.playFor("town"); // the drone must never leak into town BGM
    expect(m.dark()).toBe(0);
    m.playFor("dungeon");
    expect(m.dark()).toBeCloseTo(0.4); // intent survives track switches; only audibility gates
    m.setVolume(0); // mute reaches the drone too
    expect(m.dark()).toBe(0);
  });
});
