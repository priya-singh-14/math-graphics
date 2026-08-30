import { useCallback, useEffect, useState } from 'react';
import type { PlateEntry } from '../core/types';
import { decodeEntry, encodeEntry } from '../export/metadata';
import { Catalogue } from './catalogue';
import { PlateView } from './plate-view';

/**
 * The archive shell.
 *
 * The URL always describes the plate on screen. There is no server and no
 * database: the entry encoded in the query string is the whole record.
 */

export function App() {
  const [entry, setEntry] = useState<PlateEntry | null>(() =>
    typeof location !== 'undefined' ? decodeEntry(new URLSearchParams(location.search)) : null,
  );

  // Back and forward move between the catalogue and a plate.
  useEffect(() => {
    const onPop = () => setEntry(decodeEntry(new URLSearchParams(location.search)));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((next: PlateEntry) => {
    setEntry(next);
    history.pushState(null, '', `?${encodeEntry(next).toString()}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const close = useCallback(() => {
    setEntry(null);
    history.pushState(null, '', location.pathname);
  }, []);

  /**
   * Live edits rewrite the address in place — a citation, not a history entry.
   * Deliberately does *not* lift the entry into state: the plate view owns its
   * own working copy, and re-seeding it from above on every slider move would
   * throw away the accumulation (and any decoded audio) mid-edit.
   */
  const sync = useCallback((next: PlateEntry) => {
    history.replaceState(null, '', `?${encodeEntry(next).toString()}`);
  }, []);

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Input/Output</h1>
      </header>

      {entry ? (
        <PlateView
          key={`${entry.system}-${entry.seed}-${entry.driver}`}
          entry={entry}
          onEntryChange={sync}
          onClose={close}
        />
      ) : (
        <Catalogue onOpen={open} />
      )}
    </div>
  );
}
