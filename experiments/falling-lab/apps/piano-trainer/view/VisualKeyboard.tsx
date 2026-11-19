import { noteName } from '../midi/useMidi';
import { colorForPitch } from '../cards/noteColors';

export function VisualKeyboard({ heldNotes }: { heldNotes: string[] }) {
  const notes = Array.from({ length: 37 }, (_, index) => index + 48);
  let whites = 0;
  return <div className="visual-keyboard" aria-label="MIDI keyboard C3 to C6">
    {notes.map(pitch => {
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      const left = black ? (whites - .32) / 22 * 100 : whites++ / 22 * 100;
      const name = noteName(pitch), held = heldNotes.includes(name);
      return <div key={pitch} className={`visual-key ${black ? 'black' : 'white'}${held ? ' held' : ''}`} aria-label={`${name}${held ? ' pressed' : ''}`} style={{ left: `${left}%`, width: `${(black ? .64 : 1) / 22 * 100}%`, backgroundColor: held ? colorForPitch(pitch) : undefined }}><span>{name}</span></div>;
    })}
  </div>;
}
