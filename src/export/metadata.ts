import type { DriverId, MappingRow, Params, PlateEntry, SystemId } from '../core/types';
import { provenanceOf } from '../core/types';
import { SYSTEMS, defaultParams, sanitizeParams } from '../systems';

/**
 * The provenance record.
 *
 * An entry is the whole plate: system, seed, params, driver, mapping, moment.
 * It round-trips through a URL (the citation) and through a `.json` sidecar
 * (the archive's record), and it names the file it produced.
 */

const VALID_SYSTEMS: SystemId[] = ['flow-field', 'reaction', 'attractor'];
const VALID_DRIVERS: DriverId[] = ['static', 'lfo', 'time', 'audio-live', 'audio-offline'];

export function makeEntry(init: Partial<PlateEntry> & { system: SystemId }): PlateEntry {
  const system = init.system;
  return {
    system,
    seed: init.seed ?? 1,
    params: sanitizeParams(system, init.params ?? defaultParams(system)),
    driver: init.driver ?? 'static',
    audioRef: init.audioRef,
    mapping: init.mapping,
    frame: init.frame,
    createdAt: init.createdAt ?? new Date().toISOString(),
    title: init.title,
  };
}

/* ------------------------------------------------------------------ */
/* URL codec — the citation mechanism.                                  */
/* ------------------------------------------------------------------ */

export function encodeEntry(entry: PlateEntry): URLSearchParams {
  const q = new URLSearchParams();
  q.set('sys', entry.system);
  q.set('seed', String(entry.seed));
  q.set('drv', entry.driver);

  // Only params that differ from the schema default travel, so a URL stays
  // readable and a later default change doesn't silently rewrite old plates
  // that never touched that control.
  const defaults = defaultParams(entry.system);
  for (const [key, value] of Object.entries(entry.params)) {
    if (defaults[key] === value) continue;
    q.append('p', `${key}:${round(value)}`);
  }

  if (entry.mapping?.length) {
    for (const row of entry.mapping) {
      if (row.enabled === false) continue;
      q.append(
        'm',
        [row.source, row.target, round(row.gain), round(row.offset), round(row.smoothing)].join(':'),
      );
    }
  }
  if (entry.audioRef) q.set('audio', entry.audioRef);
  if (typeof entry.frame === 'number') q.set('frame', String(Math.round(entry.frame)));
  if (entry.title) q.set('title', entry.title);
  return q;
}

export function decodeEntry(q: URLSearchParams): PlateEntry | null {
  const sys = q.get('sys');
  if (!sys || !VALID_SYSTEMS.includes(sys as SystemId)) return null;
  const system = sys as SystemId;

  const seedRaw = Number(q.get('seed'));
  const seed = Number.isFinite(seedRaw) ? Math.abs(Math.floor(seedRaw)) : 1;

  const params: Params = { ...defaultParams(system) };
  for (const raw of q.getAll('p')) {
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const key = raw.slice(0, idx);
    const value = Number(raw.slice(idx + 1));
    if (Number.isFinite(value)) params[key] = value;
  }

  const drvRaw = q.get('drv');
  const driver: DriverId = VALID_DRIVERS.includes(drvRaw as DriverId)
    ? (drvRaw as DriverId)
    : 'static';

  const mapping: MappingRow[] = [];
  for (const raw of q.getAll('m')) {
    const [source, target, gain, offset, smoothing] = raw.split(':');
    if (!source || !target) continue;
    mapping.push({
      source,
      target,
      gain: numberOr(gain, 1),
      offset: numberOr(offset, 0),
      smoothing: numberOr(smoothing, 0.9),
      enabled: true,
    });
  }

  const frameRaw = Number(q.get('frame'));

  return makeEntry({
    system,
    seed,
    params,
    driver,
    mapping: mapping.length ? mapping : undefined,
    audioRef: q.get('audio') ?? undefined,
    frame: Number.isFinite(frameRaw) ? frameRaw : undefined,
    title: q.get('title') ?? undefined,
  });
}

