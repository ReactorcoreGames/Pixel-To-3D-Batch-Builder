/* Real contact sheets for the UI: the core's sheet writer, drawn onto a canvas and cached per settings.
   Used by the ① preview and the ① Run button. (② works on the sheet pictures themselves, see models.ts.) */

import { makeSheet, type EndsCode, type Frame, type ShapeCode, type Sheet, type SheetRect, type SideCode } from '../core';
import { images } from './state';

export interface UISheet {
  sheet: Sheet;
  cv: HTMLCanvasElement;
  W: number; H: number; N: number;
  X: number; Y: number; Z: number;
  rects: Record<SideCode, SheetRect>;
  legend: string;
}

export const sheetCache = new Map<string, UISheet | null>();

/** The sheet for a loaded picture with these settings, or null when it can't be made (model over 128). */
export function sheetFor(imageId: string, side: SideCode, depth: number, shape: ShapeCode, ends: EndsCode, outlined: boolean, copySides: boolean, frame: Frame): UISheet | null {
  const key = [imageId, side, depth, shape, ends, outlined, copySides, frame.edge, frame.core].join('|');
  if (sheetCache.has(key)) return sheetCache.get(key)!;
  const im = images.get(imageId);
  const sheet = im ? makeSheet(im.img, { side, depth, shape, ends, outlined, copySides, frame }) : null;
  let out: UISheet | null = null;
  if (sheet) {
    const { width: W, height: H, data } = sheet.image;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), W, H), 0, 0);
    const [X, Y, Z] = sheet.size;
    out = { sheet, cv, W, H, N: sheet.n, X, Y, Z, rects: sheet.rects, legend: sheet.legend };
  }
  sheetCache.set(key, out);
  return out;
}
