import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlateFrame } from '../core/plate';
import { prefersReducedMotion, onReducedMotionChange } from '../core/loop';
import type { Driver, DriverId, MappingRow, Params, PlateEntry } from '../core/types';
import { provenanceOf } from '../core/types';
import { SYSTEMS, defaultParams, sanitizeParams } from '../systems';
import { DRIVERS, createSimpleDriver } from '../drivers';
import { AudioOfflineDriver } from '../drivers/audio-offline';
import { AudioLiveDriver } from '../drivers/audio-live';
import { decodeFileToTimeline, AudioDecodeError } from '../audio/decode';
import type { FeatureTimeline } from '../audio/decode';
import {
  downloadBlob,
  entryFilename,
  entryUrl,
  makeEntry,
  metadataEntries,
  plateCaption,
  sidecarBlob,
} from '../export/metadata';
import { renderEntryToBlob } from '../export/raster';
import { renderEntryToSvg, svgBlob, supportsVector } from '../export/vector';
import { usePlateRuntime } from './use-plate-runtime';
import { ParamSliders, SeedControl, DriverSelector } from './controls';
import { MappingTable } from './mapping-table';
import { AudioUpload, FeatureMeters, Transport } from './audio-panel';
import type { AudioStatus } from './audio-panel';

/**
 * The single-plate view: one plate, its controls, its provenance and its
 * exports. The seed stays visible, the URL tracks the current state, and the
 * driver's reproducibility is stated on the page rather than implied.
 */

export interface PlateViewProps {
  entry: PlateEntry;
  onEntryChange: (entry: PlateEntry) => void;
  onClose: () => void;
}

const PLATE_SIZE = 720;

