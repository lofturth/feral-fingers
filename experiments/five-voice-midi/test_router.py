import math
import unittest
from unittest.mock import patch, MagicMock
from router import Router, KeyboardConnection, PRESETS, OPEN_SKIES, LONGING, AFTERGLOW, GOLDEN_LIGHT, parse_notes
class Output:
    def __init__(self):self.messages=[]
    def send_message(self,msg):self.messages.append(msg)
class Tests(unittest.TestCase):
    def setUp(self):self.out=Output();self.r=Router(self.out)
    def press(self,n):self.r.keyboard_message([0x90,n,100])
    def release(self,n):self.r.keyboard_message([0x80,n,0])
    def test_lock_and_release(self):
        self.r.cc=[1,2,3,4,5]
        for n in [72,60,67,64,69]:self.press(n)
        self.assertEqual(self.r.chord,[60,64,67,69,72])
        self.assertEqual(self.out.messages,[[176+i,1,i+1] if j%2==0 else [144+i,[60,64,67,69,72][i],100] for i in range(5) for j in range(2)])
        self.press(80)
        for n in [64,72,60,67]:self.release(n)
        self.assertEqual(len(self.out.messages),10)
        self.release(69)
        self.assertEqual(self.out.messages[-5:],[[128+i,n,0] for i,n in enumerate([60,64,67,69,72])])
        self.assertIsNone(self.r.chord)
    def test_disconnect(self):
        for n in [1,2,3,4,5]:self.press(n)
        self.r.silence()
        self.assertEqual(len([m for m in self.out.messages if m[0]&0xf0==0x80]),5)
    def test_parse(self):
        self.assertEqual(parse_notes('C3 G3 E4 B4 D5'),[48,55,64,71,74])
        for text in ['C3 C3 E4 B4 D5','C3 B#2 E4 B4 D5','C3 G3 E4 B4','C3 G3 E4 B4 H5','C3 G3 E4 B4 C10']:
            with self.assertRaises(ValueError):parse_notes(text)
    def test_player_play_replace_stop(self):
        notes=parse_notes('C3 G3 E4 B4 D5')
        self.r.cc=[1,2,3,4,5];self.r.play(notes)
        self.assertEqual(self.r.chord,notes);self.assertEqual(self.r.chord_source,'player')
        self.assertEqual(self.out.messages,[[176+i,1,i+1] if j%2==0 else [144+i,notes[i],100] for i in range(5) for j in range(2)])
        self.out.messages.clear();new=parse_notes('C4 D4 E4 F4 G4');self.r.play(new)
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertEqual(self.r.chord,new)
        self.out.messages.clear();self.r.silence()
        self.assertTrue(all([128+i,n,0] in self.out.messages for i,n in enumerate(new)))
        self.assertIsNone(self.r.chord_source)
    def test_player_and_keyboard_are_exclusive(self):
        for n in [60,62,64,65,67]:self.press(n)
        self.assertEqual(self.r.chord_source,'keyboard')
        self.out.messages.clear();self.r.play(parse_notes('C3 D3 E3 F3 G3'))
        self.assertTrue(any(m[0]&0xf0==0x90 for m in self.out.messages))
        self.out.messages.clear()
        for n in [60,62,64,65,67]:self.release(n);self.press(n)
        self.assertEqual(self.out.messages,[]);self.assertEqual(self.r.chord_source,'player')
        self.r.silence()
        for n in [60,62,64,65,67]:self.press(n)
        self.assertEqual(self.r.chord_source,'keyboard')
    def test_preset_selection_replacement_stop_and_custom(self):
        self.assertEqual(len(PRESETS),20)
        first=parse_notes(' '.join(PRESETS['C major'][0]))
        self.r.play(first,'C major',1)
        self.assertEqual(self.r.selected_preset,'C major')
        self.out.messages.clear()
        second=parse_notes(' '.join(PRESETS['C major'][1]))
        self.r.play(second,'C major',2)
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144+i,n,100] for i,n in enumerate(second) if first[i]!=n])
        self.assertEqual(self.r.selected_voicing,2)
        self.out.messages.clear()
        self.r.play(parse_notes('C3 G3 E4 B4 D5'))
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertIsNone(self.r.selected_preset)
        self.r.play(first,'C major',1);self.r.silence()
        self.assertIsNone(self.r.selected_preset);self.assertIsNone(self.r.chord)
    def test_random_preset_choice_and_manual_selection(self):
        self.r.play_preset('D minor')
        self.assertEqual(self.r.selected_voicing,1)
        first=self.r.chord[:];self.out.messages.clear()
        with patch('router.random.choice',side_effect=lambda options:options[-1]) as choice:
            self.r.play_preset('D minor',randomize=True)
            self.assertNotIn(1,choice.call_args.args[0])
        self.assertEqual(self.r.selected_voicing,10)
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertEqual(self.r.chord,parse_notes(' '.join(PRESETS['D minor'][9])))
        self.r.play_preset('D minor',voicing=4)
        self.assertEqual(self.r.selected_voicing,4)
        with patch('router.random.choice',side_effect=lambda options:options[0]) as choice:
            self.r.play_preset('C major',randomize=True)
            self.assertEqual(choice.call_args.args[0],list(range(1,11)))
        self.assertEqual(self.r.selected_voicing,1)
        self.r.play_preset('D minor')
        self.assertEqual(self.r.selected_voicing,1)
        with self.assertRaises(ValueError):self.r.play_preset('D minor',randomize='yes')
    def test_voicing_catalog(self):
        roots={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
        qualities={'major':(0,4,7),'minor':(0,3,7),'maj9':(0,4,7,11,2),'m9':(0,3,7,10,2),'7':(0,4,7,10),'sus4':(0,5,7),'maj7':(0,4,7,11)}
        self.assertEqual(len(PRESETS),20)
        for name,voicings in PRESETS.items():
            root=roots[name[0]]+(1 if len(name)>1 and name[1]=='♯' else -1 if len(name)>1 and name[1]=='♭' else 0)
            quality=name[2:].strip() if len(name)>1 and name[1] in '♯♭' else name[1:].strip()
            expected={(root+x)%12 for x in qualities[quality]}
            self.assertEqual(len(voicings),10,name)
            self.assertEqual(len({tuple(v) for v in voicings}),10,name)
            for voicing in voicings:
                self.assertEqual(len(voicing),5,name)
                pitches=parse_notes(' '.join(voicing))
                self.assertEqual([parse_notes(' '.join([n,'C-1','C#-1','D-1','Eb-1']))[-1] for n in voicing],pitches,name)
                self.assertTrue(all(36<=n<=84 for n in pitches),name)
                self.assertEqual({n%12 for n in pitches},expected,name)
    def test_gates_mapping_and_stale(self):
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.r.cc,[127,64,0,32,95])
        count=len(self.out.messages)
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[6000,sensors]]})
        self.assertEqual(len(self.out.messages),count)
        with patch('router.time.monotonic',return_value=max(self.r.last_sensor)+1):self.r.watchdog()
        self.assertEqual(self.r.cc,[0]*5)
        self.assertTrue(all(x is None for x in self.r.gates))
    def test_negative_gravity_closes_gate(self):
        sensors=[[i,3,0,0,0,0,z,0,0,0] for i,z in enumerate([1,-1,1,-1,1])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.r.cc,[127,0,127,0,127])
