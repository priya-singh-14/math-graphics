import type { Driver } from '../core/types';

/**
 * StaticDriver — the pure seeded plate.
 *
 * It emits nothing, which means the mapping has nothing to route and the system
 * receives its base parameters unchanged. The classic single plate: one rule,
 * one seed, no signal.
 */
export class StaticDriver implements Driver {
  readonly id = 'static' as const;
  readonly featureNames: string[] = [];
  private empty = new Float32Array(0);

  tick(): Float32Array {
    return this.empty;
  }
}
