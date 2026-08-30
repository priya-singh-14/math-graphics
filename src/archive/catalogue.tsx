import { useMemo } from "react";
import { PlateFrame } from "../core/plate";
import type { PlateEntry, SystemId } from "../core/types";
import { SYSTEMS, SYSTEM_ORDER, defaultParams } from "../systems";
import { DRIVERS, createSimpleDriver } from "../drivers";
import { makeEntry } from "../export/metadata";
import { usePlateRuntime } from "./use-plate-runtime";
import { SeriesSheet, useSeries } from "./series";

/**
 * The catalogue index: three live plates, then the series sheets. Hovering
 * quiets the neighbouring plates rather than outlining the target.
 */

const CARD_SIZE = 300;

/** The default plate for each system. */
export const OPENING_SEEDS: Record<SystemId, number> = {
  "flow-field": 48273,
  reaction: 4127,
  attractor: 7719,
};

export function openingEntry(system: SystemId): PlateEntry {
  return makeEntry({
    system,
    seed: OPENING_SEEDS[system],
    params: defaultParams(system),
    driver:
      system === "attractor"
        ? "lfo"
        : system === "flow-field"
        ? "time"
        : "static",
  });
}

export interface CatalogueProps {
  onOpen: (entry: PlateEntry) => void;
}

export function Catalogue({ onOpen }: CatalogueProps) {
  const series = useSeries();

  return (
    <div>
      <p className="lede opening">
        A driver emits a signal — a seed, a clock, an audio waveform — and a
        mapping table converts that signal into parameters. Dynamical systems
        receive these parameters and plot the evolving output.
      </p>
      <p className="lede">
        A plate is defined by its system, seed, parameters, driver and mapping.
        That description is held in the URL and written alongside every export.
      </p>

      <div className="section-head">
        <h2>Systems</h2>
      </div>

      <div className="plate-grid quieting">
        {SYSTEM_ORDER.map((id) => (
          <LivePlateCard key={id} system={id} onOpen={onOpen} />
        ))}
      </div>

      {series.map((s) => (
        <SeriesSheet key={s.id} series={s} onOpen={onOpen} />
      ))}

      <div className="section-head">
        <h2>Reproducibility</h2>
      </div>
      <p className="lede">
        The static, LFO, time and uploaded-audio drivers reproduce exactly. Live
        microphone input does not.
      </p>
      <p className="lede">
        Uploaded audio is decoded in the browser and discarded after analysis.
        The entry stores a hash of the file, not the file.
      </p>
    </div>
  );
}

function LivePlateCard({
  system,
  onOpen,
}: {
  system: SystemId;
  onOpen: (e: PlateEntry) => void;
}) {
  const def = SYSTEMS[system];
  const entry = useMemo(() => openingEntry(system), [system]);
  const driver = useMemo(
    () =>
      entry.driver === "static" ||
      entry.driver === "lfo" ||
      entry.driver === "time"
        ? createSimpleDriver(entry.driver, entry.seed)
        : null,
    [entry]
  );

  const runtime = usePlateRuntime({
    system,
    seed: entry.seed,
    params: entry.params,
    mapping: [],
    driver,
    size: CARD_SIZE,
    settleFrames: Math.min(def.settleFrames, 420),
  });

  return (
    <button type="button" className="plate-link" onClick={() => onOpen(entry)}>
      <PlateFrame
        number={def.plate}
        caption={`${def.caption} · ${DRIVERS[entry.driver].caption}`}
        description={`${def.title}, seed ${entry.seed}, driver ${
          DRIVERS[entry.driver].label
        }. ${def.blurb}`}
        sub={<>seed {entry.seed}</>}
      >
        <canvas ref={runtime.canvasRef} />
      </PlateFrame>
    </button>
  );
}
