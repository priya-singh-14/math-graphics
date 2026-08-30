/// <reference lib="webworker" />
import { FFT, hann } from '../audio/fft';
import { FEATURE_COUNT, FEATURE_INDEX, FeatureExtractor, FFT_SIZE } from '../audio/features';

/**
 * Offline feature extraction: one walk over decoded PCM, producing a feature
 * timeline. Decoding itself has to happen on the main thread (no AudioContext
 * in a worker), but the full-file analysis walk lives here.
 *
 * Because the whole file is known up front, each feature is normalized against
 * that file's own min/max — the reason offline is the deterministic,
 * exportable path while live is a performance.
 */

export interface AnalyseRequest {
  type: 'analyse';
  pcm: Float32Array;
  sampleRate: number;
  fps: number;
}

export interface AnalyseProgress {
  type: 'progress';
  value: number;
}

export interface AnalyseResult {
  type: 'timeline';
  frames: Float32Array;
  frameCount: number;
  featureCount: number;
  fps: number;
  duration: number;
  min: Float32Array;
  max: Float32Array;
}

self.onmessage = (e: MessageEvent<AnalyseRequest>) => {
  const { pcm, sampleRate, fps } = e.data;
  const post = (m: AnalyseProgress) => (self as unknown as Worker).postMessage(m);

  const hop = sampleRate / fps;
  const frameCount = Math.max(1, Math.floor(pcm.length / hop));
  const fft = new FFT(FFT_SIZE);
  const window = hann(FFT_SIZE);
  const extractor = new FeatureExtractor(sampleRate, FFT_SIZE);

  const windowed = new Float32Array(FFT_SIZE);
  const raw = new Float32Array(FFT_SIZE);
  const mag = new Float32Array(FFT_SIZE / 2);
  const out = new Float32Array(FEATURE_COUNT);
  const frames = new Float32Array(frameCount * FEATURE_COUNT);

  const min = new Float32Array(FEATURE_COUNT).fill(Infinity);
  const max = new Float32Array(FEATURE_COUNT).fill(-Infinity);

  let lastProgress = 0;
  for (let f = 0; f < frameCount; f++) {
    // Window centred on the frame's moment, zero-padded at the file edges.
    const centre = Math.round(f * hop);
    const start = centre - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = start + i;
      const s = j >= 0 && j < pcm.length ? pcm[j] : 0;
      raw[i] = s;
      windowed[i] = s * window[i];
    }
    fft.magnitude(windowed, mag);
    extractor.compute(mag, raw, out);

    const base = f * FEATURE_COUNT;
    for (let i = 0; i < FEATURE_COUNT; i++) {
      const v = out[i];
      frames[base + i] = v;
      if (v < min[i]) min[i] = v;
      if (v > max[i]) max[i] = v;
    }

    if (f - lastProgress > 200) {
      lastProgress = f;
      post({ type: 'progress', value: f / frameCount });
    }
  }

  // Onset is already a 0/1 gate; forcing its range keeps a file with no onsets
  // from normalizing a flat zero into a constant 1.
  min[FEATURE_INDEX.onset] = 0;
  max[FEATURE_INDEX.onset] = 1;

  for (let f = 0; f < frameCount; f++) {
    const base = f * FEATURE_COUNT;
    for (let i = 0; i < FEATURE_COUNT; i++) {
      const span = max[i] - min[i];
      const v = span > 1e-9 ? (frames[base + i] - min[i]) / span : 0;
      frames[base + i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }

  const result: AnalyseResult = {
    type: 'timeline',
    frames,
    frameCount,
    featureCount: FEATURE_COUNT,
    fps,
    duration: pcm.length / sampleRate,
    min,
    max,
  };
  (self as unknown as Worker).postMessage(result, [frames.buffer as ArrayBuffer]);
};
