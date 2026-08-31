# Input/Output

A dynamical system is a concept used in mathematics and science to describe how something changes and evolves over time according to a specific, fixed rule.

This browser app renders dynamical systems as printable plates with the ability to swap out the data supplying the rule. The systems are a flow field, a reaction–diffusion grid, and a strange attractor. The drivers are a fixed seed, a slow oscillator, a clock, an uploaded audio file, or a live microphone.

## The systems

**1. Flow field.** A seeded Perlin field read as an angle at every point. Particles walk along the local angle and leave low-alpha trails, so density builds up over successive frames.

**2. Reaction–diffusion.** Gray-Scott on a grid, running in a worker. A feed rate adds chemical A, a kill rate removes B, and where you sit in the (f, k) plane decides whether you get spots, stripes, mazes, or mitosis.

**3. Strange attractor.** Two trigonometric recurrences with four parameters, plotted at very low opacity across hundreds of thousands of iterations.

## Running it

```
npm install
npm run dev        # vite dev server
npm run build      # typecheck, then build
npm run typecheck
```

## Layout

```
src/
  core/       rng, rAF loop, spring, plate frame, shared types
  drivers/    static, lfo, time, audio-live, audio-offline
  audio/      fft, feature extraction, envelopes, the mapping table logic
  systems/    flow-field, reaction, attractor
  export/     raster, vector, metadata
  archive/    the UI shell: catalogue, plate view, controls, series
  workers/    reaction step, offline audio decode
```

`core/types.ts` is the place to start if you want the shape of the whole thing in one file.

## Notes

Reduced motion is respected throughout. Plates render to a single settled still and drivers freeze.

`src/archive/` is the main presentation layer, not archived code.
