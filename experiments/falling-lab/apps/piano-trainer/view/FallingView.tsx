import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SessionSnapshot } from '../../../core/physics';
import type { PianoExercise } from '../deck';
import { noteName } from '../midi/useMidi';

type Observation = { time: number; progress: number };
type Props = { state: SessionSnapshot; progress: number; history: readonly Observation[]; exercises: readonly PianoExercise[] };
const top = 24, bottom = 502, reachableTop = 60, left = 20, right = 1180;
const screenY = (position: number) => bottom - position / 100 * (bottom - reachableTop);
const traceY = (value: number) => bottom - 4 - value / 100 * (bottom - top - 8);

export type FieldHandle = { selectedCardRect: (snapshot: SessionSnapshot) => DOMRect | null };

// Geometry and SVG styling follow apps/generic/view/falling-field.js.
export const FallingView = forwardRef<FieldHandle, Props>(function FallingView({ state, progress, history, exercises }, ref) {
  const chart = useRef<SVGSVGElement>(null);
  const [traceWidth, setTraceWidth] = useState(2.3);
  useImperativeHandle(ref, () => ({
    selectedCardRect(snapshot) {
      const index = snapshot.selectedIndex;
      const item = snapshot.cards[index];
      const matrix = chart.current?.getScreenCTM();
      if (!item?.unlocked || !matrix) return null;
      const width = (right - left) / snapshot.cards.length - 10;
      const x = left + index * (right - left) / snapshot.cards.length + 7;
      const y = Math.max(top + 2, screenY(item.shown) - 28);
      const p1 = new DOMPoint(x, y).matrixTransform(matrix);
      const p2 = new DOMPoint(x + Math.max(0, width - 4), y + 20).matrixTransform(matrix);
      return new DOMRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    }
  }), []);
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
    <svg id="chart" ref={chart} viewBox="0 0 1270 560" aria-label="Falling piano phrase and overall progress">
      <defs>
        <linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ED4CA8" stopOpacity=".025"/><stop offset="1" stopColor="#ED4CA8" stopOpacity=".20"/></linearGradient>
        <linearGradient id="bar-fill-selected" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#43E6ED" stopOpacity=".05"/><stop offset="1" stopColor="#43E6ED" stopOpacity=".25"/></linearGradient>
      </defs>
      <g id="grid">
        {[0, 1, 2, 3, 4].map(i => { const y = top + i * (bottom - top) / 4; return <g key={i}><line x1={left} y1={y} x2={right} y2={y} stroke="#202738" strokeWidth="1"/><text x="1190" y={y + 3} fill="#657087" fontSize="8" textAnchor="end">{100 - i * 25}</text></g>; })}
        {state.cards.map((item, i) => { const x = left + i * slotWidth + 5, width = slotWidth - 10, selected = i === state.selectedIndex; return <g key={item.id} visibility={item.unlocked ? 'visible' : 'hidden'}>
          <rect x={x - 2} y={top} width={width + 4} height={bottom - top} fill="rgba(67, 230, 237, 0.04)" stroke="#43E6ED" strokeWidth="1.2" strokeDasharray="3 6" opacity={selected ? .9 : 0} rx="2"/>
          <polygon points={`${x + width / 2 - 5},${top - 10} ${x + width / 2 + 5},${top - 10} ${x + width / 2},${top - 3}`} fill="#43E6ED" opacity={selected ? 1 : 0}/>
          <line x1={x + width / 2} y1={top} x2={x + width / 2} y2={bottom} stroke="#202738" strokeWidth=".6" strokeDasharray="2 8"/>
          <text x={x + width / 2} y="540" fill={selected ? '#43E6ED' : '#657087'} fontSize="8" textAnchor="middle" fontWeight={selected ? '700' : '400'}>{String(i + 1).padStart(2, '0')}</text>
        </g>; })}
      </g>
      <g id="bars">
        {state.cards.map((item, i) => { const x = left + i * slotWidth + 5, width = slotWidth - 10, y = screenY(item.shown), selected = i === state.selectedIndex, faded = item.depth >= state.config.finish.threshold; return <g key={item.id} visibility={item.unlocked ? 'visible' : 'hidden'} className={faded ? 'word-faded' : undefined}>
          <rect x={x} y={top} width={width} height={y - top} fill={selected ? 'url(#bar-fill-selected)' : 'url(#bar-fill)'}/>
          <line x1={x} y1={y} x2={x + width} y2={y} stroke={selected ? '#43E6ED' : '#ED4CA8'} strokeWidth="1.3"/>
        </g>; })}
      </g>
      <path id="trace" d={trace} fill="none" stroke="#43E6ED" strokeWidth={traceWidth} strokeLinejoin="round" strokeLinecap="round" transform={transform} vectorEffect="non-scaling-stroke"/>
      <path id="trace-live" d={`M${last.time},${traceY(last.progress).toFixed(2)} L${state.time},${traceY(progress).toFixed(2)}`} fill="none" stroke="#43E6ED" strokeWidth={traceWidth} strokeLinejoin="round" strokeLinecap="round" transform={transform} vectorEffect="non-scaling-stroke"/>
      <g id="labels">
        <line x1={left} y1={screenY(state.config.unlock.threshold)} x2={right} y2={screenY(state.config.unlock.threshold)} stroke="#8b7aa8" strokeWidth="1" strokeDasharray="3 8" opacity=".65"/>
        <text x={left + 3} y={screenY(state.config.unlock.threshold) - 7} fill="#8b7aa8" fontSize="8">NEW WORDS</text>
        <line x1={left} y1={screenY(state.config.finish.threshold)} x2={right} y2={screenY(state.config.finish.threshold)} stroke="#657087" strokeWidth="1" strokeDasharray="5 7" opacity=".65"/>
        <text x={left + 3} y={screenY(state.config.finish.threshold) - 7} fill="#657087" fontSize="8">COMPLETION</text>
        {state.cards.map((item, i) => { const x = left + i * slotWidth + 5, width = slotWidth - 10, y = screenY(item.shown), selected = i === state.selectedIndex; return <g key={item.id} visibility={item.unlocked ? 'visible' : 'hidden'} className={item.depth >= state.config.finish.threshold ? 'word-faded' : undefined}>
          <text transform={`translate(${left + (i + .5) * slotWidth},${y - 8}) rotate(-90)`} fill={selected ? '#43E6ED' : '#e3e8ef'} fontSize="14" textAnchor="start" dominantBaseline="central">{exercises[i].label}</text>
          <text x={x + width / 2} y={y + 16} fill={selected ? '#43E6ED' : '#ED4CA8'} fontSize="15" fontWeight="700" textAnchor="middle" stroke="#0A0D19" strokeWidth="4" paintOrder="stroke">{Math.round(Math.min(item.depth, item.shown))}%</text>
        </g>; })}
      </g>
      <text id="trace-percentage" x={right + 12} y={traceY(progress)} fill="#43E6ED" fontSize="16" fontWeight="700" dominantBaseline="central" stroke="#0A0D19" strokeWidth="4" paintOrder="stroke">{progress.toFixed(1)}%</text>
      {state.cards.map((item, i) => {
        if (!item.unlocked) return null;
        const x = left + i * slotWidth + 5;
        const width = slotWidth - 10;
        const y = screenY(item.shown);
        const notes = exercises[i].notes.map(noteName).join(' · ');
        return <g key={item.id} aria-label={`${exercises[i].label}: ${notes}`}>
          <rect x={x + 2} y={Math.max(top + 2, y - 28)} width={Math.max(0, width - 4)} height="20" rx="3" fill="#141e30" stroke={i === state.selectedIndex ? '#43E6ED' : '#43536a'}/>
          <text x={x + width / 2} y={Math.max(top + 15, y - 15)} fill="#e3e8ef" fontSize="9" textAnchor="middle" textLength={Math.max(0, width - 10)} lengthAdjust="spacingAndGlyphs">{notes}</text>
        </g>;
      })}
    </svg>
  </div>;
});
