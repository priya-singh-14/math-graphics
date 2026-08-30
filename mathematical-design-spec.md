# Mathematical Design — Build Spec

*A body of generative work presented as an editorial monograph. Each piece is a single rule made visible, driven by a signal — mathematical or audio — and rendered as a reproducible, exportable plate.*

---

## 1. Concept

**Mathematical Design** is an archive collection, not a single toy. It presents a family of generative systems — a flow field, a reaction–diffusion process, and a strange attractor — as *plates* in a printed volume: ink on paper, numbered, captioned in monospace, catalogued.

Every plate is the output of one deterministic system reacting to a signal over time. The signal can be static (a seed), temporal (an LFO or clock), or **audio** (features extracted from an uploaded track). The system doesn't know or care where its numbers come from — this separation is the central architectural idea.

Three properties make each piece archive-worthy rather than a demo:

1. **Seedable / reproducible** — a given seed + parameters + driver produces the same output every time.
2. **A series, not a single output** — each system is presented as a catalogue (a sheet of seeds, a taxonomy of parameters), which reads as rigor.
3. **Exportable as a print artifact** — every plate renders to high-resolution PNG (and SVG where the geometry allows) with embedded metadata, so it has a life outside the browser.

### Editorial register

The visual language is deliberately restrained: two colors only (ink on paper), hairline strokes, monospace captions, plate numbers, generous margin. The tell that separates this from a "rave visualizer" or a CodePen is *restraint and reproducibility* — heavy smoothing, considered mappings, stable palette, citable outputs.

---

## 2. Design system

### Palette

Strictly two colors. Hardcoded and **mode-stable** — the plates do **not** invert in dark mode (they are physical ink-on-paper scenes; the surrounding UI chrome may theme, the plates never do).

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#EFEDE4` | Background / substrate |
| `--ink` | `#1A1A18` | Marks |
| `--paper-edge` | `#C9C6BB` | Plate hairline border (0.5px) |
| `--label` | `#8A867A` | Plate numbers |
| `--caption` | `#5F5E5A` | Captions |

Accumulation is achieved through low-alpha ink (typically 6–12%), never through additional colors. If a second ink is ever introduced for a specific series, it must be a single warm neutral (e.g. a red-oxide `#8A3B2E`) used as a categorical accent only, never a rainbow.

### Typography

- **Captions, plate numbers, controls, metadata:** sans serif, lowercase, letter-spacing `0.04–0.08em`, 11px.
- **Body / editorial prose** (about pages, catalogue intros): the site's serif voice.
- **Sentence case** everywhere except plate numbers (`PL. 01`) and the captions, which are a deliberate typographic device.

### Plate framing

Every rendered system sits in a **plate frame**: a 1:1 `--paper` panel, `0.5px solid --paper-edge`, `border-radius: 2px`, with a plate number top-left (`PL. NN`) and an uppercase mono caption below naming the system and its driver (`FLOW FIELD · PERLIN NOISE`, or `FLOW FIELD · AUDIO`). This frame is the atomic unit of the archive and the export.

### Layout

- Catalogue index: responsive grid, `repeat(auto-fit, minmax(190px, 1fr))`, 20px gap.
- Single-plate view: centered plate at up to 720px, controls in a left rail (desktop) or below (mobile).
- Print/export: plate + a metadata footer (system, seed, params, driver, timestamp).

- **Spring config** for any UI transition (control panels, plate open/close): `{ stiffness: 170, damping: 30, mass: 1 }` — the same slight-overshoot settle used by the grid's hover box.
- **Bouncy in, quiet out** — entrances (a plate opening, a control rail sliding in) overshoot; exits are critically damped, no rebound, ~70–80% of the entrance duration.
- **Everything animatable runs through a transform/opacity channel**, never a competing CSS layout transition — the same lesson as the grid engine owning `transform`.
- **`prefers-reduced-motion`** collapses all ambient animation: plates render to a single settled still, drivers freeze at t=0 (or a chosen frame), no auto-drift.

---

## 3. Architecture

### Stack

- Rendering: HTML5 Canvas 2D for accumulation-based plates (flow field, attractor); a typed grid + `ImageData` (or WebGL/`OffscreenCanvas` for performance) for reaction–diffusion.
- Web Audio API for the audio driver. `OfflineAudioContext` for deterministic decode.
- All heavy per-pixel work (reaction–diffusion, offline audio decode) runs in a **Web Worker** to keep the main thread free.

### The central abstraction: driver → mapping → system

