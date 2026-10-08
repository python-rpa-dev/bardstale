import { describe, expect, it } from "vitest";
import { createMusic, trackForRoute } from "../music";

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
