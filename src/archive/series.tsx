import { useMemo } from 'react';
import { PlateFrame } from '../core/plate';
import type { PlateEntry } from '../core/types';
import { SYSTEMS, defaultParams } from '../systems';
import { makeEntry } from '../export/metadata';
import { useSettledPlate } from './use-settled-plate';

/**
 * Series: each system sampled across one axis of its parameter space — a sheet
 * of seeds, the (f, k) plane, a grid of (a, b). Specimens are settled stills
 * rather than live plates; each opens as a full plate at its coordinates.
 */

export interface SeriesDef {
  id: string;
  title: string;
  note: string;
  entries: Array<{ entry: PlateEntry; label: string }>;
  frames: number;
  columns: number;
}

const SPECIMEN_SIZE = 200;

export function useSeries(): SeriesDef[] {
  return useMemo(() => [seedSheet(), fkPlane(), attractorGrid()], []);
}

/** PL. 01 — a sheet of seeds at fixed parameters. */
function seedSheet(): SeriesDef {
  const base = defaultParams('flow-field');
  const seeds = [1041, 2287, 3390, 4813, 5502, 6178, 7264, 8931, 9407, 11250, 12688, 13974];
  return {
    id: 'seed-sheet',
    title: 'Series A — seed sheet',
    note: '12 unique seeds',
    frames: 420,
    columns: 4,
    entries: seeds.map((seed) => ({
      entry: makeEntry({ system: 'flow-field', seed, params: { ...base, drift: 0.0012 } }),
      label: `seed ${seed}`,
    })),
  };
}

/** PL. 02 — the (f, k) plane, sampled at sixteen coordinates. */
function fkPlane(): SeriesDef {
  const base = defaultParams('reaction');
  const feeds = [0.022, 0.03, 0.037, 0.045];
  const kills = [0.051, 0.057, 0.062, 0.065];
  const entries: SeriesDef['entries'] = [];
  for (const kill of kills) {
    for (const feed of feeds) {
      entries.push({
        entry: makeEntry({
          system: 'reaction',
          seed: 4127,
          params: { ...base, feed, kill, gridSize: 110, iterationsPerFrame: 12 },
        }),
        label: `f ${feed.toFixed(3)} · k ${kill.toFixed(3)}`,
      });
    }
  }
  return {
    id: 'fk-plane',
    title: 'Series B — the (f, k) plane',
    note: '16 coordinates in feed–kill space',
    frames: 260,
    columns: 4,
    entries,
  };
}

/** PL. 03 — a grid of (a, b) with c and d held. */
function attractorGrid(): SeriesDef {
  const base = defaultParams('attractor');
  const as = [-2.4, -2.0, -1.6, -1.2];
  const bs = [-2.4, -2.0, -1.6];
  const entries: SeriesDef['entries'] = [];
  for (const b of bs) {
    for (const a of as) {
      entries.push({
        entry: makeEntry({
          system: 'attractor',
          seed: 7719,
          params: { ...base, a, b, c: -1.2, d: 2.0, washEvery: 2400 },
        }),
        label: `a ${a.toFixed(1)} · b ${b.toFixed(1)}`,
      });
    }
  }
  return {
    id: 'attractor-grid',
    title: 'Series C — parameter grid',
    note: '12 values of a and b · c = −1.2 · d = 2.0 · seed 7719',
    frames: 200,
    columns: 4,
    entries,
  };
}

export interface SeriesSheetProps {
  series: SeriesDef;
  onOpen: (entry: PlateEntry) => void;
}

export function SeriesSheet({ series, onOpen }: SeriesSheetProps) {
  return (
    <section>
      <div className="section-head">
        <h2>{series.title}</h2>
        <p className="micro">{series.note}</p>
      </div>
      <div
        className="plate-grid quieting"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${SPECIMEN_SIZE - 40}px, 1fr))` }}
      >
        {series.entries.map(({ entry, label }, i) => (
          <Specimen
            key={`${series.id}-${i}`}
            entry={entry}
            label={label}
            index={i}
            frames={series.frames}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function Specimen({
  entry,
  label,
  index,
  frames,
  onOpen,
}: {
  entry: PlateEntry;
  label: string;
  index: number;
  frames: number;
  onOpen: (entry: PlateEntry) => void;
}) {
  const def = SYSTEMS[entry.system];
  const { canvasRef, status } = useSettledPlate(entry, SPECIMEN_SIZE, frames);
  const number = `${index + 1}`.padStart(2, '0');

  return (
    <button type="button" className="plate-link" onClick={() => onOpen(entry)}>
      <PlateFrame
        number={number}
        caption={label}
        description={`${def.title} specimen ${number}, ${label}, seed ${entry.seed}. ${status === 'done' ? 'Settled still.' : 'Rendering.'}`}
        sub={status === 'done' ? `seed ${entry.seed}` : status === 'error' ? 'render failed' : 'settling…'}
      >
        <canvas ref={canvasRef} />
      </PlateFrame>
    </button>
  );
}
