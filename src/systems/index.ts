import type { MappingRow, ParamSchema, Params, System, SystemId } from '../core/types';
import { FlowFieldSystem, flowFieldSchema } from './flow-field';
import { ReactionSystem, reactionSchema } from './reaction';
import { AttractorSystem, attractorSchema } from './attractor';

/** The catalogue's table of contents. Plate numbers are part of the identity. */
export interface SystemDef {
  id: SystemId;
  plate: string;
  title: string;
  /** Uppercase caption fragment, before the driver: "FLOW FIELD". */
  caption: string;
  rule: string;
  blurb: string;
  schema: ParamSchema;
  create(seed: number, size: number, opts?: { sync?: boolean }): System;
  /** Mapping rows that read as designed rather than arbitrary, per system. */
  suggestedMapping: MappingRow[];
  /** Frames to run for a settled still (reduced motion, catalogue thumbnails). */
  settleFrames: number;
  vectorExport: boolean;
}

export const SYSTEMS: Record<SystemId, SystemDef> = {
  'flow-field': {
    id: 'flow-field',
    plate: 'PL. 01',
    title: 'Flow field',
    caption: 'FLOW FIELD',
    rule: 'angle(x, y, t) = noise(x·s, y·s + t) · 2π · turns',
    blurb:
      'A seeded Perlin field is read as an angle at each point. Particles step along the local angle and leave trails at low alpha. Line density accumulates over successive frames.',
    schema: flowFieldSchema,
    create: (seed, size) => new FlowFieldSystem(seed, size),
    suggestedMapping: [
      { source: 'centroid', target: 'noiseScale', gain: 0.012, offset: 0.004, smoothing: 0.9, enabled: true },
      { source: 'rms', target: 'step', gain: 1.4, offset: 0.7, smoothing: 0.82, enabled: true },
      { source: 'rms', target: 'count', gain: 1100, offset: 500, smoothing: 0.88, enabled: true },
      { source: 'high', target: 'turns', gain: 2.5, offset: 3.0, smoothing: 0.92, enabled: true },
    ],
    settleFrames: 900,
    vectorExport: true,
  },
  reaction: {
    id: 'reaction',
    plate: 'PL. 02',
    title: 'Reaction–diffusion',
    caption: 'REACTION–DIFFUSION',
    rule: "A' = A + (Da·∇²A − A·B² + f·(1 − A))·dt    B' = B + (Db·∇²B + A·B² − (k + f)·B)·dt",
    blurb:
      'Two chemicals on a grid. B consumes A and autocatalyses. A feed rate f adds A; a kill rate k removes B. The values of f and k determine whether the result settles into spots, stripes, mazes or mitosis.',
    schema: reactionSchema,
    create: (seed, size, opts) => new ReactionSystem(seed, size, opts),
    suggestedMapping: [
      { source: 'bass', target: 'feed', gain: 0.014, offset: 0.03, smoothing: 0.96, enabled: true },
      { source: 'rms', target: 'kill', gain: 0.006, offset: 0.059, smoothing: 0.96, enabled: true },
    ],
    settleFrames: 400,
    vectorExport: false,
  },
  attractor: {
    id: 'attractor',
    plate: 'PL. 03',
    title: 'Strange attractor',
    caption: 'STRANGE ATTRACTOR',
    rule: 'xₙ₊₁ = sin(a·yₙ) − cos(b·xₙ)    yₙ₊₁ = sin(c·xₙ) − cos(d·yₙ)',
    blurb:
      'A pair of trigonometric recurrences with four parameters. Each iteration is plotted at low opacity; over hundreds of thousands of iterations, overlapping points build a density field.',
    schema: attractorSchema,
    create: (seed, size) => new AttractorSystem(seed, size),
    suggestedMapping: [
      { source: 'bass', target: 'a', gain: 1.6, offset: -2.6, smoothing: 0.97, enabled: true },
      { source: 'mid', target: 'b', gain: 1.6, offset: -2.6, smoothing: 0.97, enabled: true },
      { source: 'high', target: 'c', gain: 1.4, offset: -1.9, smoothing: 0.97, enabled: true },
      { source: 'rms', target: 'd', gain: 1.0, offset: 1.4, smoothing: 0.98, enabled: true },
    ],
    settleFrames: 240,
    vectorExport: true,
  },
};

export const SYSTEM_ORDER: SystemId[] = ['flow-field', 'reaction', 'attractor'];

export function defaultParams(id: SystemId): Params {
  const out: Params = {};
  for (const spec of SYSTEMS[id].schema) out[spec.key] = spec.default;
  return out;
}

/** Clamp to the schema and drop unknown keys — entries arrive from URLs. */
export function sanitizeParams(id: SystemId, input: Params): Params {
  const out = defaultParams(id);
  for (const spec of SYSTEMS[id].schema) {
    const v = input[spec.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[spec.key] = Math.max(spec.min, Math.min(spec.max, v));
  }
  return out;
}

export { FlowFieldSystem, ReactionSystem, AttractorSystem };
export type { System };