```
Driver.tick(t) ──▶ Float32Array (feature vector, normalized 0–1)
        │
        ▼
   Mapping.apply(features) ──▶ Params (system-specific)
        │
        ▼
   System.step(params) ──▶ draws onto canvas
        │
        ▼
   Exporter.render(system, seed, params, mapping) ──▶ PNG/SVG + metadata
```

A **System** never reads audio, time, or a seed directly. It exposes `reset(seed)`, `step(params)`, and `renderTo(ctx, scale)`. It receives fully-resolved `params` each frame. This is what makes every system audio-capable for free and keeps math-mode vs audio-mode a driver swap rather than a rewrite.

### Module structure

```
mathematical-design/
├── core/
│   ├── rng.ts            # seedable PRNG (mulberry32 / xoshiro128)
│   ├── loop.ts           # rAF loop, reduced-motion aware, pause/resume
│   ├── plate.ts          # Plate frame component (border, number, caption)
│   └── types.ts          # System, Driver, Mapping, Params interfaces
├── drivers/
│   ├── static.ts         # StaticDriver   — constant params (pure seed)
│   ├── lfo.ts            # LFODriver      — slow sinusoidal param morph
│   ├── time.ts           # TimeDriver     — monotonic clock (noise z-drift)
│   ├── audio-live.ts     # AudioLiveDriver    — mic / element, streamed
│   └── audio-offline.ts  # AudioOfflineDriver — decoded timeline, seekable
├── audio/
│   ├── features.ts       # RMS, bands, spectral centroid, onset  (shared)
│   ├── decode.ts         # OfflineAudioContext → feature timeline
│   ├── envelope.ts       # one-pole smoothers, attack/release, normalizers
│   └── mapping.ts        # routing table (feature→param, gain, smoothing)
├── systems/
│   ├── flow-field.ts     # PL. 01
│   ├── reaction.ts       # PL. 02  (worker-backed)
│   └── attractor.ts      # PL. 03
├── export/
│   ├── raster.ts         # offscreen high-DPI PNG render
│   ├── vector.ts         # SVG export (attractor / flow paths)
│   └── metadata.ts       # entry schema, filename, sidecar JSON
└── archive/
    ├── catalogue.tsx     # index grid of plates / series
    └── plate-view.tsx    # single plate + controls + export
```

### Shared interfaces

```ts
interface System<P> {
  reset(seed: number): void;
  step(params: P): void;                 // advance one frame
  renderTo(ctx: CanvasRenderingContext2D, scale: number): void;
  readonly paramSchema: ParamSchema<P>;  // names, ranges, defaults
}

interface Driver {
  tick(tSeconds: number): Float32Array;  // normalized feature vector
  readonly featureNames: string[];       // e.g. ["rms","bass","mid","high","centroid","onset"]
  seekable?: boolean;                     // true for AudioOfflineDriver
  duration?: number;
}

interface MappingRow {
  source: string;   // feature name
  target: string;   // param name
  gain: number;     // scalar
  offset: number;   // baseline
  smoothing: number;// 0..1 release amount
}
```

---

## 4. Reproducibility model

Every archive entry is fully described by:

```ts
interface PlateEntry {
  system: "flow-field" | "reaction" | "attractor";
  seed: number;
  params: Record<string, number>;   // resolved defaults / static overrides
  driver: "static" | "lfo" | "time" | "audio-live" | "audio-offline";
  audioRef?: string;                // file hash or asset id (offline only)
  mapping?: MappingRow[];           // present when driver is audio
  frame?: number;                   // for seekable drivers: the captured moment
  createdAt: string;                // ISO timestamp
  title?: string;
}
```

- The **seed** flows through `core/rng.ts` into everything stochastic (particle spawns, RD seed points, attractor start). No `Math.random()` anywhere in a system — all randomness is seeded.
- Entries are **URL-encodable**: `?sys=flow-field&seed=48273&…` reconstructs a plate exactly. This is the citation mechanism.
- **Determinism boundary (state honestly in the UI):**
  - `static`, `lfo`, `time`, `audio-offline` → **artifact**. Reproducible pixel-for-pixel given the entry (audio-offline requires the same source file; hash it).
  - `audio-live` → **performance**. Not reproducible; used for interaction/exhibition only. Export from live mode captures a still but marks the entry `driver: "audio-live"` with no reproducibility guarantee.

---

## 5. The signal drivers

All drivers emit a normalized `Float32Array` per frame on the same interface. Math-mode and audio-mode differ only in the driver.

### StaticDriver
Emits a constant vector. Produces the classic single seeded plate.

### LFODriver
One or more slow sinusoids (`0.01–0.1 Hz`). Drives the attractor's parameter morph and any "breathing" motion. Deterministic (phase derived from seed).

