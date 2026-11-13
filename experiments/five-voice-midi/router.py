#!/usr/bin/env python3
"""Five-voice MIDI router fed by the existing dashboard, never the serial port."""
import argparse
import ast
import json
import math
import re
import random
import signal
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import rtmidi

ROOT=Path(__file__).resolve().parent
source=ROOT.parent/'bmi323-gravity/server.py'
tree=ast.parse(source.read_text())
estimator_class=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='GravityEstimator')
scope={'math':math}
exec(compile(ast.Module(body=[estimator_class],type_ignores=[]),str(source),'exec'),scope)
GravityEstimator=scope['GravityEstimator']
# Logical sensor IDs correspond to mux channels 3–7.
SENSOR_IDS=(0,1,2,3,4)  # Left thumb through pinky: mux channels 3–7
PRESETS={
    'C major': [
        ['C3', 'E3', 'C4', 'E4', 'G4'],
        ['C2', 'G2', 'C3', 'E3', 'G3'],
        ['C2', 'C3', 'G3', 'E4', 'G4'],
        ['C2', 'G3', 'E4', 'G4', 'C5'],
        ['G3', 'C4', 'E4', 'G4', 'C5'],
        ['C4', 'E4', 'G4', 'C5', 'E5'],
        ['C2', 'C3', 'E3', 'G3', 'C4'],
        ['C3', 'G3', 'C4', 'G4', 'E5'],
        ['C2', 'E3', 'G3', 'C5', 'E5'],
        ['E3', 'C4', 'E4', 'G4', 'C5'],
    ],
    'D minor': [
        ['D3', 'A3', 'D4', 'F4', 'A4'],
        ['D2', 'A2', 'D3', 'F3', 'A3'],
        ['D2', 'D3', 'A3', 'F4', 'A4'],
        ['D2', 'A3', 'F4', 'A4', 'D5'],
        ['A3', 'D4', 'F4', 'A4', 'D5'],
        ['D4', 'F4', 'A4', 'D5', 'F5'],
        ['D2', 'D3', 'F3', 'A3', 'D4'],
        ['D3', 'A3', 'D4', 'A4', 'F5'],
        ['D2', 'F3', 'A3', 'D5', 'F5'],
        ['D3', 'F3', 'A3', 'D4', 'F4'],
    ],
    'Fmaj9': [
        ['F3', 'A3', 'E4', 'G4', 'C5'],
        ['F2', 'A2', 'E3', 'G3', 'C4'],
        ['F2', 'E3', 'A3', 'G4', 'C5'],
        ['F2', 'A3', 'G4', 'C5', 'E5'],
        ['A3', 'E4', 'G4', 'C5', 'F5'],
        ['E4', 'G4', 'C5', 'F5', 'A5'],
        ['F2', 'E3', 'A3', 'C4', 'G4'],
        ['E3', 'A3', 'F4', 'C5', 'G5'],
        ['F2', 'G3', 'C4', 'E5', 'A5'],
        ['G3', 'E4', 'A4', 'C5', 'F5'],
    ],
    'G major': [
        ['G3', 'B3', 'G4', 'B4', 'D5'],
        ['G2', 'D3', 'G3', 'B3', 'D4'],
        ['G2', 'G3', 'D4', 'B4', 'D5'],
        ['G2', 'D4', 'B4', 'D5', 'G5'],
        ['D4', 'G4', 'B4', 'D5', 'G5'],
        ['G4', 'B4', 'D5', 'G5', 'B5'],
        ['G2', 'G3', 'B3', 'D4', 'G4'],
        ['G3', 'D4', 'G4', 'D5', 'B5'],
        ['G2', 'B3', 'D4', 'G5', 'B5'],
        ['B3', 'G4', 'B4', 'D5', 'G5'],
    ],
    'A minor': [
        ['A2', 'C3', 'A3', 'C4', 'E4'],
        ['C2', 'E2', 'A2', 'C3', 'E3'],
        ['C2', 'A2', 'E3', 'C4', 'E4'],
        ['C2', 'E3', 'C4', 'E4', 'A4'],
        ['E3', 'A3', 'C4', 'E4', 'A4'],
        ['A3', 'C4', 'E4', 'A4', 'C5'],
        ['C2', 'A2', 'C3', 'E3', 'A3'],
        ['A2', 'E3', 'A3', 'E4', 'C5'],
        ['C2', 'C3', 'E3', 'A4', 'C5'],
        ['C3', 'A3', 'C4', 'E4', 'A4'],
    ],
    'E minor': [
        ['E3', 'G3', 'E4', 'G4', 'B4'],
        ['E2', 'B2', 'E3', 'G3', 'B3'],
        ['E2', 'E3', 'B3', 'G4', 'B4'],
        ['E2', 'B3', 'G4', 'B4', 'E5'],
        ['B3', 'E4', 'G4', 'B4', 'E5'],
        ['E4', 'G4', 'B4', 'E5', 'G5'],
        ['E2', 'E3', 'G3', 'B3', 'E4'],
        ['E3', 'B3', 'E4', 'B4', 'G5'],
        ['E2', 'G3', 'B3', 'E5', 'G5'],
        ['G3', 'E4', 'G4', 'B4', 'E5'],
    ],
    'B♭ major': [
        ['Bb2', 'D3', 'Bb3', 'D4', 'F4'],
        ['D2', 'F2', 'Bb2', 'D3', 'F3'],
        ['D2', 'Bb2', 'F3', 'D4', 'F4'],
        ['D2', 'F3', 'D4', 'F4', 'Bb4'],
        ['F3', 'Bb3', 'D4', 'F4', 'Bb4'],
        ['Bb3', 'D4', 'F4', 'Bb4', 'D5'],
        ['D2', 'Bb2', 'D3', 'F3', 'Bb3'],
        ['Bb2', 'F3', 'Bb3', 'F4', 'D5'],
        ['D2', 'D3', 'F3', 'Bb4', 'D5'],
        ['D3', 'Bb3', 'D4', 'F4', 'Bb4'],
    ],
    'E♭ major': [
        ['Eb3', 'G3', 'Eb4', 'G4', 'Bb4'],
        ['Eb2', 'Bb2', 'Eb3', 'G3', 'Bb3'],
        ['Eb2', 'Eb3', 'Bb3', 'G4', 'Bb4'],
        ['Eb2', 'Bb3', 'G4', 'Bb4', 'Eb5'],
        ['Bb3', 'Eb4', 'G4', 'Bb4', 'Eb5'],
        ['Eb4', 'G4', 'Bb4', 'Eb5', 'G5'],
        ['Eb2', 'Eb3', 'G3', 'Bb3', 'Eb4'],
        ['Eb3', 'Bb3', 'Eb4', 'Bb4', 'G5'],
        ['Eb2', 'G3', 'Bb3', 'Eb5', 'G5'],
        ['G3', 'Eb4', 'G4', 'Bb4', 'Eb5'],
    ],
    'D major': [
        ['D3', 'F#3', 'D4', 'F#4', 'A4'],
        ['D2', 'A2', 'D3', 'F#3', 'A3'],
        ['D2', 'D3', 'A3', 'F#4', 'A4'],
        ['D2', 'A3', 'F#4', 'A4', 'D5'],
        ['A3', 'D4', 'F#4', 'A4', 'D5'],
        ['D4', 'F#4', 'A4', 'D5', 'F#5'],
        ['D2', 'D3', 'F#3', 'A3', 'D4'],
        ['D3', 'A3', 'D4', 'A4', 'F#5'],
        ['D2', 'F#3', 'A3', 'D5', 'F#5'],
        ['F#3', 'D4', 'F#4', 'A4', 'D5'],
    ],
    'F minor': [
        ['F3', 'Ab3', 'F4', 'Ab4', 'C5'],
        ['F2', 'C3', 'F3', 'Ab3', 'C4'],
        ['F2', 'F3', 'C4', 'Ab4', 'C5'],
        ['F2', 'C4', 'Ab4', 'C5', 'F5'],
        ['C4', 'F4', 'Ab4', 'C5', 'F5'],
        ['F4', 'Ab4', 'C5', 'F5', 'Ab5'],
        ['F2', 'F3', 'Ab3', 'C4', 'F4'],
        ['F3', 'C4', 'F4', 'C5', 'Ab5'],
        ['F2', 'Ab3', 'C4', 'F5', 'Ab5'],
        ['Ab3', 'F4', 'Ab4', 'C5', 'F5'],
    ],
    'Cmaj9': [
        ['C3', 'E3', 'B3', 'D4', 'G4'],
        ['C2', 'E2', 'B2', 'D3', 'G3'],
        ['C2', 'B2', 'E3', 'D4', 'G4'],
        ['C2', 'E3', 'D4', 'G4', 'B4'],
        ['E3', 'B3', 'D4', 'G4', 'C5'],
        ['B3', 'D4', 'G4', 'C5', 'E5'],
        ['C2', 'B2', 'E3', 'G3', 'D4'],
        ['B2', 'E3', 'C4', 'G4', 'D5'],
        ['C2', 'D3', 'G3', 'B4', 'E5'],
        ['D3', 'B3', 'E4', 'G4', 'C5'],
    ],
    'Dm9': [
        ['D3', 'F3', 'C4', 'E4', 'A4'],
        ['D2', 'F2', 'C3', 'E3', 'A3'],
        ['D2', 'E3', 'A3', 'F4', 'C5'],
        ['D2', 'A3', 'F4', 'C5', 'E5'],
        ['A3', 'D4', 'F4', 'C5', 'E5'],
        ['C4', 'E4', 'A4', 'D5', 'F5'],
        ['D2', 'C3', 'F3', 'A3', 'E4'],
        ['D3', 'A3', 'E4', 'C5', 'F5'],
        ['D2', 'E3', 'A3', 'C5', 'F5'],
        ['F3', 'C4', 'E4', 'A4', 'D5'],
    ],
    'G7': [
        ['G3', 'B3', 'F4', 'B4', 'D5'],
        ['G2', 'D3', 'F3', 'B3', 'D4'],
        ['G2', 'F3', 'D4', 'B4', 'D5'],
        ['G2', 'D4', 'B4', 'D5', 'F5'],
        ['D4', 'F4', 'B4', 'D5', 'G5'],
        ['F4', 'B4', 'D5', 'G5', 'B5'],
        ['G2', 'F3', 'B3', 'D4', 'G4'],
        ['F3', 'D4', 'G4', 'D5', 'B5'],
        ['G2', 'B3', 'D4', 'F5', 'B5'],
        ['B3', 'F4', 'B4', 'D5', 'G5'],
    ],
    'A7': [
        ['A2', 'C#3', 'G3', 'C#4', 'E4'],
        ['C#2', 'E2', 'A2', 'C#3', 'G3'],
        ['C#2', 'A2', 'E3', 'C#4', 'G4'],
        ['C#2', 'G3', 'C#4', 'E4', 'A4'],
        ['E3', 'G3', 'C#4', 'E4', 'A4'],
        ['G3', 'C#4', 'E4', 'A4', 'C#5'],
        ['C#2', 'G2', 'A2', 'E3', 'A3'],
        ['G2', 'E3', 'A3', 'E4', 'C#5'],
        ['C#2', 'A2', 'E3', 'G4', 'C#5'],
        ['C#3', 'G3', 'C#4', 'E4', 'A4'],
    ],
    'Csus4': [
        ['C3', 'F3', 'G3', 'C4', 'F4'],
        ['C2', 'G2', 'C3', 'F3', 'G3'],
        ['C2', 'C3', 'F3', 'C4', 'G4'],
        ['C2', 'F3', 'C4', 'G4', 'C5'],
        ['G3', 'C4', 'F4', 'G4', 'C5'],
        ['C4', 'F4', 'G4', 'C5', 'F5'],
        ['C2', 'C3', 'F3', 'G3', 'C4'],
        ['C3', 'G3', 'C4', 'G4', 'F5'],
        ['C2', 'C3', 'G3', 'C5', 'F5'],
        ['F3', 'G3', 'C4', 'F4', 'C5'],
    ],
    'Dsus4': [
        ['D3', 'G3', 'A3', 'D4', 'G4'],
        ['D2', 'A2', 'D3', 'G3', 'A3'],
        ['D2', 'D3', 'G3', 'D4', 'A4'],
        ['D2', 'G3', 'D4', 'A4', 'D5'],
        ['A3', 'D4', 'G4', 'A4', 'D5'],
        ['D4', 'G4', 'A4', 'D5', 'G5'],
        ['D2', 'D3', 'G3', 'A3', 'D4'],
        ['D3', 'A3', 'D4', 'A4', 'G5'],
        ['D2', 'D3', 'A3', 'D5', 'G5'],
        ['G3', 'A3', 'D4', 'G4', 'D5'],
    ],
    'B minor': [
        ['B2', 'D3', 'B3', 'D4', 'F#4'],
        ['D2', 'F#2', 'B2', 'D3', 'F#3'],
        ['D2', 'B2', 'F#3', 'D4', 'F#4'],
        ['D2', 'F#3', 'D4', 'F#4', 'B4'],
        ['F#3', 'B3', 'D4', 'F#4', 'B4'],
        ['B3', 'D4', 'F#4', 'B4', 'D5'],
        ['D2', 'B2', 'D3', 'F#3', 'B3'],
        ['B2', 'F#3', 'B3', 'F#4', 'D5'],
        ['D2', 'D3', 'F#3', 'B4', 'D5'],
        ['D3', 'B3', 'D4', 'F#4', 'B4'],
    ],
    'E major': [
        ['E3', 'Ab3', 'E4', 'Ab4', 'B4'],
        ['E2', 'B2', 'E3', 'Ab3', 'B3'],
        ['E2', 'E3', 'B3', 'Ab4', 'B4'],
        ['E2', 'B3', 'Ab4', 'B4', 'E5'],
        ['B3', 'E4', 'Ab4', 'B4', 'E5'],
        ['E4', 'Ab4', 'B4', 'E5', 'Ab5'],
        ['E2', 'E3', 'Ab3', 'B3', 'E4'],
        ['E3', 'B3', 'E4', 'B4', 'Ab5'],
        ['E2', 'Ab3', 'B3', 'E5', 'Ab5'],
        ['Ab3', 'E4', 'Ab4', 'B4', 'E5'],
    ],
    'A♭ major': [
        ['Ab2', 'C3', 'Ab3', 'C4', 'Eb4'],
        ['C2', 'Eb2', 'Ab2', 'C3', 'Eb3'],
        ['C2', 'Ab2', 'Eb3', 'C4', 'Eb4'],
        ['Ab2', 'Eb3', 'C4', 'Eb4', 'Ab4'],
        ['Eb3', 'Ab3', 'C4', 'Eb4', 'Ab4'],
        ['Ab3', 'C4', 'Eb4', 'Ab4', 'C5'],
        ['C2', 'Ab2', 'C3', 'Eb3', 'Ab3'],
        ['Ab2', 'Eb3', 'Ab3', 'Eb4', 'C5'],
        ['Ab2', 'C3', 'Eb3', 'Ab4', 'C5'],
        ['C3', 'Ab3', 'C4', 'Eb4', 'Ab4'],
    ],
    'Fmaj7': [
        ['F3', 'A3', 'E4', 'A4', 'C5'],
        ['F2', 'C3', 'E3', 'A3', 'C4'],
        ['F2', 'E3', 'C4', 'A4', 'C5'],
        ['F2', 'C4', 'A4', 'C5', 'E5'],
        ['C4', 'E4', 'A4', 'C5', 'F5'],
        ['E4', 'A4', 'C5', 'F5', 'A5'],
        ['F2', 'E3', 'A3', 'C4', 'F4'],
        ['E3', 'C4', 'F4', 'C5', 'A5'],
        ['F2', 'A3', 'C4', 'E5', 'A5'],
        ['A3', 'E4', 'A4', 'C5', 'F5'],
    ],
}

