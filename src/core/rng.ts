/**
 * Seedable randomness. No `Math.random()` is allowed anywhere inside a system —
 * every stochastic decision (particle spawns, chemical seed points, attractor
 * start) flows from here so a seed fully determines the plate.
 */

/** mulberry32 — small, fast, good enough for spatial scatter. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }

  /** 0..1 */
  float(): number {
    return this.next();
  }

  /** min..max */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % n;
  }

  /** Standard normal, Box–Muller. Useful for softer particle scatter. */
  gaussian(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** A fresh sub-generator, so independent concerns don't share a stream. */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.seed ^ salt, 0x9e3779b1) >>> 0) ^ (salt >>> 0));
  }
}

/** A 32-bit seed derived from a string — used for audio file hashes and titles. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** A new seed for the dice button. This is the one place entropy is welcome. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    return buf[0] % 100000;
  }
  return Math.floor(Math.random() * 100000);
}

/* ------------------------------------------------------------------ */
/* Seeded value/Perlin noise — the flow field's vector source.          */
/* ------------------------------------------------------------------ */

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 2D Perlin noise over a seeded permutation table. The flow field reads
 * `noise(x*s, y*s + t)` as an angle, so drifting `t` walks the field through
 * a continuous slice of the same seeded landscape.
 */
export class Noise2D {
  private perm: Uint8Array;
  private gradX: Float32Array;
  private gradY: Float32Array;

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];

    // 8 gradient directions, evenly spaced on the unit circle.
    this.gradX = new Float32Array(8);
    this.gradY = new Float32Array(8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.gradX[i] = Math.cos(a);
      this.gradY[i] = Math.sin(a);
    }
  }

  private dot(hash: number, x: number, y: number): number {
    const h = hash & 7;
    return this.gradX[h] * x + this.gradY[h] * y;
  }

  /** Returns roughly -1..1. */
  noise(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = lerp(this.dot(aa, xf, yf), this.dot(ba, xf - 1, yf), u);
    const x2 = lerp(this.dot(ab, xf, yf - 1), this.dot(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.4142;
  }

  /** Fractal sum. `octaves` of 1 is the plain field; more adds fine texture. */
  fbm(x: number, y: number, octaves: number): number {
    if (octaves <= 1) return this.noise(x, y);
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
