/** Seeded, deterministic randomness. Never use Math.random in the data engine. */

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: uniform [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  uniform(): number;
  normal(): number;
  /** Gamma(shape, scale=1). */
  gamma(shape: number): number;
}

export function makeRng(seedKey: string): Rng {
  const u = mulberry32(hashString(seedKey));
  const uniform = () => {
    const v = u();
    return v <= 1e-12 ? 1e-12 : v;
  };
  const normal = () => {
    // Box-Muller (one value per call keeps the stream simple and deterministic).
    const a = uniform();
    const b = uniform();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  const gamma = (shape: number): number => {
    if (shape < 1) {
      const g = gamma(shape + 1);
      return g * Math.pow(uniform(), 1 / shape);
    }
    // Marsaglia-Tsang
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 64; i++) {
      const x = normal();
      const v0 = 1 + c * x;
      if (v0 <= 0) continue;
      const v = v0 * v0 * v0;
      const uu = uniform();
      if (Math.log(uu) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
    return shape;
  };
  return { uniform, normal, gamma };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Linear ramp: 0 at `zeroAt`, 1 at `oneAt` (works in both directions), clamped. */
export function ramp(v: number, zeroAt: number, oneAt: number): number {
  if (oneAt === zeroAt) return v >= oneAt ? 1 : 0;
  return clamp((v - zeroAt) / (oneAt - zeroAt), 0, 1);
}
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const r3 = (n: number) => Math.round(n * 1000) / 1000;
