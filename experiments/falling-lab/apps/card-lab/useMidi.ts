import { useEffect, useRef, useState } from 'react';
import type { AttemptMidiEvent } from './attemptRecording';

type MidiEvent = { id: number; type: 'Note on' | 'Note off'; note: string; velocity: number; channel: number };
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (pitch: number) => `${noteNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export function useMidi(onNoteOn: (note: string) => void, onMidiEvent: (event: AttemptMidiEvent) => void) {
  const onMidiEventRef = useRef(onMidiEvent);
  onMidiEventRef.current = onMidiEvent;
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
  const connecting = useRef(false);
  const reconnectId = useRef('');

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
      const channel = (statusByte & 0x0f) + 1;
      onMidiEventRef.current({ type: on ? 'note-on' : 'note-off', pitch, velocity, channel, timestamp: event.timeStamp });
      if (on) onNoteOnRef.current(noteName(pitch));
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
    if (connecting.current || accessRef.current) return;
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI is not supported in this browser');
      return;
    }
    connecting.current = true;
    setStatus('Requesting MIDI access…');
    try {
      const access = await navigator.requestMIDIAccess();
      if (!mounted.current) return;
      accessRef.current = access;
      const refresh = () => {
        const inputs = [...access.inputs.values()].filter(input => input.state === 'connected');
        setDevices(inputs);
        const current = inputRef.current;
        const returning = inputs.find(input => input.id === reconnectId.current);
        if (returning) {
          reconnectId.current = '';
          selectInput(returning.id, inputs);
          return;
        }
        if (current && inputs.some(input => input.id === current.id)) return;
        if (current) {
          reconnectId.current = current.id;
          current.onmidimessage = null;
          inputRef.current = null;
          clearHeld();
          setSelectedId('');
        }
        const preferred = inputs.find(input => /minilab\s*37/i.test(input.name || '')) || inputs[0];
        if (preferred) selectInput(preferred.id, inputs);
        else setStatus(current ? `${current.name || 'MIDI input'} disconnected` : 'No MIDI input connected');
      };
      access.onstatechange = refresh;
      refresh();
    } catch (error) {
      if (mounted.current) setStatus(`MIDI access failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connecting.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    void connect();
    return () => {
      mounted.current = false;
      if (inputRef.current) inputRef.current.onmidimessage = null;
      if (accessRef.current) accessRef.current.onstatechange = null;
    };
  }, []);

  return { devices, selectedId, status, heldNotes, events, connect, selectInput: (id: string) => { reconnectId.current = ''; selectInput(id); } };
}
