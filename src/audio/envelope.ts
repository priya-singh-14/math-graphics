/**
 * Envelope following and normalization.
 *
 * These two are non-negotiable and belong here from the start — retrofitting
 * them is painful, and without them the plates twitch instead of breathing.
 * Heavy smoothing is most of the distance between "editorial" and "visualizer".
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One-pole follower: fast attack, slow release. */
export class OnePole {
  private v = 0;
  private attack: number;
  private release: number;

  constructor(smoothing = 0.85) {
    this.attack = 0.5;
    this.release = 0.05;
    this.setSmoothing(smoothing);
  }

  /** `smoothing` 0..1 — higher is calmer. Attack stays quick so hits still land. */
  setSmoothing(smoothing: number): void {
    const s = clamp01(smoothing);
    const inv = 1 - s;
    this.release = 0.0015 + inv * inv * 0.6;
    this.attack = Math.max(this.release, 0.12 + inv * 0.7);
  }

  process(x: number): number {
    const c = x > this.v ? this.attack : this.release;
    this.v += (x - this.v) * c;
    return this.v;
  }

  get value(): number {
    return this.v;
  }

  reset(v = 0): void {
    this.v = v;
  }
}

/** A bank of followers, one per feature — the global smoothing stage. */
export class EnvelopeBank {
  private poles: OnePole[];

  constructor(count: number, smoothing = 0.85) {
    this.poles = Array.from({ length: count }, () => new OnePole(smoothing));
  }

  setSmoothing(smoothing: number): void {
    for (const p of this.poles) p.setSmoothing(smoothing);
  }

  /** In-place. Onset is deliberately excluded by the caller where it matters. */
  process(values: Float32Array): Float32Array {
    for (let i = 0; i < values.length && i < this.poles.length; i++) {
      values[i] = this.poles[i].process(values[i]);
    }
    return values;
  }

  reset(): void {
    for (const p of this.poles) p.reset();
  }
}

/**
 * Live normalization: a decaying rolling window, so a quiet track and a loud
 * track both fill the 0..1 range and a mapping transfers between them.
 */
export class RollingNormalizer {
  private min: Float32Array;
  private max: Float32Array;
  private seen = false;
  private decay: number;

  constructor(count: number, decay = 0.9995) {
    this.min = new Float32Array(count).fill(Infinity);
    this.max = new Float32Array(count).fill(-Infinity);
    this.decay = decay;
  }

  /** In-place, returns the same array. */
  normalize(values: Float32Array): Float32Array {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!this.seen) {
        this.min[i] = v;
        this.max[i] = v;
      } else {
        // Relax the window toward the current value so an early transient
        // doesn't permanently squash the rest of the performance.
        const mid = (this.min[i] + this.max[i]) / 2;
        this.min[i] = this.min[i] * this.decay + mid * (1 - this.decay);
        this.max[i] = this.max[i] * this.decay + mid * (1 - this.decay);
        if (v < this.min[i]) this.min[i] = v;
        if (v > this.max[i]) this.max[i] = v;
      }
      const span = this.max[i] - this.min[i];
      values[i] = span > 1e-9 ? clamp01((v - this.min[i]) / span) : 0;
    }
    this.seen = true;
    return values;
  }

  reset(): void {
    this.min.fill(Infinity);
    this.max.fill(-Infinity);
    this.seen = false;
  }
}

/**
 * Offline normalization: the future is known, so normalize against the whole
 * file's min/max. Same file in, same 0..1 timeline out — this is the
 * deterministic, exportable path.
 */
export class MinMaxNormalizer {
  constructor(
    private min: Float32Array,
    private max: Float32Array,
  ) {}

  normalize(values: Float32Array): Float32Array {
    for (let i = 0; i < values.length; i++) {
      const span = this.max[i] - this.min[i];
      values[i] = span > 1e-9 ? clamp01((values[i] - this.min[i]) / span) : 0;
    }
    return values;
  }
}

export { clamp01 };
