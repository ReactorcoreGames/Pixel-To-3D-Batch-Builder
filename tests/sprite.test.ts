import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseName, checkSprite, cubeSize, fileOf, hasSolidPixels, modelSize, sideFromFilename } from '../src/core';

describe('model size and cube size', () => {
  it('puts the sprite on the axes its side faces', () => {
    expect(modelSize(24, 9, 3, 'F')).toEqual([24, 9, 3]);
    expect(modelSize(24, 9, 3, 'Bk')).toEqual([24, 9, 3]);
    expect(modelSize(24, 9, 3, 'R')).toEqual([3, 9, 24]);
    expect(modelSize(24, 9, 3, 'L')).toEqual([3, 9, 24]);
    expect(modelSize(24, 9, 3, 'T')).toEqual([24, 3, 9]);
    expect(modelSize(24, 9, 3, 'Bt')).toEqual([24, 3, 9]);
  });

  it('rounds up to the standard sizes and gives up past 128', () => {
    expect(cubeSize(1)).toBe(8);
    expect(cubeSize(8)).toBe(8);
    expect(cubeSize(9)).toBe(16);
    expect(cubeSize(33)).toBe(64);
    expect(cubeSize(128)).toBe(128);
    expect(cubeSize(129)).toBeNull();
  });
});

describe('filename side suffix', () => {
  it('reads the side codes', () => {
    expect(sideFromFilename('sword_R.png')).toBe('R');
    expect(sideFromFilename('barrel_Bk.PNG')).toBe('Bk');
    expect(sideFromFilename('lamp_Bt.png')).toBe('Bt');
    expect(sideFromFilename('crate_T.png')).toBe('T');
    expect(sideFromFilename('crate_F')).toBe('F');
  });

  it('ignores anything that is not exactly a side code at the end', () => {
    expect(sideFromFilename('sword_r.png')).toBeNull();
    expect(sideFromFilename('sword_B.png')).toBeNull();
    expect(sideFromFilename('sword_Right.png')).toBeNull();
    expect(sideFromFilename('rifle__32_R_cyW.png')).toBeNull();
    expect(sideFromFilename('01 - large boulder.png')).toBeNull();
  });

  it('strips .png and the suffix for the sheet base name', () => {
    expect(baseName('sword_R.png')).toBe('sword');
    expect(baseName('beer_mug.png')).toBe('beer_mug');
    expect(baseName('18 - lamp (3).png')).toBe('18 - lamp (3)');
  });

  it('takes the file part of a path', () => {
    expect(fileOf('Sheet4Color/01 - large boulder.png')).toBe('01 - large boulder.png');
    expect(fileOf('D:\\art\\sword_R.png')).toBe('sword_R.png');
    expect(fileOf('plain.png')).toBe('plain.png');
  });
});

describe('row errors', () => {
  it('accepts up to 128 × 128', () => {
    expect(checkSprite(128, 128, 4, 'F').problem).toBeNull();
    expect(checkSprite(128, 128, 4, 'F').n).toBe(128);
  });

  it('refuses sprites over 128 on either side', () => {
    expect(checkSprite(129, 10, 4, 'F').problem).toBe('too-big');
    expect(checkSprite(10, 129, 4, 'F').problem).toBe('too-big');
  });

  it('refuses a thickness that pushes the model past 128', () => {
    expect(checkSprite(20, 20, 129, 'R').problem).toBe('too-thick');
    expect(checkSprite(20, 20, 128, 'R').problem).toBeNull();
  });

  it('flags fully see-through pictures', () => {
    expect(checkSprite(8, 8, 4, 'F', true).problem).toBe('empty');
  });

  it('counts pixels as solid from alpha 128', () => {
    const img = (a: number) => ({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, a]) });
    expect(hasSolidPixels(img(127))).toBe(false);
    expect(hasSolidPixels(img(128))).toBe(true);
  });
});

describe('main test set (PSRC Starter Pack Sprites)', () => {
  const dir = 'test sprites/PSRC Starter Pack Sprites';
  const files = readdirSync(dir).filter(f => /\.png$/i.test(f));
  // width and height straight from the PNG header, so this runs without a decoder
  const size = (f: string) => { const b = readFileSync(join(dir, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

  it('has all 71 sprites', () => expect(files).toHaveLength(71));

  it('every sprite is a ready row at the default thickness', () => {
    for (const f of files) {
      const [w, h] = size(f);
      expect(checkSprite(w, h, 4, sideFromFilename(f) ?? 'F').problem, f).toBeNull();
    }
  });
});
