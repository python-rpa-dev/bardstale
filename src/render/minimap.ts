/** Minimap: 5 px per cell, visited cells only, gold stairs glyph, "?" for unopened chests. */

import { DIR_VECS } from "../core/mapgen";
import type { FloorMapSave } from "../state/save";

const CELL = 5;

export interface MinimapInput {
  map: FloorMapSave;
  visited: number[];
  pos: { x: number; y: number };
  dir: 0 | 1 | 2 | 3;
  chests: { cell: number; opened: boolean }[];
}

export function renderMinimap(canvas: HTMLCanvasElement, input: MinimapInput): void {
  const { map, pos, dir } = input;
  const visited = new Set(input.visited);
  const w = map.w;
  const h = map.h;
  canvas.width = w * CELL;
  canvas.height = h * CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#070510"; // unexplored void
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stairsCells: number[] = [];
  const shrineCells: number[] = [];
  for (const [id, kind] of map.entities) {
    if (!visited.has(id)) continue;
    if (kind === "stairs") stairsCells.push(id);
    if (kind === "shrine") shrineCells.push(id);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = y * w + x;
      if (!visited.has(id)) continue;
      const isWall = map.cells.charCodeAt(id) === 49;
      ctx.fillStyle = isWall ? "#241a2e" : "#8a6d46";
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // Gold stairs glyph.
  for (const id of stairsCells) {
    const x = (id % w) * CELL;
    const y = Math.floor(id / w) * CELL;
    ctx.fillStyle = "#d9a441";
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }

  // Teal shrine dots.
  for (const id of shrineCells) {
    const x = (id % w) * CELL;
    const y = Math.floor(id / w) * CELL;
    ctx.fillStyle = "#4fb3a5";
    ctx.fillRect(x + 1, y + 2, CELL - 2, CELL - 4);
    ctx.fillRect(x + 2, y + 1, CELL - 4, CELL - 2);
  }

  // Chests: "?" while unopened (only once the cell is revealed), dimmed box after looting.
  for (const c of input.chests) {
    if (!visited.has(c.cell)) continue;
    const x = (c.cell % w) * CELL;
    const y = Math.floor(c.cell / w) * CELL;
    if (c.opened) {
      ctx.strokeStyle = "#5a4326";
      ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    } else {
      ctx.fillStyle = "#f0d9a8";
      // The "?" is bigger than a cell; draw it centred and let it bleed slightly.
      ctx.font = `bold ${CELL * 3}px serif`;
      ctx.fillText("?", x - CELL / 2, y + CELL * 1.6);
    }
  }

  // Player marker with facing tick.
  const cx = pos.x * CELL + CELL / 2;
  const cy = pos.y * CELL + CELL / 2;
  ctx.fillStyle = "#e8ddc4";
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
  const [dx, dy] = DIR_VECS[dir];
  ctx.strokeStyle = "#e8ddc4";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dx * CELL * 0.9, cy + dy * CELL * 0.9);
  ctx.stroke();
}