export function entryUrl(entry: PlateEntry, base = location.href): string {
  const url = new URL(base);
  url.search = encodeEntry(entry).toString();
  url.hash = '';
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Filenames and captions.                                             */
/* ------------------------------------------------------------------ */

/** A short, readable slug of the parameters that define the plate's identity. */
export function paramSlug(entry: PlateEntry): string {
  const p = entry.params;
  switch (entry.system) {
    case 'reaction':
      return `f${pad3(p.feed)}k${pad3(p.kill)}`;
    case 'attractor':
      return `a${sign2(p.a)}b${sign2(p.b)}c${sign2(p.c)}d${sign2(p.d)}`;
    case 'flow-field':
    default:
      return `n${pad4(p.noiseScale)}t${Math.round((p.turns ?? 0) * 10)}`;
  }
}

export function entryFilename(entry: PlateEntry, ext: 'png' | 'svg' | 'json'): string {
  const date = entry.createdAt.slice(0, 10);
  return `mathdesign_${entry.system}_seed${entry.seed}_${paramSlug(entry)}_${date}.${ext}`;
}

/** "FLOW FIELD · AUDIO" — the caption under every plate. */
export function plateCaption(entry: PlateEntry, driverCaption: string): string {
  return `${SYSTEMS[entry.system].caption} · ${driverCaption}`;
}

export interface MetadataEntry {
  key: string;
  value: string;
}

/**
 * The entry as key/value pairs, for on-screen display.
 *
 * `metadataLines` below stays the compact form composited into an export, where
 * space is tight and the reader is looking at a printed footer. On screen the
 * same data reads better as a table than as four dense lines.
 */
export function metadataEntries(entry: PlateEntry): MetadataEntry[] {
  const def = SYSTEMS[entry.system];
  const rows: MetadataEntry[] = [
    { key: 'system', value: def.title.toLowerCase() },
    { key: 'seed', value: String(entry.seed) },
    { key: 'driver', value: entry.driver },
    { key: 'provenance', value: provenanceOf(entry.driver) },
  ];

  for (const spec of def.schema) {
    rows.push({
      key: spec.label.trim(),
      value: formatValue(entry.params[spec.key], spec.decimals, spec.options),
    });
  }

  if (entry.audioRef) rows.push({ key: 'audio', value: entry.audioRef });
  if (typeof entry.frame === 'number') {
    rows.push({ key: 'frame', value: String(Math.round(entry.frame)) });
  }
  rows.push({ key: 'created', value: entry.createdAt.replace('T', ' ').slice(0, 16) });

  return rows;
}

/** The compact block composited under an export. */
export function metadataLines(entry: PlateEntry): string[] {
  const def = SYSTEMS[entry.system];
  const lines: string[] = [];
  lines.push(`${def.plate}  ${def.caption}`);
  lines.push(`seed ${entry.seed}   driver ${entry.driver}   ${provenanceOf(entry.driver)}`);
  lines.push(
    def.schema
      .map((s) => `${s.key} ${formatValue(entry.params[s.key], s.decimals, s.options)}`)
      .join('   '),
  );
  if (entry.audioRef) lines.push(`audio ${entry.audioRef}${frameSuffix(entry)}`);
  lines.push(entry.createdAt);
  return lines;
}

export function formatValue(v: number, decimals?: number, options?: string[]): string {
  if (options) return options[Math.max(0, Math.min(options.length - 1, Math.round(v)))] ?? String(v);
  if (decimals && decimals > 0) return v.toFixed(decimals);
  return String(Math.round(v));
}

function frameSuffix(entry: PlateEntry): string {
  return typeof entry.frame === 'number' ? `   frame ${Math.round(entry.frame)}` : '';
}

/* ------------------------------------------------------------------ */
/* Sidecar.                                                            */
/* ------------------------------------------------------------------ */

export interface Sidecar extends PlateEntry {
  schemaVersion: 1;
  rule: string;
  url: string;
  reproducible: boolean;
}

export function buildSidecar(entry: PlateEntry, url: string): Sidecar {
  return {
    schemaVersion: 1,
    ...entry,
    rule: SYSTEMS[entry.system].rule,
    url,
    reproducible: provenanceOf(entry.driver) === 'artifact',
  };
}

export function sidecarBlob(entry: PlateEntry, url: string): Blob {
  return new Blob([JSON.stringify(buildSidecar(entry, url), null, 2)], {
    type: 'application/json',
  });
}

/** Re-import: a sidecar reconstructs the plate. */
export function entryFromSidecar(json: unknown): PlateEntry | null {
  if (!json || typeof json !== 'object') return null;
  const raw = json as Partial<PlateEntry>;
  if (!raw.system || !VALID_SYSTEMS.includes(raw.system)) return null;
  return makeEntry({
    system: raw.system,
    seed: typeof raw.seed === 'number' ? raw.seed : 1,
    params: (raw.params as Params) ?? undefined,
    driver: VALID_DRIVERS.includes(raw.driver as DriverId) ? raw.driver : 'static',
    mapping: Array.isArray(raw.mapping) ? raw.mapping : undefined,
    audioRef: typeof raw.audioRef === 'string' ? raw.audioRef : undefined,
    frame: typeof raw.frame === 'number' ? raw.frame : undefined,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  });
}

/* helpers */

function round(v: number): string {
  return String(Math.round(v * 100000) / 100000);
}

function numberOr(s: string | undefined, fallback: number): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : fallback;
}

function pad3(v: number | undefined): string {
  return String(Math.round((v ?? 0) * 1000)).padStart(3, '0');
}

function pad4(v: number | undefined): string {
  return String(Math.round((v ?? 0) * 10000)).padStart(4, '0');
}

function sign2(v: number | undefined): string {
  const n = Math.round((v ?? 0) * 100);
  return (n < 0 ? 'm' : '') + String(Math.abs(n)).padStart(3, '0');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
