/**
 * A small iterative radix-2 FFT.
 *
 * The offline path can't borrow an `AnalyserNode` — an AnalyserNode only
 * observes a stream in real time and reports nothing useful inside an
 * `OfflineAudioContext`. So the offline walk does its own transform, using the
 * same window size and band layout as the live analyser to keep the two
 * extractors interchangeable.
 */

export class FFT {
  readonly size: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  private re: Float32Array;
  private im: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /**
   * Magnitude spectrum of a real signal. `out` receives size/2 bins.
   * The input is copied, so the caller's buffer is untouched.
   */
  magnitude(input: Float32Array, out: Float32Array): void {
    const { size, re, im, rev, cos, sin } = this;
    for (let i = 0; i < size; i++) {
      re[i] = input[rev[i]] ?? 0;
      im[i] = 0;
    }

    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const stride = size / len;
      for (let i = 0; i < size; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * stride;
          const tRe = re[i + j + half] * cos[k] - im[i + j + half] * sin[k];
          const tIm = re[i + j + half] * sin[k] + im[i + j + half] * cos[k];
          re[i + j + half] = re[i + j] - tRe;
          im[i + j + half] = im[i + j] - tIm;
          re[i + j] += tRe;
          im[i + j] += tIm;
        }
      }
    }

    const bins = size >> 1;
    const norm = 2 / size;
    for (let i = 0; i < bins; i++) {
      out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * norm;
    }
  }
}

/** Hann window, precomputed for a given size. */
export function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}
