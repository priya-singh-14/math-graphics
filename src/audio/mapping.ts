import { OnePole } from './envelope';
import type { MappingRow, ParamSchema, Params } from '../core/types';

/**
 * The routing table: source feature -> target parameter, with gain, offset and
 * per-row smoothing.
 *
 * This is the primary creative surface of the whole project. Exposing it as a
 * table — rather than burying a hand-tuned mapping in the system code — is what
 * turns "audio reactive" from a black box into a designed instrument, and it
 * serializes into the entry so a plate's behaviour is part of its citation.
 */

export function rowKey(row: MappingRow, index: number): string {
  return `${index}:${row.source}->${row.target}`;
}

export class Mapping {
  private poles = new Map<string, OnePole>();
  /** Global release, multiplied into every row's own smoothing. */
  private release = 0.5;

  setRelease(release: number): void {
    this.release = Math.max(0, Math.min(1, release));
    this.poles.clear();
  }

  reset(): void {
    this.poles.clear();
  }

  /**
   * Resolve params for one frame.
   *
   * The first enabled row for a target replaces the base value with
   * `offset + gain·feature`; further rows targeting the same param add to it,
   * so layering two features on one parameter reads as summing, not as the
   * last row silently winning.
   */
  apply(
    rows: MappingRow[],
    features: Float32Array,
    featureNames: string[],
    base: Params,
    schema: ParamSchema,
  ): Params {
    const out: Params = { ...base };
    if (!rows.length || !features.length) return out;

    const specs = new Map(schema.map((s) => [s.key, s]));
    const written = new Set<string>();

    rows.forEach((row, i) => {
      if (row.enabled === false) return;
      const spec = specs.get(row.target);
      if (!spec) return;
      const fi = featureNames.indexOf(row.source);
      if (fi < 0) return;

      const key = rowKey(row, i);
      let pole = this.poles.get(key);
      const smoothing = combine(row.smoothing, this.release);
      if (!pole) {
        pole = new OnePole(smoothing);
        pole.reset(features[fi]);
        this.poles.set(key, pole);
      } else {
        pole.setSmoothing(smoothing);
      }

      const f = pole.process(features[fi]);
      const contribution = row.gain * f;
      const next = written.has(row.target)
        ? out[row.target] + contribution
        : row.offset + contribution;

      out[row.target] = Math.max(spec.min, Math.min(spec.max, next));
      written.add(row.target);
    });

    return out;
  }
}

/**
 * Row smoothing and the global release compose rather than override: pushing
 * the global release up calms every row, without erasing the relative
 * differences the mapping was designed with.
 */
function combine(rowSmoothing: number, release: number): number {
  const r = Math.max(0, Math.min(1, rowSmoothing));
  return Math.max(0, Math.min(0.999, 1 - (1 - r) * (1 - release * 0.9)));
}

export function newMappingRow(source: string, target: string): MappingRow {
  return { source, target, gain: 1, offset: 0, smoothing: 0.9, enabled: true };
}