class ProgressionTests(unittest.TestCase):
    def setUp(self):
        self.clock=patch('router.time.monotonic',return_value=100.0)
        self.now=self.clock.start();self.addCleanup(self.clock.stop)
        self.out=Output();self.r=Router(self.out)
    def advance(self,seconds):
        self.now.return_value+=seconds;self.r.progression_tick()
    def test_timing_transitions_tempo_and_end(self):
        self.r.progression_action('play');first=parse_notes(OPEN_SKIES[0][1])
        self.assertEqual(self.r.chord,first)
        self.advance(3.9);self.assertEqual(self.r.chord,first)
        self.out.messages.clear();self.advance(.1)
        second=parse_notes(OPEN_SKIES[1][1])
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144+i,n,100] for i,n in enumerate(second) if first[i]!=n])
        self.advance(1);self.r.progression_action('tempo',120);self.advance(1.5)
        self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[2][1]))
        self.r.progression_action('jump',7);self.out.messages.clear();self.advance(2)
        self.assertEqual(self.r.progress_state,'stopped');self.assertIsNone(self.r.chord)
        self.assertGreaterEqual(len([m for m in self.out.messages if m[0]&0xf0==0x80]),5)
        self.assertEqual(self.r.progress_beat,0)
    def test_pause_resume_jump_and_stop(self):
        self.r.progression_action('play');self.advance(1.5);self.out.messages.clear()
        self.r.progression_action('pause');self.assertEqual(self.r.progress_state,'paused')
        self.assertEqual(len(self.out.messages),5);self.assertIsNone(self.r.chord)
        self.advance(10);self.assertEqual(self.r.progress_beat,1.5)
        self.r.progression_action('pause');self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[0][1]))
        self.advance(2.5);self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[1][1]))
        self.r.progression_action('jump',4);self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[4][1]))
        self.r.progression_action('stop');self.assertIsNone(self.r.chord);self.assertEqual(self.r.progress_beat,0)
        self.r.progression_action('jump',3);self.r.progression_action('play');self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[0][1]))
    def test_manual_switch_and_keyboard_exclusivity(self):
        manual=parse_notes('C3 G3 C4 E4 G4');self.r.play(manual)
        self.out.messages.clear();self.r.progression_action('play')
        self.assertTrue(any(m[0]&0xf0==0x90 for m in self.out.messages))
        self.r.keyboard_message([0x90,60,100]);self.assertEqual(self.r.held,set())
        self.r.play(manual);self.assertEqual(self.r.progress_state,'stopped');self.assertEqual(self.r.chord,manual)
        self.r.progression_action('play');self.r.progression_action('pause');self.r.keyboard_message([0x90,60,100]);self.assertEqual(self.r.held,set())
        self.r.play(manual);self.assertEqual(self.r.progress_state,'stopped')
    def test_independent_cc_during_progression(self):
        self.r.progression_action('play');self.out.messages.clear()
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.r.cc,[127,64,0,32,95])
        self.assertEqual(self.out.messages,[[176+i,1,value] for i,value in enumerate([127,64,0,32,95])])
        self.assertEqual(self.r.chord_source,'progression')
    def test_longing_notes_switch_and_melody(self):
        expected=['D2 A2 D3 F3 A4','Bb2 F3 Bb3 D4 Bb4','F2 C3 A3 C4 C5','C3 G3 C4 E4 G4',
                  'G2 D3 G3 Bb3 A4','D2 A2 D3 F4 F5','Bb2 F3 Bb3 D4 D5','A2 E3 G3 C#4 E5']
        self.assertEqual([notes for _,notes in LONGING],expected)
        self.r.progression_action('play');old=self.r.chord[:];self.advance(1)
        self.out.messages.clear();self.r.progression_action('select','Longing')
        self.assertEqual(self.out.messages,[[128+i,n,0] for i,n in enumerate(old)])
        self.assertEqual(self.r.progression_status()['name'],'Longing')
        self.assertEqual(self.r.progress_state,'stopped');self.assertEqual(self.r.progress_beat,0);self.assertEqual(self.r.progress_tempo,60)
        self.r.progression_action('play')
        for i,text in enumerate(expected):
            self.assertEqual(self.r.chord,parse_notes(text))
            self.assertEqual(self.r.chord[4],parse_notes(text)[-1])
            if i<7:self.advance(4)
        self.r.progression_action('pause');self.r.progression_action('select','Open Skies')
        self.assertEqual(self.r.progress_beat,0);self.assertEqual(self.r.progress_state,'stopped')
        self.r.progression_action('play');self.assertEqual(self.r.chord,parse_notes(OPEN_SKIES[0][1]))
    def test_longing_gate_and_invalid_selection(self):
        self.r.progression_action('select','Longing');self.r.progression_action('play');self.out.messages.clear()
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.out.messages,[[176+i,1,v] for i,v in enumerate([127,64,0,32,95])])
        with self.assertRaises(ValueError):self.r.progression_action('select','unknown')
        self.assertEqual(self.r.progress_state,'playing');self.assertEqual(self.r.progress_name,'Longing')
    def test_afterglow_loop_timing_and_playback_controls(self):
        expected=['A2 E3 A3 C4 E4','F2 C3 A3 E4 G4','C3 G3 B3 D4 E4','G2 D3 G3 B3 D4',
                  'D2 A2 F3 C4 E4','E2 B2 D3 G#3 E4']
        self.assertEqual([notes for _,notes in AFTERGLOW],expected)
        self.r.progression_action('select','Afterglow');self.assertEqual(self.r.progress_tempo,60)
        self.r.progression_action('play');self.advance(7.9);self.assertEqual(self.r.chord,parse_notes(expected[0]));self.advance(.1);self.assertEqual(self.r.chord,parse_notes(expected[1]));self.r.progression_action('jump',5)
        old=self.r.chord[:];self.out.messages.clear();self.advance(4.25)
        self.assertEqual(self.r.progress_state,'playing');self.assertAlmostEqual(self.r.progress_beat,.25)
        self.assertTrue(all(m[0]&0xf0!=0x80 for m in self.out.messages))
        self.assertEqual(self.r.chord,parse_notes(expected[0]))
        self.r.progression_action('pause');self.advance(10);self.assertAlmostEqual(self.r.progress_beat,.25)
        self.r.progression_action('play');self.r.progression_action('tempo',120);self.advance(1)
        self.assertAlmostEqual(self.r.progress_beat,2.25)
        self.r.progression_action('jump',5);self.advance(2);self.assertAlmostEqual(self.r.progress_beat,0)
        self.advance(28.25);self.assertAlmostEqual(self.r.progress_beat,.5)
        self.r.progression_action('stop');self.assertIsNone(self.r.chord);self.assertEqual(self.r.progress_beat,0)
    def test_loop_live_melody_and_cc_isolation(self):
        self.r.set_live_melody(True);self.r.keyboard_message([0x90,72,84]);self.r.progression_action('select','Afterglow')
        self.r.progression_action('play');self.r.progression_action('jump',5)
        self.out.messages.clear();self.advance(4.1)
        self.assertFalse(any(m[0] in (0x84,0x94,0xb4) for m in self.out.messages))
        self.assertEqual(self.r.sounding_chord,parse_notes(AFTERGLOW[0][1])[:4])
        self.out.messages.clear()
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.out.messages,[[176+i,1,v] for i,v in enumerate([127,64,0,32,95])])
    def test_longing_still_stops_at_end(self):
        self.r.progression_action('select','Longing');self.r.progression_action('play');self.r.progression_action('jump',7);self.advance(4)
        self.assertEqual(self.r.progress_state,'stopped');self.assertIsNone(self.r.chord)
    def test_golden_light_durations_loop_and_controls(self):
        expected=[('Am9','A2 E3 G3 B3 C4'),('Fmaj7','F2 C3 A3 C4 E4'),('Cmaj9','C3 G3 B3 D4 E4'),('G6','G2 D3 G3 B3 E4'),('Dm9','D2 A2 F3 C4 E4'),('Fmaj7','F2 C3 A3 C4 E4'),('Cmaj9','C3 G3 B3 D4 E4'),('G6','G2 D3 G3 B3 E4')]
        self.assertEqual(GOLDEN_LIGHT,expected)
        self.r.progression_action('select','Golden Light');status=self.r.progression_status()
        self.assertEqual(status['tempo'],60);self.assertEqual(status['total_beats'],40);self.assertTrue(status['loop'])
        self.assertNotIn('Undertow',status['names'])
        self.assertEqual([x['beats'] for x in status['chords']],[8,4,8,4,4,4,4,4])
        self.r.progression_action('play');self.advance(7.9);self.assertEqual(self.r.chord,parse_notes(expected[0][1]))
        self.advance(.1);self.assertEqual(self.r.chord,parse_notes(expected[1][1]))
        self.r.progression_action('jump',2);self.assertEqual(self.r.progress_beat,12);self.advance(7.9);self.assertEqual(self.r.chord,parse_notes(expected[2][1]))
        self.r.progression_action('pause');self.advance(10);self.assertAlmostEqual(self.r.progress_beat,19.9)
        self.r.progression_action('play');self.advance(.1);self.assertEqual(self.r.chord,parse_notes(expected[3][1]))
        self.r.progression_action('jump',7);self.advance(4.25);self.assertEqual(self.r.chord,parse_notes(expected[0][1]));self.assertAlmostEqual(self.r.progress_beat,.25)
        self.assertEqual(self.r.progress_state,'playing');self.r.progression_action('stop');self.assertIsNone(self.r.chord)
    def test_golden_light_live_melody_and_common_notes(self):
        self.r.set_live_melody(True);self.r.progression_action('select','Golden Light');self.r.progression_action('play');self.out.messages.clear()
        self.advance(8);self.assertEqual(self.r.sounding_chord,parse_notes(GOLDEN_LIGHT[1][1])[:4])
        self.assertFalse(any(m[0] in (0x84,0x94) for m in self.out.messages))
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.out.messages.clear();self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.out.messages,[[176+i,1,v] for i,v in enumerate([127,64,0,32,95])])
    def test_golden_light_common_fifth_voice_is_held(self):
        self.r.progression_action('select','Golden Light');self.r.progression_action('play');self.r.progression_action('jump',2)
        self.out.messages.clear();self.advance(8)
        self.assertFalse(any(m[0] in (0x84,0x94) for m in self.out.messages))
        self.assertEqual(self.r.sounding_chord[4],64)
    def test_invalid_values(self):
        self.r.progression_action('tempo',10)
        self.assertEqual(self.r.progress_tempo,10)
        for action,value in [('tempo',9),('tempo',121),('tempo',True),('jump',8),('jump',-1)]:
            with self.assertRaises(ValueError):self.r.progression_action(action,value)