### TimeDriver
Monotonic clock; used for the flow field's noise `z`-drift so the field evolves.

### Audio driver — shared feature extractor (`audio/features.ts`)

Both audio drivers use the **same** extractor so live and offline are interchangeable. Never feed raw samples downstream — feed *features*:

| Feature | Source | Maps well to |
|---|---|---|
| `rms` | time-domain amplitude | trail opacity, particle count, overall energy |
| `bass` | FFT low band (log-spaced) | feed/kill nudge, attractor A/B |
| `mid` | FFT mid band | noise scale, attractor C |
| `high` | FFT high band | fine turbulence, attractor D |
| `centroid` | spectral centroid | "brightness" → noise scale / step length |
| `onset` | energy spike vs rolling avg | seed resets, chemical drops, param jolts |

FFT size 2048; log-spaced band edges; centroid computed from the magnitude spectrum; onset via energy > (rolling mean × threshold) with a refractory window.

### AudioLiveDriver (`drivers/audio-live.ts`) — performance mode
`getUserMedia` (mic) or a `<audio>`/`<video>` element → `MediaElementAudioSourceNode` → `AnalyserNode`. Per frame: read frequency + time-domain arrays, compute features, normalize against a **rolling window** (loud/quiet tracks stay comparable). Streamed; not seekable; not reproducible.

### AudioOfflineDriver (`drivers/audio-offline.ts`) — archive mode
On upload: `OfflineAudioContext` decodes the whole buffer, walks it once, and produces a **feature timeline** (array of frames, e.g. at 60 fps). Because the future is known, normalize per-feature against the **whole file's** min/max. The timeline is:

- **seekable** — scrub to any time, `frame` is captured in the entry.
- **deterministic** — same file → same timeline → same plate. This is the exportable/printable path.

### Envelope & normalization (`audio/envelope.ts`)

Two non-negotiables, built in from the start (retrofitting is painful):

- **Smoothing (attack/release):** each feature passes through a one-pole envelope follower — fast attack, slow release — before the mapping. Release time is a global control. Heavy smoothing is the difference between "editorial" and "twitchy visualizer."
- **Normalization:** the mapping always operates on `0–1` features so a mapping table transfers between tracks. Offline: normalize to file min/max. Live: rolling window.

### Mapping (`audio/mapping.ts`)

The routing table is the primary *creative* surface. A small UI: rows of `source feature → target parameter`, each with `gain`, `offset`, and per-row `smoothing`. Serialized into the entry. This is what turns "audio reactive" from a black box into a designed instrument.

---

## 6. The three systems

### PL. 01 — Flow field (Perlin noise)

**Rule.** A vector field where the value of a Perlin/simplex noise function at each point is read as an angle. Particles step along the local angle and leave faint low-alpha trails; the field's structure accumulates as line density over time.

**Math.**
```
angle(x, y, t) = noise(x·s, y·s + t) · 2π · turns
p' = p + (cos angle, sin angle) · step
```
Value/simplex noise implemented from a seeded permutation table (`core/rng.ts`). Optional fractal octaves for finer texture.

**Parameters (schema).**

| Param | Range | Default | Notes |
|---|---|---|---|
| `noiseScale` `s` | 0.002–0.02 | 0.008 | field granularity |
| `octaves` | 1–4 | 1 | fractal detail |
| `turns` | 1–6 | 4 | angular multiplier (curl intensity) |
| `step` | 0.5–2.5 | 1.1 | particle speed |
| `count` | 100–2000 | 700 | particle population |
| `trailAlpha` | 0.04–0.15 | 0.10 | accumulation weight |
| `resetEvery` | frames | 900 | soft paper wash cadence |

**Rendering.** Start on `--paper`. Each frame batch-draw all particle segments as one path at `trailAlpha` ink, 0.5px. Respawn particles at end-of-life or off-canvas (seeded). Periodic soft wash (`--paper` at ~0.55α) prevents saturation and gives the woodgrain/topographic look.

**Audio mapping (recommended).** `centroid → noiseScale` (brighter = finer/more turbulent), `rms → count` or `step`, `onset → seeded respawn burst`. Because it accumulates, the finished still is a *portrait of the whole track's texture*.

**Series concept.** A contact sheet of seeds at fixed parameters — a page of variations that share DNA.

**Export.** Raster (accumulation is intrinsic). Optionally re-simulate at higher particle count for print.

---

### PL. 02 — Reaction–diffusion (Gray–Scott)

