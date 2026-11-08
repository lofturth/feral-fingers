import binascii
import struct
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import serial
import server


def packet(seq):
    header=server.decoder.HEADER.pack(b'FFIM',1,5,136,seq,seq*5000,seq*5000+5000,seq*5000+3200,0)
    sensors=b''.join(server.decoder.SENSOR.pack(i,3,0,0,600*(i+1),0,0,16000,0,0,0) for i in range(5))
    payload=header+sensors
    return payload+struct.pack('<H',binascii.crc_hqx(payload,0xffff))


def wait_for(predicate, timeout=5):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if predicate():
            return
        time.sleep(.01)
    raise AssertionError('timed out waiting for condition')


class ReconnectTest(unittest.TestCase):
    def test_identification_and_repeated_disconnects(self):
        expected='D0:CF:13:0A:F4:E0'
        unrelated=SimpleNamespace(device='/dev/midi',vid=0x303a,pid=0x1001,serial_number='OTHER')
        device=SimpleNamespace(device='/dev/first',vid=0x303a,pid=0x1001,serial_number=expected)
        ports=[unrelated,device]
        unplugged=[False]
        opened=[]
        closed=[]
        class FakeSerial:
            def __init__(self,path,*args,**kwargs):
                self.path=path
                self.seq=0
                opened.append(path)
            def __enter__(self): return self
            def __exit__(self,*args): closed.append(self.path)
            def read(self,n):
                if unplugged[0]:
                    raise serial.SerialException('simulated unplug')
                time.sleep(.005)
                self.seq+=1
                return packet(self.seq)
        with patch.object(server.list_ports,'comports',side_effect=lambda:list(ports)), patch.object(server.serial,'Serial',FakeSerial):
            bridge=server.Bridge(expected)
            bridge.start()
            try:
                wait_for(lambda:bridge.status()['received']>=5)
                self.assertEqual(opened,['/dev/first'])
                for cycle in range(2):
                    unplugged[0]=True
                    ports[:]=[unrelated]
                    wait_for(lambda:bridge.status()['state']=='waiting')
                    self.assertIsNone(bridge.status()['port'])
                    self.assertIn(opened[-1],closed)
                    device=SimpleNamespace(device=f'/dev/new{cycle}',vid=0x303a,pid=0x1001,serial_number=expected.replace(':','').lower())
                    ports.append(device)
                    before=bridge.status()['received']
                    unplugged[0]=False
                    wait_for(lambda:bridge.status()['generation']==cycle+2 and bridge.status()['received']>=before+5)
                    self.assertEqual(bridge.status()['port'],device.device)
                    self.assertEqual(bridge.status()['gaps'],0)
                self.assertEqual(opened,['/dev/first','/dev/new0','/dev/new1'])
            finally:
                bridge.stop()
                bridge.thread.join(3)
            self.assertEqual(len(closed),3)
            self.assertEqual(bridge.status()['state'],'disconnected')

if __name__=='__main__':
    unittest.main()
