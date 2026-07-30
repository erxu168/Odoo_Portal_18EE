'use client';

/**
 * Hear about records changing elsewhere in the app, and keep a list correct
 * without re-fetching or re-mounting.
 *
 * The re-mount is what loses the scroll position, so "just reload the list" is
 * not a fix for the stale-delete bug — it trades one complaint for the other.
 * These hooks patch the array in place.
 */
import { useEffect, useRef } from 'react';
import { onRecordChange, removedIds, type RecordChange, type RecordKind } from './record-events';

/**
 * Run a handler whenever a record of `kind` changes anywhere.
 *
 * The handler is held in a ref, so an inline arrow function does not resubscribe
 * on every render — subscribing in an effect with the callback in its dependency
 * list is the classic way this becomes a subscribe/unsubscribe loop.
 */
export function useRecordChanges(kind: RecordKind, handler: (change: RecordChange) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onRecordChange(kind, (c) => ref.current(c)), [kind]);
}

/**
 * The common case: keep a list of records in step with what happens to them
 * elsewhere. Deletions and archivings drop out, updates get patched.
 *
 *   const [locations, setLocations] = useState<CountLocation[]>([]);
 *   useRecordList('location', setLocations, (l) => l.id);
 *
 * That is the whole fix for "the deleted location is still there".
 */
export function useRecordList<T>(
  kind: RecordKind,
  setList: (updater: (prev: T[]) => T[]) => void,
  getId: (row: T) => number,
  opts?: {
    /** Treat an archive as a removal from THIS list. Default true — most lists
     *  show live records only. A list that shows archived rows passes false. */
    dropArchived?: boolean;
  },
): void {
  const dropArchived = opts?.dropArchived !== false;
  useRecordChanges(kind, (change) => {
    if (change.verb === 'deleted' || (dropArchived && change.verb === 'archived')) {
      const gone = new Set(removedIds(change));
      setList((prev) => prev.filter((row) => !gone.has(getId(row))));
      return;
    }
    if (change.verb === 'updated' && change.patch) {
      setList((prev) => prev.map((row) => (getId(row) === change.id ? { ...row, ...change.patch } : row)));
    }
    // 'created' and 'restored' are deliberately NOT handled here. A new record
    // may not belong in this list at all — wrong company, filtered out, or the
    // list is sorted and the position matters — so the screen that wants it
    // decides, via useRecordChanges directly.
  });
}
