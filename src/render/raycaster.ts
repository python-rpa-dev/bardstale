/** Canvas DDA raycaster for the dungeon view: 480×300 internal, pixelated upscale, FOV 66°. */

import { DIR_VECS } from "../core/mapgen";
import { slotTexture } from "./art";

export const VIEW_W = 480;
export const VIEW_H = 300;
const FOV = (66 * Math.PI) / 180;
const PLANE_LEN = Math.tan(FOV / 2);

/** Wall texture slot per gate. */
export function wallSlotForGate(gateId: string): "wall.brick" | "wall.stone" | "wall.vault" | "wall.fen" | "wall.ember" {
  if (gateId === "sunken-cloister") return "wall.stone";
  if (gateId === "gallows-fen") return "wall.fen";
  if (gateId === "wyrm-vault") return "wall.vault";
  if (gateId === "ember-spire") return "wall.ember";
  return "wall.brick";
}

export interface ViewTextures {
  wall: HTMLImageElement | null;
  floorTint: HTMLImageElement | null;
  ceilTint: HTMLImageElement | null;
}

/** Load the three textures for a gate (null entries fall back to flat tints). */
export async function loadGateTextures(gateId: string): Promise<ViewTextures> {
  const [wall, floorTint, ceilTint] = await Promise.all([
    slotTexture(wallSlotForGate(gateId)),
    slotTexture("floor.tint"),
    slotTexture("ceil.tint"),
  ]);
  return { wall, floorTint, ceilTint };
}

const FLAT_CEIL = "#0d0a12";
const FLAT_FLOOR = "#241b12";
const FLAT_WALL_NS = "#574736"; // side shading: N/S faces darker
const FLAT_WALL_EW = "#6b5842";

/** Patterns are per-context; cache them so each frame doesn't re-wrap the tint images. */
const patternCache = new WeakMap<CanvasRenderingContext2D, WeakMap<HTMLImageElement, CanvasPattern>>();
function tintPattern(ctx: CanvasRenderingContext2D, tex: HTMLImageElement): CanvasPattern | null {
  let byImg = patternCache.get(ctx);
  if (!byImg) patternCache.set(ctx, (byImg = new WeakMap()));
  const hit = byImg.get(tex);
  if (hit !== undefined) return hit;
  const p = ctx.createPattern(tex, "repeat"); // null only for undecoded images; not cached so it retries once loaded
  if (p) byImg.set(tex, p);
  return p;
}

/** Fill one horizontal half of the view with a repeated tint tile, or a flat color. */
function fillHalf(ctx: CanvasRenderingContext2D, tex: HTMLImageElement | null, flat: string, y: number): void {
  ctx.fillStyle = tex ? (tintPattern(ctx, tex) ?? flat) : flat;
  ctx.fillRect(0, y, VIEW_W, VIEW_H / 2);
}

/** Draw one frame of the first-person view at pos (cell coords) facing dir. */
export function renderView(
  canvas: HTMLCanvasElement,
  grid: Uint8Array,
  w: number,
  h: number,
  pos: { x: number; y: number },
  dir: 0 | 1 | 2 | 3,
  tex: ViewTextures,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Size once: re-assigning width/height reallocates the backing store and resets all context
  // state every frame. The two full-width tint fills below repaint every pixel, so frames need
  // no explicit clear between them.
  if (canvas.width !== VIEW_W || canvas.height !== VIEW_H) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
  }

  // Ceiling / floor halves. The tints are seamless small tiles, so repeat them;
  // stretching one tile across the frame blows its seams up into giant blobs.
  const halfH = VIEW_H / 2;
  fillHalf(ctx, tex.ceilTint, FLAT_CEIL, 0);
  fillHalf(ctx, tex.floorTint, FLAT_FLOOR, halfH);

  const [dirX, dirY] = DIR_VECS[dir];
  // Camera plane perpendicular to view direction.
  const planeX = -dirY * PLANE_LEN;
  const planeY = dirX * PLANE_LEN;
  const px = pos.x + 0.5;
  const py = pos.y + 0.5;

  for (let x = 0; x < VIEW_W; x++) {
    const cameraX = (2 * x) / VIEW_W - 1;
    const rayX = dirX + planeX * cameraX;
    const rayY = dirY + planeY * cameraX;

    let mapX = Math.floor(px);
    let mapY = Math.floor(py);
    const dDistX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
    const dDistY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);

    let stepX: number, stepY: number, sideX: number, sideY: number;
    if (rayX < 0) {
      stepX = -1;
      sideX = (px - mapX) * dDistX;
    } else {
      stepX = 1;
      sideX = (mapX + 1.0 - px) * dDistX;
    }
    if (rayY < 0) {
      stepY = -1;
      sideY = (py - mapY) * dDistY;
    } else {
      stepY = 1;
      sideY = (mapY + 1.0 - py) * dDistY;
    }

    let side = 0;
    let hit = false;
    for (let guard = 0; guard < 64 && !hit; guard++) {
      if (sideX < sideY) {
        sideX += dDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += dDistY;
        mapY += stepY;
        side = 1;
      }
      if (mapX < 0 || mapY < 0 || mapX >= w || mapY >= h) break; // perimeter is sealed, but stay safe
      if (grid[mapY * w + mapX] === 1) hit = true;
    }
    if (!hit) continue; // ray escaped the maze: leave floor/ceiling visible

    const perp = side === 0 ? sideX - dDistX : sideY - dDistY;
    const dist = Math.max(0.05, perp);
    const lineH = VIEW_H / dist;
    const top = halfH - lineH / 2;

    if (tex.wall) {
      let wallX = side === 0 ? py + dist * rayY : px + dist * rayX;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * tex.wall.width);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = tex.wall.width - texX - 1;
      ctx.drawImage(tex.wall, texX, 0, 1, tex.wall.height, x, top, 1, lineH);
    } else {
      ctx.fillStyle = side === 0 ? FLAT_WALL_NS : FLAT_WALL_EW;
      ctx.fillRect(x, top, 1, lineH);
    }

    // Distance fog on the wall slice only.
    const fog = Math.min(0.78, dist * 0.13);
    if (fog > 0.02) {
      ctx.fillStyle = `rgba(6,4,3,${fog.toFixed(3)})`;
      ctx.fillRect(x, top, 1, lineH);
    }
  }
}
