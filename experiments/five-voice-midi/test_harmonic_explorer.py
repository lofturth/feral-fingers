import ast
import json
import math
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import router as module
from router import Router


class Output:
    def __init__(self): self.messages = []
    def send_message(self, message): self.messages.append(message)
    def get_ports(self): return ['test output']


class ExplorerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Exercise the real nested HTTP handler without starting hardware or the main loop.
        tree = ast.parse(Path(module.__file__).read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        handler = next(n for n in main.body if isinstance(n, ast.ClassDef) and n.name == 'StatusHandler')
        cls.output = Output()
        cls.router = Router(cls.output)
        scope = dict(vars(module), router=cls.router, midi_out=cls.output, args=SimpleNamespace(output='test output'))
        exec(compile(ast.Module(body=[handler], type_ignores=[]), module.__file__, 'exec'), scope)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), scope['StatusHandler'])
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, data=None):
        payload = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            return response.headers, response.read()

    def test_page_route_and_existing_root(self):
        headers, page = self.request('/harmonic-explorer')
        self.assertIn('text/html', headers['Content-Type'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertIn(b'Harmonic Explorer', page)
        self.assertIn(b"name:'C major',role:'STARTING CHORD',pitches:[48,55,60,64,67]", page)
        self.assertIn(b'[48,53,57,64,67]', page)
        self.assertIn(b'Five-voice chord player', self.request('/')[1])

    def test_play_switch_status_and_stop_keep_expression(self):
        r, out = self.router, self.output
        r.silence()
        r.cc = [11, 22, 33, 44, 55]
        out.messages.clear()
        with patch.object(module.threading, 'Timer') as timer:
            self.request('/play', {'notes': 'C3 G3 B3 D4 E4'})
            status = json.loads(self.request('/status')[1])
            self.assertTrue(status['finger_mapping_supported'])
            self.assertEqual(status['router_revision'], module.ROUTER_REVISION)
            self.assertEqual(status['assigned_notes'], [48, 55, 59, 62, 64])
            self.assertEqual([m for m in out.messages if m[0] & 0xf0 == 0xb0], [[176+i, 1, v] for i, v in enumerate(r.cc)])
            out.messages.clear()
            self.request('/play', {'notes': 'C3 F3 A3 E4 G4'})
            self.assertEqual(json.loads(self.request('/status')[1])['assigned_notes'], [48, 53, 57, 64, 67])
            self.assertEqual(r.cc, [11, 22, 33, 44, 55])
            self.assertEqual([m for m in out.messages if m[0] & 0xf0 == 0xb0], [[176+i, 1, r.cc[i]] for i in range(1, 5)])
            self.request('/stop', {})
            self.assertIsNone(json.loads(self.request('/status')[1])['assigned_notes'])
            self.assertTrue(timer.called)

    def test_finger_mappings_switch_and_release(self):
        r, out = self.router, self.output
        r.silence(); r.cc = [10,20,30,40,50]; r.last_sensor=[time.monotonic()]*5; out.messages.clear()
        notes=[48,55,60,64,67]
        with patch.object(module.threading, 'Timer'):
            self.request('/play', {'voice_notes':notes,'mapping':[0,1,2,3,4]})
            self.assertEqual(r.sounding_chord,notes)
            for mapping in ([4,3,2,1,0],[2,1,4,3,0],[0,1,2,3,4]):
                out.messages.clear();self.request('/finger-mapping',{'mapping':mapping})
                self.assertEqual(r.sounding_chord,notes)
                self.assertEqual(out.messages,[[0xb0+i,1,r.cc[finger]] for i,finger in enumerate(mapping)])
                self.assertEqual(json.loads(self.request('/status')[1])['finger_mapping'],mapping)
            self.request('/finger-mapping',{'mapping':[4,3,2,1,0]})
            out.messages.clear();self.request('/play',{'voice_notes':[69,55,60,64,67],'mapping':[4,3,2,1,0]})
            self.assertEqual(r.sounding_chord,[69,55,60,64,67])
            self.assertIn([0x90,69,100],out.messages)
            self.assertFalse(any(m[0]&0xf0==0x90 for m in out.messages if m[0]!=0x90))
            self.request('/stop',{})
            self.assertFalse(r.pending_releases)
            for i,n in enumerate([69,55,60,64,67]):self.assertIn([0x80+i,n,0],out.messages)

    def test_mapped_live_cc_and_diagnostic(self):
        r,out=self.router,self.output
        r.silence();r.set_cc1_enabled(True);r.sensor_reset()
        self.request('/play',{'voice_notes':[48,55,60,64,67],'mapping':[4,3,2,1,0]})
        out.messages.clear()
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        r.process({'status':{'state':'connected','generation':123},'samples':[[1000,sensors]]})
        self.assertEqual(out.messages,[[0xb0+4-i,1,v] for i,v in enumerate([127,64,0,32,95]) if v])
        out.messages.clear();self.request('/cc1',{'enabled':False})
        self.assertEqual(out.messages,[[0xb0+i,1,100] for i in range(5)])
        out.messages.clear();self.request('/finger-mapping',{'mapping':[2,1,4,3,0]})
        self.assertEqual(out.messages,[])
        self.request('/cc1',{'enabled':True})
        self.assertEqual(out.messages,[[0xb0+i,1,v] for i,v in enumerate([0,64,95,32,127])])
        self.request('/stop',{})

    def test_invalid_mapping_does_not_change_playback(self):
        r = self.router
        r.silence()

        self.request('/play', {'notes':'C3 G3 C4 E4 G4'})
        old = r.sounding_chord[:]
        for mapping in ([0,0,1,2,3], [0,1,2,3,True], [0,1,2,3,5], 'reverse'):
            with self.assertRaises(urllib.error.HTTPError) as exc:
                self.request('/play', {'notes':'C3 G3 C4 E4 G4','mapping':mapping})
            self.assertEqual(exc.exception.code, 400)
            exc.exception.close()
            self.assertEqual(r.sounding_chord, old)
        r.silence()

    def test_voice_crossing_and_unison_keep_channels(self):
        r, out = self.router, self.output
        r.silence(); r.cc = [10,20,30,40,50]; out.messages.clear()
        with patch.object(module.threading, 'Timer'):
            for notes in ([59,60,64,67,69],[60,60,64,67,69],[61,60,64,67,69]):
                self.request('/play', {'voice_notes': notes})
                status=json.loads(self.request('/status')[1])
                self.assertEqual(status['voice_notes'], notes)
                self.assertEqual(r.sounding_chord, notes)
            self.assertIn([0x90,61,100], out.messages)
            self.assertIn([0xb0,1,10], out.messages)
            self.request('/stop', {})
            self.assertFalse(r.pending_releases)
            for i,n in enumerate([61,60,64,67,69]):self.assertIn([0x80+i,n,0],out.messages)

    def test_cc1_toggle_preserves_notes_and_restores_live_expression(self):
        r, out = self.router, self.output
        r.silence(); r.set_cc1_enabled(True); out.messages.clear()
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        sample={'status':{'state':'connected','generation':123},'samples':[[1000,sensors]]}
        r.sensor_reset();r.process(sample);out.messages.clear()
        self.request('/cc1', {'enabled':False})
        self.assertFalse(json.loads(self.request('/status')[1])['cc1_enabled'])
        self.assertEqual(out.messages,[[0xb0+i,1,100] for i in range(5)])
        out.messages.clear();self.request('/cc1', {'enabled':False})
        self.assertEqual(out.messages,[])
        self.request('/play', {'voice_notes':[67,64,60,55,48]})
        self.assertEqual([m for m in out.messages if m[0]&0xf0==0x90],[[0x90+i,n,100] for i,n in enumerate([67,64,60,55,48])])
        self.assertFalse(any(m[0]&0xf0==0xb0 for m in out.messages))
        out.messages.clear();r.sensor_reset();r.process(sample)
        with patch.object(module.time, 'monotonic', return_value=max(r.last_sensor)+1):r.watchdog()
        self.assertEqual(out.messages,[])
        r.process(sample)
        self.request('/cc1', {'enabled':True})
        self.assertEqual(out.messages,[[0xb0+i,1,v] for i,v in enumerate([127,64,0,32,95])])
        self.assertEqual(r.sounding_chord,[67,64,60,55,48])
        self.request('/stop', {})


if __name__ == '__main__': unittest.main()
