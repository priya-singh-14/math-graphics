/// <reference lib="webworker" />
import { GrayScott } from '../systems/reaction-core';

/**
 * Reaction–diffusion runs here so the per-pixel work never touches the main
 * thread. The RGBA buffer ping-pongs: we transfer it out, the main thread
 * hands the same buffer back after `putImageData`, so a live plate allocates
 * nothing per frame.
 */

export interface ReactionInit {
  type: 'init';
  size: number;
  seed: number;
  pattern: number;
  /** Bumped on every re-init so the main thread can discard stale frames. */
  gen: number;
}

export interface ReactionStep {
  type: 'step';
  feed: number;
  kill: number;
  db: number;
  iterations: number;
  injects?: Array<{ x: number; y: number; r: number }>;
  buffer?: ArrayBuffer;
}

export type ReactionRequest = ReactionInit | ReactionStep;

export interface ReactionFrame {
  type: 'frame';
  size: number;
  gen: number;
  buffer: ArrayBuffer;
}

let sim: GrayScott | null = null;
let pixels: Uint8ClampedArray | null = null;
let gen = 0;

self.onmessage = (e: MessageEvent<ReactionRequest>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    sim = new GrayScott(msg.size, msg.seed, msg.pattern);
    pixels = new Uint8ClampedArray(msg.size * msg.size * 4);
    gen = msg.gen;
    return;
  }

  if (msg.type === 'step') {
    if (!sim) return;
    if (msg.injects) {
      for (const inj of msg.injects) sim.inject(inj.x, inj.y, inj.r);
    }
    sim.iterate(msg.feed, msg.kill, msg.db, msg.iterations);

    const n = sim.size * sim.size * 4;
    let out: Uint8ClampedArray;
    if (msg.buffer && msg.buffer.byteLength === n) {
      out = new Uint8ClampedArray(msg.buffer);
    } else {
      if (!pixels || pixels.length !== n) pixels = new Uint8ClampedArray(n);
      out = pixels;
    }
    sim.paint(out);

    const frame: ReactionFrame = {
      type: 'frame',
      size: sim.size,
      gen,
      buffer: out.buffer as ArrayBuffer,
    };
    (self as unknown as Worker).postMessage(frame, [out.buffer as ArrayBuffer]);
    // The buffer we just transferred is no longer ours; the main thread returns it.
    if (out === pixels) pixels = null;
  }
};
