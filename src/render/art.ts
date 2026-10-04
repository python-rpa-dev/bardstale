/**
 * Art contract: public/art/manifest.json maps slot ids to files. Replacing any
 * SVG with a Blender/ComfyUI PNG (same manifest entry) needs zero code changes.
 * Missing files render a dashed-outline placeholder carrying the slot id.
 */

interface SlotMeta {
  file: string;
  w: number;
  h: number;
}

let slots: Record<string, SlotMeta> | null = null;

export async function loadManifest(): Promise<void> {
  const url = `${import.meta.env.BASE_URL}art/manifest.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { version: number; slots: Record<string, SlotMeta> };
    slots = json.slots;
  } catch {
    slots = {}; // game still runs — every slot falls back to a placeholder
  }
}

function placeholderDataUri(slotId: string, w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="1.5" y="1.5" width="${Math.max(1, w - 3)}" height="${Math.max(1, h - 3)}" fill="#241d2b" stroke="#c9a227" stroke-dasharray="6 4"/>` +
    `<text x="50%" y="50%" fill="#f2e8d5" font-family="sans-serif" font-size="${Math.max(8, Math.min(w, h) / 8)}" text-anchor="middle">${slotId}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Resolved URL for a slot, or an inline placeholder if the slot/file is unknown. */
export function slotSrc(slotId: string): string {
  const meta = slots?.[slotId];
  if (!meta) return placeholderDataUri(slotId, 96, 96);
  return `${import.meta.env.BASE_URL}${meta.file}`;
}

/** <img> for a slot; swaps in the dashed placeholder on load error. */
export function slotImg(slotId: string, cssSizePx?: number): HTMLImageElement {
  const meta = slots?.[slotId];
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  if (cssSizePx) {
    img.style.width = `${cssSizePx}px`;
    img.style.height = `${cssSizePx}px`;
  }
  img.src = slotSrc(slotId);
  img.onerror = () => {
    img.onerror = null;
    img.src = placeholderDataUri(slotId, meta?.w ?? 96, meta?.h ?? 96);
  };
  return img;
}

/** Canvas texture for the raycaster; resolves null when missing (flat-color fallback). */
export function slotTexture(slotId: string): Promise<HTMLImageElement | null> {
  const meta = slots?.[slotId];
  if (!meta) return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers<HTMLImageElement | null>();
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = `${import.meta.env.BASE_URL}${meta.file}`;
  return promise;
}

export function slotSize(slotId: string): { w: number; h: number } {
  const meta = slots?.[slotId];
  return meta ? { w: meta.w, h: meta.h } : { w: 96, h: 96 };
}
