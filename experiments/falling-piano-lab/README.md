# Falling Piano Lab

Standalone browser experiment for MIDI piano practice. Run `./run.sh` and open
http://127.0.0.1:4177/ in a Web MIDI-capable browser. The local server sends
`Cache-Control: no-store`; refresh manually after file changes.

Select a phrase section (A–D), Shift-click to extend a range, or choose All.
Press Start / Restart at A to hear the first phrase. Play the phrase on a MIDI
keyboard to enter the repeat stage, then play it correctly from the first note.
The next section begins automatically. Play or MIDI C3 replays the current
phrase; MIDI C♯3/D3 selects the previous/next section. This is the continuous
hear–play–repeat behavior copied from Robot Piano; its pitch recognition has
not been redesigned.

MIDI input selection, browser audio, keyboard display, and tonic/scale display
settings remain. Session recording is still stored in this browser's IndexedDB
under the exact origin http://127.0.0.1:4177/. An active session survives a
refresh until End Session is pressed. Session and all-recording JSON exports
remain available. Local recordings at Robot Piano's port 4174 are separate.

The built-in composition in `a-little-jazzy-walk.mjs` supplies the phrase note
sequences. `scoring.mjs` retains the existing note-sequence generator and scoring
helpers for later phrase work. Importing, selecting, editing, and exporting
melody libraries are no longer part of this lab.

The separate fixed-phrase presentation shows and/or plays C4 D4 E4 when Start
is pressed. Letters, treble-staff notation, audio, and metronome are independent
switches, all enabled initially. The notes sound once at 80 BPM; the metronome
continues at that tempo until Stop. They do not change the existing MIDI
practice loop or session recording.

The live piano roll under the fixed phrase records MIDI Note On/Off events
between Start and Stop. It shows note duration over a scrolling eight-second
window, with a fixed C3–C5 pitch range. The roll is a visual record only; it
does not score notes or affect practice.
