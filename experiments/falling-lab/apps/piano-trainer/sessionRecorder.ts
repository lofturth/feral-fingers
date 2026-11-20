import { createPracticeStorage } from './practiceStorage';

export type SessionEvent =
  | { type: 'midi'; time: number; data: number[]; device: { id: string; name: string } }
  | { type: 'selection'; time: number; previous: string | null; next: string | null; cause: string }
  | { type: 'attempt-start'; time: number; exerciseId: string; attemptId: number }
  | { type: 'attempt-end'; time: number; exerciseId: string; attemptId: number; reason: 'completed' | 'skipped' | 'interrupted' }
  | { type: 'result'; time: number; exerciseId: string; attemptId: number; score: number }
  | { type: 'reward'; time: number; exerciseId: string; attemptId: number; magnitude: number; applied: boolean }
  | { type: 'skip'; time: number; exerciseId: string; attemptId: number; applied: boolean };

type EventInput = SessionEvent extends infer E ? E extends SessionEvent ? Omit<E, 'time'> & { timestamp: number } : never : never;

export function createSessionRecorder(deck: unknown) {
  const storage = createPracticeStorage();
  let record: { schemaVersion: 1; sessionId: string; startTime: string; deck: unknown; settings: unknown; events: SessionEvent[] } | null = null;
  let startTick = 0, finished = false;
  return {
    start(timestamp: number, settings: unknown) {
      if (record || finished) return false;
      startTick = timestamp;
      record = { schemaVersion: 1, sessionId: crypto.randomUUID(), startTime: new Date(Date.now() - Math.max(0, performance.now() - timestamp)).toISOString(), deck: structuredClone(deck), settings: structuredClone(settings), events: [] };
      storage.start({ schemaVersion: record.schemaVersion, sessionId: record.sessionId, startTime: record.startTime, deck: record.deck, settings: record.settings, status: 'interrupted' });
      return true;
    },
    finish(status: 'completed' | 'interrupted') {
      if (!finished) {
        finished = true;
        if (record && status === 'completed') storage.complete({ schemaVersion: 1, sessionId: record.sessionId, startTime: record.startTime, deck: record.deck, settings: record.settings, status: 'interrupted' });
      }
      return storage.flush();
    },
    record(event: EventInput) {
      if (!record || finished) return;
      const { timestamp, ...data } = event;
      const item = { ...data, time: timestamp - startTick } as SessionEvent;
      record.events.push(item);
      storage.event(record.sessionId, record.events.length - 1, item);
    },
    getRecord() { return record && structuredClone(record); }
  };
}
export type SessionRecorder = ReturnType<typeof createSessionRecorder>;
