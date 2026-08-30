import { EnvelopeBank, RollingNormalizer } from '../audio/envelope';
import { FEATURE_COUNT, FEATURE_NAMES, FeatureExtractor, FFT_SIZE } from '../audio/features';
import type { Driver } from '../core/types';

/**
 * AudioLiveDriver — performance mode.
 *
 * Microphone or media element -> AnalyserNode -> the same feature extractor the
 * offline path uses. Normalization is a rolling window, so a quiet room and a
 * loud one both fill the range.
 *
 * Not seekable and not reproducible: an export from live mode is a capture of a
 * moment, and the entry says so. That honesty is the point — the archive
 * distinguishes artifacts from performances instead of pretending both are the
 * same kind of object.
 */

export type LiveSource = { kind: 'mic' } | { kind: 'element'; element: HTMLMediaElement };

export class AudioLiveDriver implements Driver {
  readonly id = 'audio-live' as const;
  readonly featureNames = [...FEATURE_NAMES];
  readonly seekable = false;

  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private node: AudioNode;
  private stream: MediaStream | null;
  private extractor: FeatureExtractor;
  private normalizer = new RollingNormalizer(FEATURE_COUNT);
  private bank: EnvelopeBank;

  // The analyser API only accepts views known to be backed by a plain
  // ArrayBuffer, hence the explicit buffer type on these three.
  private freqDb: Float32Array<ArrayBuffer>;
  private mag: Float32Array<ArrayBuffer>;
  private time: Float32Array<ArrayBuffer>;
  private out = new Float32Array(FEATURE_COUNT);

  private constructor(
    ctx: AudioContext,
    node: AudioNode,
    stream: MediaStream | null,
    release: number,
  ) {
    this.ctx = ctx;
    this.node = node;
    this.stream = stream;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0; // we do our own, deliberately
    node.connect(this.analyser);

    const bins = this.analyser.frequencyBinCount;
    this.freqDb = new Float32Array(bins);
    this.mag = new Float32Array(bins);
    this.time = new Float32Array(this.analyser.fftSize);
    this.extractor = new FeatureExtractor(ctx.sampleRate, FFT_SIZE);
    this.bank = new EnvelopeBank(FEATURE_COUNT, release);
  }

  static async create(source: LiveSource, release = 0.85): Promise<AudioLiveDriver> {
    const Ctx: typeof AudioContext | undefined =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error('This browser has no Web Audio support.');
    const ctx = new Ctx();
    await ctx.resume();

    if (source.kind === 'mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      return new AudioLiveDriver(ctx, ctx.createMediaStreamSource(stream), stream, release);
    }

    const node = ctx.createMediaElementSource(source.element);
    // Keep the element audible: analysis taps the graph, it doesn't replace it.
    node.connect(ctx.destination);
    return new AudioLiveDriver(ctx, node, null, release);
  }

  setRelease(release: number): void {
    this.bank.setSmoothing(release);
  }

  tick(): Float32Array {
    this.analyser.getFloatFrequencyData(this.freqDb);
    this.analyser.getFloatTimeDomainData(this.time);

    // The analyser reports dBFS; the extractor wants linear magnitudes so live
    // and offline see the same numbers.
    for (let i = 0; i < this.freqDb.length; i++) {
      const db = this.freqDb[i];
      this.mag[i] = db <= -160 ? 0 : Math.pow(10, db / 20);
    }

    this.extractor.compute(this.mag, this.time, this.out);
    this.normalizer.normalize(this.out);
    this.bank.process(this.out);
    return this.out;
  }

  dispose(): void {
    try {
      this.node.disconnect(this.analyser);
    } catch {
      /* already torn down */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx.close();
  }
}
