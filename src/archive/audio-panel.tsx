import { useEffect, useRef } from "react";
import type { AudioOfflineDriver } from "../drivers/audio-offline";
import { FEATURE_INDEX } from "../audio/features";
import { PALETTE } from "../core/palette";
import { get2d } from "../systems/flow-field";

/**
 * Audio surfaces: upload, transport and feature meters. The transport scrubs
 * the decoded timeline; the meters show the feature vector for the current
 * frame, after smoothing.
 */

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export type AudioStatus =
  | { kind: "idle" }
  | { kind: "decoding"; progress: number }
  | { kind: "analysing"; progress: number }
  | { kind: "ready"; name: string; duration: number; hash: string }
  | { kind: "error"; message: string };

export interface AudioUploadProps {
  status: AudioStatus;
  onFile: (file: File) => void;
  onClear: () => void;
}

export function AudioUpload({ status, onFile, onClear }: AudioUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <div className="button-row">
        <button type="button" onClick={() => inputRef.current?.click()}>
          choose a track
        </button>
        {status.kind === "ready" ? (
          <button type="button" onClick={onClear}>
            clear
          </button>
        ) : null}
      </div>

      {/* Decoding, ready and error states are announced, not just shown. */}
      <p
        className={`field-note status${
          status.kind === "error" ? " error" : ""
        }`}
        role="status"
        aria-live="polite"
        style={{ marginTop: 8 }}
      >
        {describeStatus(status)}
      </p>

      <p className="field-note" style={{ marginTop: 6 }}>
        The file is not stored or transmitted; the entry records a hash of it.
      </p>
    </div>
  );
}

function describeStatus(status: AudioStatus): string {
  switch (status.kind) {
    case "decoding":
      return "decoding…";
    case "analysing":
      return `analysing… ${Math.round(status.progress * 100)}%`;
    case "ready":
      return `${status.name} · ${formatTime(status.duration)} · ${status.hash}`;
    case "error":
      return status.message;
    default:
      return "No track loaded.";
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export interface TransportProps {
  driver: AudioOfflineDriver;
  playing: boolean;
  /** Read imperatively so the playhead can move without re-rendering the tree. */
  timeRef: React.MutableRefObject<number | null>;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
}

export function Transport({
  driver,
  playing,
  timeRef,
  onTogglePlay,
  onSeek,
}: TransportProps) {
  const ribbonRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const duration = driver.duration;

  // Peak RMS across the whole file, drawn once.
  useEffect(() => {
    const canvas = ribbonRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 34;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = get2d(canvas);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, width, height);

    const { frames, frameCount, featureCount } = driver.timeline;
    const step = Math.max(1, Math.floor(frameCount / width));
    ctx.strokeStyle = "rgba(26,26,24,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const f = Math.min(frameCount - 1, Math.floor((x / width) * frameCount));
      let peak = 0;
      for (let k = 0; k < step; k++) {
        const idx =
          Math.min(frameCount - 1, f + k) * featureCount + FEATURE_INDEX.rms;
        peak = Math.max(peak, frames[idx]);
      }
      const h = peak * (height - 4);
      ctx.moveTo(x + 0.5, height - 2);
      ctx.lineTo(x + 0.5, height - 2 - h);
    }
    ctx.stroke();
  }, [driver]);

  // The playhead runs on its own rAF through the transform channel.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = timeRef.current ?? 0;
      const ratio = duration > 0 ? Math.min(1, t / duration) : 0;
      const head = headRef.current;
      if (head?.parentElement) {
        head.style.transform = `translate3d(${
          ratio * head.parentElement.clientWidth
        }px, 0, 0)`;
      }
      if (scrubRef.current && document.activeElement !== scrubRef.current) {
        scrubRef.current.value = String(t);
      }
      if (labelRef.current) {
        labelRef.current.textContent = `${formatTime(t)} / ${formatTime(
          duration
        )}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, timeRef]);

  return (
    <div className="transport">
      <div className="transport-track">
        <canvas className="ribbon" ref={ribbonRef} aria-hidden="true" />
        <div className="transport-head" ref={headRef} aria-hidden="true" />
      </div>

      <div className="transport-row">
        <button type="button" onClick={onTogglePlay} aria-pressed={playing}>
          {playing ? "pause" : "play"}
        </button>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={duration}
          step={1 / driver.timeline.fps}
          defaultValue={0}
          aria-label="position in the track"
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <span className="field-value" ref={labelRef}>
          0:00 / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meters                                                              */
/* ------------------------------------------------------------------ */

export interface FeatureMetersProps {
  names: string[];
  valuesRef: React.MutableRefObject<Float32Array | null>;
}

/** Reads the feature vector imperatively — 60 fps of React state would be silly. */
export function FeatureMeters({ names, valuesRef }: FeatureMetersProps) {
  const fillsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const values = valuesRef.current;
      if (values) {
        for (let i = 0; i < fillsRef.current.length; i++) {
          const el = fillsRef.current[i];
          if (!el) continue;
          const v = Math.max(0, Math.min(1, values[i] ?? 0));
          el.style.transform = `scaleX(${v.toFixed(3)})`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [valuesRef]);

  return (
    <div className="meters" aria-hidden="true">
      {names.map((name, i) => (
        <div className="meter" key={name}>
          <span className="field-label">{name}</span>
          <div className="meter-track">
            <div
              className="meter-fill"
              ref={(el) => {
                fillsRef.current[i] = el;
              }}
              style={{ transform: "scaleX(0)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
