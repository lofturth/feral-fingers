import { useEffect, useRef } from 'react';
import type { DiagnosticEvent } from '../eventLog';

type Entry = DiagnosticEvent & { sequence: number };
export function EventLog({ entries, clear }: { entries: readonly Entry[]; clear: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrollToLatest = () => { if (panel.current) panel.current.scrollTop = panel.current.scrollHeight; };
  useEffect(scrollToLatest, [entries]);
  return <details className="trainer-event-log" onToggle={event => { if (event.currentTarget.open) scrollToLatest(); }}>
    <summary>Event Log</summary>
    <button type="button" onClick={clear}>Clear Log</button>
    <div className="trainer-event-log__entries" ref={panel} tabIndex={0} aria-label="Piano Trainer event log">
      {entries.length ? <ol>{entries.map(entry => <li key={entry.sequence}>
        <time>{entry.timestamp.toFixed(1)} ms</time> · <strong>{entry.type}</strong>{entry.attemptId !== undefined ? ` · Attempt ${entry.attemptId}` : ''} · {entry.detail}
      </li>)}</ol> : <p>No events yet.</p>}
    </div>
    <p className="trainer-event-log__hint">Timestamps use the browser performance clock.</p>
  </details>;
}
