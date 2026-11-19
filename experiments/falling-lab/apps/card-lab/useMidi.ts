import { useEffect, useRef, useState } from 'react';

type MidiEvent = { id: number; type: 'Note on' | 'Note off'; note: string; velocity: number; channel: number };
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (pitch: number) => `${noteNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export function useMidi(onNoteOn: (note: string) => void) {
  const onNoteOnRef = useRef(onNoteOn);
  onNoteOnRef.current = onNoteOn;
  const [devices, setDevices] = useState<MIDIInput[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('MIDI not connected');
  const [heldNotes, setHeldNotes] = useState<string[]>([]);
  const [events, setEvents] = useState<MidiEvent[]>([]);
  const accessRef = useRef<MIDIAccess | null>(null);
  const inputRef = useRef<MIDIInput | null>(null);
  const heldRef = useRef(new Map<string, number>());
  const eventId = useRef(0);
  const mounted = useRef(true);

  function clearHeld() {
    heldRef.current.clear();
    setHeldNotes([]);
  }

  function selectInput(id: string, inputs = devices) {
    if (inputRef.current) inputRef.current.onmidimessage = null;
    inputRef.current = null;
    clearHeld();
    setSelectedId(id);
    const input = inputs.find(device => device.id === id && device.state === 'connected');
    if (!input) {
      setStatus('No MIDI input connected');
      return;
    }
    inputRef.current = input;
    input.onmidimessage = event => {
      if (!event.data || event.data.length < 3) return;
      const [statusByte, pitch, velocity] = event.data;
      const command = statusByte & 0xf0;
      const on = command === 0x90 && velocity > 0;
      if (!on && command !== 0x80 && !(command === 0x90 && velocity === 0)) return;
      if (on) onNoteOnRef.current(noteName(pitch));
      const channel = (statusByte & 0x0f) + 1;
      const key = `${channel}:${pitch}`;
      if (on) heldRef.current.set(key, pitch);
      else heldRef.current.delete(key);
      setHeldNotes([...new Set([...heldRef.current.values()].map(noteName))]);
      const midiEvent: MidiEvent = { id: ++eventId.current, type: on ? 'Note on' : 'Note off', note: noteName(pitch), velocity, channel };
      setEvents(previous => [midiEvent, ...previous].slice(0, 20));
    };
    setStatus(`Connected: ${input.name || 'MIDI input'}`);
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI is not supported in this browser');
      return;
    }
    setStatus('Requesting MIDI access…');
    try {
      const access = await navigator.requestMIDIAccess();
      if (!mounted.current) return;
      accessRef.current = access;
      const refresh = () => {
        const inputs = [...access.inputs.values()].filter(input => input.state === 'connected');
        setDevices(inputs);
        const current = inputRef.current;
        if (current && inputs.some(input => input.id === current.id)) return;
        if (current) {
          current.onmidimessage = null;
          inputRef.current = null;
          clearHeld();
          setSelectedId('');
          setStatus(`${current.name || 'MIDI input'} disconnected`);
          return;
        }
        const preferred = inputs.find(input => /minilab\s*37/i.test(input.name || '')) || inputs[0];
        if (preferred) selectInput(preferred.id, inputs);
        else setStatus('No MIDI input connected');
      };
      access.onstatechange = refresh;
      refresh();
    } catch (error) {
      if (mounted.current) setStatus(`MIDI access failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  useEffect(() => () => {
    mounted.current = false;
    if (inputRef.current) inputRef.current.onmidimessage = null;
    if (accessRef.current) accessRef.current.onstatechange = null;
  }, []);

  return { devices, selectedId, status, heldNotes, events, connect, selectInput };
}