class LiveMelodyTests(unittest.TestCase):
    def setUp(self):
        self.out=Output();self.r=Router(self.out);self.r.set_live_melody(True)
    def test_harmony_is_four_channels_and_keyboard_ignored(self):
        for n in (60,62,64,65,67):self.r.keyboard_message([0x94,n,90])
        self.assertEqual(self.out.messages,[]);self.assertFalse(self.r.held)
        self.r.play_preset('D minor');notes=parse_notes(' '.join(PRESETS['D minor'][0]))
        self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144+i,n,100] for i,n in enumerate(notes[:4])])
        self.out.messages.clear();self.r.progression_action('play');self.r.progression_action('pause');self.r.progression_action('play');self.r.progression_action('stop')
        self.assertFalse(any(m[0] in (0x84,0x94) for m in self.out.messages))
    def test_direct_input_is_never_forwarded_and_panic_remains(self):
        for msg in ([0x94,60,50],[0x94,64,90],[0x84,64,0],[0x94,60,0],[0xb4,1,127]):self.r.keyboard_message(msg)
        self.assertEqual(self.out.messages,[])
        self.r.progression_action('select','Afterglow');self.r.progression_action('play');self.out.messages.clear();self.r.emergency_stop()
        self.assertEqual(self.r.progress_state,'stopped')
        self.assertEqual(self.out.messages[-10:],[[176+i,cc,0] for i in range(5) for cc in (123,120)])
        self.assertFalse(any(m[0] in (0x84,0x94) for m in self.out.messages))
    def test_switch_back_restores_chord_keyboard(self):
        self.r.keyboard_message([0x94,60,80]);self.r.set_live_melody(False)
        for n in (60,62,64,65,67):self.r.keyboard_message([0x94,n,90])
        self.assertEqual(self.r.chord_source,'keyboard');self.assertEqual(len(self.r.sounding_chord),5)
    def test_independent_cc_mapping(self):
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.out.messages,[[176+i,1,v] for i,v in enumerate([127,64,0,32,95])])

