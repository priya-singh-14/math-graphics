import { Noise2D, Rng } from '../core/rng';
import { inkAlpha, paperAlpha, PALETTE } from '../core/palette';
import type { ParamSchema, Params, System, VectorScene } from '../core/types';

/**
 * PL. 01 — Flow field.
 *
 * The rule: read a seeded Perlin field as an angle at every point, step
 * particles along the local angle, and let faint trails accumulate. The
 * structure of the field emerges as line density over time rather than being
 * drawn directly — the image is a record of the rule, not a picture of it.
 *
 *   angle(x, y, t) = noise(x·s, y·s + t) · 2π · turns
 *   p' = p + (cos angle, sin angle) · step
 */

/**
 * Parameters are authored against a 720px plate. Everything spatial is scaled
 * from this reference so a 4000px export reproduces the on-screen composition
 * instead of a zoomed-in crop of it.
 */
const REF_SIZE = 720;

const MAX_VECTOR_POINTS = 240_000;

export const flowFieldSchema: ParamSchema = [
  {
    key: 'noiseScale',
    label: 'noise scale',
    min: 0.002,
    max: 0.02,
    step: 0.0005,
    default: 0.008,
    decimals: 4,
    note: 'field granularity',
  },
  { key: 'octaves', label: 'octaves', min: 1, max: 4, step: 1, default: 1, note: 'fractal detail' },
  {
    key: 'turns',
    label: 'turns',
    min: 1,
    max: 6,
    step: 0.1,
    default: 4,
    decimals: 1,
    note: 'angular multiplier — curl intensity',
  },
  {
    key: 'step',
    label: 'step',
    min: 0.5,
    max: 2.5,
    step: 0.05,
    default: 1.1,
    decimals: 2,
    note: 'particle speed',
  },
  { key: 'count', label: 'count', min: 100, max: 2000, step: 10, default: 700, note: 'population' },
  {
    key: 'trailAlpha',
    label: 'trail alpha',
    min: 0.04,
    max: 0.15,
    step: 0.005,
    default: 0.1,
    decimals: 3,
    note: 'accumulation weight',
  },
  {
    key: 'resetEvery',
    label: 'wash every',
    min: 120,
    max: 2400,
    step: 30,
    default: 900,
    note: 'soft paper wash cadence, in frames',
  },
  {
    key: 'drift',
    label: 'drift',
    min: 0,
    max: 0.02,
    step: 0.0005,
    default: 0.0015,
    decimals: 4,
    note: 'noise z-drift per frame',
    affectsMotion: true,
  },
];

interface VectorRecord {
  lines: Float32Array[];
  points: number;
}

export class FlowFieldSystem implements System {
  readonly id = 'flow-field' as const;
  readonly title = 'Flow field';
  readonly paramSchema = flowFieldSchema;

  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D;
  private size = REF_SIZE;
  private noise: Noise2D;
  private rng: Rng;
  private seed = 0;

  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private age = new Int32Array(0);
  private life = new Int32Array(0);
  private count = 0;

  private t = 0;
  private frame = 0;
  private drawn = false;

  /** SVG export only: the exporter re-simulates with recording on. */
  private recordVector = false;
  private record: VectorRecord = { lines: [], points: 0 };
  private trails: number[][] = [];

  constructor(seed = 1, size = REF_SIZE) {
    this.canvas = makeCanvas(size, size);
    this.ctx = get2d(this.canvas);
    this.size = size;
    this.noise = new Noise2D(seed);
    this.rng = new Rng(seed);
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
    this.noise = new Noise2D(this.seed);
    this.rng = new Rng(this.seed ^ 0x5f3a);
    this.t = 0;
    this.frame = 0;
    this.drawn = false;
    this.record = { lines: [], points: 0 };
    this.trails = [];
    this.count = 0;
    this.x = new Float32Array(0);
    this.y = new Float32Array(0);
    this.age = new Int32Array(0);
    this.life = new Int32Array(0);
    this.ctx.fillStyle = PALETTE.paper;
    this.ctx.fillRect(0, 0, this.size, this.size);
  }

