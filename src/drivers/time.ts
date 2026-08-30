import { Rng } from '../core/rng';
import type { Driver } from '../core/types';

/**
 * TimeDriver — a monotonic clock, exposed as three shapes.
 *
 * Its main job is the flow field's noise z-drift: route `tri` at low gain into
 * `drift` and the field walks slowly back and forth through the same seeded
 * landscape instead of running away from it.
 *
 *   saw   0..1 ramp, repeating over `period`
 *   tri   0..1..0 over `period` — reverses rather than jumping
 *   ramp  0..1 once over the first minute, then held — a settle-in
 */
export class TimeDriver implements Driver {
  readonly id = 'time' as const;
  readonly featureNames = ['saw', 'tri', 'ramp'];

  private period = 60;
  private out = new Float32Array(3);

  constructor(seed = 1) {
    this.reset(seed);
  }

  reset(seed: number): void {
    const rng = new Rng((seed >>> 0) ^ 0x7c1a);
    this.period = rng.range(40, 120);
  }

  tick(tSeconds: number): Float32Array {
    const phase = (tSeconds % this.period) / this.period;
    this.out[0] = phase;
    this.out[1] = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    this.out[2] = Math.min(1, tSeconds / 60);
    return this.out;
  }
}