export function PlateView({ entry, onEntryChange, onClose }: PlateViewProps) {
  const def = SYSTEMS[entry.system];

  const [seed, setSeed] = useState(entry.seed);
  const [params, setParams] = useState<Params>(() => sanitizeParams(entry.system, entry.params));
  const [driverId, setDriverId] = useState<DriverId>(entry.driver);
  const [mapping, setMapping] = useState<MappingRow[]>(entry.mapping ?? def.suggestedMapping);
  const [release, setRelease] = useState(0.6);

  const [audioStatus, setAudioStatus] = useState<AudioStatus>({ kind: 'idle' });
  const [timeline, setTimeline] = useState<FeatureTimeline | null>(null);
  const [liveDriver, setLiveDriver] = useState<AudioLiveDriver | null>(null);
  const [playing, setPlaying] = useState(true);

  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [exportState, setExportState] = useState<{ busy: boolean; message: string }>({
    busy: false,
    message: '',
  });
  const [exportSize, setExportSize] = useState(2400);
  const [vectorEnabled, setVectorEnabled] = useState(false);

  const timeRef = useRef<number | null>(null);
  const featuresRef = useRef<Float32Array | null>(null);

  useEffect(() => onReducedMotionChange(setReduced), []);

  /* ---------------------------------------------------------------- */
  /* Driver resolution                                                 */
  /* ---------------------------------------------------------------- */

  const offlineDriver = useMemo(
    () => (timeline ? new AudioOfflineDriver(timeline, release) : null),
    // `release` is applied below rather than here so changing it doesn't
    // discard the decoded timeline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline],
  );

  useEffect(() => {
    offlineDriver?.setRelease(release);
    liveDriver?.setRelease(release);
  }, [release, offlineDriver, liveDriver]);

  const simpleDriver = useMemo(
    () =>
      driverId === 'static' || driverId === 'lfo' || driverId === 'time'
        ? createSimpleDriver(driverId, seed)
        : null,
    [driverId, seed],
  );

  const driver: Driver | null =
    driverId === 'audio-offline'
      ? offlineDriver
      : driverId === 'audio-live'
        ? liveDriver
        : simpleDriver;

  const isAudio = DRIVERS[driverId].isAudio;

  // The offline transport owns the clock; everything else runs on the loop's.
  useEffect(() => {
    timeRef.current = driverId === 'audio-offline' ? (timeRef.current ?? 0) : null;
  }, [driverId]);

  /* ---------------------------------------------------------------- */
  /* The plate                                                         */
  /* ---------------------------------------------------------------- */

  const runtime = usePlateRuntime({
    system: entry.system,
    seed,
    params,
    mapping: isAudio ? mapping : [],
    driver,
    size: PLATE_SIZE,
    timeRef,
    onFeatures: (f) => {
      featuresRef.current = f;
    },
  });

  /* ---------------------------------------------------------------- */
  /* Offline transport clock                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (driverId !== 'audio-offline' || !offlineDriver || !playing || reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = (timeRef.current ?? 0) + dt;
      if (next >= offlineDriver.duration) {
        timeRef.current = offlineDriver.duration;
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [driverId, offlineDriver, playing, reduced]);

  /* ---------------------------------------------------------------- */
  /* The entry — kept in sync with the URL, which is the citation      */
  /* ---------------------------------------------------------------- */

  const currentEntry: PlateEntry = useMemo(
    () =>
      makeEntry({
        system: entry.system,
        seed,
        params,
        driver: driverId,
        mapping: isAudio ? mapping.filter((r) => r.enabled !== false) : undefined,
        audioRef: driverId === 'audio-offline' ? timeline?.hash : undefined,
        frame:
          driverId === 'audio-offline' && offlineDriver
            ? offlineDriver.frameAt(timeRef.current ?? 0)
            : undefined,
        createdAt: entry.createdAt,
        title: entry.title,
      }),
    // `frame` is read at capture time; it deliberately doesn't re-run on every
    // transport tick, or the URL would rewrite itself sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry.system, entry.createdAt, entry.title, seed, params, driverId, mapping, isAudio, timeline, offlineDriver],
  );

  useEffect(() => {
    onEntryChange(currentEntry);
  }, [currentEntry, onEntryChange]);

  /* ---------------------------------------------------------------- */
  /* Audio                                                             */
  /* ---------------------------------------------------------------- */

  const handleFile = useCallback(async (file: File) => {
    setAudioStatus({ kind: 'decoding', progress: 0 });
    try {
      const result = await decodeFileToTimeline(file, {
        onProgress: (stage, value) =>
          setAudioStatus(
            stage === 'decoding'
              ? { kind: 'decoding', progress: value }
              : { kind: 'analysing', progress: value },
          ),
      });
      timeRef.current = 0;
      setTimeline(result);
      setPlaying(true);
      setAudioStatus({
        kind: 'ready',
        name: result.name,
        duration: result.duration,
        hash: result.hash,
      });
    } catch (err) {
      const message =
        err instanceof AudioDecodeError
          ? err.message
          : 'Something went wrong reading that file.';
      setAudioStatus({ kind: 'error', message });
    }
  }, []);

  const clearAudio = useCallback(() => {
    setTimeline(null);
    timeRef.current = 0;
    setAudioStatus({ kind: 'idle' });
  }, []);

  const startMic = useCallback(async () => {
    try {
      const live = await AudioLiveDriver.create({ kind: 'mic' }, release);
      setLiveDriver(live);
      setAudioStatus({ kind: 'idle' });
    } catch (err) {
      setAudioStatus({
        kind: 'error',
        message:
          err instanceof Error ? err.message : 'The microphone could not be opened.',
      });
    }
  }, [release]);

  const stopMic = useCallback(() => {
    setLiveDriver((prev) => {
      prev?.dispose();
      return null;
    });
  }, []);

  useEffect(() => () => liveDriver?.dispose(), [liveDriver]);

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */

  const runExport = useCallback(
    async (kind: 'png' | 'svg' | 'json') => {
      const captured: PlateEntry = {
        ...currentEntry,
        createdAt: new Date().toISOString(),
        frame:
          driverId === 'audio-offline' && offlineDriver
            ? offlineDriver.frameAt(timeRef.current ?? 0)
            : undefined,
      };

      if (kind === 'json') {
        downloadBlob(sidecarBlob(captured, entryUrl(captured)), entryFilename(captured, 'json'));
        setExportState({ busy: false, message: 'sidecar written.' });
        return;
      }

      setExportState({ busy: true, message: 'rendering…' });
      try {
        if (kind === 'png') {
          const blob = await renderEntryToBlob(captured, {
            size: exportSize,
            driver: driverId === 'audio-offline' ? (offlineDriver ?? undefined) : undefined,
            snapshot: driverId === 'audio-live' ? runtime.snapshot() : null,
            onProgress: (v) =>
              setExportState({ busy: true, message: `rendering… ${Math.round(v * 100)}%` }),
          });
          downloadBlob(blob, entryFilename(captured, 'png'));
        } else {
          const svg = await renderEntryToSvg(captured, {
            driver: driverId === 'audio-offline' ? (offlineDriver ?? undefined) : undefined,
            onProgress: (v) =>
              setExportState({ busy: true, message: `tracing… ${Math.round(v * 100)}%` }),
          });
          downloadBlob(svgBlob(svg), entryFilename(captured, 'svg'));
        }
        setExportState({ busy: false, message: 'done.' });
      } catch (err) {
        setExportState({
          busy: false,
          message: err instanceof Error ? err.message : 'Export failed.',
        });
      }
    },
    [currentEntry, driverId, exportSize, offlineDriver, runtime],
  );

  const copyCitation = useCallback(async () => {
    const url = entryUrl(currentEntry);
    try {
      await navigator.clipboard.writeText(url);
      setExportState({ busy: false, message: 'URL copied.' });
    } catch {
      setExportState({ busy: false, message: url });
    }
  }, [currentEntry]);

  /* ---------------------------------------------------------------- */

  const drivenKeys = useMemo(
    () =>
      new Set(isAudio ? mapping.filter((r) => r.enabled !== false).map((r) => r.target) : []),
    [isAudio, mapping],
  );

  const caption = plateCaption(currentEntry, DRIVERS[driverId].caption);
  const provenance = provenanceOf(driverId);

  return (
    <div className="plate-view">
      <div className="rail rail-enter">
        <div className="rail-group">
          <div className="button-row">
            <button type="button" onClick={onClose}>
              ← catalogue
            </button>
            <button type="button" onClick={runtime.restart}>
              clear plate
            </button>
          </div>
        </div>

        <div className="rail-group">
          <h3>signal</h3>
          <DriverSelector value={driverId} onChange={setDriverId} />
          <p className="field-note" style={{ marginTop: 8 }}>
            {DRIVERS[driverId].blurb}
          </p>
        </div>

        {driverId === 'audio-offline' ? (
          <div className="rail-group">
            <h3>track</h3>
            <AudioUpload status={audioStatus} onFile={handleFile} onClear={clearAudio} />
            {offlineDriver ? (
              <div style={{ marginTop: 12 }}>
                <Transport
                  driver={offlineDriver}
                  playing={playing}
                  timeRef={timeRef}
                  onTogglePlay={() => setPlaying((p) => !p)}
                  onSeek={(t) => {
                    timeRef.current = t;
                    if (!playing) runtime.tickOnce(t);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {driverId === 'audio-live' ? (
          <div className="rail-group">
            <h3>input</h3>
            <div className="button-row">
              {liveDriver ? (
                <button type="button" onClick={stopMic}>
                  stop microphone
                </button>
              ) : (
                <button type="button" onClick={startMic}>
                  start microphone
                </button>
              )}
            </div>
            <p
              className={`field-note status${audioStatus.kind === 'error' ? ' error' : ''}`}
              role="status"
              aria-live="polite"
              style={{ marginTop: 8 }}
            >
              {audioStatus.kind === 'error'
                ? audioStatus.message
                : liveDriver
                  ? 'Listening. Not reproducible; an export captures the current canvas.'
                  : 'Microphone off.'}
            </p>
          </div>
        ) : null}

        {isAudio && driver ? (
          <div className="rail-group">
            <h3>mapping</h3>
            <MappingTable
              rows={mapping}
              featureNames={driver.featureNames}
              schema={def.schema}
              release={release}
              onChange={setMapping}
              onRelease={setRelease}
              onRestoreSuggested={() => setMapping(def.suggestedMapping)}
            />
            <FeatureMeters names={driver.featureNames} valuesRef={featuresRef} />
          </div>
        ) : null}

        <div className="rail-group">
          <h3>seed</h3>
          <SeedControl seed={seed} onChange={setSeed} />
        </div>

        <div className="rail-group">
          <h3>parameters</h3>
          <ParamSliders
            schema={def.schema}
            params={params}
            drivenKeys={drivenKeys}
            reducedMotion={reduced}
            onChange={(key, value) => setParams((p) => ({ ...p, [key]: value }))}
          />
          <div className="button-row">
            <button type="button" onClick={() => setParams(defaultParams(entry.system))}>
              defaults
            </button>
          </div>
        </div>

        <div className="rail-group">
          <h3>export</h3>
          <label className="field-label" htmlFor="export-size">
            print size
          </label>
          <select
            id="export-size"
            value={exportSize}
            onChange={(e) => setExportSize(Number(e.target.value))}
            style={{ marginBottom: 8 }}
          >
            <option value={1200}>1200 px · screen</option>
            <option value={2400}>2400 px · large</option>
            <option value={4000}>4000 px · print</option>
          </select>

          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={exportState.busy}
              onClick={() => runExport('png')}
            >
              png
            </button>
            <button type="button" disabled={exportState.busy} onClick={() => runExport('json')}>
              sidecar
            </button>
            <button type="button" onClick={copyCitation}>
              copy url
            </button>
          </div>

          {supportsVector(currentEntry) ? (
            <div style={{ marginTop: 10 }}>
              <div className="button-row">
                <button
                  type="button"
                  aria-pressed={vectorEnabled}
                  onClick={() => setVectorEnabled((v) => !v)}
                >
                  vector export {vectorEnabled ? 'on' : 'off'}
                </button>
                <button
                  type="button"
                  disabled={!vectorEnabled || exportState.busy}
                  onClick={() => runExport('svg')}
                >
                  svg
                </button>
              </div>
              <p className="field-note" style={{ marginTop: 6 }}>
                One element per mark. Suitable for large-format print; files are large.
              </p>
            </div>
          ) : (
            <p className="field-note" style={{ marginTop: 8 }}>
              This system is a grid of values. Raster export only.
            </p>
          )}

          <p className="field-note status" role="status" aria-live="polite" style={{ marginTop: 8 }}>
            {exportState.message}
          </p>
        </div>
      </div>

      <div className="plate-stage enter">
        <PlateFrame
          number={def.plate}
          caption={caption}
          description={`${def.title}, seed ${seed}, driven by ${DRIVERS[driverId].label}. ${def.blurb}`}
          sub={
            <>
              seed {seed} · {provenance}
              {reduced ? ' · settled still (reduced motion)' : ''}
            </>
          }
        >
          <canvas ref={runtime.canvasRef} />
        </PlateFrame>

        {reduced ? (
          <p className="field-note" style={{ marginTop: 10 }}>
            Reduced motion is on. The plate renders as a settled still and drift is frozen.
            Parameters marked “no effect” govern motion only.
          </p>
        ) : null}

        <div className="entry-block">
          <span className="field-label">entry</span>
          <dl className="entry-data">
            {metadataEntries(currentEntry).map((row) => (
              <div className="entry-row" key={row.key}>
                <dt>{row.key}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rule-block">
          <span className="field-label">rule</span>
          <div className="formula">{def.rule}</div>
        </div>

        <p className="lede">{def.blurb}</p>

        <p className="field-note">
          {provenance === 'artifact'
            ? 'Reproducible from this entry. An export re-runs the simulation at the target resolution rather than upscaling the canvas.'
            : 'Not reproducible. Live input has no timeline to replay; an export captures the current canvas and records the driver as audio-live.'}
        </p>
      </div>
    </div>
  );
}
