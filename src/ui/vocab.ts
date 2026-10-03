/* UI names and tooltips for sides, shapes, blends, gap colours, materials and inside styles (from the mockup's data.js).
   The codes themselves live in the core; these are only the words shown on screen. */

import { hasEnds, type BlendCode, type EndsCode, type FallbackCode, type InsideCode, type MaterialCode, type ShapeCode, type SideCode } from '../core';

export const SIDES: [SideCode, string, string][] = [
  ['F', 'Front', 'The sprite shows the object from the front.'],
  ['Bk', 'Back', 'The sprite shows the object from behind.'],
  ['L', 'Left', 'The sprite shows the object\'s left side (as you look at its front).'],
  ['R', 'Right', 'The sprite shows the object\'s right side (as you look at its front). Typical for side-view items like guns.'],
  ['T', 'Top', 'The sprite shows the object from above.'],
  ['Bt', 'Bottom', 'The sprite shows the object from below.'],
];
export const SIDE_NAME = Object.fromEntries(SIDES.map(s => [s[0], s[1]])) as Record<SideCode, string>;

export const SHAPES: [ShapeCode, string, string][] = [
  ['box', '■ Box', 'A plain block. The safe default.'],
  ['rbox', '▢ Soft box', 'A block with rounded-off edges.'],
  ['cyW', '⬭ Tube ↔', 'Round like a pipe running along your sprite’s width (↔), e.g. a gun barrel drawn from the side, a log.'],
  ['cyH', '⬭ Tube ↕', 'Round like a pipe running along your sprite’s height (↕), e.g. bottles, mugs, trees.'],
  ['cyT', '⬭ Tube ⊙', 'Round like a pipe coming straight out of the picture at you (⊙), e.g. a wheel or coin drawn face-on.'],
  ['diW', '◆ Diamond ↔', 'Diamond-shaped cross-section running along your sprite’s width (↔), e.g. a blade drawn lying down.'],
  ['diH', '◆ Diamond ↕', 'Diamond-shaped cross-section running along your sprite’s height (↕), e.g. a sword drawn standing up.'],
  ['diT', '◆ Diamond ⊙', 'Diamond-shaped cross-section coming out of the picture at you (⊙).'],
  ['ell', '● Egg / ball', 'Rounded in every direction: balls, eggs, rugby balls, blobs.'],
  ['dpy', '◈ Gem', 'Pointy in every direction, like a cut gem or a double pyramid.'],
];
export const SHAPE_NAME = Object.fromEntries(SHAPES.map(s => [s[0], s[1]])) as Record<ShapeCode, string>;

/** The Ends choices for a Tube or Diamond, named by the direction of its axis on the sprite as drawn (DESIGN.md §3), so
    first and last stay readable: ← left / → right for ↔, ↑ top / ↓ bottom for ↕, front / back for ⊙. */
export function endsOptions(shape: ShapeCode): [EndsCode, string, string][] {
  const axis = shape.slice(-1), done = shape.startsWith('di') ? 'Pointed' : 'Rounded';
  const [first, last, both, fw, lw] = axis === 'H' ? ['↑ Top end', '↓ Bottom end', '↕ Both ends', 'top', 'bottom']
    : axis === 'T' ? ['⊙ Front end', '⊗ Back end', '⊙⊗ Both ends', 'front (the end pointing at you)', 'back (the end pointing away)']
    : ['← Left end', '→ Right end', '↔ Both ends', 'left', 'right'];
  return [
    ['flat', '▭ Flat', 'Both ends stay flat, cut straight off like a log.'],
    ['cF', first, `${done} at the ${fw} end only, like a bullet or a stake. The rest stays a straight ${shape.startsWith('di') ? 'diamond' : 'tube'}.`],
    ['cL', last, `${done} at the ${lw} end only, like a bullet or a stake. The rest stays a straight ${shape.startsWith('di') ? 'diamond' : 'tube'}.`],
    ['cB', both, `${done} at both ends: a capsule or a crystal with a straight middle.`],
  ];
}
/** Short name of a row's ends, for titles; empty for flat ends and for shapes without ends. */
export const endsName = (shape: ShapeCode, ends: EndsCode) => (hasEnds(shape) && ends !== 'flat' ? endsOptions(shape).find(e => e[0] === ends)![1] : '');

export const BLENDS: [BlendCode, string][] = [['hard', 'Hard step'], ['stepped', 'Steps'], ['smooth', 'Smooth']];
export const FALLBACKS: [FallbackCode, string][] = [['opp', 'Opposite side'], ['near', 'Nearest pixel']];
export const MATERIALS: [MaterialCode, string][] = [['matte', '🧱 Matte'], ['plastic', '🧸 Plastic'], ['dull', '⚙️ Dull metal'], ['shiny', '✨ Shiny metal'], ['unlit', '💡 Unlit (PS1)']];
export const INSIDES: [InsideCode, string][] = [
  ['nearest', '🔁 Like the outside'], ['solid', '⬛ Solid colour'], ['hollow', '⬜ Hollow'], ['noise', '🪨 Speckled'],
  ['onion', '🧅 Onion layers'], ['rings', '🪵 Tree rings'], ['strata', '🍰 Layer cake'], ['crystal', '💎 Crystal'],
  ['fractal', '🌀 Marble swirl'], ['flesh', '🍖 Flesh & bone'], ['machine', '🤖 Machine'],
];
export const MATERIAL_NAME = Object.fromEntries(MATERIALS) as Record<MaterialCode, string>;
export const INSIDE_NAME = Object.fromEntries(INSIDES) as Record<InsideCode, string>;
