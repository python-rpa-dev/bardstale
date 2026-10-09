import { describe, expect, it } from "vitest";
import { startCombat, tallyVictory } from "../../core/combat";
import type { ActiveGate, GameState } from "../save";
import { deserialize, emptyChronicle, newGame, serialize } from "../save";
import { applyDefeat, claimVictory, resolveFlee } from "../combat";
import { descendFloor, startExpedition } from "../expedition";
import { importSave } from "../saveio";

const clock = () => new Date("2026-10-04T12:00:00Z");

const gateFor = (seed: number): ActiveGate => ({
  gateId: "hollow-roots",
  runNumber: 1,
  seed,
  modifier: "none",
  floor: 0,
  map: { w: 21, h: 21, cells: "0".repeat(441), entities: [[220, "stairs"]] },
  pos: { x: 10, y: 11 },
  dir: 0,
  visited: [241],
  partyHpSp: [],
  chests: [],
  flags: {},
  steps: 3,
  loot: { gold: 0, items: {} },
});

const runState = (seed = 42): GameState => {
  const s = newGame(clock);
  s.activeGate = gateFor(seed);
  return s;
};

/** Force the fight to won so claimVictory accepts it. */
function winFight(s: GameState): void {
  const cs = s.activeCombat!;
  for (const f of cs.foes) f.hp = 0;
  cs.phase = "won";
  cs.victory = tallyVictory(cs);
}

/** Unwrap importSave; surface the rejection reason as a test failure. */
function mustImport(code: string): GameState {
  const res = importSave(code);
  if (!res.ok) throw new Error(`import rejected: ${res.error}`);
  return res.state;
}

describe("chronicle tally", () => {
  it("a victory counts every slain foe and the battle itself", () => {
    const s = runState();
    s.activeCombat = startCombat(s.party, ["skeleton", "cave-rat"], { seed: 5 });
    winFight(s);
    claimVictory(s);
    expect(s.chronicle!.killsByFoe["skeleton"]).toBe(1);
    expect(s.chronicle!.killsByFoe["cave-rat"]).toBe(1);
    expect(s.chronicle!.battlesWon).toBe(1);
  });

  it("wins stack; a flee counts as a flee, not a win; a wipe counts once", () => {
    const s = runState();
    for (const seed of [5, 6]) {
      s.activeCombat = startCombat(s.party, ["skeleton"], { seed });
      winFight(s);
      claimVictory(s);
    }
    expect(s.chronicle!.killsByFoe["skeleton"]).toBe(2);

    s.activeCombat = startCombat(s.party, ["goblin"], { seed: 7 });
    resolveFlee(s);
    expect(s.chronicle!.battlesFled).toBe(1);
    expect(s.chronicle!.battlesWon).toBe(2); // fleeing never inflates wins

    applyDefeat(s);
    expect(s.chronicle!.partyWipes).toBe(1);
  });

  it("deepest floor tracks the deepest descent ever, across runs", () => {
    const s = newGame(clock);
    startExpedition(s, "hollow-roots");
    expect(s.chronicle!.deepestFloor).toBe(1); // standing on floor 0 is depth 1
    descendFloor(s);
    descendFloor(s);
    expect(s.chronicle!.deepestFloor).toBe(3);

    s.activeGate = undefined;
    startExpedition(s, "hollow-roots"); // a shallow later run never lowers the record
    expect(s.chronicle!.deepestFloor).toBe(3);
  });

  it("migrate backfills the chronicle on legacy v1 saves", () => {
    const s = newGame(clock);
    delete s.chronicle;
    const loaded = deserialize(JSON.stringify(s))!;
    expect(loaded.chronicle).toEqual(emptyChronicle());
  });

  it("import preserves a real chronicle and clamps a garbage one", () => {
    const s = runState();
    s.activeCombat = startCombat(s.party, ["skeleton"], { seed: 5 });
    winFight(s);
    claimVictory(s);
    const code = serialize(s);
    expect(mustImport(code).chronicle).toEqual(s.chronicle);

    const junk = JSON.parse(code);
    junk.chronicle = { killsByFoe: { goblin: -3, "cave-rat": 4.5 }, battlesWon: -5, deepestFloor: "deep" };
    // every junk value clamps to a real zero rather than rejecting the whole code
    expect(mustImport(JSON.stringify(junk)).chronicle).toEqual(emptyChronicle());
  });
});
