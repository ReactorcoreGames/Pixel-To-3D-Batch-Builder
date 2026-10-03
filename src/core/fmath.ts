/* Sine, cosine, tangent and atan2 that give the same bits in every JavaScript engine.
   `Math.sin` and friends are only required to be close: Edge and Node round about 4% of `Math.sin` / `Math.cos`
   results and 17% of `Math.atan2` results differently in the last bit (checked in session 7b). That was enough for a
   round model's rings to triangulate differently in the GUI and in the command-line tool. These use only + − × ÷,
   which IEEE arithmetic rounds the same everywhere. They are the fdlibm kernels (the same polynomials most C
   libraries use), accurate to about 1 ulp for the angles the core uses. The core uses these instead of `Math.sin`,
   `Math.cos`, `Math.tan`, `Math.atan2` and `Math.pow`/`**` with a fractional power. */

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function kSin(x: number): number {
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}
/** cos on [−π/4, π/4]. */
function kCos(x: number): number {
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))), hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}

// π/2 in two parts: the first has 33 bits, so k × PIO2_1 is exact for any k the core will see
const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-01;

/** x = k·π/2 + r with |r| ≤ π/4 (about); returns [r, k mod 4]. Fine for |x| up to about 1e6. */
function reduce(x: number): [number, number] {
  const k = Math.round(x * INV_PIO2);
  return [(x - k * PIO2_1) - k * PIO2_1T, ((k % 4) + 4) % 4];
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? kSin(r) : q === 1 ? kCos(r) : q === 2 ? -kSin(r) : -kCos(r);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? kCos(r) : q === 1 ? -kSin(r) : q === 2 ? -kCos(r) : kSin(r);
}

export const tan = (x: number) => sin(x) / cos(x);

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x, id = -1;
  if (a >= 1e19) return neg ? -ATANHI[3] : ATANHI[3];
  if (a < 0.4375) { if (a < 3.7252902984e-09) return x; }
  else if (a < 1.1875) {
    if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); }
  } else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); } else { id = 3; a = -1 / a; }
  const z = a * a, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return neg ? -(a - a * (s1 + s2)) : a - a * (s1 + s2);
  const r = ATANHI[id] - ((a * (s1 + s2) - ATANLO[id]) - a);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16;

/** atan2(y, x). The edge cases (a zero or an infinity) are exact constants, so `Math.atan2` gives the same bits for them
    everywhere and handles them. */
export function atan2(y: number, x: number): number {
  if (y === 0 || x === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x);
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? Math.PI - (z - PI_LO) : (z - PI_LO) - Math.PI;
}
