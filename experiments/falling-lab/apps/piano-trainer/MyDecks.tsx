import { useEffect, useState } from 'react';
import { listDecks, type SavedDeck } from './deckStorage';
import { deletePracticeSession, listPracticeSessions, type SessionSummary } from './practiceStorage';
import { groupDecks } from './myDecks';
import { SessionDetails } from './SessionDetails.tsx';

function duration(ms: number | null) {
  if (ms === null) return 'Duration unavailable';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function MyDecks({ onBack, onPractice }: { onBack: () => void; onPractice: (deck: SavedDeck) => void }) {
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sort, setSort] = useState<'created' | 'practiced'>('created');
  const [status, setStatus] = useState('Loading decks…');
  useEffect(() => {
    let active = true;
    void Promise.all([listDecks(), listPracticeSessions()]).then(([saved, history]) => {
      if (active) { setDecks(saved); setSessions(history); setStatus(''); }
    }).catch(() => { if (active) setStatus('Could not load your saved decks and sessions.'); });
    return () => { active = false; };
  }, []);
  async function deleteSession(session: SessionSummary) {
    if (!window.confirm('Delete this practice session and its recorded events?')) return;
    try { await deletePracticeSession(session.sessionId); setSessions(current => current.filter(item => item.sessionId !== session.sessionId)); }
    catch { setStatus('Could not delete the session. Please try again.'); }
  }
  const rows = groupDecks(decks, sessions, sort);
  if (selectedSession) return <SessionDetails session={selectedSession} decks={decks} onBack={() => setSelectedSession(null)}/>;
  return <section className="my-decks" aria-labelledby="my-decks-title">
    <div className="my-decks-heading"><div><h2 id="my-decks-title">My Decks</h2><p>Saved decks and practice sessions</p></div><button type="button" onClick={onBack}>Back to practice</button></div>
    <label className="my-decks-sort">Sort by <select value={sort} onChange={event => setSort(event.target.value as 'created' | 'practiced')}><option value="created">Date created</option><option value="practiced">Last practiced</option></select></label>
    {status && <p role="status">{status}</p>}
    {!status && !rows.length && <p>No saved decks yet. Import a deck to add it here.</p>}
    <div className="my-decks-list">{rows.map(row => <article className="my-decks-row" key={row.deck.deckId}>
      <div className="my-decks-info"><h3>{row.deck.title}</h3><span>{(row.deck.content as { exercises?: unknown[] }).exercises?.length ?? 0} cards</span><button type="button" onClick={() => onPractice(row.deck)}>Practice</button></div>
      <div className="my-decks-sessions" aria-label={`Practice sessions for ${row.deck.title}`}>{row.sessions.length ? row.sessions.map(session => <div className="my-decks-session-wrap" key={session.sessionId}><button type="button" className="my-decks-session" onClick={() => setSelectedSession(session)}><time dateTime={session.startTime}>{new Date(session.startTime).toLocaleString()}</time><span>{duration(session.durationMs)}{session.durationMs !== null && ' recorded'}</span></button><button type="button" className="my-decks-delete" aria-label={`Delete session ${new Date(session.startTime).toLocaleString()}`} onClick={() => void deleteSession(session)}>×</button></div>) : <span className="my-decks-empty">No practice sessions yet</span>}</div>
    </article>)}</div>
    <p className="my-decks-note">Duration is measured through the last recorded event.</p>
  </section>;
}
