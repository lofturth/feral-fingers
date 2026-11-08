import math
import unittest
from unittest.mock import patch
from router import Router, parse_notes
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
        self.assertEqual(self.out.messages[:5],[[128+i,n,0] for i,n in enumerate(notes)])
        self.assertEqual(self.r.chord,new)
        self.out.messages.clear();self.r.silence()
        self.assertEqual(self.out.messages,[[128+i,n,0] for i,n in enumerate(new)])
        self.assertIsNone(self.r.chord_source)
    def test_player_and_keyboard_are_exclusive(self):
        for n in [60,62,64,65,67]:self.press(n)
        self.assertEqual(self.r.chord_source,'keyboard')
        self.out.messages.clear();self.r.play(parse_notes('C3 D3 E3 F3 G3'))
        self.assertEqual(self.out.messages[:5],[[128+i,n,0] for i,n in enumerate([60,62,64,65,67])])
        self.out.messages.clear()
        for n in [60,62,64,65,67]:self.release(n);self.press(n)
        self.assertEqual(self.out.messages,[]);self.assertEqual(self.r.chord_source,'player')
        self.r.silence()
        for n in [60,62,64,65,67]:self.press(n)
        self.assertEqual(self.r.chord_source,'keyboard')
    def test_gates_mapping_and_stale(self):
        sensors=[[i,3,0,0,math.sqrt(1-z*z),0,z,0,0,0] for i,z in enumerate([1,.5,0,.25,.75])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.r.cc,[32,95,0,64,127])
        count=len(self.out.messages)
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[6000,sensors]]})
        self.assertEqual(len(self.out.messages),count)
        with patch('router.time.monotonic',return_value=max(self.r.last_sensor)+1):self.r.watchdog()
        self.assertEqual(self.r.cc,[0]*5)
        self.assertTrue(all(x is None for x in self.r.gates))
    def test_negative_gravity_closes_gate(self):
        sensors=[[i,3,0,0,0,0,z,0,0,0] for i,z in enumerate([1,-1,1,-1,1])]
        self.r.process({'status':{'state':'connected','generation':1},'samples':[[1000,sensors]]})
        self.assertEqual(self.r.cc,[0,127,127,0,127])
if __name__=='__main__':unittest.main()
