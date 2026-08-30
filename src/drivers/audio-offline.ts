import { EnvelopeBank } from '../audio/envelope';
import { FEATURE_NAMES } from '../audio/features';
import type { FeatureTimeline } from '../audio/decode';
import type { Driver } from '../core/types';

/**
 * AudioOfflineDriver — archive mode.
 *
 * The whole file was walked once at upload, so the future is known: the
 * timeline is seekable, and every feature is already normalized against the
 * file's own min/max. Same file -> same timeline -> same plate. This is the
 * exportable, printable, citable path.
 *
 * The envelope is replayed deterministically from frame 0 rather than carried
 * along with playback, so scrubbing to frame 4000 gives exactly the state that
 * playing to frame 4000 would have — a captured `frame` in an entry means one
 * thing only.
 */
export class AudioOfflineDriver implements Driver {
  readonly id = 'audio-offline' as const;
  readonly featureNames = [...FEATURE_NAMES];
  readonly seekable = true;

  readonly timeline: FeatureTimeline;
  private bank: EnvelopeBank;
  private cursor = -1;
  private out: Float32Array;
  private release: number;

  constructor(timeline: FeatureTimeline, release = 0.85) {
    this.timeline = timeline;
    this.release = release;
    this.bank = new EnvelopeBank(timeline.featureCount, release);
    this.out = new Float32Array(timeline.featureCount);
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get frameCount(): number {
    return this.timeline.frameCount;
  }

  get currentFrame(): number {
    return Math.max(0, this.cursor);
  }

  setRelease(release: number): void {
    if (release === this.release) return;
    this.release = release;
    this.bank.setSmoothing(release);
    this.cursor = -1; // force a deterministic replay from the start
  }

  frameAt(tSeconds: number): number {
    const f = Math.floor(tSeconds * this.timeline.fps);
    return Math.max(0, Math.min(this.timeline.frameCount - 1, f));
  }

  timeAtFrame(frame: number): number {
    return frame / this.timeline.fps;
  }

  tick(tSeconds: number): Float32Array {
    return this.featuresAtFrame(this.frameAt(tSeconds));
  }

  seek(tSeconds: number): void {
    this.featuresAtFrame(this.frameAt(tSeconds));
  }

  /** Deterministic: replays the envelope from frame 0 whenever we move backwards. */
  featuresAtFrame(frame: number): Float32Array {
    const target = Math.max(0, Math.min(this.timeline.frameCount - 1, Math.floor(frame)));
    if (target < this.cursor) {
      this.bank.reset();
      this.cursor = -1;
    }
    const { frames, featureCount } = this.timeline;
    for (let f = this.cursor + 1; f <= target; f++) {
      const base = f * featureCount;
      for (let i = 0; i < featureCount; i++) this.out[i] = frames[base + i];
      this.bank.process(this.out);
    }
    this.cursor = target;
    return this.out;
  }

  /** Un-smoothed values, for drawing the transport's feature ribbon. */
  rawAtFrame(frame: number, into: Float32Array): Float32Array {
    const { frames, featureCount, frameCount } = this.timeline;
    const f = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
    const base = f * featureCount;
    for (let i = 0; i < featureCount; i++) into[i] = frames[base + i];
    return into;
  }
}
