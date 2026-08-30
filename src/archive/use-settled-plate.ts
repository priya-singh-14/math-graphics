import { useEffect, useRef, useState } from 'react';
import type { PlateEntry } from '../core/types';
import { renderPlateSurface } from '../export/raster';
import { get2d } from '../systems/flow-field';

/**
 * A settled still, rendered once.
 *
 * Series sheets are twenty-odd plates on one page; twenty live simulations
 * would be a space heater, and a series is meant to be read as a taxonomy
 * anyway — settled specimens, not motion. Renders are queued one at a time so
 * a sheet builds visibly, top to bottom, instead of freezing the page.
 */

type Task = () => Promise<void>;

const queue: Task[] = [];
let draining = false;

function enqueue(task: Task): () => void {
  let cancelled = false;
  queue.push(async () => {
    if (cancelled) return;
    await task();
  });
  void drain();
  return () => {
    cancelled = true;
  };
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const task = queue.shift();
    try {
      await task?.();
    } catch {
      /* a failed thumbnail must not stall the rest of the sheet */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  draining = false;
}

export type SettledStatus = 'waiting' | 'rendering' | 'done' | 'error';

export function useSettledPlate(
  entry: PlateEntry,
  size: number,
  frames?: number,
): { canvasRef: React.RefObject<HTMLCanvasElement>; status: SettledStatus } {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<SettledStatus>('waiting');
  const key = `${entry.system}|${entry.seed}|${JSON.stringify(entry.params)}|${frames ?? ''}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const buffer = Math.round(size * dpr);
    canvas.width = buffer;
    canvas.height = buffer;

    let disposed = false;
    let cancelQueued: (() => void) | null = null;

    const start = () => {
      setStatus('rendering');
      cancelQueued = enqueue(async () => {
        if (disposed) return;
        try {
          const surface = await renderPlateSurface(entry, buffer, { frames });
          if (disposed) return;
          const ctx = get2d(canvas);
          ctx.drawImage(surface as CanvasImageSource, 0, 0);
          setStatus('done');
        } catch {
          if (!disposed) setStatus('error');
        }
      });
    };

    // Only build a specimen once it is near the viewport.
    if (typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        disposed = true;
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(canvas);

    return () => {
      disposed = true;
      io.disconnect();
      cancelQueued?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);

  return { canvasRef, status };
}
