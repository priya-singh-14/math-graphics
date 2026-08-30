import { Rng } from '../core/rng';
import type { Driver } from '../core/types';

/**
 * LFODriver — slow sinusoids, 0.01–0.1 Hz (one cycle every 10 to 100 seconds).
 *
 * Deterministic: rates and phases come from the seed, so an LFO plate is still
 * an artifact — the same seed at the same moment gives the same image. This is
 * what makes the attractor "breathe" without becoming a performance.
 */
export class LFODriver implements Driver {
  readonly id = 'lfo' as const;
  readonly featureNames = ['lfo1', 'lfo2', 'lfo3', 'lfo4'];

  private rates: Float32Array;
  private phases: Float32Array;
  private out: Float32Array;

  constructor(seed = 1) {
    this.rates = new Float32Array(4);
    this.phases = new Float32Array(4);
    this.out = new Float32Array(4);
    this.reset(seed);
  }

  reset(seed: number): void {
    const rng = new Rng((seed >>> 0) ^ 0x10f0);
    for (let i = 0; i < 4; i++) {
      this.rates[i] = rng.range(0.01, 0.1);
      this.phases[i] = rng.range(0, Math.PI * 2);
    }
  }

  tick(tSeconds: number): Float32Array {
    for (let i = 0; i < 4; i++) {
      this.out[i] = (Math.sin(tSeconds * this.rates[i] * Math.PI * 2 + this.phases[i]) + 1) / 2;
    }
    return this.out;
  }
}
