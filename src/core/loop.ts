/**
 * The render loop. One per live plate.
 *
 * Two responsibilities beyond calling rAF: it knows about `prefers-reduced-motion`
 * (where a plate renders to a single settled still instead of animating), and it
 * parks itself when the plate scrolls off-screen so a catalogue of twenty plates
 * doesn't cook the machine.
 */

export type FrameFn = (tSeconds: number, frame: number) => void;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Subscribe to reduced-motion changes; returns an unsubscribe. */
export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (e: MediaQueryListEvent) => fn(e.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export interface LoopOptions {
  /** Called once per animation frame with elapsed seconds (excluding paused time). */
  onFrame: FrameFn;
  /**
   * Under reduced motion the loop does not animate; it runs this many frames
   * synchronously, once, and stops — the plate arrives already settled.
   */
  settleFrames?: number;
  /** Pause automatically when this element leaves the viewport. */
  observe?: Element | null;
}

export class Loop {
  private raf = 0;
  private running = false;
  private startedAt = 0;
  private elapsedBeforePause = 0;
  private frameCount = 0;
  private io: IntersectionObserver | null = null;
  private visible = true;
  private wantsRun = false;
  private opts: LoopOptions;
  private reducedUnsub: (() => void) | null = null;

  constructor(opts: LoopOptions) {
    this.opts = opts;
    if (opts.observe && typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(
        (entries) => {
          this.visible = entries.some((e) => e.isIntersecting);
          this.sync();
        },
        { rootMargin: '96px' },
      );
      this.io.observe(opts.observe);
      this.visible = false; // assume off-screen until the observer says otherwise
    }
    this.reducedUnsub = onReducedMotionChange(() => {
      if (this.wantsRun) {
        this.stop();
        this.start();
      }
    });
  }

  get frame(): number {
    return this.frameCount;
  }

  get seconds(): number {
    if (!this.running) return this.elapsedBeforePause / 1000;
    return (this.elapsedBeforePause + (performance.now() - this.startedAt)) / 1000;
  }

  start(): void {
    this.wantsRun = true;
    if (prefersReducedMotion()) {
      this.settle();
      return;
    }
    this.sync();
  }

  stop(): void {
    this.wantsRun = false;
    this.pauseRaf();
  }

  /** Reduced-motion (and export) path: run N frames right now, then hold. */
  settle(frames = this.opts.settleFrames ?? 600): void {
    for (let i = 0; i < frames; i++) {
      this.frameCount++;
      this.opts.onFrame(this.frameCount / 60, this.frameCount);
    }
  }

  /** Advance exactly one frame while paused — used by the offline transport. */
  tickOnce(atSeconds?: number): void {
    this.frameCount++;
    this.opts.onFrame(atSeconds ?? this.frameCount / 60, this.frameCount);
  }

  resetClock(): void {
    this.elapsedBeforePause = 0;
    this.startedAt = performance.now();
    this.frameCount = 0;
  }

  dispose(): void {
    this.stop();
    this.io?.disconnect();
    this.io = null;
    this.reducedUnsub?.();
    this.reducedUnsub = null;
  }

  private sync(): void {
    const shouldRun = this.wantsRun && this.visible && !prefersReducedMotion();
    if (shouldRun && !this.running) this.resumeRaf();
    else if (!shouldRun && this.running) this.pauseRaf();
  }

  private resumeRaf(): void {
    this.running = true;
    this.startedAt = performance.now();
    const tick = () => {
      if (!this.running) return;
      this.frameCount++;
      this.opts.onFrame(this.seconds, this.frameCount);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private pauseRaf(): void {
    if (this.running) {
      this.elapsedBeforePause += performance.now() - this.startedAt;
      this.running = false;
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
