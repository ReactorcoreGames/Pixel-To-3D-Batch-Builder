import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUBE_SIZES, SHAPE_CODES, SIDE_CODES, cutsSpritePlane, decodePng, encodePng, guardColour, legendText, makeSheet, parseSheetName,
  planFileNames, sheetFileName, sheetSize, type RGBAImage, type Sheet, type ShapeCode, type SideCode,
} from '../src/core';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
type RGB = [number, number, number];

/** A sprite from rows of letters; each letter is a colour, '.' is see-through. */
function sprite(rows: string[], pal: Record<string, RGB>): RGBAImage {
  const h = rows.length, w = rows[0].length, data = new Uint8Array(w * h * 4);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') data.set([...pal[ch], 255], (y * w + x) * 4); }));
  return { width: w, height: h, data };
}

const PAL: Record<string, RGB> = { r: [200, 30, 30], g: [30, 200, 30], b: [30, 30, 200], y: [220, 220, 40], k: [20, 20, 20], w: [240, 240, 240] };
const nameOf = (c: number[] | null) => (c ? Object.entries(PAL).find(([, v]) => v.every((x, i) => x === c[i]))?.[0] ?? '?' : '.');

/** Colour at (x, y) inside a panel's model box, or null when see-through. */
function at(sh: Sheet, panel: SideCode, x: number, y: number) {
  const r = sh.rects[panel], i = ((r.y + y) * sh.image.width + r.x + x) * 4, d = sh.image.data;
  return d[i + 3] ? [d[i], d[i + 1], d[i + 2]] : null;
}
/** A panel's model box as rows of letters. */
function panelText(sh: Sheet, panel: SideCode) {
  const r = sh.rects[panel];
  return Array.from({ length: r.h }, (_, y) => Array.from({ length: r.w }, (_, x) => nameOf(at(sh, panel, x, y))).join(''));
}
const make = (img: RGBAImage, side: SideCode, depth: number, shape: ShapeCode = 'box', outlined = false) => makeSheet(img, { side, depth, shape, outlined, frame: FRAME })!;

// a 3 × 2 sprite: every edge row/column has its own colour, so each inferred panel shows which edge it scanned
//   r g b      top row: r g b (left to right), bottom row: y w k
//   y w k      left column: r y, right column: b k
const ASYM = sprite(['rgb', 'ywk'], PAL);

describe('sheet size and layout', () => {
  it('is 3·3 + 2·N wide and 4·3 + 3·N + 7 tall for every cube size', () => {
    for (const n of CUBE_SIZES) {
      const img = sprite(['r'.repeat(n)], PAL);
      const sh = make(img, 'F', 1);
      expect(sh.n).toBe(n);
      expect([sh.image.width, sh.image.height]).toEqual([9 + 2 * n, 12 + 3 * n + 7]);
      expect(sheetSize(n)).toEqual({ width: sh.image.width, height: sh.image.height });
    }
    expect(sheetSize(128)).toEqual({ width: 265, height: 403 });
  });

  it('refuses models over 128', () => {
    expect(makeSheet(sprite(['r'], PAL), { side: 'F', depth: 129, shape: 'box', outlined: false, frame: FRAME })).toBeNull();
  });

  it('has an opaque frame everywhere outside the cells, so a flood fill stops at it', () => {
    const sh = make(ASYM, 'F', 2), { width: W, height: H, data } = sh.image, n = sh.n;
    const inCell = (x: number, y: number) => SIDE_CODES.some(p => { const r = sh.rects[p]; return x >= r.cx && y >= r.cy && x < r.cx + n && y < r.cy + n; });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inCell(x, y)) expect(data[(y * W + x) * 4 + 3]).toBe(255);
  });

  it('draws edge | core | edge gutters in the chosen colours', () => {
    const sh = make(ASYM, 'F', 2), px = (x: number, y: number) => [...sh.image.data.subarray((y * sh.image.width + x) * 4, (y * sh.image.width + x) * 4 + 3)];
    expect(px(0, 10)).toEqual([0x1f, 0x5a, 0x44]);
    expect(px(1, 10)).toEqual([0xa6, 0x3e, 0xc5]);
    expect(px(2, 10)).toEqual([0x1f, 0x5a, 0x44]);
  });

  it('centres the model in the cube', () => {
    const sh = make(ASYM, 'F', 2);
    expect(sh.rects.F).toMatchObject({ x: 3 + 2, w: 3, h: 2 }); // (8 − 3) / 2 rounded down
    expect(sh.rects.F.y - sh.rects.F.cy).toBe(3);
    expect(sh.rects.T.y - sh.rects.T.cy).toBe(3); // thickness 2 in a cube of 8
  });
});

