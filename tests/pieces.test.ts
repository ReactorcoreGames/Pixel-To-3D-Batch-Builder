/* Loose pieces (session 8 stress test): a model must not float in bits that the sprite didn't draw apart. Two causes
   were fixed: the visual hull's ghosts (blobs every side allows but no side shows), and Phase 1's settling cutting
   an Egg or Gem on an uneven outline into parts. Session 7c: Egg, Gem and the ⊙ shaped ends follow the distance from
   the outline, so they reach their full thickness on any outline, and a ⊙ cut leaves no loose rods. The stress
   sprites are 128 × 128 shapes filled with noise. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildVoxelModel, decodePng, labelPieces, makeSheet, readSheet, sheetFileName, type EndsCode, type ShapeCode } from '../src/core';

const FRAME = { edge: '#1f5a44', core: '#a63ec5' };
const MID = { x: .5, y: .5, z: .5 };
const stress = (name: string) => decodePng(readFileSync(`test sprites/Stress Test Shapes 128px/${name}.png`));

function roundTrip(name: string, shape: ShapeCode, depth: number, ends: EndsCode = 'flat') {
  const sheet = makeSheet(stress(name), { side: 'F', depth, shape, ends, outlined: true, frame: FRAME })!;
  const read = readSheet(sheet.image, sheetFileName('x', sheet.n, 'F', shape, ends));
  return buildVoxelModel(read, 'F', shape, MID, undefined, ends);
}

describe('no floating bits', () => {
  for (const [name, shape, depth] of [
    ['5d - donut - egg', 'ell', 128], ['5e - donut - gem', 'dpy', 64], ['2e - triangle - gem', 'dpy', 64], ['2d - triangle - egg', 'ell', 32],
  ] as [string, ShapeCode, number][]) {
    it(`${name} at thickness ${depth} is one piece, with no paint cut off`, () => {
      const m = roundTrip(name, shape, depth);
      expect(labelPieces(m.solid, m.n, true).pieces.length).toBe(1);
      expect(m.trimmed).toEqual([]);
    }, 60_000);
  }

  it('a triangle as Tube ⊙ or Diamond ⊙ is one piece: no loose rods at the corners of its base', () => {
    // the ⊙ cut fits a circle or diamond to the drawing's box; keeping a pixel in every row and column it emptied
    // left lone pixels at the base corners, rods through the whole thickness
    for (const [name, shape] of [['2b - triangle - tube', 'cyT'], ['2c - triangle - diamond', 'diT']] as [string, ShapeCode][]) {
      const m = roundTrip(name, shape, 32);
      expect(labelPieces(m.solid, m.n, true).pieces.length, name).toBe(1);
      expect(m.trimmed, name).toEqual([]);
    }
  }, 60_000);
});

describe('full thickness on any outline', () => {
  it('Egg and Gem reach the thickness they were given, wherever the drawing is widest', () => {
    // the two combined cuts only reached it where a long column met a long row: a triangle as Gem at 128 came out
    // about 68 deep
    for (const [name, shape] of [['2e - triangle - gem', 'dpy'], ['2d - triangle - egg', 'ell'], ['5d - donut - egg', 'ell']] as [string, ShapeCode][]) {
      const m = roundTrip(name, shape, 128);
      expect(m.hi[2] - m.lo[2] + 1, name).toBe(128);
    }
  }, 60_000);

  it('a donut with shaped ends (Tube ⊙ and Diamond ⊙, both ends) is one piece, full thickness, with no paint cut off', () => {
    // the ↔ and ↕ end cuts combined broke a donut's caps into spikes
    for (const [name, shape] of [['5b - donut - tube', 'cyT'], ['5c - donut - diamond', 'diT']] as [string, ShapeCode][]) {
      const m = roundTrip(name, shape, 64, 'cB');
      expect(labelPieces(m.solid, m.n, true).pieces.length, name).toBe(1);
      expect(m.hi[2] - m.lo[2] + 1, name).toBe(64);
      expect(m.trimmed, name).toEqual([]);
    }
  }, 60_000);
});
