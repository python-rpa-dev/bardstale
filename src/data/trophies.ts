/** Gate-lord trophies: one per gate, each a permanent town-wide economy perk. */

export type PerkSite = "heal" | "revive" | "bounty" | "shop" | "brew";

export interface TrophyDef {
  gateId: string; // the gate whose lord drops this trophy
  lord: string; // bestiary id of the gate lord
  name: string;
  blurb: string; // what the perk does, shown on the Guild shelf and at claim time
  site: PerkSite;
  mult: number; // price/payout multiplier applied at that site (floored at the call site)
}

export const TROPHIES: TrophyDef[] = [
  { gateId: "hollow-roots", lord: "bark-thrall", name: "Heartwood Trophy", blurb: "Temple healing costs a quarter less.", site: "heal", mult: 0.75 },
  { gateId: "sunken-cloister", lord: "cloister-lich", name: "Bone Reliquary", blurb: "Revives at the temple cost 40% less.", site: "revive", mult: 0.6 },
  { gateId: "gallows-fen", lord: "fen-matriarch", name: "Spinner's Idol", blurb: "Bounty payouts swell by a third.", site: "bounty", mult: 1.3 },
  { gateId: "wyrm-vault", lord: "vault-wyrm", name: "Wyrm Hoard", blurb: "Merchants' Row prices drop a fifth.", site: "shop", mult: 0.8 },
  { gateId: "ember-spire", lord: "ashfiend", name: "Ashbrand", blurb: "Hearth Kitchen brewing costs 30% less coin.", site: "brew", mult: 0.7 },
];

export function trophyByLord(lordId: string): TrophyDef | undefined {
  return TROPHIES.find((t) => t.lord === lordId);
}

/** Multiplier for one perk site given the gate ids whose trophies are raised. */
export function perkMult(owned: readonly string[] | undefined, site: PerkSite): number {
  const t = TROPHIES.find((x) => x.site === site && !!owned?.includes(x.gateId));
  return t ? t.mult : 1;
}
