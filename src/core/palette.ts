/* Colours: merging a model's colours into a limited palette (the .vox file's 255 slots, DESIGN.md §8) and the palette
   export (.gpl / .hex, DESIGN.md §11). Colours are 0xRRGGBB numbers throughout. */

/** How far apart two colours look: squared RGB distance, weighted towards green like the eye. */
export function colourDistance(a: number, b: number): number {
  const dr = (a >> 16) - (b >> 16), dg = ((a >> 8) & 255) - ((b >> 8) & 255), db = (a & 255) - (b & 255);
  return 3 * dr * dr + 4 * dg * dg + 2 * db * db;
}

/** The palette entry nearest to a colour (its index). */
export function nearestColour(c: number, palette: ArrayLike<number>): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = colourDistance(c, palette[i]);
    if (d < bd) { bd = d; best = i; if (!d) break; }
  }
  return best;
}

/**
 * Merges colours into at most `k` (median cut, then two rounds of moving each palette colour to the middle of the
 * colours that picked it). `counts` maps each colour to how often it's used, so common colours stay closest to
 * themselves. With `k` or fewer colours, they are returned as they are.
 */
export function quantize(counts: Map<number, number>, k: number): number[] {
  const cols = [...counts.keys()];
  if (cols.length <= k) return cols;
  if (k <= 0) return [];
  const w = cols.map(c => counts.get(c)!);
  const ch = (c: number, j: number) => (c >> (16 - 8 * j)) & 255;
  // median cut: always split the box with the widest channel range, at the weighted median of that channel
  type Box = { idx: number[]; range: number; axis: number };
  const boxOf = (idx: number[]): Box => {
    let range = -1, axis = 0;
    for (let j = 0; j < 3; j++) {
      let lo = 255, hi = 0;
      for (const i of idx) { const v = ch(cols[i], j); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > range) { range = hi - lo; axis = j; }
    }
    return { idx, range, axis };
  };
  const boxes = [boxOf(cols.map((_, i) => i))];
  while (boxes.length < k) {
    let bi = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].idx.length > 1 && (bi < 0 || boxes[i].range > boxes[bi].range)) bi = i;
    if (bi < 0 || boxes[bi].range === 0) break;
    const { idx, axis } = boxes[bi];
    idx.sort((a, b) => ch(cols[a], axis) - ch(cols[b], axis));
    const total = idx.reduce((s, i) => s + w[i], 0);
    let acc = 0, cut = idx.length - 1;
    for (let j = 0; j < idx.length - 1; j++) { acc += w[idx[j]]; if (acc >= total / 2) { cut = j + 1; break; } }
    boxes.splice(bi, 1, boxOf(idx.slice(0, cut)), boxOf(idx.slice(cut)));
  }
  const mean = (idx: number[]) => {
    let r = 0, g = 0, b = 0, t = 0;
    for (const i of idx) { const c = cols[i]; r += (c >> 16) * w[i]; g += ((c >> 8) & 255) * w[i]; b += (c & 255) * w[i]; t += w[i]; }
    return (Math.round(r / t) << 16) | (Math.round(g / t) << 8) | Math.round(b / t);
  };
  let pal = boxes.map(b => mean(b.idx));
  for (let round = 0; round < 2; round++) {
    const groups: number[][] = pal.map(() => []);
    cols.forEach((c, i) => groups[nearestColour(c, pal)].push(i));
    pal = groups.map((g, j) => (g.length ? mean(g) : pal[j]));
  }
  return [...new Set(pal)];
}

/** Brightness, for sorting palettes dark to light. */
export const luminance = (c: number) => (c >> 16) * .3 + ((c >> 8) & 255) * .59 + (c & 255) * .11;

const hex6 = (c: number) => c.toString(16).padStart(6, '0');

/** A GIMP palette file (also read by Aseprite and Krita). */
export function writeGpl(name: string, colours: number[]): string {
  const lines = ['GIMP Palette', `Name: ${name.replace(/[\r\n]/g, ' ')}`, `Columns: ${Math.min(16, Math.max(1, colours.length))}`, '#'];
  for (const c of colours) lines.push(`${String(c >> 16).padStart(3)} ${String((c >> 8) & 255).padStart(3)} ${String(c & 255).padStart(3)}\t#${hex6(c)}`);
  return lines.join('\n') + '\n';
}

/** A plain list of colour codes, one per line, as Lospec's .hex files. */
export const writeHex = (colours: number[]) => colours.map(hex6).join('\n') + '\n';