class LegatoTests(unittest.TestCase):
    def setUp(self):
        self.out=Output();self.r=Router(self.out);self.timers=[]
        def timer(delay,callback):
            t=MagicMock();t.delay=delay;t.callback=callback;self.timers.append(t);return t
        self.patch=patch('router.threading.Timer',side_effect=timer);self.patch.start();self.addCleanup(self.patch.stop)
    def fire(self,timer):
        with patch('router.threading.current_thread',return_value=timer):timer.callback()
    def test_order_delay_common_notes_and_cleanup(self):
        a=[48,55,60,64,67];b=[50,55,62,64,69]
        self.r.play(a);self.out.messages.clear();self.r.play(b)
        self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144,50,100],[146,62,100],[148,69,100]])
        self.assertFalse(any(m[0]&0xf0==0x80 for m in self.out.messages))
        self.assertEqual([t.delay for t in self.timers],[.02]*3)
        for t in self.timers:self.fire(t)
        self.assertEqual(self.out.messages[-3:],[[128,48,0],[130,60,0],[132,67,0]])
        self.out.messages.clear();self.r.silence()
        self.assertEqual(self.out.messages,[[128+i,n,0] for i,n in enumerate(b)])
    def test_rapid_reversal_and_stop_cancel_stale_timers(self):
        a=[48,55,60,64,67];b=[50,57,62,65,69]
        self.r.play(a);self.r.play(b);first=self.timers[:];self.out.messages.clear();self.r.play(a)
        self.assertFalse(any(m[0]&0xf0==0x90 for m in self.out.messages))
        for t in first:self.fire(t)
        self.assertFalse(any(m[0]&0xf0==0x80 for m in self.out.messages))
        self.r.emergency_stop();self.out.messages.clear()
        for t in self.timers:self.fire(t)
        self.assertEqual(self.out.messages,[])
    def test_live_mode_stop_and_progression(self):
        self.r.set_live_melody(True);self.r.progression_action('play');self.out.messages.clear();self.r.progression_action('jump',1)
        self.assertTrue(any(m[0]&0xf0==0x90 for m in self.out.messages))
        self.assertFalse(any(m[0] in (0x84,0x94) for m in self.out.messages))
        self.r.progression_action('stop');self.assertFalse(self.r.pending_releases);self.assertIsNone(self.r.chord)
        self.out.messages.clear()
        for t in self.timers:self.fire(t)
        self.assertEqual(self.out.messages,[])
    def test_mode_switch_clears_pending_notes(self):
        self.r.play([48,55,60,64,67]);self.r.play([50,57,62,65,69]);self.r.set_live_melody(True)
        self.assertEqual(self.r.pending_releases,{});self.assertIsNone(self.r.chord)
        self.out.messages.clear()
        for t in self.timers:self.fire(t)
        self.assertEqual(self.out.messages,[])

