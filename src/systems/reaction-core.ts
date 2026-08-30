import { Rng } from '../core/rng';
import { INK_RGB, PAPER_RGB } from '../core/palette';

/**
 * PL. 02 — Gray–Scott reaction–diffusion, the simulation itself.
 *
 *   A' = A + (Da·∇²A − A·B² + f·(1 − A)) · dt
 *   B' = B + (Db·∇²B + A·B² − (k + f)·B) · dt
 *
 * Kept free of DOM and worker plumbing so the identical code runs in the
 * worker (for the live plate) and synchronously on the main thread (for a
 * deterministic print export run to convergence).
 */

export const SEED_PATTERNS = ['center', 'grid', 'scatter', 'ring', 'line'] as const;
export type SeedPatternName = (typeof SEED_PATTERNS)[number];

/** 9-point Laplacian stencil. Orthogonals 0.2, diagonals 0.05, center -1. */
const W_ORTHO = 0.2;
const W_DIAG = 0.05;

export class GrayScott {
  readonly size: number;
  private a: Float32Array;
  private b: Float32Array;
  private a2: Float32Array;
  private b2: Float32Array;
  private rng: Rng;
  private seed: number;

  constructor(size: number, seed: number, pattern: number) {
    this.size = size;
    const n = size * size;
    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
    this.a2 = new Float32Array(n);
    this.b2 = new Float32Array(n);
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed ^ 0x2b71);
    this.seedPattern(pattern);
  }

  /** Initial B placement. Everything stochastic here comes from the seed. */
  seedPattern(pattern: number): void {
    const { size } = this;
    this.a.fill(1);
    this.b.fill(0);
    this.rng = new Rng(this.seed ^ 0x2b71);

    const name = SEED_PATTERNS[Math.max(0, Math.min(SEED_PATTERNS.length - 1, pattern))];
    const r = Math.max(3, Math.round(size * 0.035));

    switch (name) {
      case 'center':
        this.inject(size / 2, size / 2, r * 2);
        break;
      case 'grid': {
        const cells = 4;
        for (let gy = 0; gy < cells; gy++) {
          for (let gx = 0; gx < cells; gx++) {
            const cx = ((gx + 0.5) / cells) * size;
            const cy = ((gy + 0.5) / cells) * size;
            this.inject(cx, cy, r);
          }
        }
        break;
      }
      case 'scatter': {
        const n = 18;
        for (let i = 0; i < n; i++) {
          this.inject(this.rng.float() * size, this.rng.float() * size, r);
        }
        break;
      }
      case 'ring': {
        const n = 16;
        const rad = size * 0.3;
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2;
          this.inject(size / 2 + Math.cos(t) * rad, size / 2 + Math.sin(t) * rad, r * 0.8);
        }
        break;
      }
      case 'line': {
        const n = 24;
        for (let i = 0; i < n; i++) {
          this.inject(((i + 0.5) / n) * size, size / 2, r * 0.7);
        }
        break;
      }
    }
  }

  /** A drop of chemical B. Onsets use this to bloom new structure mid-run. */
  inject(cx: number, cy: number, radius: number): void {
    const { size, b } = this;
    const r2 = radius * radius;
    const x0 = Math.floor(cx - radius);
    const x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius);
    const y1 = Math.ceil(cy + radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const wx = ((x % size) + size) % size;
        const wy = ((y % size) + size) % size;
        b[wy * size + wx] = 1;
      }
    }
  }

  /**
   * Advance `iterations` steps. The grid wraps (toroidal) — a plate with hard
   * edges grows a border artifact that reads as a rendering bug rather than
   * as part of the chemistry.
   */
  iterate(feed: number, kill: number, db: number, iterations: number, da = 1.0, dt = 1.0): void {
    const { size } = this;
    for (let it = 0; it < iterations; it++) {
      const { a, b, a2, b2 } = this;
      for (let y = 0; y < size; y++) {
        const yUp = ((y - 1 + size) % size) * size;
        const yDn = ((y + 1) % size) * size;
        const yMid = y * size;
        for (let x = 0; x < size; x++) {
          const xL = (x - 1 + size) % size;
          const xR = (x + 1) % size;
          const i = yMid + x;

          const lapA =
            (a[yMid + xL] + a[yMid + xR] + a[yUp + x] + a[yDn + x]) * W_ORTHO +
            (a[yUp + xL] + a[yUp + xR] + a[yDn + xL] + a[yDn + xR]) * W_DIAG -
            a[i];
          const lapB =
            (b[yMid + xL] + b[yMid + xR] + b[yUp + x] + b[yDn + x]) * W_ORTHO +
            (b[yUp + xL] + b[yUp + xR] + b[yDn + xL] + b[yDn + xR]) * W_DIAG -
            b[i];

          const av = a[i];
          const bv = b[i];
          const abb = av * bv * bv;

          let na = av + (da * lapA - abb + feed * (1 - av)) * dt;
          let nb = bv + (db * lapB + abb - (kill + feed) * bv) * dt;

          a2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
          b2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
        }
      }
      this.a = a2;
      this.b = b2;
      this.a2 = a;
      this.b2 = b;
    }
  }

  /** Paint A − B into RGBA as a paper -> ink lerp. Ink where B dominates. */
  paint(out: Uint8ClampedArray): void {
    const { a, b } = this;
    const n = a.length;
    for (let i = 0; i < n; i++) {
      let v = a[i] - b[i];
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const o = i << 2;
      out[o] = INK_RGB[0] + (PAPER_RGB[0] - INK_RGB[0]) * v;
      out[o + 1] = INK_RGB[1] + (PAPER_RGB[1] - INK_RGB[1]) * v;
      out[o + 2] = INK_RGB[2] + (PAPER_RGB[2] - INK_RGB[2]) * v;
      out[o + 3] = 255;
    }
  }
}
