/**
 * Shared vocabulary for the archive.
 *
 * The central abstraction is a one-way chain:
 *
 *   Driver.tick(t) -> Float32Array (features, 0..1)
 *   Mapping.apply(features) -> Params
 *   System.step(params) -> marks on a canvas
 *   Exporter.render(...) -> PNG / SVG + metadata
 *
 * A System never reads audio, time or a seed directly. It is handed fully
 * resolved params every frame, which is what makes every system audio-capable
 * for free: math-mode vs audio-mode is a driver swap, not a rewrite.
 */

export type SystemId = 'flow-field' | 'reaction' | 'attractor';

export type DriverId = 'static' | 'lfo' | 'time' | 'audio-live' | 'audio-offline';

/** Resolved parameter values, keyed by `ParamSpec.key`. Always plain numbers. */
export type Params = Record<string, number>;

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Enum params are still numbers on the wire; `options` labels each index. */
  options?: string[];
  /** How many decimals the live readout shows. */
  decimals?: number;
  note?: string;
  /** Params that only shape the still (not the motion) stay live under reduced motion. */
  affectsMotion?: boolean;
}

export type ParamSchema = ParamSpec[];

export interface System {
  readonly id: SystemId;
  readonly title: string;
  readonly paramSchema: ParamSchema;

  /** Allocate the internal accumulation buffer at `size` x `size` device px. */
  resize(size: number): void;
  /** Re-seed everything stochastic and clear to paper. */
  reset(seed: number): void;
  /** Advance one frame. */
  step(params: Params): void;
  /** Blit the accumulated plate into `ctx`, drawn at `scale` x its buffer size. */
  renderTo(ctx: CanvasRenderingContext2D, scale: number): void;

  /** Point/line geometry for SVG export, where the system has any. */
  exportVector?(): VectorScene | null;
  /** True once the system has drawn something worth exporting. */
  readonly ready?: boolean;
  dispose?(): void;
}

export interface VectorScene {
  /** Buffer-space extent; the exporter maps this to the SVG viewBox. */
  size: number;
  polylines?: Array<Float32Array>;
  points?: Float32Array;
  strokeWidth: number;
  opacity: number;
}

export interface Driver {
  readonly id: DriverId;
  /** Normalized feature vector for time `tSeconds`. Length === featureNames.length. */
  tick(tSeconds: number): Float32Array;
  readonly featureNames: string[];
  /** Scrubbable timelines (audio-offline) expose a duration and accept seeks. */
  readonly seekable?: boolean;
  readonly duration?: number;
  seek?(tSeconds: number): void;
  reset?(seed: number): void;
  dispose?(): void;
}

export interface MappingRow {
  /** Feature name, e.g. "rms". */
  source: string;
  /** Param key, e.g. "noiseScale". */
  target: string;
  gain: number;
  offset: number;
  /** 0..1 release amount. Higher values release more slowly. */
  smoothing: number;
  enabled?: boolean;
}

/**
 * A complete, citable description of one plate. Everything needed to rebuild
 * the image lives here, which is what makes the archive an archive.
 */
export interface PlateEntry {
  system: SystemId;
  seed: number;
  params: Params;
  driver: DriverId;
  /** File hash (offline audio only). Uploads are ephemeral: we store the hash, never the audio. */
  audioRef?: string;
  mapping?: MappingRow[];
  /** For seekable drivers: the captured moment, in timeline frames. */
  frame?: number;
  createdAt: string;
  title?: string;
}

/**
 * Determinism boundary, stated honestly in the UI rather than implied.
 * `artifact` plates are reproducible pixel-for-pixel from their entry;
 * a `performance` plate is a one-off capture of a live signal.
 */
export type Provenance = 'artifact' | 'performance';

export function provenanceOf(driver: DriverId): Provenance {
  return driver === 'audio-live' ? 'performance' : 'artifact';
}