class KeyboardChordsTests(unittest.TestCase):
    def setUp(self):
        self.out=Output();self.r=Router(self.out);self.r.set_keyboard_chords(True)
    def press(self,n):self.r.keyboard_message([0x90,n,90])
    def release(self,n):self.r.keyboard_message([0x80,n,0])
    def test_three_four_five_sorted_and_delayed(self):
        for size in (3,4,5):
            self.r.set_keyboard_size(size);self.out.messages.clear()
            notes=[72,60,67,64,69][:size]
            for n in notes[:-1]:self.press(n)
            self.assertEqual(self.out.messages,[])
            self.press(notes[-1]);self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144+i,n,90] for i,n in enumerate(sorted(notes))])
            for n in notes:self.release(n)
            self.assertFalse(self.r.keyboard_captured)
    def test_partial_releases_extras_and_repeat(self):
        self.r.set_keyboard_size(3)
        for n in (67,60,64):self.press(n)
        self.out.messages.clear();self.release(64);self.assertEqual(self.out.messages,[[0x81,64,0]])
        self.out.messages.clear();self.press(70);self.release(60);self.release(67)
        self.assertFalse(any(m[0]&0xf0==0x90 for m in self.out.messages));self.assertTrue(self.r.keyboard_captured)
        self.release(70);self.assertFalse(self.r.keyboard_captured);self.out.messages.clear()
        for n in (65,62,69):self.press(n)
        self.assertEqual([m for m in self.out.messages if m[0]&0xf0==0x90],[[144,62,90],[145,65,90],[146,69,90]])
    def test_stop_size_disconnect_and_live_mode(self):
        self.r.set_keyboard_size(3);self.press(60);self.r.emergency_stop();self.assertFalse(self.r.keyboard_capture)
        for n in (60,64,67):self.press(n)
        self.out.messages.clear();self.r.set_keyboard_size(4)
        self.assertEqual(self.out.messages,[[128,60,0],[129,64,0],[130,67,0]]);self.assertFalse(self.r.keyboard_capture)
        self.press(65);self.r.keyboard_disconnect();self.assertFalse(self.r.keyboard_capture)
        self.r.set_live_melody(True);self.out.messages.clear();self.press(70);self.assertEqual(self.out.messages,[])
    def test_cc_and_no_keyboard_retrigger_during_manual(self):
        self.r.set_keyboard_size(3);self.r.cc=[1,2,3,4,5]
        for n in (60,64,67):self.press(n)
        self.assertEqual(self.out.messages[:2],[[176,1,1],[144,60,90]])
        self.r.play([48,55,60,64,67]);self.out.messages.clear();self.press(72);self.assertEqual(self.out.messages,[])

