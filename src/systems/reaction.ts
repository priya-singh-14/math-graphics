import { PALETTE } from '../core/palette';
import type { ParamSchema, Params, System } from '../core/types';
import { get2d, makeCanvas } from './flow-field';
import { GrayScott, SEED_PATTERNS } from './reaction-core';
import type { ReactionFrame, ReactionRequest } from '../workers/reaction.worker';

/**
 * PL. 02 — Reaction–diffusion, the plate.
 *
 * The simulation lives in a worker; this class is the System facade the rest of
 * the archive talks to. The live plate is therefore one frame behind the
 * request that produced it, which is invisible at RD's timescale and is the
 * price of never blocking the main thread.
 *
 * In `sync` mode (used by the exporter) the same core runs inline and the
 * result is deterministic frame-for-frame.
 */

const REF_SIZE = 720;

export const reactionSchema: ParamSchema = [
  {
    key: 'feed',
    label: 'feed  f',
    min: 0.01,
    max: 0.09,
    step: 0.001,
    default: 0.037,
    decimals: 3,
    note: 'the primary axis',
  },
  {
    key: 'kill',
    label: 'kill  k',
    min: 0.045,
    max: 0.07,
    step: 0.0005,
    default: 0.062,
    decimals: 4,
    note: 'the secondary axis',
  },
  {
    key: 'Db',
    label: 'Db',
    min: 0.3,
    max: 0.6,
    step: 0.01,
    default: 0.5,
    decimals: 2,
    note: 'diffusion ratio',
  },
  {
    key: 'iterationsPerFrame',
    label: 'iterations / frame',
    min: 4,
    max: 16,
    step: 1,
    default: 8,
    note: 'sim speed',
    affectsMotion: true,
  },
  {
    key: 'gridSize',
    label: 'grid',
    min: 100,
    max: 300,
    step: 10,
    default: 160,
    note: 'resolution — perf-bound; changing it restarts the plate',
  },
  {
    key: 'seedPattern',
    label: 'seed pattern',
    min: 0,
    max: SEED_PATTERNS.length - 1,
    step: 1,
    default: 0,
    options: [...SEED_PATTERNS],
    note: 'initial B placement',
  },
  {
    key: 'smooth',
    label: 'render',
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    options: ['pixelated', 'bilinear'],
    note: 'crisp plate vs soft plate',
  },
];

export interface ReactionOptions {
  /** Run the sim inline instead of in a worker. The export path uses this. */
  sync?: boolean;
}

export class ReactionSystem implements System {
  readonly id = 'reaction' as const;
  readonly title = 'Reaction–diffusion';
  readonly paramSchema = reactionSchema;

  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D;
  private size = REF_SIZE;
  private seed = 0;

  private gridSize = 160;
  private pattern = 0;
  private smooth = false;

  private worker: Worker | null = null;
  private sync: boolean;
  private simInline: GrayScott | null = null;
  private pixels: Uint8ClampedArray<ArrayBuffer> | null = null;
  private returnBuffer: ArrayBuffer | null = null;

  private gen = 0;
  private pending = false;
  private drawn = false;
  private injects: Array<{ x: number; y: number; r: number }> = [];

  constructor(seed = 1, size = REF_SIZE, opts: ReactionOptions = {}) {
    this.sync = opts.sync === true || typeof Worker === 'undefined';
    this.size = size;
    this.canvas = makeCanvas(this.gridSize, this.gridSize);
    this.ctx = get2d(this.canvas);
    this.reset(seed);
  }

  get ready(): boolean {
    return this.drawn;
  }

  resize(size: number): void {
    // The grid is the real resolution; `size` only sets how large the plate is
    // drawn, so a resize never disturbs the running chemistry.
    this.size = size;
  }

  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.drawn = false;
    this.injects = [];
    this.initSim();
  }

  step(params: Params): void {
    const grid = clampGrid(params.gridSize ?? 160);
    const pattern = Math.round(params.seedPattern ?? 0);
    this.smooth = Math.round(params.smooth ?? 0) === 1;

    if (grid !== this.gridSize || pattern !== this.pattern) {
      this.gridSize = grid;
      this.pattern = pattern;
      this.initSim();
    }

    const feed = params.feed ?? 0.037;
    const kill = params.kill ?? 0.062;
    const db = params.Db ?? 0.5;
    const iterations = Math.max(1, Math.round(params.iterationsPerFrame ?? 8));

    const injects = this.injects;
    this.injects = [];

    if (this.sync) {
      const sim = this.simInline;
      if (!sim) return;
      for (const inj of injects) sim.inject(inj.x, inj.y, inj.r);
      sim.iterate(feed, kill, db, iterations);
      if (!this.pixels || this.pixels.length !== grid * grid * 4) {
        this.pixels = new Uint8ClampedArray(grid * grid * 4);
      }
      sim.paint(this.pixels);
      this.blit(this.pixels, grid);
      return;
    }

    if (this.pending) {
      // Hand the injects to the next request rather than dropping them.
      this.injects = injects.concat(this.injects);
      return;
    }
    this.pending = true;
    const msg: ReactionRequest = {
      type: 'step',
      feed,
      kill,
      db,
      iterations,
      injects: injects.length ? injects : undefined,
      buffer: this.returnBuffer ?? undefined,
    };
    const transfer = this.returnBuffer ? [this.returnBuffer] : [];
    this.returnBuffer = null;
    this.worker?.postMessage(msg, transfer);
  }

  /** An onset drops chemical B at a seeded location and lets it bloom. */
  injectSeed(x01: number, y01: number, radius01 = 0.03): void {
    this.injects.push({
      x: x01 * this.gridSize,
      y: y01 * this.gridSize,
      r: Math.max(2, radius01 * this.gridSize),
    });
  }

  renderTo(ctx: CanvasRenderingContext2D, scale: number): void {
    const dest = this.size * scale;
    ctx.imageSmoothingEnabled = this.smooth;
    if (this.smooth) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0, dest, dest);
    ctx.imageSmoothingEnabled = true;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private initSim(): void {
    this.gen++;
    this.pending = false;
    this.returnBuffer = null;

    if (this.canvas.width !== this.gridSize) {
      this.canvas = makeCanvas(this.gridSize, this.gridSize);
      this.ctx = get2d(this.canvas);
    }
    this.ctx.fillStyle = PALETTE.paper;
    this.ctx.fillRect(0, 0, this.gridSize, this.gridSize);

    if (this.sync) {
      this.simInline = new GrayScott(this.gridSize, this.seed, this.pattern);
      return;
    }

    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/reaction.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<ReactionFrame>) => this.onFrame(e.data);
    }
    const init: ReactionRequest = {
      type: 'init',
      size: this.gridSize,
      seed: this.seed,
      pattern: this.pattern,
      gen: this.gen,
    };
    this.worker.postMessage(init);
  }

  private onFrame(frame: ReactionFrame): void {
    this.pending = false;
    if (frame.gen !== this.gen || frame.size !== this.gridSize) return; // stale
    const px = new Uint8ClampedArray(frame.buffer);
    this.blit(px, frame.size);
    this.returnBuffer = frame.buffer;
  }

  private blit(px: Uint8ClampedArray<ArrayBuffer>, grid: number): void {
    const image = new ImageData(px, grid, grid);
    this.ctx.putImageData(image, 0, 0);
    this.drawn = true;
  }
}

function clampGrid(v: number): number {
  return Math.max(40, Math.min(400, Math.round(v)));
}
