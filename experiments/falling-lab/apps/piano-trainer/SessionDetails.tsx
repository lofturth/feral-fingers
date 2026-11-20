import { useEffect, useState } from 'react';
import type { SavedDeck } from './deckStorage';
import { getPracticeEvents, type SessionSummary } from './practiceStorage';
import type { SessionEvent } from './sessionRecorder';
import { findRevision, summarizeSession } from './sessionDetails';

export function SessionDetails({ session, decks, onBack }: { session: SessionSummary; decks: SavedDeck[]; onBack: () => void }) {
  const [events, setEvents] = useState<SessionEvent[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getPracticeEvents(session.sessionId).then(result => { if (active) setEvents(result); }).catch(() => { if (active) setError('Could not load session events.'); });
    return () => { active = false; };
  }, [session.sessionId]);
  const deck = session.deck as { title?: string; exercises?: { id: string; label: string }[] } | null;
  const revision = findRevision(session.deck, decks);
  const summary = events && summarizeSession(events);
  const seconds = session.durationMs === null ? null : Math.floor(session.durationMs / 1000);
  return <section className="session-details" aria-labelledby="session-details-title">
    <div className="my-decks-heading"><div><h2 id="session-details-title">Practice session</h2><p>{deck?.title || 'Deck name unavailable'}</p></div><button type="button" onClick={onBack}>Back to My Decks</button></div>
    <dl className="session-details-meta">
      <div><dt>Date</dt><dd><time dateTime={session.startTime}>{new Date(session.startTime).toLocaleString()}</time></dd></div>
      <div><dt>Duration</dt><dd>{seconds === null ? 'Unavailable' : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s recorded`}</dd></div>
      <div><dt>Deck revision</dt><dd>{revision ? revision.createdAt ? `Revision ${revision.number} · saved ${new Date(revision.createdAt).toLocaleDateString()}` : 'Built-in'  : 'Unavailable'}</dd></div>
    </dl>
    <p className="my-decks-note">Duration is measured through the last recorded event.</p>
    {error && <p role="status">{error}</p>}
    {!events && !error && <p role="status">Loading session…</p>}
    {summary && <><div className="session-details-totals"><span>Attempts <b>{summary.attempts}</b></span><span>Successes <b>{summary.successes}</b></span><span>Skips <b>{summary.skips}</b></span></div>
      <p className="my-decks-note">Successes include completed attempts scored 50% or 100%.</p>
      <h3>Cards practiced</h3>
      {summary.cards.length ? <div className="session-details-cards">{summary.cards.map(card => <div key={card.id} className="session-details-card"><strong>{deck?.exercises?.find(exercise => exercise.id === card.id)?.label || card.id}</strong><span>{card.attempts} {card.attempts === 1 ? 'attempt' : 'attempts'}</span><span>{card.results.length ? card.results.join(' · ') : 'No recorded result'}</span></div>)}</div> : <p>No card attempts recorded.</p>}
    </>}
  </section>;
}
