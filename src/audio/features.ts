/**
 * The shared feature extractor.
 *
 * Live and offline drivers use *this* code, which is what makes them
 * interchangeable: a mapping designed against an uploaded file behaves the same
 * way against a microphone. Raw samples never travel downstream — only features.
 */

export const FEATURE_NAMES = ['rms', 'bass', 'mid', 'high', 'centroid', 'onset'] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_COUNT = FEATURE_NAMES.length;

export const FFT_SIZE = 2048;

export const FEATURE_INDEX: Record<FeatureName, number> = {
  rms: 0,
  bass: 1,
  mid: 2,
  high: 3,
  centroid: 4,
  onset: 5,
};

/** Log-spaced band edges, in Hz. Musical spacing, not linear FFT bins. */
export const BAND_EDGES_HZ = {
  bass: [20, 200],
  mid: [200, 2000],
  high: [2000, 11000],
} as const;

function binForHz(hz: number, sampleRate: number, fftSize: number): number {
  return Math.max(0, Math.min(fftSize / 2 - 1, Math.round((hz * fftSize) / sampleRate)));
}

export interface OnsetOptions {
  /** Energy must exceed rolling mean × threshold to count. */
  threshold?: number;
  /** Frames to wait before another onset can fire. */
  refractory?: number;
}

/**
 * Computes raw (un-normalized) features from one analysis frame.
 * Normalization is the caller's job, because it differs by driver:
 * offline normalizes against the whole file, live against a rolling window.
 */
export class FeatureExtractor {
  private sampleRate: number;
  private fftSize: number;
  private bands: Array<[number, number]>;
  private freqHz: Float32Array;

  private energyMean = 0;
  private refractoryLeft = 0;
  private threshold: number;
  private refractory: number;
  private primed = 0;

  constructor(sampleRate: number, fftSize = FFT_SIZE, opts: OnsetOptions = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.threshold = opts.threshold ?? 1.5;
    this.refractory = opts.refractory ?? 6;

    this.bands = [
      [binForHz(BAND_EDGES_HZ.bass[0], sampleRate, fftSize), binForHz(BAND_EDGES_HZ.bass[1], sampleRate, fftSize)],
      [binForHz(BAND_EDGES_HZ.mid[0], sampleRate, fftSize), binForHz(BAND_EDGES_HZ.mid[1], sampleRate, fftSize)],
      [binForHz(BAND_EDGES_HZ.high[0], sampleRate, fftSize), binForHz(BAND_EDGES_HZ.high[1], sampleRate, fftSize)],
    ];

    const bins = fftSize / 2;
    this.freqHz = new Float32Array(bins);
    for (let i = 0; i < bins; i++) this.freqHz[i] = (i * sampleRate) / fftSize;
  }

  reset(): void {
    this.energyMean = 0;
    this.refractoryLeft = 0;
    this.primed = 0;
  }

  /**
   * @param mag       magnitude spectrum, fftSize/2 bins
   * @param timeDomain time-domain samples for RMS (may be shorter than fftSize)
   * @param out       receives FEATURE_COUNT raw values
   */
  compute(mag: Float32Array, timeDomain: Float32Array, out: Float32Array): void {
    // rms — time-domain amplitude
    let sumSq = 0;
    for (let i = 0; i < timeDomain.length; i++) sumSq += timeDomain[i] * timeDomain[i];
    out[FEATURE_INDEX.rms] = Math.sqrt(sumSq / Math.max(1, timeDomain.length));

    // log-spaced bands — mean magnitude per band, so band width doesn't bias level
    for (let b = 0; b < 3; b++) {
      const [i0, i1] = this.bands[b];
      let sum = 0;
      for (let i = i0; i <= i1; i++) sum += mag[i];
      out[1 + b] = sum / Math.max(1, i1 - i0 + 1);
    }

    // spectral centroid — the "brightness" of the frame, in Hz
    let num = 0;
    let den = 0;
    for (let i = 0; i < mag.length; i++) {
      num += this.freqHz[i] * mag[i];
      den += mag[i];
    }
    out[FEATURE_INDEX.centroid] = den > 1e-9 ? num / den : 0;

    // onset — energy spike against a rolling mean, with a refractory window
    let energy = 0;
    for (let i = 0; i < mag.length; i++) energy += mag[i] * mag[i];
    let fired = 0;
    if (this.primed > 8 && this.refractoryLeft <= 0 && energy > this.energyMean * this.threshold) {
      fired = 1;
      this.refractoryLeft = this.refractory;
    }
    if (this.refractoryLeft > 0) this.refractoryLeft--;
    this.energyMean = this.energyMean === 0 ? energy : this.energyMean * 0.9 + energy * 0.1;
    this.primed++;
    out[FEATURE_INDEX.onset] = fired;
  }

  get nyquist(): number {
    return this.sampleRate / 2;
  }

  get windowSize(): number {
    return this.fftSize;
  }
}
