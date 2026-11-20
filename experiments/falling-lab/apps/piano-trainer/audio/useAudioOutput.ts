import { useCallback, useEffect, useRef, useState } from 'react';

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
const storageKey = 'piano-trainer.audio-output';
function savedOutput() { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } }

export function useAudioOutput() {
  const [selected, setSelected] = useState(savedOutput);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [message, setMessage] = useState('');
  const audio = useRef<SinkContext | null>(null);
  const desired = useRef(selected);
  const queue = useRef(Promise.resolve());
  const refresh = useRef<() => Promise<void>>(async () => {});
  const supported = typeof window !== 'undefined' && !!(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)?.prototype && 'setSinkId' in (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)!.prototype;

  const apply = useCallback((id: string, context: SinkContext) => {
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (audio.current !== context || desired.current !== id || !context.setSinkId) return;
      try {
        await context.setSinkId(id);
        if (audio.current === context && desired.current === id) {
          setSelected(id); setMessage('');
          try { localStorage.setItem(storageKey, id); } catch { /* Keep the session setting. */ }
        }
      } catch {
        if (audio.current !== context || desired.current !== id) return;
        desired.current = '';
        try { await context.setSinkId(''); } catch { /* The browser retains its current output. */ }
        setSelected('');
        try { localStorage.setItem(storageKey, ''); } catch { /* Keep the session setting. */ }
        setMessage('Could not use that output. Using system default when available.');
      }
    });
  }, []);
  const setContext = useCallback((context: AudioContext) => {
    audio.current = context as SinkContext;
    if (desired.current) apply(desired.current, audio.current);
  }, [apply]);
  const select = useCallback((id: string) => {
    desired.current = id;
    if (audio.current) apply(id, audio.current);
    else { setSelected(id); try { localStorage.setItem(storageKey, id); } catch { /* Keep the session setting. */ } }
  }, [apply]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) { setMessage('Audio device discovery is unavailable in this browser.'); return; }
    let active = true, request = 0;
    async function update() {
      const current = ++request;
      try {
        const outputs = (await media.enumerateDevices()).filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications');
        if (!active || current !== request) return;
        setDevices(outputs);
        // Enumeration may be permission-filtered, so an absent device is not proof it is disconnected.
      } catch { if (active && current === request) setMessage('Could not list audio outputs. Check browser permissions.'); }
    }
    refresh.current = update;
    void update();
    media.addEventListener?.('devicechange', update);
    return () => { active = false; refresh.current = async () => {}; media.removeEventListener?.('devicechange', update); };
  }, []);
  const allowDevices = useCallback(async () => {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) { setMessage('Microphone permission is unavailable. Check browser and site settings.'); return; }
    try {
      const stream = await media.getUserMedia({ audio: true });
      setMessage('');
      try { await refresh.current(); } finally { stream.getTracks().forEach(track => track.stop()); }
    } catch { setMessage('Could not get microphone permission. Check browser and site settings.'); }
  }, []);
  return { selected, devices, message, supported, select, setContext, allowDevices };
}
