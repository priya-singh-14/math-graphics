import type { Driver, DriverId } from "../core/types";
import { StaticDriver } from "./static";
import { LFODriver } from "./lfo";
import { TimeDriver } from "./time";
import { AudioOfflineDriver } from "./audio-offline";
import { AudioLiveDriver } from "./audio-live";

export interface DriverDef {
  id: DriverId;
  label: string;
  /** Caption fragment after the system name: "FLOW FIELD · PERLIN NOISE". */
  caption: string;
  blurb: string;
  /** Stated plainly in the UI — the archive doesn't blur this line. */
  reproducible: boolean;
  isAudio: boolean;
}

export const DRIVERS: Record<DriverId, DriverDef> = {
  static: {
    id: "static",
    label: "Static",
    caption: "PERLIN NOISE",
    blurb: "Constant parameters.",
    reproducible: true,
    isAudio: false,
  },
  lfo: {
    id: "lfo",
    label: "LFO",
    caption: "LFO",
    blurb:
      "Four sinusoids, 0.01–0.1 Hz. Rates and phases are derived from the seed.",
    reproducible: true,
    isAudio: false,
  },
  time: {
    id: "time",
    label: "Time",
    caption: "CLOCK",
    blurb: "A monotonic clock. Emits a saw, a triangle and a one-minute ramp.",
    reproducible: true,
    isAudio: false,
  },
  "audio-live": {
    id: "audio-live",
    label: "Audio (live)",
    caption: "AUDIO",
    blurb:
      "Microphone or media element, streamed live.",
    reproducible: false,
    isAudio: true,
  },
  "audio-offline": {
    id: "audio-offline",
    label: "Audio (upload)",
    caption: "AUDIO",
    blurb: "The file is decoded once into a seekable feature timeline.",
    reproducible: true,
    isAudio: true,
  },
};

export const DRIVER_ORDER: DriverId[] = [
  "static",
  "lfo",
  "time",
  "audio-offline",
  "audio-live",
];

export function createSimpleDriver(
  id: "static" | "lfo" | "time",
  seed: number
): Driver {
  switch (id) {
    case "lfo":
      return new LFODriver(seed);
    case "time":
      return new TimeDriver(seed);
    default:
      return new StaticDriver();
  }
}

export {
  StaticDriver,
  LFODriver,
  TimeDriver,
  AudioOfflineDriver,
  AudioLiveDriver,
};
