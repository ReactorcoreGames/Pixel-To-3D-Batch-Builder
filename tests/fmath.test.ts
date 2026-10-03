import { describe, expect, it } from 'vitest';
import { atan2, cos, sin, tan } from '../src/core/fmath';

/** A seeded random stream, so the test checks the same numbers every run. */
function rnd(seed = 1) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

describe('engine-independent trig (core/fmath.ts)', () => {
  it('agrees with Math to about 1 ulp', () => {
    const r = rnd();
    let worst = 0;
    for (let i = 0; i < 100000; i++) {
      const t = (r() - .5) * 40, x = (r() - .5) * 60, y = (r() - .5) * 60;
      worst = Math.max(worst, Math.abs(sin(t) - Math.sin(t)), Math.abs(cos(t) - Math.cos(t)), Math.abs(atan2(y, x) - Math.atan2(y, x)));
      if (Math.abs(Math.cos(t)) > .05) worst = Math.max(worst, Math.abs(tan(t) - Math.tan(t)) / Math.max(1, Math.abs(Math.tan(t))));
    }
    expect(worst).toBeLessThan(1e-15);
  });
  it('is exact where it matters and handles the edge cases like Math', () => {
    expect(sin(0)).toBe(0); expect(cos(0)).toBe(1);
    for (const [y, x] of [[0, 1], [0, -1], [1, 0], [-1, 0], [-0, -1], [0, 0], [Infinity, 1], [1, -Infinity]]) expect(atan2(y, x)).toBe(Math.atan2(y, x));
    expect(atan2(1, 1)).toBeCloseTo(Math.PI / 4, 15); expect(atan2(-1, -1)).toBeCloseTo(-3 * Math.PI / 4, 15);
    expect(sin(NaN)).toBeNaN(); expect(cos(Infinity)).toBeNaN();
  });
});
