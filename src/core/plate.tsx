import type { ReactNode } from 'react';

/**
 * The plate frame: a 1:1 paper panel, hairline border, plate number top-left,
 * uppercase caption below. The catalogue is a grid of these, the
 * single-plate view is one large one, and the export composites the same
 * arrangement.
 *
 * Monospace is confined to the plate label and caption; the surrounding chrome
 * uses the sans voice.
 */

export interface PlateFrameProps {
  /** "PL. 01" */
  number: string;
  /** "FLOW FIELD · PERLIN NOISE" */
  caption: string;
  /** Optional second line: seed, provenance, coordinates. */
  sub?: ReactNode;
  /**
   * Describes the plate for anyone not looking at it. Meaning is carried by
   * density and geometry, neither of which a screen reader can infer.
   */
  description: string;
  children: ReactNode;
  className?: string;
}

export function PlateFrame({
  number,
  caption,
  sub,
  description,
  children,
  className,
}: PlateFrameProps) {
  return (
    <figure className={`plate${className ? ` ${className}` : ''}`}>
      <div className="plate-frame" role="img" aria-label={description}>
        {children}
        <span className="plate-number" aria-hidden="true">
          {number}
        </span>
      </div>
      <figcaption className="plate-caption">{caption}</figcaption>
      {sub ? <div className="plate-sub">{sub}</div> : null}
    </figure>
  );
}
