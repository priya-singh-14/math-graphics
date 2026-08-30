import { Rng } from '../core/rng';
import { inkAlpha, paperAlpha, PALETTE } from '../core/palette';
import type { ParamSchema, Params, System, VectorScene } from '../core/types';
import { get2d, makeCanvas } from './flow-field';

/**
 * PL. 03 — Strange attractor (de Jong).
 *
 *   x' = sin(a·y) − cos(b·x)
 *   y' = sin(c·x) − cos(d·y)
 *
 * Four numbers, two trigonometric recurrences. Iterated a few hundred thousand
 * times and plotted at very low opacity, the density of landing points — not
 * any individual point — is the image: smoke-like filamentary structure.
 *
 * Clifford and Lorenz are drop-in alternates behind the same interface; de Jong
 * is the default because its (a,b,c,d) space is the most legible as a catalogue.
 */

const REF_SIZE = 720;
const MAX_VECTOR_POINTS = 300_000;
const WARMUP_ITERATIONS = 1000;

export const attractorSchema: ParamSchema = [
  { key: 'a', label: 'a', min: -3, max: 3, step: 0.01, default: -2.0, decimals: 2 },
  { key: 'b', label: 'b', min: -3, max: 3, step: 0.01, default: -2.0, decimals: 2 },
  { key: 'c', label: 'c', min: -3, max: 3, step: 0.01, default: -1.2, decimals: 2 },
  { key: 'd', label: 'd', min: 1, max: 3, step: 0.01, default: 2.0, decimals: 2 },
  {
    key: 'pointsPerFrame',
    label: 'points / frame',
    min: 1000,
    max: 5000,
    step: 100,
    default: 2200,
    note: 'density build rate',
  },
  {
    key: 'pointAlpha',
    label: 'point alpha',
    min: 0.03,
    max: 0.1,
    step: 0.005,
    default: 0.06,
    decimals: 3,
  },
  {
    key: 'scale',
    label: 'scale',
    min: 0.12,
    max: 0.4,
    step: 0.005,
    default: 0.24,
    decimals: 3,
    note: 'fraction of plate',
  },
  {
    key: 'washEvery',
    label: 'wash every',
    min: 120,
    max: 2400,
    step: 30,
    default: 720,
    note: 'soft wash cadence, in frames — lets slow morphs breathe',
    affectsMotion: true,
  },
];

export class AttractorSystem implements System {
  readonly id = 'attractor' as const;
  readonly title = 'Strange attractor';
  readonly paramSchema = attractorSchema;

  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D;
  private size = REF_SIZE;
  private seed = 0;

  private px = 0;
  private py = 0;
  private frame = 0;
  private drawn = false;
  private lastParams: Params | null = null;

  private recordVector = false;
  private recorded: number[] = [];

  constructor(seed = 1, size = REF_SIZE) {
    this.canvas = makeCanvas(size, size);
    this.ctx = get2d(this.canvas);
    this.size = size;
    this.reset(seed);
  }

  get ready(): boolean {
    return this.drawn;
  }

  setVectorRecording(on: boolean): void {
    this.recordVector = on;
  }

  resize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.canvas = makeCanvas(size, size);
    this.ctx = get2d(this.canvas);
    this.reset(this.seed);
  }

  reset(seed: number): void {
    this.seed = seed >>> 0;
    const rng = new Rng(this.seed ^ 0x1d0b);
    // The starting point is seeded but arbitrary — the attractor forgets it
    // after the warm-up. It matters only for exact reproducibility.
    this.px = rng.range(-0.5, 0.5);
    this.py = rng.range(-0.5, 0.5);
    this.frame = 0;
    this.drawn = false;
    this.recorded = [];
    this.lastParams = null;
    this.ctx.fillStyle = PALETTE.paper;
    this.ctx.fillRect(0, 0, this.size, this.size);
  }

  step(params: Params): void {
    const a = params.a ?? -2;
    const b = params.b ?? -2;
    const c = params.c ?? -1.2;
    const d = params.d ?? 2;
    const n = Math.max(1, Math.round(params.pointsPerFrame ?? 2200));
    const alpha = params.pointAlpha ?? 0.06;
    const scale = params.scale ?? 0.24;
    const washEvery = Math.max(1, Math.round(params.washEvery ?? 720));

    const size = this.size;
    const half = size / 2;
    const k = scale * size;
    const dot = Math.max(1, Math.round(size / REF_SIZE));

    // Re-settle onto the attractor whenever the parameters move, so a morphing
    // driver never plots the transient tail of the previous form.
    if (this.needsWarmup(a, b, c, d)) {
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const nx = Math.sin(a * this.py) - Math.cos(b * this.px);
        const ny = Math.sin(c * this.px) - Math.cos(d * this.py);
        this.px = nx;
        this.py = ny;
      }
      this.lastParams = { a, b, c, d };
    }

    const ctx = this.ctx;
    ctx.fillStyle = inkAlpha(alpha);
    ctx.beginPath();

    for (let i = 0; i < n; i++) {
      const nx = Math.sin(a * this.py) - Math.cos(b * this.px);
      const ny = Math.sin(c * this.px) - Math.cos(d * this.py);
      this.px = nx;
      this.py = ny;

      const sx = half + nx * k;
      const sy = half + ny * k;
      ctx.rect(sx, sy, dot, dot);

      if (this.recordVector && this.recorded.length < MAX_VECTOR_POINTS * 2) {
        this.recorded.push(sx, sy);
      }
    }

    ctx.fill(); // one fill for the whole frame's population
    this.drawn = true;
    this.frame++;

    if (this.frame % washEvery === 0) {
      ctx.fillStyle = paperAlpha(0.5);
      ctx.fillRect(0, 0, size, size);
    }
  }

  renderTo(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0, this.size * scale, this.size * scale);
  }

  exportVector(): VectorScene | null {
    if (!this.recorded.length) return null;
    return {
      size: this.size,
      points: Float32Array.from(this.recorded),
      strokeWidth: Math.max(1, this.size / REF_SIZE),
      opacity: 0.06,
    };
  }

  private needsWarmup(a: number, b: number, c: number, d: number): boolean {
    const prev = this.lastParams;
    if (!prev) return true;
    return prev.a !== a || prev.b !== b || prev.c !== c || prev.d !== d;
  }
}
