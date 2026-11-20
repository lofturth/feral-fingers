import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../../core/physics';
import type { PianoExercise } from '../deck';
import { noteName } from '../midi/useMidi';
import { colorForPitch } from '../cards/noteColors';

type Observation = { time: number; progress: number };
type Props = { state: SessionSnapshot; progress: number; history: readonly Observation[]; exercises: readonly PianoExercise[] };
const top = 24, bottom = 502, reachableTop = 60, left = 20, right = 1180;
const screenY = (position: number) => bottom - position / 100 * (bottom - reachableTop);
const traceY = (value: number) => bottom - 4 - value / 100 * (bottom - top - 8);

export function FallingView({ state, progress, history, exercises }: Props) {
  const chart = useRef<SVGSVGElement>(null);
  const [traceWidth, setTraceWidth] = useState(2.3);
  useEffect(() => {
    const resize = () => setTraceWidth(2.3 * (chart.current?.getScreenCTM()?.a || 1));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const slotWidth = (right - left) / state.cards.length;
  const trace = history.map((point, i) => `${i ? 'L' : 'M'}${point.time},${traceY(point.progress).toFixed(2)}`).join(' ');
  const last = history[history.length - 1];
  const transform = `translate(${left} 0) scale(${state.time > 0 ? (right - left) / state.time : 1} 1)`;
  return <div className="chart-wrap">
    <svg id="chart" ref={chart} viewBox="0 0 1270 560" aria-label="Falling piano exercises and overall progress">
      <g aria-label="Thresholds">
        <line x1={left} y1={screenY(state.config.unlock.threshold)} x2={right} y2={screenY(state.config.unlock.threshold)} stroke="#c1d3cf" strokeWidth="1"/>
        <line x1={left} y1={screenY(state.config.finish.threshold)} x2={right} y2={screenY(state.config.finish.threshold)} stroke="#c1d3cf" strokeWidth="1"/>
      </g>
      <path id="trace" d={trace} fill="none" stroke="#247c83" strokeOpacity=".65" strokeWidth={traceWidth} strokeLinejoin="round" strokeLinecap="round" transform={transform} vectorEffect="non-scaling-stroke"/>
      <path id="trace-live" d={`M${last.time},${traceY(last.progress).toFixed(2)} L${state.time},${traceY(progress).toFixed(2)}`} fill="none" stroke="#247c83" strokeOpacity=".65" strokeWidth={traceWidth} strokeLinejoin="round" strokeLinecap="round" transform={transform} vectorEffect="non-scaling-stroke"/>
      <g id="bars">
        {state.cards.map((item, i) => {
          const x = left + i * slotWidth + 5, width = Math.max(0, slotWidth - 10), y = screenY(item.shown), selected = i === state.selectedIndex;
          const notes = exercises[i].notes;
          const tileWidth = Math.min(48, Math.max(0, width - 8));
          const gap = notes.length > 1 ? Math.min(3, 460 / (notes.length - 1)) : 0;
          const tileHeight = Math.min(26, Math.max(0, (bottom - top - 16 - gap * (notes.length - 1)) / notes.length));
          const tileX = x + (width - tileWidth) / 2;
          return <g key={item.id} visibility={item.unlocked ? 'visible' : 'hidden'} aria-label={`${exercises[i].label}${selected ? ', active' : ''}`}>
            <rect x={x} y={top} width={width} height={y - top} rx="4" fill="#4ba49c" fillOpacity={selected ? .28 : .13} stroke="#478f88" strokeOpacity={selected ? .8 : .36} strokeWidth={selected ? 1.5 : 1}/>
            {notes.map((pitch, index) => {
              const tileY = top + 7 + index * (tileHeight + gap);
              return <g key={index}>
                <rect x={tileX} y={tileY} width={tileWidth} height={tileHeight} rx="4" fill={colorForPitch(pitch)} stroke="#d2c9bc" strokeWidth="1"/>
                <text x={x + width / 2} y={tileY + tileHeight / 2} fill="#101828" fontSize={Math.max(0, Math.min(18, tileHeight * .7, tileWidth / 2.5))} textAnchor="middle" dominantBaseline="central" textLength={Math.max(0, Math.min(tileWidth - 5, noteName(pitch).length * tileHeight * .4))} lengthAdjust="spacingAndGlyphs">{noteName(pitch)}</text>
              </g>;
            })}
            {selected && <polygon points={`${x + width / 2 - 5},${top - 10} ${x + width / 2 + 5},${top - 10} ${x + width / 2},${top - 3}`} fill="#247c83"/>}
          </g>;
        })}
      </g>

    </svg>
  </div>;
}
