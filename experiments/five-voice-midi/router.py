#!/usr/bin/env python3
"""Five-voice MIDI router fed by the existing dashboard, never the serial port."""
import argparse
import ast
import json
import math
import re
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
SENSOR_IDS=(3,4,2,1,0)  # Thumb, Index, Middle, Ring, Pinky

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

class Router:
    def __init__(self, output):
        self.output=output
        self.lock=threading.RLock()
        self.held=set()
        self.chord=None
        self.chord_source=None
        self.remaining=set()
        self.cc=[None]*5
        self.gates=[None]*5
        self.last_sensor=[0.0]*5
        self.estimators=[GravityEstimator() for _ in range(5)]
        self.last_timestamp=None
        self.generation=None
        self.keyboard=False
    def send(self, msg):
        self.output.send_message(msg)
    def silence(self):
        with self.lock:
            if self.chord:
                for i,note in enumerate(self.chord):
                    self.send([0x80+i,note,0])
            self.chord=None
            self.chord_source=None
            self.remaining.clear()
            self.held.clear()
    def play(self, notes):
        with self.lock:
            self.silence()
            self.chord=list(notes)
            self.chord_source='player'
            for i,note in enumerate(self.chord):
                self.send([0xb0+i,1,self.cc[i] if self.cc[i] is not None else 0])
                self.send([0x90+i,note,100])
    def keyboard_message(self, msg):
        with self.lock:
            if len(msg)<3:return
            if self.chord_source=='player':return
            typ=msg[0]&0xf0
            note,velocity=msg[1],msg[2]
            if typ==0x90 and velocity:
                if self.chord:return
                self.held.add(note)
                if len(self.held)==5:
                    self.chord=sorted(self.held)
                    self.chord_source='keyboard'
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
                body=json.dumps({'keyboard_connected':router.keyboard,'midi_output':args.output,'output_available':args.output in midi_out.get_ports(),
                                 'gates':router.gates,'assigned_notes':router.chord,
                                 'chord_source':router.chord_source,
                                 'sensor_fresh':[bool(t and time.monotonic()-t<=.5) for t in router.last_sensor]}).encode()
            if self.path=='/':
                body=(ROOT/'index.html').read_bytes();content_type='text/html; charset=utf-8'
            elif self.path=='/status':content_type='application/json'
            else:self.send_error(404);return
            self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            if self.path not in ('/play','/stop'):self.send_error(404);return
            if self.headers.get('Origin') not in (None,'http://127.0.0.1:8767','http://localhost:8767'):
                self.send_error(403);return
            if self.headers.get_content_type()!='application/json':self.send_error(415);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<0 or length>1024:raise ValueError('Request too large.')
                data=json.loads(self.rfile.read(length))
                if self.path=='/play':
                    if not isinstance(data,dict) or not isinstance(data.get('notes'),str):raise ValueError('Enter five note names.')
                    router.play(parse_notes(data['notes']))
                else:router.silence()
                body=json.dumps({'ok':True}).encode();code=200
            except (ValueError,TypeError,json.JSONDecodeError) as exc:
                body=json.dumps({'error':str(exc)}).encode();code=400
            self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    status_server=ThreadingHTTPServer(('127.0.0.1',8767),StatusHandler)
    threading.Thread(target=status_server.serve_forever,daemon=True).start()
    t=threading.Thread(target=stream,args=(router,stop,'http://127.0.0.1:8766/events'),daemon=True);t.start()
    midi_in=None
    print('Output:',args.output,'· waiting for keyboard:',args.keyboard,flush=True)
    last_report=0
    try:
        while not stop.is_set():
            probe=rtmidi.MidiIn()
            ports=probe.get_ports()
            if args.keyboard not in ports:
                if midi_in:
                    with router.lock:
                        if router.chord_source!='player':router.silence()
                    midi_in.close_port();midi_in=None
                    router.keyboard=False
                del probe
            elif midi_in is None:
                probe.open_port(ports.index(args.keyboard))
                probe.ignore_types(sysex=True,timing=True,active_sense=True)
                probe.set_callback(lambda event,_:router.keyboard_message(event[0]))
                midi_in=probe;router.keyboard=True
            else:del probe
            router.watchdog()
            if time.monotonic()-last_report>=2:
                with router.lock:
                    print('keyboard=',router.keyboard,'output=',args.output,'gates=',[round(x,3) if x is not None else None for x in router.gates],'notes=',router.chord,flush=True)
                last_report=time.monotonic()
            time.sleep(.1)
    except KeyboardInterrupt:pass
    finally:
        stop.set()
        router.silence()
        router.safe_cc()
        if midi_in:midi_in.close_port()
        status_server.shutdown();status_server.server_close()
        midi_out.close_port()

if __name__=='__main__':main()
