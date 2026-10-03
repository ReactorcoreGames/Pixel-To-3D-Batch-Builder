/* Test sheets painted "by hand" in code: each panel is described in world coordinates (x right, y up, z towards the
   front, in an N-cube), the way an artist would paint it in an art app, then drawn onto a real sheet layout.
   The same sheets are saved as PNGs in `tests/fixtures/phase2 test sheets/` for trying them in the app
   (run `WRITE_TEST_SHEETS=1 npx vitest run tests/phase2.test.ts`). */

import { LEGEND_H, SIDE_CODES, VIEW, cellOrigin, panelPixel, sheetSize, type RGBAImage, type SideCode } from '../src/core';

export type RGB = [number, number, number];
/** Colour of the panel pixel that sees world position (x, y, z); the coordinate along the panel's view is ignored. */
export type Paint = (x: number, y: number, z: number) => RGB | null;

export function paintSheet(n: number, paints: Record<SideCode, Paint>): RGBAImage {
  const { width, height } = sheetSize(n), data = new Uint8Array(width * height * 4);
  // a plain grey frame and a dark legend strip: the reader never looks at them
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(y >= height - LEGEND_H ? [20, 20, 30, 255] : [90, 90, 100, 255], (y * width + x) * 4);
  for (const p of SIDE_CODES) {
    const [cx, cy] = cellOrigin(p, n), k = VIEW[p].look[0];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data.fill(0, ((cy + y) * width + cx + x) * 4, ((cy + y) * width + cx + x) * 4 + 4);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const c = k === 0 ? [0, a, b] : k === 1 ? [a, 0, b] : [a, b, 0];
      const col = paints[p](c[0], c[1], c[2]);
      if (!col) continue;
      const [px, py] = panelPixel(p, c, n);
      data.set([...col, 255], ((cy + py) * width + cx + px) * 4);
    }
  }
  return { width, height, data };
}

// ------------------------------------------------------------------ a mug with a handle and a blind hole (N = 16)

export const MUG = { red: [200, 60, 60] as RGB, rim: [240, 200, 200] as RGB, base: [70, 30, 30] as RGB, handle: [150, 40, 40] as RGB };
const inBody = (x: number, y: number, z: number) => x >= 3 && x <= 12 && y >= 2 && y <= 13 && z >= 3 && z <= 12;
/** The handle, seen from the front: a loop to the right of the body with a hole at x 13, y 6–9. */
const inHandleFront = (x: number, y: number) => (x === 13 || x === 14) && y >= 5 && y <= 10 && !(x === 13 && y >= 6 && y <= 9);
const inHandleTop = (x: number, z: number) => (x === 13 || x === 14) && (z === 7 || z === 8);
const inHole = (x: number, z: number) => x >= 5 && x <= 10 && z >= 5 && z <= 10;

export function mugSheet(strayPaint = false): RGBAImage {
  const side: Paint = (_x, y, z) => (inBody(5, y, z) ? MUG.red : null);
  const front: Paint = (x, y, z) => (inBody(x, y, 5) ? MUG.red : inHandleFront(x, y) ? MUG.handle : (void z, null));
  return paintSheet(16, {
    F: front, Bk: front, L: side, R: side,
    // the top shows the rim around the hole, and the handle's top; the hole itself is left see-through
    T: (x, _y, z) => (strayPaint && x <= 1 && z <= 1 ? MUG.rim : inBody(x, 5, z) ? (inHole(x, z) ? null : MUG.rim) : inHandleTop(x, z) ? MUG.handle : null),
    Bt: (x, _y, z) => (inBody(x, 5, z) ? MUG.base : inHandleTop(x, z) ? MUG.handle : null),
  });
}

// ------------------------------------------------------------------ a fish: wide short head, tall thin tail (N = 32)

export const FISH = { body: [60, 140, 220] as RGB, belly: [200, 230, 250] as RGB, fin: [240, 150, 40] as RGB };
const profile = (x: number, y: number) => {
  const body = ((x - 13) / 9.5) ** 2 + ((y - 15.5) / 5) ** 2 <= 1; // x 4–22, y 11–20
  const tail = x >= 21 && x <= 27 && Math.abs(y - 15.5) <= Math.min(7, (x - 20) * 1.2); // up to 14 tall at the end
  return body || tail;
};
/** Seen from the top: the head is up to 8 wide (z 12–19), the back half 2 wide (z 15–16). */
const plan = (x: number, z: number) => (x >= 4 && x <= 15 ? Math.abs(z - 15.5) <= Math.min(4, 1 + (x - 4) * .8) : x >= 16 && x <= 27 && (z === 15 || z === 16));

export function fishSheet(): RGBAImage {
  const side: Paint = (x, y) => (profile(x, y) ? (x >= 21 ? FISH.fin : y < 14 ? FISH.belly : FISH.body) : null);
  const top: Paint = (x, _y, z) => (plan(x, z) ? (x >= 21 ? FISH.fin : FISH.body) : null);
  return paintSheet(32, {
    F: side, Bk: side, T: top, Bt: top,
    // looking at the head: a short, wide oval; looking at the tail: a tall, thin fin
    L: (_x, y, z) => (((y - 15.5) / 5) ** 2 + ((z - 15.5) / 4) ** 2 <= 1 ? FISH.body : null),
    R: (_x, y, z) => ((z === 15 || z === 16) && Math.abs(y - 15.5) <= 7 ? FISH.fin : null),
  });
}
