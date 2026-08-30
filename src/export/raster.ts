import { PALETTE } from '../core/palette';
import type { Driver, Params, PlateEntry, System } from '../core/types';
import { SYSTEMS, sanitizeParams } from '../systems';
import { createSimpleDriver } from '../drivers';
import { Mapping } from '../audio/mapping';
import { metadataLines } from './metadata';
import { get2d, makeCanvas } from '../systems/flow-field';

/**
 * Print-resolution raster export.
 *
 * The plate is *re-simulated* offscreen rather than upscaled: low-alpha
 * accumulation carries almost no information per pixel, so scaling the screen
 * canvas up gives a muddy, softened smear. Re-running the rule at the target
 * resolution gives real hairlines and real density.
 *
 * A metadata footer is composited beneath the plate so the file carries its own
 * entry.
 */

export interface RasterOptions {
  /** Plate edge in pixels. The long edge of the file is this plus margins. */
  size?: number;
  /** Simulation frames. Defaults to the system's settle count, scaled up for print. */
  frames?: number;
  /** Multiplies particle count / points-per-frame / grid resolution. */
  densityScale?: number;
  footer?: boolean;
  /**
   * A driver for audio entries. For `audio-offline` this reproduces the track
   * frame by frame up to the captured moment.
   */
  driver?: Driver;
  /** Live-audio plates can't be re-simulated; the on-screen canvas is the record. */
  snapshot?: HTMLCanvasElement | null;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}

export const PRINT_LONG_EDGE = 4000;

export async function renderEntryToCanvas(
  entry: PlateEntry,
  opts: RasterOptions = {},
): Promise<HTMLCanvasElement> {
  const size = Math.round(opts.size ?? PRINT_LONG_EDGE);
  const margin = Math.round(size * 0.055);
  const withFooter = opts.footer !== false;
  const footerHeight = withFooter ? Math.round(size * 0.115) : Math.round(margin * 0.6);

  const plate = await renderPlateSurface(entry, size, opts);

  const canvas = document.createElement('canvas');
  canvas.width = size + margin * 2;
  canvas.height = size + margin + footerHeight;
  const ctx = get2d(canvas) as CanvasRenderingContext2D;

  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(plate, margin, margin, size, size);

  // The plate's hairline border, scaled so it stays a hairline in print.
  ctx.strokeStyle = PALETTE.paperEdge;
  ctx.lineWidth = Math.max(1, size / 1440);
  ctx.strokeRect(margin + 0.5, margin + 0.5, size - 1, size - 1);

  if (withFooter) drawFooter(ctx, entry, margin, margin + size, size, footerHeight);

  return canvas;
}

export async function renderEntryToBlob(
  entry: PlateEntry,
  opts: RasterOptions = {},
): Promise<Blob> {
  const canvas = await renderEntryToCanvas(entry, opts);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the plate as PNG.'));
    }, 'image/png');
  });
}

/**
 * Runs the rule at export resolution and returns the bare plate.
 * Also used by the catalogue to bake settled thumbnails.
 */
export async function renderPlateSurface(
  entry: PlateEntry,
  size: number,
  opts: RasterOptions = {},
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const def = SYSTEMS[entry.system];

  // A live-audio plate is a performance: there is no timeline to replay, so
  // the on-screen accumulation is the only truthful source.
  if (entry.driver === 'audio-live' && opts.snapshot) {
    const surface = makeCanvas(size, size);
    const sctx = get2d(surface);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(opts.snapshot, 0, 0, size, size);
    return surface;
  }

  const density = opts.densityScale ?? Math.max(1, size / 720);
  const params = printParams(entry, density);
  const system = def.create(entry.seed, size, { sync: true });
  system.reset(entry.seed);

  const driver =
    opts.driver ??
    (entry.driver === 'audio-live' || entry.driver === 'audio-offline'
      ? createSimpleDriver('static', entry.seed)
      : createSimpleDriver(entry.driver, entry.seed));

  const mapping = new Mapping();
  const rows = entry.mapping ?? [];

  const frames = resolveFrames(entry, def.settleFrames, opts);
  const yieldEvery = Math.max(1, Math.floor(frames / 60));

  for (let f = 0; f < frames; f++) {
    if (opts.signal?.aborted) throw new Error('Export cancelled.');
    const t = f / 60;
    const features = driver.tick(t);
    const resolved = features.length
      ? mapping.apply(rows, features, driver.featureNames, params, def.schema)
      : params;
    system.step(resolved);

    if (f % yieldEvery === 0) {
      opts.onProgress?.(f / frames);
      await nextTick();
    }
  }
  opts.onProgress?.(1);

  const surface = makeCanvas(size, size);
  const sctx = get2d(surface);
  system.renderTo(sctx, 1);
  system.dispose?.();
  return surface;
}

/**
 * Print density. Screen defaults are tuned for a 720px plate; at 4000px the
 * same particle count would read as a sparse scribble, so population and grid
 * resolution scale with the plate.
 */
export function printParams(entry: PlateEntry, density: number): Params {
  const params = { ...sanitizeParams(entry.system, entry.params) };
  switch (entry.system) {
    case 'flow-field':
      // Below the reference size this scales *down* too, which is what keeps a
      // 220px specimen reading as the same drawing rather than a solid mat.
      params.count = Math.max(60, Math.round(params.count * Math.min(4, density)));
      break;
    case 'attractor':
      params.pointsPerFrame = Math.max(400, Math.round(params.pointsPerFrame * Math.min(6, density)));
      break;
    case 'reaction':
      // The grid *is* the resolution here — a bigger grid run to convergence,
      // not the same grid upscaled. It never shrinks: coarsening the chemistry
      // for a thumbnail would show a different pattern, not a smaller one.
      params.gridSize = Math.min(
        400,
        Math.round(params.gridSize * Math.max(1, Math.min(2.5, density))),
      );
      break;
  }
  return params;
}

function resolveFrames(entry: PlateEntry, settle: number, opts: RasterOptions): number {
  if (opts.frames) return Math.max(1, Math.round(opts.frames));
  if (entry.driver === 'audio-offline' && typeof entry.frame === 'number') {
    // Reproduce the track up to the captured moment: the still is a portrait
    // of everything that happened before it.
    return Math.max(1, Math.round(entry.frame) + 1);
  }
  return settle;
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  entry: PlateEntry,
  x: number,
  top: number,
  size: number,
  height: number,
): void {
  const lines = metadataLines(entry);
  const fontSize = Math.max(9, Math.round(size * 0.0135));
  const lineHeight = Math.round(fontSize * 1.85);
  const sans = `${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`;

  ctx.save();
  ctx.font = sans;
  ctx.textBaseline = 'top';
  // `letterSpacing` is well supported but still missing from some DOM typings.
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
    `${(fontSize * 0.05).toFixed(2)}px`;

  let y = top + Math.round(height * 0.24);
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? PALETTE.ink : PALETTE.caption;
    ctx.fillText(fit(ctx, line, size), x, y);
    y += lineHeight;
  });
  ctx.restore();
}

/** Metadata should never overrun the plate's width — truncate rather than wrap. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export type { System };