class KeyboardReconnectTests(unittest.TestCase):
    def test_port_enumeration_failure_then_disconnect_and_reconnect(self):
        import rtmidi
        out=Output();router=Router(out);connection=KeyboardConnection(router,'MiniLab')
        bad=MagicMock();bad.get_ports.side_effect=rtmidi.InvalidPortError('port disappeared')
        connected=MagicMock();connected.get_ports.return_value=['MiniLab']
        missing=MagicMock();missing.get_ports.return_value=[]
        reconnected=MagicMock();reconnected.get_ports.return_value=['MiniLab']
        with patch('router.rtmidi.MidiIn',side_effect=[bad,connected,missing,reconnected]):
            connection.poll();self.assertFalse(router.keyboard)
            connection.poll();self.assertTrue(router.keyboard);connected.open_port.assert_called_once_with(0)
            for n in (60,62,64,65,67):router.keyboard_message([0x90,n,90])
            self.assertEqual(router.chord_source,'keyboard')
            out.messages.clear();connection.poll();self.assertFalse(router.keyboard);self.assertIsNone(router.chord)
            self.assertEqual(len([m for m in out.messages if m[0]&0xf0==0x80]),5)
            connection.poll();self.assertTrue(router.keyboard);reconnected.open_port.assert_called_once_with(0)
        connection.close()
    def test_open_race_and_direct_mode_do_not_stop_progression(self):
        import rtmidi
        out=Output();router=Router(out);router.progression_action('play');connection=KeyboardConnection(router,'MiniLab')
        bad=MagicMock();bad.get_ports.return_value=['MiniLab'];bad.open_port.side_effect=rtmidi.InvalidPortError('port disappeared')
        direct=MagicMock();direct.get_ports.return_value=['MiniLab']
        with patch('router.rtmidi.MidiIn',side_effect=[bad,direct]):
            connection.poll();self.assertEqual(router.progress_state,'playing')
            router.live_melody=True;connection.poll();direct.open_port.assert_not_called()
            self.assertEqual(router.progress_state,'playing');self.assertTrue(router.keyboard)

if __name__=='__main__':unittest.main()