**Rule.** Two simulated chemicals A and B diffuse across a grid; B autocatalyses by consuming A; a *feed* rate adds A and a *kill* rate removes B. Tiny changes in feed/kill cross boundaries between spots, stripes, mazes, and mitosis-like blooms — a taxonomy in a two-number space.

**Math (per cell, per iteration).**
```
A' = A + (Da·∇²A − A·B² + f·(1 − A)) · dt
B' = B + (Db·∇²B + A·B² − (k + f)·B) · dt
```
`∇²` is the Laplacian (9-point stencil). Typical: `Da=1.0, Db=0.5, dt=1`. The (`f`,`k`) plane is the design space; e.g. `f=0.037, k=0.062` → worms/spots.

**Parameters (schema).**

| Param | Range | Default | Notes |
|---|---|---|---|
| `feed` `f` | 0.010–0.090 | 0.037 | the primary axis |
| `kill` `k` | 0.045–0.070 | 0.062 | the secondary axis |
| `Db` | 0.3–0.6 | 0.5 | diffusion ratio |
| `iterationsPerFrame` | 4–16 | 8 | sim speed |
| `gridSize` | 100–300 | 160 | resolution (perf-bound) |
| `seedPattern` | enum | center | initial B placement (seeded) |

**Rendering.** Map `A − B` (clamped 0–1) to a `--paper → --ink` lerp via `ImageData`. Ink where B dominates. Runs in a **Web Worker**; transfer the buffer to the main thread for `putImageData`. Upscale the grid to the plate with `image-rendering: pixelated` (or bilinear for a softer plate — choose per series).

**Audio mapping (recommended).** Slow features only — `rms`/`bass → feed/kill nudge` so the pattern *phase-transitions* with energy; `onset → inject B seed points` (drops of chemical that bloom). Do **not** beat-sync; RD is slow by nature.

**Series concept.** A **catalogue of the (f,k) plane** — a grid of plates at sampled coordinates. This is the most "scientific plate" of the three and reads as a taxonomy.

**Export.** Raster from the grid buffer at high grid resolution (render a larger grid offscreen for print, run to convergence).

---

### PL. 03 — Strange attractor (de Jong)

**Rule.** Four parameters drive a pair of trigonometric recurrences. Iterating the map hundreds of thousands of times and plotting each landing point at very low opacity lets density accumulate into smoke-like filamentary forms.

**Math.**
```
xₙ₊₁ = sin(a·yₙ) − cos(b·xₙ)
yₙ₊₁ = sin(c·xₙ) − cos(d·yₙ)
```
Plot each `(x, y)` mapped to plate coordinates; density = overlap of many low-alpha marks. (Clifford and Lorenz variants are drop-in alternates behind the same interface.)

**Parameters (schema).**

| Param | Range | Default | Notes |
|---|---|---|---|
| `a` | −3.0–3.0 | −2.0 | |
| `b` | −3.0–3.0 | −2.0 | |
| `c` | −3.0–3.0 | −1.2 | |
| `d` | 1.0–3.0 | 2.0 | |
| `pointsPerFrame` | 1000–5000 | 2200 | density build rate |
| `pointAlpha` | 0.03–0.10 | 0.06 | |
| `scale` | fraction of plate | 0.24 | zoom |

**Rendering.** Accumulate `pointsPerFrame` points per frame at `pointAlpha` ink onto `--paper`. Periodic soft wash to allow slow morphs without total saturation.

**Audio / LFO mapping.** `bands → a/b/c/d` with **heavy** smoothing so the form breathes and reorganizes rather than thrashing. This is the showiest system — restraint in smoothing is essential.

**Series concept.** A **parameter grid** — a sheet of forms at sampled (a,b,c,d), each citable by its coordinates.

**Export.** Both raster (density) and — because it's pure point geometry — an optional **SVG** export for very high-resolution print (accumulate points into a path; large files, gate behind a "vector export" toggle).

---

## 7. Interaction spec

### Single-plate view

- Left rail (desktop) / bottom sheet (mobile): the parameter schema rendered as sliders, each with a rounded live readout (`Math.round`/`toFixed`).
- **Driver selector:** Static · LFO · Time · Audio (live) · Audio (upload).
- When a driver is audio: reveal the **mapping table** (source→target rows, gain, smoothing) and, for offline, a **transport** (play/scrub/seek over the decoded timeline).
- **Seed control:** numeric field + "new seed" (dice) + the current seed always visible for citation.
- **Reduced motion:** if set, plate renders to a settled still and controls that would animate the field are marked as such.

### Motion

- Plate open/close and rail slide use the shared spring (`170/30/1`), bouncy-in / quiet-out.
- Panning/zooming a plate (if enabled) runs through the transform channel, never a layout transition.

