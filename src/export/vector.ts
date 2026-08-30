import { PALETTE } from '../core/palette';
import type { Driver, PlateEntry, VectorScene } from '../core/types';
import { SYSTEMS } from '../systems';
import { createSimpleDriver } from '../drivers';
import { Mapping } from '../audio/mapping';
import { printParams } from './raster';
import { metadataLines } from './metadata';

/**
 * SVG export, for large-format print.
 *
 * The attractor and the flow field are pure geometry — points and polylines —
 * so they can leave the raster world entirely and print at any size. Files get
 * large (hundreds of thousands of marks), which is why this sits behind a
 * toggle rather than being the default. Reaction–diffusion is a grid of pixel
 * values and stays raster-only; there is no honest vector form of it.
 */

export interface VectorOptions {
  /** Simulation frames. Fewer than the raster path — every mark becomes markup. */
  frames?: number;
  size?: number;
  driver?: Driver;
  footer?: boolean;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}

export function supportsVector(entry: PlateEntry): boolean {
  return SYSTEMS[entry.system].vectorExport;
}

export async function renderEntryToSvg(
  entry: PlateEntry,
  opts: VectorOptions = {},
): Promise<string> {
  const def = SYSTEMS[entry.system];
  if (!def.vectorExport) {
    throw new Error(`${def.title} is a grid of values — it has no vector form.`);
  }

  const size = Math.round(opts.size ?? 1440);
  const frames = Math.max(1, Math.round(opts.frames ?? Math.min(def.settleFrames, 420)));
  const params = printParams(entry, 1);

  const system = def.create(entry.seed, size, { sync: true }) as ReturnType<
    typeof def.create
  > & { setVectorRecording?: (on: boolean) => void };
  system.setVectorRecording?.(true);
  system.reset(entry.seed);
  system.setVectorRecording?.(true);

  const driver =
    opts.driver ??
    (entry.driver === 'audio-live' || entry.driver === 'audio-offline'
      ? createSimpleDriver('static', entry.seed)
      : createSimpleDriver(entry.driver, entry.seed));
  const mapping = new Mapping();
  const rows = entry.mapping ?? [];

  const yieldEvery = Math.max(1, Math.floor(frames / 40));
  for (let f = 0; f < frames; f++) {
    if (opts.signal?.aborted) throw new Error('Export cancelled.');
    const features = driver.tick(f / 60);
    const resolved = features.length
      ? mapping.apply(rows, features, driver.featureNames, params, def.schema)
      : params;
    system.step(resolved);
    if (f % yieldEvery === 0) {
      opts.onProgress?.(f / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const scene = system.exportVector?.() ?? null;
  system.dispose?.();
  if (!scene) throw new Error('Nothing was recorded for vector export.');
  opts.onProgress?.(1);

  return sceneToSvg(scene, entry, opts.footer !== false);
}

function sceneToSvg(scene: VectorScene, entry: PlateEntry, withFooter: boolean): string {
  const size = scene.size;
  const margin = Math.round(size * 0.055);
  const footerHeight = withFooter ? Math.round(size * 0.115) : Math.round(margin * 0.6);
  const width = size + margin * 2;
  const height = size + margin + footerHeight;

  const body: string[] = [];
  body.push(`<rect width="${width}" height="${height}" fill="${PALETTE.paper}"/>`);
  body.push(
    `<rect x="${margin + 0.25}" y="${margin + 0.25}" width="${size - 0.5}" height="${size - 0.5}" fill="none" stroke="${PALETTE.paperEdge}" stroke-width="0.5"/>`,
  );

  body.push(
    `<g transform="translate(${margin} ${margin})" clip-path="url(#plate)" fill="${PALETTE.ink}" stroke="${PALETTE.ink}">`,
  );

  if (scene.polylines?.length) {
    body.push(
      `<g fill="none" stroke-width="${trim(scene.strokeWidth)}" stroke-opacity="${trim(scene.opacity)}" stroke-linecap="round">`,
    );
    for (const line of scene.polylines) {
      body.push(`<path d="${polylineToPath(line)}"/>`);
    }
    body.push('</g>');
  }

  if (scene.points?.length) {
    const r = trim(scene.strokeWidth / 2);
    body.push(`<g stroke="none" fill-opacity="${trim(scene.opacity)}">`);
    const pts = scene.points;
    for (let i = 0; i < pts.length; i += 2) {
      body.push(`<circle cx="${trim(pts[i])}" cy="${trim(pts[i + 1])}" r="${r}"/>`);
    }
    body.push('</g>');
  }

  body.push('</g>');

  if (withFooter) {
    const fontSize = Math.max(9, Math.round(size * 0.0135));
    const lineHeight = Math.round(fontSize * 1.85);
    let y = size + margin + Math.round(footerHeight * 0.24) + fontSize;
    metadataLines(entry).forEach((line, i) => {
      body.push(
        `<text x="${margin}" y="${y}" font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif" font-size="${fontSize}" letter-spacing="${trim(fontSize * 0.05)}" fill="${i === 0 ? PALETTE.ink : PALETTE.caption}">${escapeXml(line)}</text>`,
      );
      y += lineHeight;
    });
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><clipPath id="plate"><rect width="${size}" height="${size}"/></clipPath></defs>`,
    `<title>${escapeXml(`${SYSTEMS[entry.system].plate} ${SYSTEMS[entry.system].caption} seed ${entry.seed}`)}</title>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

function polylineToPath(line: Float32Array): string {
  let d = `M${trim(line[0])} ${trim(line[1])}`;
  for (let i = 2; i < line.length; i += 2) d += `L${trim(line[i])} ${trim(line[i + 1])}`;
  return d;
}

/** Two decimals is well below print resolution and roughly halves file size. */
function trim(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}