  step(params: Params): void {
    const size = this.size;
    const toRef = REF_SIZE / size; // buffer px -> reference px
    const fromRef = size / REF_SIZE;

    const count = Math.max(1, Math.round(params.count ?? 700));
    if (count !== this.count) this.setCount(count);

    const s = params.noiseScale ?? 0.008;
    const octaves = Math.max(1, Math.round(params.octaves ?? 1));
    const turns = params.turns ?? 4;
    const stepLen = (params.step ?? 1.1) * fromRef;
    const trailAlpha = params.trailAlpha ?? 0.1;
    const resetEvery = Math.max(1, Math.round(params.resetEvery ?? 900));
    const drift = params.drift ?? 0.0015;

    this.t += drift;
    this.frame++;

    const ctx = this.ctx;
    ctx.strokeStyle = inkAlpha(trailAlpha);
    ctx.lineWidth = Math.max(0.5, 0.5 * fromRef);
    ctx.lineCap = 'round';
    ctx.beginPath();

    // One path for the whole population, one stroke per frame.
    for (let i = 0; i < this.count; i++) {
      const px = this.x[i];
      const py = this.y[i];
      const angle =
        this.noise.fbm(px * toRef * s, py * toRef * s + this.t, octaves) * Math.PI * 2 * turns;
      const nx = px + Math.cos(angle) * stepLen;
      const ny = py + Math.sin(angle) * stepLen;

      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);

      if (this.recordVector) this.recordSegment(i, px, py, nx, ny);

      this.x[i] = nx;
      this.y[i] = ny;
      this.age[i]++;

      const dead =
        this.age[i] > this.life[i] || nx < 0 || ny < 0 || nx >= size || ny >= size;
      if (dead) this.respawn(i);
    }

    ctx.stroke();
    this.drawn = true;

    // Periodic soft wash: keeps density from saturating to a solid block and
    // gives the topographic, woodgrain reading.
    if (this.frame % resetEvery === 0) {
      ctx.fillStyle = paperAlpha(0.55);
      ctx.fillRect(0, 0, size, size);
    }
  }

  /** An onset can ask for a seeded burst of respawns — a jolt, not a reset. */
  respawnBurst(fraction: number): void {
    const n = Math.min(this.count, Math.round(this.count * Math.max(0, Math.min(1, fraction))));
    for (let k = 0; k < n; k++) this.respawn(this.rng.int(this.count));
  }

  renderTo(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0, this.size * scale, this.size * scale);
  }

  exportVector(): VectorScene | null {
    this.flushTrails();
    if (!this.record.lines.length) return null;
    return {
      size: this.size,
      polylines: this.record.lines,
      strokeWidth: 0.5 * (this.size / REF_SIZE),
      opacity: 0.1,
    };
  }

  private setCount(next: number): void {
    const prev = this.count;
    const x = new Float32Array(next);
    const y = new Float32Array(next);
    const age = new Int32Array(next);
    const life = new Int32Array(next);
    const keep = Math.min(prev, next);
    x.set(this.x.subarray(0, keep));
    y.set(this.y.subarray(0, keep));
    age.set(this.age.subarray(0, keep));
    life.set(this.life.subarray(0, keep));
    this.x = x;
    this.y = y;
    this.age = age;
    this.life = life;
    this.count = next;
    if (this.recordVector) this.trails.length = next;
    for (let i = keep; i < next; i++) this.respawn(i);
  }

  private respawn(i: number): void {
    if (this.recordVector) this.closeTrail(i);
    this.x[i] = this.rng.float() * this.size;
    this.y[i] = this.rng.float() * this.size;
    this.age[i] = 0;
    this.life[i] = 60 + this.rng.int(220);
  }

  private recordSegment(i: number, px: number, py: number, nx: number, ny: number): void {
    if (this.record.points >= MAX_VECTOR_POINTS) return;
    let trail = this.trails[i];
    if (!trail) {
      trail = [px, py];
      this.trails[i] = trail;
      this.record.points++;
    }
    trail.push(nx, ny);
    this.record.points++;
  }

  private closeTrail(i: number): void {
    const trail = this.trails[i];
    if (trail && trail.length >= 4) this.record.lines.push(Float32Array.from(trail));
    this.trails[i] = undefined as unknown as number[];
  }

  private flushTrails(): void {
    for (let i = 0; i < this.trails.length; i++) this.closeTrail(i);
  }
}

/* Small canvas helpers, shared shape with the other systems. */

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function get2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D {
  const ctx = (c as HTMLCanvasElement).getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx as CanvasRenderingContext2D;
}
