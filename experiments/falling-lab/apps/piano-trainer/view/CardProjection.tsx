import { useEffect, useRef } from 'react';

export type Projection = { id: number; label: string; notes: string; start: DOMRect; end: DOMRect };

export function CardProjection({ projection, onFinish }: { projection: Projection; onFinish: (id: number) => void }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const { start, end, id } = projection;
    const animation = el.animate([
      { transform: 'translate(0, 0) scale(1, 1)', opacity: .9 },
      { transform: `translate(${end.left - start.left}px, ${end.top - start.top}px) scale(${end.width / start.width}, ${end.height / start.height})`, opacity: 0 }
    ], { duration: 350, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'forwards' });
    animation.onfinish = () => onFinish(id);
    return () => { animation.onfinish = null; animation.cancel(); };
  }, [projection, onFinish]);
  const { start } = projection;
  return <div ref={node} aria-hidden="true" className="card-projection" style={{ left: start.left + window.scrollX, top: start.top + window.scrollY, width: start.width, height: start.height }}>
    <span>{projection.label}</span><span>{projection.notes}</span>
  </div>;
}
