import type { MappingRow, ParamSchema } from '../core/types';
import { newMappingRow } from '../audio/mapping';
import { Field } from './controls';

/**
 * The routing table: which feature drives which parameter, by how much, from
 * what baseline, and how heavily smoothed. Rows serialize into the entry.
 */

export interface MappingTableProps {
  rows: MappingRow[];
  featureNames: string[];
  schema: ParamSchema;
  release: number;
  onChange: (rows: MappingRow[]) => void;
  onRelease: (release: number) => void;
  onRestoreSuggested: () => void;
}

export function MappingTable({
  rows,
  featureNames,
  schema,
  release,
  onChange,
  onRelease,
  onRestoreSuggested,
}: MappingTableProps) {
  const update = (index: number, patch: Partial<MappingRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div>
      <Field
        label="release"
        value={release.toFixed(2)}
        note="applied to every route in addition to its own smoothing"
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={release}
          aria-label="global release"
          onChange={(e) => onRelease(Number(e.target.value))}
        />
      </Field>

      {rows.length === 0 ? (
        <p className="field-note" style={{ margin: '4px 0 10px' }}>
          No routes. The plate runs on its base parameters.
        </p>
      ) : null}

      {rows.map((row, i) => (
        <div className="mapping-row" key={`${row.source}-${row.target}-${i}`}>
          <select
            value={row.source}
            aria-label={`route ${i + 1} source feature`}
            onChange={(e) => update(i, { source: e.target.value })}
          >
            {featureNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={row.target}
            aria-label={`route ${i + 1} target parameter`}
            onChange={(e) => update(i, { target: e.target.value })}
          >
            {schema.map((spec) => (
              <option key={spec.key} value={spec.key}>
                {spec.key}
              </option>
            ))}
          </select>

          <div className="span mapping-num">
            <span className="field-label">gain</span>
            <input
              type="number"
              step="any"
              value={row.gain}
              aria-label={`route ${i + 1} gain`}
              onChange={(e) => update(i, { gain: safeNumber(e.target.value, row.gain) })}
            />
            <span />
          </div>

          <div className="span mapping-num">
            <span className="field-label">offset</span>
            <input
              type="number"
              step="any"
              value={row.offset}
              aria-label={`route ${i + 1} offset`}
              onChange={(e) => update(i, { offset: safeNumber(e.target.value, row.offset) })}
            />
            <span />
          </div>

          <div className="span mapping-num">
            <span className="field-label">smooth</span>
            <input
              type="range"
              min={0}
              max={0.99}
              step={0.01}
              value={row.smoothing}
              aria-label={`route ${i + 1} smoothing`}
              onChange={(e) => update(i, { smoothing: Number(e.target.value) })}
            />
            <span className="field-value">{row.smoothing.toFixed(2)}</span>
          </div>

          <div className="span button-row" style={{ marginTop: 2 }}>
            <button
              type="button"
              aria-pressed={row.enabled !== false}
              onClick={() => update(i, { enabled: row.enabled === false })}
            >
              {row.enabled === false ? 'muted' : 'active'}
            </button>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              remove
            </button>
          </div>
        </div>
      ))}

      <div className="button-row" style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => onChange([...rows, newMappingRow(featureNames[0] ?? 'rms', schema[0].key)])}
        >
          add route
        </button>
        <button type="button" onClick={onRestoreSuggested}>
          suggested
        </button>
      </div>
    </div>
  );
}

function safeNumber(raw: string, fallback: number): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}
