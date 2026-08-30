import { useId } from 'react';
import type { DriverId, ParamSchema, Params } from '../core/types';
import { DRIVERS, DRIVER_ORDER } from '../drivers';
import { formatValue } from '../export/metadata';
import { randomSeed } from '../core/rng';

/**
 * The parameter schema, rendered as form controls. Each has a label and a
 * rounded live readout; the readout is the value that goes into the entry.
 */

export interface ParamSlidersProps {
  schema: ParamSchema;
  params: Params;
  /** Params currently written by the mapping are shown, but not editable. */
  drivenKeys?: Set<string>;
  reducedMotion?: boolean;
  onChange: (key: string, value: number) => void;
}

export function ParamSliders({
  schema,
  params,
  drivenKeys,
  reducedMotion,
  onChange,
}: ParamSlidersProps) {
  return (
    <div>
      {schema.map((spec) => {
        const driven = drivenKeys?.has(spec.key) ?? false;
        const inert = reducedMotion && spec.affectsMotion;
        return (
          <Field
            key={spec.key}
            label={spec.label}
            value={formatValue(params[spec.key], spec.decimals, spec.options)}
            note={driven ? 'set by the mapping' : inert ? 'no effect — motion is off' : spec.note}
          >
            {spec.options ? (
              <select
                value={String(Math.round(params[spec.key]))}
                disabled={driven}
                onChange={(e) => onChange(spec.key, Number(e.target.value))}
                aria-label={spec.label}
              >
                {spec.options.map((opt, i) => (
                  <option key={opt} value={i}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="range"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={params[spec.key]}
                disabled={driven}
                aria-label={spec.label}
                onChange={(e) => onChange(spec.key, Number(e.target.value))}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

export interface FieldProps {
  label: string;
  value?: string;
  note?: string;
  children: React.ReactNode;
}

export function Field({ label, value, note, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <div className="field-row">
        <span className="field-label" id={id}>
          {label}
        </span>
        {value !== undefined ? <span className="field-value">{value}</span> : null}
      </div>
      {children}
      {note ? <div className="field-note">{note}</div> : null}
    </div>
  );
}

export interface SeedControlProps {
  seed: number;
  onChange: (seed: number) => void;
}

/** The seed stays visible: it is part of the entry. */
export function SeedControl({ seed, onChange }: SeedControlProps) {
  return (
    <Field label="seed" note="seeds every stochastic decision in the system">
      <div className="seed-row">
        <input
          type="number"
          min={0}
          step={1}
          value={seed}
          aria-label="seed"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(0, Math.floor(v)));
          }}
        />
        <button type="button" onClick={() => onChange(randomSeed())} title="new seed">
          new seed
        </button>
      </div>
    </Field>
  );
}

export interface DriverSelectorProps {
  value: DriverId;
  onChange: (id: DriverId) => void;
}

export function DriverSelector({ value, onChange }: DriverSelectorProps) {
  return (
    <div className="segmented" role="group" aria-label="signal driver">
      {DRIVER_ORDER.map((id) => {
        const def = DRIVERS[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            title={def.blurb}
          >
            <span>{def.label.toLowerCase()}</span>
            <span className={`tag${def.reproducible ? '' : ' performance'}`}>
              {def.reproducible ? 'artifact' : 'performance'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
