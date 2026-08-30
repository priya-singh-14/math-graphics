/**
 * Motion vocabulary, carried over from the grid work so the whole site reads as
 * one hand: everything animatable runs through a transform/opacity channel and
 * settles on a spring, never a competing CSS layout transition.
 *
 * Entrances use the shared config; exits are critically damped (no rebound) and
 * run at ~75% of the entrance duration — "bouncy in, quiet out".
 */

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/** The shared config. Same settle used by the grid's hover box. */
export const SPRING_IN: SpringConfig = { stiffness: 170, damping: 30, mass: 1 };

/**
 * Quiet out. Critical damping for k=170, m=1 is 2*sqrt(k*m) ≈ 26.1, so the
 * exit is stiffer and firmly damped to guarantee no rebound on the way out.
 */
export const SPRING_OUT: SpringConfig = { stiffness: 300, damping: 35, mass: 1 };

const REST_DISPLACEMENT = 0.001;
const REST_VELOCITY = 0.001;

/** A single scalar on a spring. Step it with a frame delta, read `.value`. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  config: SpringConfig;

  constructor(initial: number, config: SpringConfig = SPRING_IN) {
    this.value = initial;
    this.target = initial;
    this.config = config;
  }

  setTarget(target: number, config?: SpringConfig): void {
    this.target = target;
    if (config) this.config = config;
  }

  /** Snap without animating — the reduced-motion path. */
  jumpTo(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  get atRest(): boolean {
    return (
      Math.abs(this.target - this.value) < REST_DISPLACEMENT &&
      Math.abs(this.velocity) < REST_VELOCITY
    );
  }

  /** `dt` in seconds. Sub-stepped so a dropped frame can't blow the integrator up. */
  step(dt: number): number {
    const { stiffness, damping, mass } = this.config;
    const clamped = Math.min(dt, 0.064);
    const steps = Math.max(1, Math.ceil(clamped / 0.008));
    const h = clamped / steps;
    for (let i = 0; i < steps; i++) {
      const force = -stiffness * (this.value - this.target);
      const drag = -damping * this.velocity;
      const accel = (force + drag) / mass;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    if (this.atRest) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
}
