export interface GateDef {
  id: string;
  name: string;
  /** Monster level band for spawns on this expedition. */
  levels: [number, number];
  floors: number;
}

export const GATES: GateDef[] = [
  { id: "hollow-roots", name: "Hollow Roots", levels: [1, 4], floors: 3 },
  { id: "sunken-cloister", name: "Sunken Cloister", levels: [3, 7], floors: 4 },
  { id: "wyrm-vault", name: "Wyrm Vault", levels: [6, 12], floors: 5 },
];

export function gateById(id: string): GateDef {
  const def = GATES.find((g) => g.id === id);
  if (!def) throw new Error(`unknown gate ${id}`);
  return def;
}

/** Index of a gate in the daily-modifier rotation. */
export function gateIndex(id: string): number {
  const i = GATES.findIndex((g) => g.id === id);
  if (i < 0) throw new Error(`unknown gate ${id}`);
  return i;
}