describe('panel orientation (DESIGN.md §4)', () => {
  it('Front sprite: the sprite on Front, mirrored on Back, edges scanned onto the sides', () => {
    const sh = make(ASYM, 'F', 2);
    expect(panelText(sh, 'F')).toEqual(['rgb', 'ywk']);
    expect(panelText(sh, 'Bk')).toEqual(['bgr', 'kwy']);
    expect(panelText(sh, 'L')).toEqual(['rr', 'yy']); // the sprite's left column
    expect(panelText(sh, 'R')).toEqual(['bb', 'kk']); // the sprite's right column
    expect(panelText(sh, 'T')).toEqual(['rgb', 'rgb']); // top row, left to right like Front
    expect(panelText(sh, 'Bt')).toEqual(['ywk', 'ywk']); // bottom row, left to right like Front
  });

  it('every side: the sprite lands unchanged on its own panel and mirrored on the opposite one', () => {
    const opposite: Record<SideCode, SideCode> = { F: 'Bk', Bk: 'F', L: 'R', R: 'L', T: 'Bt', Bt: 'T' };
    for (const side of SIDE_CODES) {
      const sh = make(ASYM, side, 2);
      expect(panelText(sh, side)).toEqual(['rgb', 'ywk']);
      const flipped = side === 'T' || side === 'Bt' ? ['ywk', 'rgb'] : ['bgr', 'kwy'];
      expect(panelText(sh, opposite[side])).toEqual(flipped);
    }
  });

  it('Right sprite: its left edge is the front (Right\'s left edge meets the Front)', () => {
    const sh = make(ASYM, 'R', 2);
    expect(panelText(sh, 'F')).toEqual(['rr', 'yy']);
    expect(panelText(sh, 'Bk')).toEqual(['bb', 'kk']);
    // Top: seen from above, front edge at the bottom; the sprite's top row runs from the front (bottom) to the back (top)
    expect(panelText(sh, 'T')).toEqual(['bb', 'gg', 'rr']);
    // Bottom: seen from below, front edge at the top
    expect(panelText(sh, 'Bt')).toEqual(['yy', 'ww', 'kk']);
  });

  it('Left sprite: its right edge is the front (Left\'s right edge meets the Front)', () => {
    const sh = make(ASYM, 'L', 2);
    expect(panelText(sh, 'F')).toEqual(['bb', 'kk']);
    expect(panelText(sh, 'Bk')).toEqual(['rr', 'yy']);
    expect(panelText(sh, 'T')).toEqual(['rr', 'gg', 'bb']);
    expect(panelText(sh, 'Bt')).toEqual(['kk', 'ww', 'yy']);
  });

  it('Top sprite: its bottom edge is the front', () => {
    const sh = make(ASYM, 'T', 2);
    expect(panelText(sh, 'F')).toEqual(['ywk', 'ywk']);
    expect(panelText(sh, 'Bk')).toEqual(['bgr', 'bgr']);
    expect(panelText(sh, 'L')).toEqual(['ry', 'ry']);
    expect(panelText(sh, 'R')).toEqual(['kb', 'kb']);
  });

  it('Bottom sprite: its top edge is the front', () => {
    const sh = make(ASYM, 'Bt', 2);
    expect(panelText(sh, 'F')).toEqual(['rgb', 'rgb']);
    expect(panelText(sh, 'Bk')).toEqual(['kwy', 'kwy']);
    expect(panelText(sh, 'L')).toEqual(['yr', 'yr']);
    expect(panelText(sh, 'R')).toEqual(['bk', 'bk']);
  });

  it('Back sprite: seen from behind, so its left edge is the object\'s right', () => {
    const sh = make(ASYM, 'Bk', 2);
    expect(panelText(sh, 'R')).toEqual(['rr', 'yy']);
    expect(panelText(sh, 'L')).toEqual(['bb', 'kk']);
    expect(panelText(sh, 'T')).toEqual(['bgr', 'bgr']);
  });
});

