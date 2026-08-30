import { useCallback, useEffect, useRef } from 'react';
import { Loop, prefersReducedMotion } from '../core/loop';
import { Rng } from '../core/rng';
import type { Driver, MappingRow, Params, System, SystemId } from '../core/types';
import { SYSTEMS } from '../systems';
import { FlowFieldSystem } from '../systems/flow-field';
import { ReactionSystem } from '../systems/reaction';
import { Mapping } from '../audio/mapping';

/**
 * Runs one live plate: system + driver + mapping + loop, wired to a canvas.
 *
 * The chain here is the whole architecture in a few lines of frame code —
 * driver ticks, mapping resolves, system steps, canvas receives. Everything
 * else in this hook is lifecycle: keeping the system alive across param edits,
 * rebuilding it when the seed or the resolution changes, and parking the loop
 * when nobody is looking at it.
 */

export interface PlateRuntimeOptions {
  system: SystemId;
  seed: number;
  params: Params;
  mapping: MappingRow[];
  /** Null means "no signal": the system runs on its base params. */
  driver: Driver | null;
  /** Plate edge in CSS pixels. */
  size: number;
  running?: boolean;
  /**
   * Seekable drivers supply their own clock (the transport position). Holding
   * `null` hands the clock back to the loop, so switching drivers mid-plate
   * doesn't strand the frame callback on a stale time source.
   */
  timeRef?: React.MutableRefObject<number | null>;
  onFeatures?: (features: Float32Array | null) => void;
  settleFrames?: number;
}

export interface PlateRuntime {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  restart: () => void;
  /** One frame, on demand — used when the transport is paused and scrubbing. */
  tickOnce: (atSeconds?: number) => void;
  snapshot: () => HTMLCanvasElement | null;
}

const MAX_DPR = 2;

export function usePlateRuntime(opts: PlateRuntimeOptions): PlateRuntime {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<Loop | null>(null);
  const systemRef = useRef<System | null>(null);

  // Live values the frame callback reads, so editing a slider never tears down
  // the accumulation that is the whole point of these systems.
  const paramsRef = useRef(opts.params);
  const mappingRowsRef = useRef(opts.mapping);
  const driverRef = useRef(opts.driver);
  const timeRef = opts.timeRef;
  const onFeaturesRef = useRef(opts.onFeatures);

  paramsRef.current = opts.params;
  mappingRowsRef.current = opts.mapping;
  driverRef.current = opts.driver;
  onFeaturesRef.current = opts.onFeatures;

  const { system: systemId, seed, size, running = true, settleFrames } = opts;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const buffer = Math.max(64, Math.round(size * dpr));
    canvas.width = buffer;
    canvas.height = buffer;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const def = SYSTEMS[systemId];
    const system = def.create(seed, buffer);
    systemRef.current = system;

    const mapping = new Mapping();
    const rng = new Rng(seed ^ 0x9a71);
    let onsetLatch = false;

    /**
     * Onsets are events, not levels: they don't belong in the mapping table,
     * which resolves continuous values. A hit reseeds the field or drops
     * chemical rather than nudging a number.
     */
    const handleOnset = (features: Float32Array, names: string[]): void => {
      const i = names.indexOf('onset');
      if (i < 0) return;
      const v = features[i];
      if (v > 0.55 && !onsetLatch) {
        onsetLatch = true;
        if (system instanceof FlowFieldSystem) {
          system.respawnBurst(0.22);
        } else if (system instanceof ReactionSystem) {
          const drops = 2 + rng.int(3);
          for (let d = 0; d < drops; d++) {
            system.injectSeed(rng.float(), rng.float(), 0.02 + rng.float() * 0.03);
          }
        }
      } else if (v < 0.3) {
        onsetLatch = false;
      }
    };

    const loop = new Loop({
      settleFrames: settleFrames ?? def.settleFrames,
      observe: canvas,
      onFrame: (tSeconds) => {
        const driver = driverRef.current;
        const driverTime = timeRef?.current;
        const t = driverTime == null ? tSeconds : driverTime;

        let resolved = paramsRef.current;
        let features: Float32Array | null = null;

        if (driver) {
          features = driver.tick(t);
          if (features.length) {
            resolved = mapping.apply(
              mappingRowsRef.current,
              features,
              driver.featureNames,
              paramsRef.current,
              def.schema,
            );
            handleOnset(features, driver.featureNames);
          }
        }

        system.step(resolved);
        system.renderTo(ctx, 1);
        onFeaturesRef.current?.(features);
      },
    });

    loopRef.current = loop;
    if (running) loop.start();

    return () => {
      loop.dispose();
      system.dispose?.();
      loopRef.current = null;
      systemRef.current = null;
    };
    // `running` is handled by the effect below so toggling play doesn't reset
    // the plate; params, mapping and driver are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, seed, size, settleFrames]);

  useEffect(() => {
    const loop = loopRef.current;
    if (!loop) return;
    if (running) loop.start();
    else loop.stop();
  }, [running]);

  const restart = useCallback(() => {
    systemRef.current?.reset(seed);
    loopRef.current?.resetClock();
    if (prefersReducedMotion()) loopRef.current?.settle();
  }, [seed]);

  const tickOnce = useCallback((atSeconds?: number) => {
    loopRef.current?.tickOnce(atSeconds);
  }, []);

  const snapshot = useCallback(() => canvasRef.current, []);

  return { canvasRef, restart, tickOnce, snapshot };
}
