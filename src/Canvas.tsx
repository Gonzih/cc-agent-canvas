import { useRef, useEffect, useState, useCallback } from 'react';
// framer-motion used via Orb child components
import { Orb } from './Orb';
import type { OrbNode, Job } from './types';

interface CanvasProps {
  nodes: OrbNode[];
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  panToRepo: string | null;
  onPanComplete: () => void;
  newIds: Set<string>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

function getLinkPath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return '';
  const perp = { x: -dy / len * 40, y: dx / len * 40 };
  const mx = (sx + tx) / 2 + perp.x;
  const my = (sy + ty) / 2 + perp.y;
  return `M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`;
}

export function Canvas({ nodes, jobs, selectedId, onSelect, panToRepo, onPanComplete, newIds }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 0.7 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Build links from jobs
  const links = jobs
    .filter(j => j.depends_on)
    .map(j => ({ sourceId: j.depends_on!, targetId: j.id }))
    .filter(l => nodes.some(n => n.id === l.sourceId) && nodes.some(n => n.id === l.targetId));

  // Pan to repo when requested
  useEffect(() => {
    if (!panToRepo || !nodes.length) return;
    const repoNodes = nodes.filter(n => {
      const name = n.repo_url?.split('/').pop() ?? 'unknown';
      return name === panToRepo;
    });
    if (!repoNodes.length) { onPanComplete(); return; }
    const cx = repoNodes.reduce((s, n) => s + n.x, 0) / repoNodes.length;
    const cy = repoNodes.reduce((s, n) => s + n.y, 0) / repoNodes.length;
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const targetK = 0.85;
    setTransform({
      x: vw / 2 - cx * targetK,
      y: vh / 2 - cy * targetK,
      k: targetK,
    });
    onPanComplete();
  }, [panToRepo, nodes, onPanComplete]);

  // Wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform(t => {
      const newK = Math.min(3, Math.max(0.1, t.k * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return t;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return {
        k: newK,
        x: cx - (cx - t.x) * (newK / t.k),
        y: cy - (cy - t.y) * (newK / t.k),
      };
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Pan drag
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('[data-orb]')) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const onMouseUp = () => { dragging.current = false; };

  // Touch support
  const lastTouchDist = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragging.current = true;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && dragging.current) {
      const dx = e.touches[0].clientX - lastPos.current.x;
      const dy = e.touches[0].clientY - lastPos.current.y;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
    } else if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const factor = newDist / lastTouchDist.current;
      lastTouchDist.current = newDist;
      setTransform(t => ({
        ...t,
        k: Math.min(3, Math.max(0.1, t.k * factor)),
      }));
    }
  };

  const onTouchEnd = () => {
    dragging.current = false;
    lastTouchDist.current = null;
  };

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'fixed',
        left: 220, top: 0,
        width: 'calc(100vw - 220px)',
        height: '100vh',
        background: '#F5F0E8',
        cursor: dragging.current ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={(e) => {
        if ((e.target as SVGElement).closest('[data-orb]')) return;
        onSelect(null);
      }}
    >
      <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
        {/* Dependency curves */}
        <g>
          {links.map(l => {
            const src = nodeMap.get(l.sourceId);
            const tgt = nodeMap.get(l.targetId);
            if (!src || !tgt) return null;
            return (
              <path
                key={`${l.sourceId}-${l.targetId}`}
                d={getLinkPath(src.x, src.y, tgt.x, tgt.y)}
                fill="none"
                stroke="rgba(100,80,60,0.25)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            );
          })}
        </g>

        {/* Orbs */}
        <g>
          {nodes.map(n => (
            <g key={n.id} data-orb="true">
              <Orb
                node={n}
                zoom={transform.k}
                selected={selectedId === n.id}
                onClick={() => onSelect(selectedId === n.id ? null : n.id)}
                onHover={(id) => {
                  setHoveredId(id);
                  if (id) {
                    const nd = nodeMap.get(id);
                    if (nd) {
                      setTooltip({
                        x: nd.x,
                        y: nd.y - 55,
                        label: nd.title || nd.task || nd.id,
                      });
                    }
                  } else {
                    setTooltip(null);
                  }
                }}
                hovered={hoveredId === n.id}
                isNew={newIds.has(n.id)}
              />
            </g>
          ))}
        </g>

        {/* Tooltip */}
        {tooltip && transform.k > 0.4 && (
          <g transform={`translate(${tooltip.x}, ${tooltip.y})`} style={{ pointerEvents: 'none' }}>
            <rect
              x={-100} y={-22} width={200} height={24}
              rx={6} fill="rgba(60,45,30,0.85)"
            />
            <text
              textAnchor="middle" y={-5}
              fontSize={11} fill="#F5ECD8"
              fontFamily="DM Sans, system-ui, sans-serif"
            >
              {tooltip.label.slice(0, 45)}
            </text>
          </g>
        )}
      </g>

      {/* Zoom hint */}
      <text
        x={20} y={30}
        fontSize={11} fill="rgba(100,80,50,0.35)"
        fontFamily="DM Sans, system-ui, sans-serif"
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        scroll to zoom · drag to pan
      </text>
    </svg>
  );
}