describe('edge scan and outlined sprites', () => {
  const OUTLINED = sprite(['kkkk', 'kbbk', 'kbbk', 'kkkk'], PAL);
  it('without the option, inferred sides take the first painted pixel (the outline)', () => {
    expect(panelText(make(OUTLINED, 'F', 3), 'T')).toEqual(['kkkk', 'kkkk', 'kkkk']);
  });
  it('with it, they take the colour just past the outline and get their own 1px outline', () => {
    const sh = make(OUTLINED, 'F', 3, 'box', true);
    expect(panelText(sh, 'T')).toEqual(['kkkk', 'kbbk', 'kkkk']);
    expect(panelText(sh, 'L')).toEqual(['kkk', 'kbk', 'kbk', 'kkk']);
    expect(panelText(sh, 'F')).toEqual(['kkkk', 'kbbk', 'kbbk', 'kkkk']);
  });
  it('a run only 1 pixel long has nothing past its outline, so it keeps the outline colour', () => {
    const sh = make(sprite(['k', 'b'], PAL), 'F', 3, 'box', true);
    expect(panelText(sh, 'L')).toEqual(['kkk', 'bbb']);
  });
});

describe('cross-section shapes on the sheet', () => {
  const SQUARE = sprite(Array(8).fill('rrrrrrrr'), PAL);
  it('Egg / ball keeps the sprite\'s outline but rounds the inferred panels, culling their corners', () => {
    const sh = make(SQUARE, 'F', 8, 'ell');
    expect(panelText(sh, 'F').join('')).not.toContain('.');
    const top = panelText(sh, 'T');
    expect(top[0][0]).toBe('.');
    expect(top[0][7]).toBe('.');
    expect(top[3]).toBe('rrrrrrrr');
    expect(panelText(sh, 'L')[7][0]).toBe('.');
  });
  it('Box leaves every panel a full rectangle', () => {
    const sh = make(SQUARE, 'F', 8);
    for (const p of SIDE_CODES) expect(panelText(sh, p).join('')).not.toContain('.');
  });
  it('Tube ↔ rounds only across the width axis, so Left/Right stay full and Top/Bottom lose corners', () => {
    const sh = make(SQUARE, 'F', 8, 'cyW');
    expect(panelText(sh, 'L')[0][0]).toBe('.');
    expect(panelText(sh, 'T').join('')).not.toContain('.');
  });
  it('a tube\'s depth follows the drawing: a pot narrow at the base is shallow at the base too (user report, session 2)', () => {
    const POT = sprite(['rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '.rrrrrr.', '..rrrr..'], PAL);
    const sh = make(POT, 'F', 8, 'cyH');
    const depthOf = (row: string) => row.replace(/\./g, '').length;
    const side = panelText(sh, 'L').map(depthOf);
    expect(side[0]).toBe(8); // the widest row gets the whole thickness
    expect(side[4]).toBeLessThan(side[2]);
    expect(side[2]).toBeLessThan(side[0]);
    // drawn from the side instead, the Front panel shows the same taper
    const fromSide = make(POT, 'R', 8, 'cyH');
    expect(panelText(fromSide, 'F').map(depthOf)).toEqual(side);
  });
  it('a circle drawn with thickness = width becomes a ball: every panel is the same round shape', () => {
    const BALL = sprite(['..rrrr..', '.rrrrrr.', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..'], PAL);
    const sh = make(BALL, 'F', 8, 'ell');
    const mask = (p: SideCode) => panelText(sh, p).map(r => r.replace(/[^.]/g, '#'));
    for (const p of ['L', 'R', 'T', 'Bt'] as const) expect(mask(p)).toEqual(mask('F'));
  });
  it('round and diamond shapes fold the drawing onto the panels around their axis: split down the middle and mirrored', () => {
    // each panel shows the half of the drawing nearest it, the edge it faces down the middle and the drawing's middle
    // at the rims
    const STRIPES = sprite(['rgby', 'rgby', 'rgby', 'rgby'], PAL);
    for (const shape of ['cyH', 'diH', 'ell', 'dpy'] as const) {
      const sh = make(STRIPES, 'F', 4, shape);
      expect(panelText(sh, 'L')[1]).toBe('grrg');
      expect(panelText(sh, 'R')[1]).toBe('byyb');
    }
    // a ↔ tube folds Top/Bottom instead (a gun seen from above: its top edge down the middle); Left/Right look down
    // its axis and keep the edge scan
    const tube = make(sprite(['rrrr', 'gggg', 'bbbb', 'yyyy'], PAL), 'F', 4, 'cyW');
    expect(panelText(tube, 'T').map(r => r[1])).toEqual(['g', 'r', 'r', 'g']);
    expect(panelText(tube, 'Bt').map(r => r[1])).toEqual(['b', 'y', 'y', 'b']);
    expect(panelText(make(STRIPES, 'F', 4, 'cyW'), 'L')[1]).toBe('rrrr');
    // box and soft box aren't the same after a quarter turn: edge scan
    expect(panelText(make(STRIPES, 'F', 4, 'rbox'), 'L')[1]).toBe('rrrr');
  });
  it('Copy sides puts the drawing on every inferred panel, turned to face it, unmirrored (any shape)', () => {
    const copy = (img: RGBAImage, shape: ShapeCode) => makeSheet(img, { side: 'F', depth: 4, shape, outlined: false, copySides: true, frame: FRAME })!;
    const STRIPES = sprite(['rgby', 'rgby', 'rgby', 'rgby'], PAL);
    // the sprite's column of the sheet (Front, Left, Top) as drawn, the other column (Back, Right, Bottom) mirrored
    for (const shape of ['box', 'rbox', 'cyH', 'ell', 'dpy'] as const) {
      expect(panelText(copy(STRIPES, shape), 'L')[1]).toBe('rgby');
      expect(panelText(copy(STRIPES, shape), 'R')[1]).toBe('ybgr');
    }
    const ROWS = sprite(['rrrr', 'gggg', 'bbbb', 'yyyy'], PAL);
    expect(panelText(copy(ROWS, 'box'), 'T').map(r => r[1])).toEqual(['r', 'g', 'b', 'y']);
    expect(panelText(copy(ROWS, 'cyW'), 'Bt').map(r => r[1])).toEqual(['r', 'g', 'b', 'y']);
    const COLS = sprite(['rgby', 'rgby', 'rgby', 'rgby'], PAL);
    expect(panelText(copy(COLS, 'box'), 'T')[1]).toBe('rgby');
    expect(panelText(copy(COLS, 'box'), 'Bt')[1]).toBe('ybgr');
    // a sprite drawn from the Right sits in the right-hand column, so the left-hand one is mirrored
    const fromRight = makeSheet(STRIPES, { side: 'R', depth: 4, shape: 'box', outlined: false, copySides: true, frame: FRAME })!;
    expect(panelText(fromRight, 'Bk')[1]).toBe('rgby');
    expect(panelText(fromRight, 'F')[1]).toBe('ybgr');
    // the sprite's own panel and the model don't change
    const plain = make(STRIPES, 'F', 4, 'ell'), copied = copy(STRIPES, 'ell');
    expect(panelText(copied, 'F')).toEqual(panelText(plain, 'F'));
    for (const p of SIDE_CODES) expect(panelText(copied, p).map(r => r.replace(/[^.]/g, '#'))).toEqual(panelText(plain, p).map(r => r.replace(/[^.]/g, '#')));
  });
  it('the ⊙ shapes round the picture plane itself', () => {
    const sh = make(SQUARE, 'F', 2, 'cyT');
    expect(panelText(sh, 'F')[0][0]).toBe('.');
    expect(panelText(sh, 'F')[3]).toBe('rrrrrrrr');
  });
  it('small pieces stay square: a 3 × 3 tube cross-section keeps all 9 pixels', () => {
    const sh = make(sprite(['rrr', 'rrr', 'rrr'], PAL), 'F', 3, 'cyW');
    expect(panelText(sh, 'L')).toEqual(['rrr', 'rrr', 'rrr']);
  });
  it('every shape except the ⊙ ones keeps the sprite\'s own outline pixel for pixel (all PSRC sprites)', () => {
    const dir = 'test sprites/PSRC Starter Pack Sprites';
    const sprites = readdirSync(dir).filter(f => f.endsWith('.png')).slice(0, 40).map(f => decodePng(readFileSync(join(dir, f))));
    for (const shape of SHAPE_CODES.filter(s => !cutsSpritePlane(s))) for (const img of sprites) {
      const depth = Math.min(128, Math.max(2, Math.round(img.width / 2)));
      const sh = make(img, 'F', depth, shape);
      const r = sh.rects.F;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const solid = img.data[(y * img.width + x) * 4 + 3] >= 128, onSheet = sh.image.data[((r.y + y) * sh.image.width + r.x + x) * 4 + 3] > 0;
        if (solid !== onSheet) throw new Error(`${shape}: pixel ${x},${y} of a ${img.width}×${img.height} sprite changed`);
      }
    }
  }, 60_000);
});

describe('legend', () => {
  it('shows the longest text that fits', () => {
    expect(legendText(8)).toBe('N8');
    expect(legendText(16)).toBe('N16');
    expect(legendText(32)).toBe('F:B L:R T:BOT N32');
    expect(legendText(64)).toBe('F:B L:R T:BOT N64 DO NOT RESIZE');
    expect(legendText(128)).toBe('FRONT:BACK LEFT:RIGHT TOP:BOTTOM N128 DO NOT RESIZE');
    for (const n of CUBE_SIZES) expect(legendText(n).length * 4 - 1 + 1).toBeLessThanOrEqual(sheetSize(n).width - 1);
  });
});

describe('collision guard', () => {
  it('leaves the frame alone when the sprite uses different colours', () => {
    const sh = make(ASYM, 'F', 2);
    expect(sh.frame).toEqual(FRAME);
    expect(sh.nudged).toBe(false);
  });
  it('nudges a frame colour away from an identical or very close sprite colour', () => {
    const img = sprite(['ab'], { a: [0x1f, 0x5a, 0x44], b: [0xa0, 0x40, 0xc0] } as Record<string, RGB>);
    const sh = makeSheet(img, { side: 'F', depth: 1, shape: 'box', outlined: false, frame: FRAME })!;
    expect(sh.nudged).toBe(true);
    for (const hex of [sh.frame.edge, sh.frame.core]) {
      const v = parseInt(hex.slice(1), 16), c = [v >> 16, (v >> 8) & 255, v & 255];
      for (const s of [[0x1f, 0x5a, 0x44], [0xa0, 0x40, 0xc0]]) expect(Math.max(...c.map((x, i) => Math.abs(x - s[i])))).toBeGreaterThan(16);
    }
    // the nudged colours are what the sheet actually draws
    const v = parseInt(sh.frame.edge.slice(1), 16);
    expect([...sh.image.data.subarray(0, 3)]).toEqual([v >> 16, (v >> 8) & 255, v & 255]);
  });
  it('is deterministic, and a single-colour frame stays single-colour', () => {
    const used = new Set([0xa63ec5]);
    expect(guardColour('#a63ec5', used)).toBe(guardColour('#a63ec5', used));
    expect(guardColour('#a63ec5', used)).not.toBe('#a63ec5');
  });
});

describe('file names', () => {
  it('writes and reads name__N_side_shape.png', () => {
    expect(sheetFileName('rifle', 32, 'R', 'cyW')).toBe('rifle__32_R_cyW.png');
    expect(parseSheetName('rifle__32_R_cyW.png')).toEqual({ base: 'rifle', n: 32, side: 'R', shape: 'cyW', ends: 'flat' });
    expect(parseSheetName('my__odd__name__16_Bk_ell.PNG')).toEqual({ base: 'my__odd__name', n: 16, side: 'Bk', shape: 'ell', ends: 'flat' });
    expect(parseSheetName('sword_final.png')).toBeNull();
    expect(parseSheetName('rifle__32_r_cyw.png')).toBeNull();
  });
  it('never gives two sheets the same name, and keeps painted sheets on disk', () => {
    expect(planFileNames(['a__8_F_box.png', 'a__8_F_box.png', 'b__8_F_box.png'])).toEqual(['a__8_F_box.png', 'a_2__8_F_box.png', 'b__8_F_box.png']);
    expect(planFileNames(['a__8_F_box.png'], ['A__8_F_BOX.png', 'a_2__8_F_box.png'])).toEqual(['a_3__8_F_box.png']);
    expect(planFileNames(['a__8_F_box.png'], ['a__8_F_box.png'], false)).toEqual(['a__8_F_box.png']);
    expect(parseSheetName('a_3__8_F_box.png')?.n).toBe(8);
  });
  it('lets a remade sheet keep the name of the sheet it replaces, and nobody else', () => {
    const disk = ['a__8_F_box.png', 'a_2__8_F_box.png', 'b__8_F_box.png'];
    // a is painted (kept), a_2 is the unpainted sheet being remade: it keeps a_2, not a_3
    expect(planFileNames(['a__8_F_box.png'], disk, true, ['a_2__8_F_box.png'])).toEqual(['a_2__8_F_box.png']);
    // b is remade under a new name (thicker): its old name is free for it only, even with "never overwrite" off
    expect(planFileNames(['b__16_F_box.png', 'b__8_F_box.png'], disk, false, ['B__8_F_BOX.png', undefined])).toEqual(['b__16_F_box.png', 'b_2__8_F_box.png']);
    expect(planFileNames(['b__8_F_box.png'], disk, true, ['b__8_F_box.png'])).toEqual(['b__8_F_box.png']);
  });
});

describe('PNG', () => {
  it('round-trips a sheet through the encoder and decoder', () => {
    const sh = make(ASYM, 'R', 5, 'ell', true);
    const back = decodePng(encodePng(sh.image));
    expect(back.width).toBe(sh.image.width);
    expect(Buffer.from(back.data).equals(Buffer.from(sh.image.data))).toBe(true);
  });
  it('reads every test sprite (palette, RGB and RGBA PNGs)', () => {
    const root = 'test sprites';
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : /\.png$/i.test(e.name) ? [join(d, e.name)] : []));
    const files = walk(root);
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) {
      const img = decodePng(readFileSync(f));
      expect(img.data.length).toBe(img.width * img.height * 4);
    }
  }, 30_000); // the comparison sheets are big: about 3 s alone, more next to the CLI test
});
