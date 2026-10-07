/** Hand-authored 24×24 stroke icons (currentColor) for the dungeon command bar.
 *  Same palette-free, hand-drawn convention as public/art — they inherit button
 *  text color, so danger/disabled states style them for free. */

const PATHS = {
  forward: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  back: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
  "turn-l": '<path d="M9 5L4 10l5 5"/><path d="M4 10h9a7 7 0 0 1 7 7v2"/>',
  "turn-r": '<path d="M15 5l5 5-5 5"/><path d="M20 10h-9a7 7 0 0 0-7 7v2"/>',
  look: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',
  "fast-forward": '<path d="M4 6l7 6-7 6"/><path d="M13 6l7 6-7 6"/>',
  pause: '<path d="M9 6v12"/><path d="M15 6v12"/>',
  flask: '<path d="M10 4h4"/><path d="M11 4v5l-4.3 7.8A2.6 2.6 0 0 0 9 20.6h6a2.6 2.6 0 0 0 2.3-3.8L13 9V4"/><path d="M7.5 15h9"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  hourglass: '<path d="M7 3h10"/><path d="M7 21h10"/><path d="M7 3c0 4 5 5 5 9s-5 5-5 9"/><path d="M17 3c0 4-5 5-5 9s5 5 5 9"/>',
  bolt: '<path d="M13 2 3.5 14H10l-1 8L18.5 10H12l1-8Z"/>',
  door: '<path d="M13 4H6v16h7"/><path d="M16 12H9"/><path d="M13 9l3 3-3 3"/>',
  camp: '<path d="M12 4c1.8 2.3 3.5 3.9 3.5 6.4A3.5 3.5 0 0 1 12 14a3.5 3.5 0 0 1-3.5-3.6C8.5 8 10.2 6.3 12 4Z"/><path d="M4 20l4.5-3.5"/><path d="M20 20l-4.5-3.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** An aria-hidden icon span; the button's sr-only text carries the name. */
export function iconEl(name: IconName): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "ico";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}
