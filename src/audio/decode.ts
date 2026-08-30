import { FEATURE_COUNT } from './features';
import type { AnalyseRequest, AnalyseResult } from '../workers/audio-decode.worker';

/**
 * Upload -> decode -> feature timeline.
 *
 * Uploaded audio is ephemeral by design: we decode it, keep the derived
 * features, and never store or transmit the file. What the archive records is
 * `audioRef` — a hash — which is enough to say "this plate came from that
 * file" without the archive holding anyone's music.
 */

export interface FeatureTimeline {
  /** frameCount × FEATURE_COUNT, already normalized to 0..1 over the whole file. */
  frames: Float32Array;
  frameCount: number;
  featureCount: number;
  fps: number;
  duration: number;
  /** SHA-256 prefix of the source file — the entry's `audioRef`. */
  hash: string;
  name: string;
}

export const TIMELINE_FPS = 60;
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 12 * 60;

export class AudioDecodeError extends Error {}

export async function hashBytes(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest).slice(0, 8)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Non-secure contexts have no SubtleCrypto; a weaker hash still identifies
  // the file well enough for a provenance note.
  const bytes = new Uint8Array(buffer);
  let h = 2166136261 >>> 0;
  const stride = Math.max(1, Math.floor(bytes.length / 65536));
  for (let i = 0; i < bytes.length; i += stride) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + bytes.length.toString(16);
}

/** Mono mix. Features are about content, not stereo image. */
function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i];
  }
  if (channels > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= channels;
  }
  return out;
}

export interface DecodeOptions {
  fps?: number;
  onProgress?: (stage: 'decoding' | 'analysing', value: number) => void;
  signal?: AbortSignal;
}

export async function decodeFileToTimeline(
  file: File,
  opts: DecodeOptions = {},
): Promise<FeatureTimeline> {
  const fps = opts.fps ?? TIMELINE_FPS;

  if (file.size > MAX_AUDIO_BYTES) {
    throw new AudioDecodeError(
      `That file is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_AUDIO_BYTES / 1048576} MB.`,
    );
  }

  opts.onProgress?.('decoding', 0);
  const bytes = await file.arrayBuffer();
  const hash = await hashBytes(bytes.slice(0));

  // `decodeAudioData` detaches its input, so hand it a copy.
  const Ctx: typeof OfflineAudioContext | undefined =
    (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctx) throw new AudioDecodeError('This browser has no Web Audio support.');

  let audio: AudioBuffer;
  try {
    const ctx = new Ctx(1, 1, 44100);
    audio = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new AudioDecodeError(
      `Could not decode “${file.name}”. Try a wav, mp3, m4a, ogg or flac file.`,
    );
  }

  if (audio.duration > MAX_AUDIO_SECONDS) {
    throw new AudioDecodeError(
      `That track is ${Math.round(audio.duration / 60)} minutes. The limit is ${MAX_AUDIO_SECONDS / 60}.`,
    );
  }

  opts.onProgress?.('analysing', 0);
  const pcm = toMono(audio);
  const result = await analyseInWorker(pcm, audio.sampleRate, fps, opts);

  return {
    frames: result.frames,
    frameCount: result.frameCount,
    featureCount: result.featureCount,
    fps: result.fps,
    duration: result.duration,
    hash,
    name: file.name,
  };
}

function analyseInWorker(
  pcm: Float32Array,
  sampleRate: number,
  fps: number,
  opts: DecodeOptions,
): Promise<AnalyseResult> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new AudioDecodeError('This browser cannot run the analysis worker.'));
      return;
    }
    const worker = new Worker(new URL('../workers/audio-decode.worker.ts', import.meta.url), {
      type: 'module',
    });
    const done = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    opts.signal?.addEventListener('abort', () =>
      done(() => reject(new AudioDecodeError('Analysis cancelled.'))),
    );
    worker.onerror = (e) => done(() => reject(new AudioDecodeError(e.message || 'Analysis failed.')));
    worker.onmessage = (e: MessageEvent<AnalyseResult | { type: 'progress'; value: number }>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        opts.onProgress?.('analysing', msg.value);
        return;
      }
      if (msg.featureCount !== FEATURE_COUNT) {
        done(() => reject(new AudioDecodeError('Feature layout mismatch.')));
        return;
      }
      done(() => resolve(msg));
    };
    const req: AnalyseRequest = { type: 'analyse', pcm, sampleRate, fps };
    worker.postMessage(req, [pcm.buffer as ArrayBuffer]);
  });
}