### Catalogue view

- Grid of plate frames (as rendered in §2). Hover treatment reuses the site's *new* focus vocabulary (not the retired viewfinder box) — a quieting of neighbors / steadying of ambient motion.
- Click opens the single-plate view; clicking a second plate while one is open slides focus between them (collapse-while-opening), matching the grid's hero-to-hero behavior.

---

## 8. Export & print pipeline

### Raster (`export/raster.ts`)

- Render into an **offscreen canvas** at print resolution: target long edge (e.g. 4000px) × `exportScale`.
- For accumulation systems, **re-run the simulation** offscreen to the desired settle count rather than upscaling the on-screen canvas (upscaling low-alpha trails looks muddy).
- Composite the **metadata footer** below the plate: system, seed, params, driver, timestamp, in mono. This makes the exported file self-documenting and citable.
- Filename encodes the entry: `mathdesign_flow-field_seed48273_f037k062_2026-08-29.png`.

### Vector (`export/vector.ts`)

- Attractor and flow-field paths can export to SVG for large-format print. Gate behind a toggle (file size). RD is raster-only.

### Metadata sidecar (`export/metadata.ts`)

- Alongside each export, optionally write a `.json` sidecar = the full `PlateEntry`. Re-import reconstructs the plate. This is the archive's provenance record.

### Color management

- `--paper`/`--ink` are fixed hex; exports are mode-independent (never inverted). For print, document the target values (consider a slightly warmer paper and denser ink for CMYK if you go to physical print).

---

## 9. Performance

- Reaction–diffusion in a **Web Worker**; transfer `ArrayBuffer`, don't clone.
- Offline audio decode in a worker too (it's a full-file walk).
- Cap `devicePixelRatio` at 2 for on-screen canvases; export uses its own scale.
- Batch canvas ops: one `beginPath`/`stroke` per frame for the flow field; one `putImageData` for RD; one fill loop for the attractor.
- Pause the rAF loop when a plate is off-screen (IntersectionObserver, mirroring the grid's video autoplay approach).
- Guard against runaway accumulation with the periodic soft-wash cadence.

---

## 10. Accessibility

- Every plate frame carries an `aria-label` / offscreen summary describing the system and driver.
- `prefers-reduced-motion`: no ambient animation; render a settled still.
- Controls are real form elements (sliders, selects) with labels; keyboard operable.
- Audio upload states are announced (decoding, ready, error). File-type/duration validation with inline errors.
- Never rely on color alone (there are only two colors — meaning is carried by density/geometry and by text captions).

---

## 11. Build phases

**Phase 0 — foundations.** `core/rng.ts`, `core/loop.ts`, `core/types.ts`, `core/plate.ts`. Reduced-motion plumbing. The System interface + a trivial test system to prove the loop and plate frame.

**Phase 1 — the three systems, static driver only.** Implement flow-field, reaction (worker), attractor against `StaticDriver`. Seed control + URL encoding. This gets the pure-math plates fully working and citable.

**Phase 2 — export.** Raster pipeline with metadata footer + filename + sidecar. Ship the catalogue index and single-plate view. At this point it's a complete archivable project.

**Phase 3 — temporal drivers.** `LFODriver`, `TimeDriver`. Attractor morph, flow-field drift. "Breathing" plates.

**Phase 4 — audio.** `audio/features.ts`, `envelope.ts`, then `AudioOfflineDriver` (archive-grade, deterministic) first, `AudioLiveDriver` (performance) second. Mapping table UI. Transport for offline. Vector (SVG) export as a stretch.

**Phase 5 — series & polish.** Catalogue *series* (seed sheets, (f,k) plane grid, attractor parameter grid). Motion polish (springs, hero-to-hero). Print-resolution tuning.

---

## 12. Open decisions to lock before Phase 4

1. **Uploaded audio: ephemeral vs stored.** For a public archive, lean **ephemeral** for arbitrary uploads (decode → drive → discard; privacy + hosting simplicity), with a curated few tracks you own shipped for playback. Affects `audioRef` and the entry schema — decide first.
2. **RD render style:** pixelated (crisp, plate-like) vs bilinear (soft) — may differ per series.
3. **Vector export scope:** attractor only, or flow field too.
4. **Second ink:** commit to strictly one ink, or allow a single warm accent for a specific series.
5. **Print target:** screen-only, or true CMYK physical print (changes paper/ink values and export color handling).

---

*Naming convention for entries: `PL. NN` in the UI; `mathdesign_{system}_seed{n}_{paramslug}_{date}` for files. Every plate is one rule, one seed, one signal — made visible.*