def parse_notes(text):
    parts=text.split()
    if len(parts)!=5:raise ValueError('Enter exactly five note names, such as C3 G3 E4 B4 D5.')
    offsets={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
    notes=[]
    for part in parts:
        match=re.fullmatch(r'([A-Ga-g])([#b♯♭]?)(-?\d+)',part)
        if not match:raise ValueError(f'Invalid note: {part}. Use names such as C3, F#4 or Bb2.')
        name,accidental,octave=match.groups()
        note=(int(octave)+1)*12+offsets[name.upper()]+(1 if accidental in ('#','♯') else -1 if accidental in ('b','♭') else 0)
        if not 0<=note<=127:raise ValueError(f'Note out of MIDI range: {part}.')
        notes.append(note)
    if len(set(notes))!=5:raise ValueError('Notes must be distinct (including enharmonic equivalents).')
    return sorted(notes)

OPEN_SKIES=[
    ('Dm','D2 A2 D3 F4 A4'), ('Bb','Bb2 F3 Bb3 D4 F4'),
    ('F','F2 C3 F3 A3 C4'), ('C','C3 G3 C4 E4 G4'),
    ('Gm','G2 D3 G3 Bb3 D4'), ('Dm','D3 A3 D4 F4 A4'),
    ('Bb','Bb2 F3 D4 F4 Bb4'), ('A7','A2 E3 G3 C#4 E4'),
]

LONGING=[
    ('Dm','D2 A2 D3 F3 A4'), ('Bb','Bb2 F3 Bb3 D4 Bb4'),
    ('F','F2 C3 A3 C4 C5'), ('C','C3 G3 C4 E4 G4'),
    ('Gm(add9)','G2 D3 G3 Bb3 A4'), ('Dm','D2 A2 D3 F4 F5'),
    ('Bb','Bb2 F3 Bb3 D4 D5'), ('A7','A2 E3 G3 C#4 E5'),
]
AFTERGLOW=[
    ('Am','A2 E3 A3 C4 E4'), ('Fmaj9','F2 C3 A3 E4 G4'),
    ('Cmaj9','C3 G3 B3 D4 E4'), ('G','G2 D3 G3 B3 D4'),
    ('Dm9','D2 A2 F3 C4 E4'), ('E7','E2 B2 D3 G#3 E4'),
]
GOLDEN_LIGHT=[
    ('Am9','A2 E3 G3 B3 C4'), ('Fmaj7','F2 C3 A3 C4 E4'),
    ('Cmaj9','C3 G3 B3 D4 E4'), ('G6','G2 D3 G3 B3 E4'),
    ('Dm9','D2 A2 F3 C4 E4'), ('Fmaj7','F2 C3 A3 C4 E4'),
    ('Cmaj9','C3 G3 B3 D4 E4'), ('G6','G2 D3 G3 B3 E4'),
]
PROGRESSIONS={'Open Skies':OPEN_SKIES,'Longing':LONGING,'Afterglow':AFTERGLOW,'Golden Light':GOLDEN_LIGHT}
LOOPING_PROGRESSIONS={'Afterglow','Golden Light'}
PROGRESSION_DURATIONS={'Afterglow':[8,4,4,4,4,4],'Golden Light':[8,4,8,4,4,4,4,4]}

def progression_durations(name):
    return PROGRESSION_DURATIONS.get(name,[4]*len(PROGRESSIONS[name]))

def progression_index(name,beat):
    elapsed=0
    for i,duration in enumerate(progression_durations(name)):
        elapsed+=duration
        if beat<elapsed:return i
    return len(PROGRESSIONS[name])-1

class Router:
    def __init__(self, output):
        self.output=output
        self.lock=threading.RLock()
        self.held=set()
        self.chord=None
        self.sounding_chord=[]
        self.pending_releases={}
        self.live_melody=False
        self.keyboard_chords=False
        self.keyboard_voices={}
        self.keyboard_capture={}
        self.keyboard_captured=False
        self.keyboard_size=5
        self.keyboard_epoch=0
        self.chord_source=None
        self.selected_preset=None
        self.selected_voicing=None
        self.remaining=set()
        self.cc=[None]*5
        self.gates=[None]*5
        self.last_sensor=[0.0]*5
        self.estimators=[GravityEstimator() for _ in range(5)]
        self.last_timestamp=None
        self.generation=None
        self.keyboard=False
        self.progress_name='Open Skies'
        self.progress_state='stopped'
        self.progress_beat=0.0
        self.progress_tempo=60
        self.progress_anchor=time.monotonic()
    def send(self, msg):
        self.output.send_message(msg)
    def silence(self):
        with self.lock:
            for (channel,note),voice in self.keyboard_voices.items():self.send([0x80+voice,note,0])
            self.keyboard_voices.clear()
            self.keyboard_capture.clear()
            self.keyboard_captured=False
            for timer in self.pending_releases.values():timer.cancel()
            for i,note in self.pending_releases:self.send([0x80+i,note,0])
            self.pending_releases.clear()
            for i,note in enumerate(self.sounding_chord):
                self.send([0x80+i,note,0])
            self.sounding_chord=[]
            self.chord=None
            self.chord_source=None
            self.selected_preset=None
            self.selected_voicing=None
            self.remaining.clear()
            self.held.clear()
    def release_delayed(self, key, timer):
        with self.lock:
            if self.pending_releases.get(key) is not timer:return
            del self.pending_releases[key]
            self.send([0x80+key[0],key[1],0])
    def play(self, notes, preset=None, voicing=None, source='player'):
        with self.lock:
            if source!='progression':
                self.progress_state='stopped'
                self.progress_beat=0.0
            if self.keyboard_voices or self.keyboard_capture:self.silence()
            old=self.sounding_chord
            new=list(notes[:4] if self.live_melody else notes[:])
            self.held.clear()
            self.remaining.clear()
            self.chord=list(notes)
            self.chord_source=source
            self.selected_preset=preset
            self.selected_voicing=voicing
            self.sounding_chord=new
            for i,note in enumerate(new):
                previous=old[i] if i<len(old) else None
                if previous==note:continue
                key=(i,note)
                pending=self.pending_releases.pop(key,None)
                if pending is not None:
                    pending.cancel()
                else:
                    self.send([0xb0+i,1,self.cc[i] if self.cc[i] is not None else 0])
                    self.send([0x90+i,note,100])
                if previous is not None:
                    old_key=(i,previous)
                    timer=threading.Timer(.020,lambda k=old_key:self.release_delayed(k,threading.current_thread()))
                    timer.daemon=True
                    self.pending_releases[old_key]=timer
                    timer.start()
            for i in range(len(new),len(old)):
                self.send([0x80+i,old[i],0])
    def play_preset(self, preset, voicing=1, randomize=False):
        with self.lock:
            if preset not in PRESETS:raise ValueError('Unknown chord preset.')
            if type(randomize) is not bool:raise ValueError('Random voicing must be on or off.')
            if type(voicing) is not int or not 1<=voicing<=10:raise ValueError('Voicing must be between 1 and 10.')
            if randomize:
                options=list(range(1,11))
                if self.selected_preset==preset and self.selected_voicing in options:
                    options.remove(self.selected_voicing)
                voicing=random.choice(options)
            self.play(parse_notes(' '.join(PRESETS[preset][voicing-1])),preset,voicing)
    def stop_all(self):
        with self.lock:
            self.progression_stop()
            self.silence()
    def emergency_stop(self):
        with self.lock:
            self.keyboard_epoch+=1
            self.stop_all()
            for channel in range(5):
                self.send([0xb0+channel,123,0])
                self.send([0xb0+channel,120,0])
    def set_live_melody(self, enabled):
        if type(enabled) is not bool:raise ValueError('Live Melody must be on or off.')
        with self.lock:
            if enabled!=self.live_melody:
                self.keyboard_epoch+=1
                self.stop_all()
                self.live_melody=enabled
    def set_keyboard_chords(self,enabled):
        if type(enabled) is not bool:raise ValueError('Keyboard Chords must be on or off.')
        with self.lock:
            if enabled!=self.keyboard_chords:
                self.keyboard_epoch+=1
                self.stop_all()
                self.keyboard_chords=enabled
    def set_keyboard_size(self,size):
        if type(size) is not int or size not in (3,4,5):raise ValueError('Chord size must be 3, 4, or 5.')
        with self.lock:
            if size!=self.keyboard_size:
                self.keyboard_epoch+=1
                self.stop_all()
                self.keyboard_size=size
    def keyboard_disconnect(self):
        with self.lock:
            self.keyboard_epoch+=1
            if self.chord_source=='keyboard':self.silence()
            else:
                self.held.clear()
                self.keyboard_capture.clear()
                self.keyboard_captured=False
            self.keyboard=False
    def keyboard_message(self, msg):
        epoch=self.keyboard_epoch
        with self.lock:
            if epoch!=self.keyboard_epoch or len(msg)<3:return
            typ=msg[0]&0xf0
            note,velocity=msg[1],msg[2]
            if self.live_melody:return
            if self.chord_source in ('player','progression') or self.progress_state=='paused':return
            if self.keyboard_chords:
                key=(msg[0]&15,note)
                if typ==0x90 and velocity:
                    if key in self.keyboard_capture:return
                    self.keyboard_capture[key]=velocity
                    if not self.keyboard_captured:
                        distinct={}
                        for k,v in self.keyboard_capture.items():distinct.setdefault(k[1],(k,v))
                        if len(distinct)==self.keyboard_size:
                            self.keyboard_captured=True
                            self.chord_source='keyboard'
                            for voice,pitch in enumerate(sorted(distinct)):
                                input_key,vel=distinct[pitch]
                                self.keyboard_voices[input_key]=voice
                                self.send([0xb0+voice,1,self.cc[voice] if self.cc[voice] is not None else 0])
                                self.send([0x90+voice,pitch,vel])
                elif typ==0x80 or (typ==0x90 and velocity==0):
                    self.keyboard_capture.pop(key,None)
                    voice=self.keyboard_voices.pop(key,None)
                    if voice is not None:self.send([0x80+voice,note,0])
                    if not self.keyboard_capture:
                        self.keyboard_captured=False
                        if not self.keyboard_voices:self.chord_source=None
                return
            if typ==0x90 and velocity:
                if self.chord:return
                self.held.add(note)
                if len(self.held)==5:
                    self.chord=sorted(self.held)
                    self.chord_source='keyboard'
                    self.sounding_chord=self.chord[:]
                    self.remaining=set(self.chord)
                    for i,n in enumerate(self.chord):
                        value=self.cc[i] if self.cc[i] is not None else 0
                        self.send([0xb0+i,1,value])
                        self.send([0x90+i,n,velocity])
            elif typ==0x80 or (typ==0x90 and velocity==0):
                if self.chord:
                    self.remaining.discard(note)
                    if not self.remaining:self.silence()
                else:self.held.discard(note)
    def progression_tick(self, now=None):
        with self.lock:
            if self.progress_state!='playing':return
            now=time.monotonic() if now is None else now
            old_index=progression_index(self.progress_name,self.progress_beat)
            self.progress_beat+=max(0,now-self.progress_anchor)*self.progress_tempo/60
            self.progress_anchor=now
            total=sum(progression_durations(self.progress_name))
            wrapped=self.progress_beat>=total
            if wrapped:
                if self.progress_name not in LOOPING_PROGRESSIONS:
                    self.progression_stop()
                    return
                self.progress_beat%=total
            new_index=progression_index(self.progress_name,self.progress_beat)
            if wrapped or new_index!=old_index:
                self.play(parse_notes(PROGRESSIONS[self.progress_name][new_index][1]),source='progression')
    def progression_stop(self):
        with self.lock:
            self.progress_state='stopped'
            self.progress_beat=0.0
            if self.chord_source=='progression':self.silence()
    def progression_action(self, action, value=None):
        with self.lock:
            self.progression_tick()
            if action=='play':
                if self.progress_state=='stopped':
                    self.progress_beat=0.0
                    self.progress_state='playing'
                    self.progress_anchor=time.monotonic()
                    self.play(parse_notes(PROGRESSIONS[self.progress_name][0][1]),source='progression')
                elif self.progress_state=='paused':
                    self.progress_state='playing'
                    self.progress_anchor=time.monotonic()
                    self.play(parse_notes(PROGRESSIONS[self.progress_name][progression_index(self.progress_name,self.progress_beat)][1]),source='progression')
            elif action=='pause':
                if self.progress_state=='playing':
                    self.progress_state='paused'
                    self.silence()
                elif self.progress_state=='paused':
                    self.progression_action('play')
            elif action=='stop':self.progression_stop()
            elif action=='jump':
                if type(value) is not int or not 0<=value<len(PROGRESSIONS[self.progress_name]):raise ValueError('Invalid bar.')
                self.progress_beat=float(sum(progression_durations(self.progress_name)[:value]))
                self.progress_anchor=time.monotonic()
                if self.progress_state=='playing':self.play(parse_notes(PROGRESSIONS[self.progress_name][value][1]),source='progression')
            elif action=='select':
                if not isinstance(value,str) or value not in PROGRESSIONS:raise ValueError('Unknown progression.')
                if value!=self.progress_name:
                    self.progression_stop()
                    self.silence()
                    self.progress_name=value
                    self.progress_tempo=60
            elif action=='tempo':
                if type(value) not in (int,float) or not math.isfinite(value) or not 10<=value<=120:raise ValueError('Tempo must be 10–120 BPM.')
                self.progress_tempo=value
            else:raise ValueError('Unknown progression action.')
    def progression_status(self):
        with self.lock:
            return {'name':self.progress_name,'names':list(PROGRESSIONS),'loop':self.progress_name in LOOPING_PROGRESSIONS,'state':self.progress_state,'beat':self.progress_beat,'tempo':self.progress_tempo,
                    'bar':progression_index(self.progress_name,self.progress_beat),
                    'total_beats':sum(progression_durations(self.progress_name)),
                    'chords':[{'name':name,'notes':notes,'beats':duration} for (name,notes),duration in zip(PROGRESSIONS[self.progress_name],progression_durations(self.progress_name))]}
    def sensor_reset(self):
        with self.lock:
            self.estimators=[GravityEstimator() for _ in range(5)]
            self.last_timestamp=None
            self.gates=[None]*5
            self.last_sensor=[0.0]*5
            self.safe_cc()
    def safe_cc(self):
        for i in range(5):
            if self.cc[i]!=0:
                self.send([0xb0+i,1,0])
                self.cc[i]=0
    def process(self, message):
        with self.lock:
            state=message['status']
            if state.get('state')!='connected':
                self.sensor_reset()
                return
            generation=state.get('generation')
            if self.generation is not None and generation!=self.generation:
                self.sensor_reset()
            self.generation=generation
            for timestamp,sensors in message['samples']:
                if self.last_timestamp is not None and timestamp<self.last_timestamp:
                    self.sensor_reset()
                self.last_timestamp=timestamp
                for i,sid in enumerate(SENSOR_IDS):
                    sensor=next((s for s in sensors if s[0]==sid),None)
                    if sensor is None or sensor[2]:continue
                    g=self.estimators[i].update(sensor[4:7],sensor[7:10],timestamp+sensor[3])
                    if g is None:continue
                    gate=max(0,min(1,g[2]))
                    self.gates[i]=gate
                    self.last_sensor[i]=time.monotonic()
                    cc=int(math.floor(gate*127+0.5))
                    if cc!=self.cc[i]:
                        self.send([0xb0+i,1,cc])
                        self.cc[i]=cc
    def watchdog(self):
        with self.lock:
            now=time.monotonic()
            for i in range(5):
                if self.last_sensor[i] and now-self.last_sensor[i]>0.5:
                    self.last_sensor[i]=0
                    self.gates[i]=None
                    self.estimators[i]=GravityEstimator()
                    if self.cc[i]!=0:self.send([0xb0+i,1,0]);self.cc[i]=0

def stream(router, stop, url):
    while not stop.is_set():
        try:
            with urllib.request.urlopen(url,timeout=3) as conn:
                for line in conn:
                    if stop.is_set():break
                    if line.startswith(b'data: '):router.process(json.loads(line[6:]))
        except (OSError,ValueError):
            router.sensor_reset()
            stop.wait(1)
    router.sensor_reset()

class KeyboardConnection:
    def __init__(self, router, name):
        self.router=router
        self.name=name
        self.midi_in=None
    def close(self):
        midi_in,self.midi_in=self.midi_in,None
        if midi_in:
            try:midi_in.cancel_callback()
            except (rtmidi.RtMidiError,RuntimeError,OSError):pass
            try:midi_in.close_port()
            except (rtmidi.RtMidiError,RuntimeError,OSError):pass
        self.router.keyboard_disconnect()
    def poll(self):
        probe=None
        try:
            probe=rtmidi.MidiIn()
            ports=probe.get_ports()
            available=self.name in ports
            if not available or self.router.live_melody:
                if self.midi_in:self.close()
                self.router.keyboard=available
            elif self.midi_in is None:
                probe.open_port(ports.index(self.name))
                probe.ignore_types(sysex=True,timing=True,active_sense=True)
                probe.set_callback(lambda event,_:self.router.keyboard_message(event[0]))
                self.midi_in=probe
                probe=None
                self.router.keyboard=True
        except (rtmidi.RtMidiError,RuntimeError,OSError,ValueError) as exc:
            self.close()
            print('MIDI input unavailable; retrying:',exc,flush=True)
        finally:
            if probe is not None:
                try:probe.close_port()
                except (rtmidi.RtMidiError,RuntimeError,OSError):pass

def midi_output_available(midi_out, name):
    try:return name in midi_out.get_ports()
    except (rtmidi.RtMidiError,RuntimeError,OSError,ValueError):return False

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--keyboard',default='Minilab37 MIDI')
    parser.add_argument('--output',default='IAC Driver Bus 1')
    args=parser.parse_args()
    midi_out=rtmidi.MidiOut()
    outs=midi_out.get_ports()
    if args.output not in outs:raise SystemExit('MIDI output not found: '+args.output+'; available: '+repr(outs))
    midi_out.open_port(outs.index(args.output))
    router=Router(midi_out);stop=threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    class StatusHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            with router.lock:
                body=json.dumps({'keyboard_connected':router.keyboard,'midi_output':args.output,'output_available':midi_output_available(midi_out,args.output),
                                 'gates':router.gates,'assigned_notes':router.chord,'live_melody':router.live_melody,
                                 'chord_source':router.chord_source,'keyboard_chords':router.keyboard_chords,'keyboard_size':router.keyboard_size,'keyboard_pending':sorted({note for _,note in router.keyboard_capture}),'keyboard_captured':router.keyboard_captured,'keyboard_voices':[{'channel':voice+1,'note':note} for (_,note),voice in sorted(router.keyboard_voices.items(),key=lambda x:x[1])],
                                 'selected_preset':router.selected_preset,'selected_voicing':router.selected_voicing,
                                 'progression':router.progression_status(),
                                 'sensor_fresh':[bool(t and time.monotonic()-t<=.5) for t in router.last_sensor]}).encode()
            if self.path=='/':
                body=(ROOT/'index.html').read_bytes();content_type='text/html; charset=utf-8'
            elif self.path=='/status':content_type='application/json'
            elif self.path=='/presets':body=json.dumps(list(PRESETS),ensure_ascii=False).encode();content_type='application/json'
            else:self.send_error(404);return
            self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            if self.path not in ('/play','/stop','/progression','/live-melody','/stop-all','/keyboard-chords','/keyboard-size'):self.send_error(404);return
            if self.headers.get('Origin') not in (None,'http://127.0.0.1:8767','http://localhost:8767'):
                self.send_error(403);return
            if self.headers.get_content_type()!='application/json':self.send_error(415);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<0 or length>1024:raise ValueError('Request too large.')
                data=json.loads(self.rfile.read(length))
                if self.path=='/play':
                    if not isinstance(data,dict):raise ValueError('Enter five note names.')
                    preset=data.get('preset')
                    if preset is not None:
                        if not isinstance(preset,str) or preset not in PRESETS:raise ValueError('Unknown chord preset.')
                        voicing=data.get('voicing',1)
                        if type(voicing) is not int or not 1<=voicing<=10:raise ValueError('Voicing must be between 1 and 10.')
                        randomize=data.get('random',False)
                        router.play_preset(preset,voicing,randomize)
                    else:
                        voicing=None
                        notes=data.get('notes')
                        if not isinstance(notes,str):raise ValueError('Enter five note names.')
                        router.play(parse_notes(notes),preset,voicing)
                elif self.path=='/keyboard-size':
                    if not isinstance(data,dict):raise ValueError('Invalid chord size request.')
                    router.set_keyboard_size(data.get('size'))
                elif self.path=='/keyboard-chords':
                    if not isinstance(data,dict):raise ValueError('Invalid mode request.')
                    router.set_keyboard_chords(data.get('enabled'))
                elif self.path=='/live-melody':
                    if not isinstance(data,dict):raise ValueError('Invalid mode request.')
                    router.set_live_melody(data.get('enabled'))
                elif self.path=='/stop-all':router.emergency_stop()
                elif self.path=='/progression':
                    if not isinstance(data,dict):raise ValueError('Invalid progression request.')
                    router.progression_action(data.get('action'),data.get('value'))
                else:
                    router.progression_stop()
                    router.silence()
                body=json.dumps({'ok':True}).encode();code=200
            except (ValueError,TypeError,json.JSONDecodeError) as exc:
                body=json.dumps({'error':str(exc)}).encode();code=400
            self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    status_server=ThreadingHTTPServer(('127.0.0.1',8767),StatusHandler)
    threading.Thread(target=status_server.serve_forever,daemon=True).start()
    t=threading.Thread(target=stream,args=(router,stop,'http://127.0.0.1:8766/events'),daemon=True);t.start()
    def schedule_progression():
        while not stop.wait(.01):router.progression_tick()
    threading.Thread(target=schedule_progression,daemon=True).start()
    keyboard=KeyboardConnection(router,args.keyboard)
    print('Output:',args.output,'· waiting for keyboard:',args.keyboard,flush=True)
    last_report=0
    try:
        while not stop.is_set():
            keyboard.poll()
            router.watchdog()
            if time.monotonic()-last_report>=2:
                with router.lock:
                    print('keyboard=',router.keyboard,'output=',args.output,'gates=',[round(x,3) if x is not None else None for x in router.gates],'notes=',router.chord,flush=True)
                last_report=time.monotonic()
            time.sleep(.1)
    except KeyboardInterrupt:pass
    finally:
        stop.set()
        router.stop_all()
        router.safe_cc()
        keyboard.close()
        status_server.shutdown();status_server.server_close()
        midi_out.close_port()

if __name__=='__main__':main()
