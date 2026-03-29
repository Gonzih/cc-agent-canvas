import { useRef, useEffect, useState, useCallback } from 'react';
import type { OrbNode, Job } from './types';
import type { ClusterCenter } from './useCanvas';

interface CanvasProps {
  nodes: OrbNode[];
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  panToRepo: string | null;
  onPanComplete: () => void;
  newIds: Set<string>;
  clusterCenters: Record<string, ClusterCenter>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

// Status palette (canvas rendering uses these directly)
const FILL: Record<string, string> = {
  running:   '#7BB3D4',
  done:      '#7DC4A0',
  failed:    '#D47B7B',
  cancelled: '#B8A898',
  pending:   '#C4B8A8',
};

const GLOW_COLOR: Record<string, string> = {
  running:   'rgba(123,179,212,0.35)',
  done:      'rgba(125,196,160,0.25)',
  failed:    'rgba(212,123,123,0.25)',
  cancelled: 'rgba(184,168,152,0.12)',
  pending:   'rgba(196,184,168,0.15)',
};

function statusFill(s?: string): string {
  return FILL[s?.toLowerCase() ?? ''] ?? FILL.pending;
}

function statusGlowColor(s?: string): string {
  return GLOW_COLOR[s?.toLowerCase() ?? ''] ?? GLOW_COLOR.pending;
}

function getRepo(n: OrbNode): string {
  return (n.repo_url || n.repoUrl || '').split('/').pop() || 'unknown';
}

function getLinkPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2 + (ty - sy) * 0.3;
  const my = (sy + ty) / 2 - (tx - sx) * 0.3;
  return `M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const ORB_R = 18;

export function Canvas({
  nodes, jobs, selectedId, onSelect,
  panToRepo, onPanComplete, newIds, clusterCenters,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<Transform>(() => {
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const k = 0.7;
    return { x: vw / 2 - 1500 * k, y: vh / 2 - 1500 * k, k };
  });

  // Refs for RAF loop (avoid stale closures)
  const nodesRef = useRef<OrbNode[]>(nodes);
  const transformRef = useRef(transform);
  const clusterCentersRef = useRef(clusterCenters);
  const selectedIdRef = useRef(selectedId);
  const hoveredIdRef = useRef<string | null>(null);
  const bloomRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { transformRef.current = transform; }, [transform]);
  useEffect(() => { clusterCentersRef.current = clusterCenters; }, [clusterCenters]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Track bloom start times for new orbs
  useEffect(() => {
    const now = Date.now();
    for (const id of newIds) {
      if (!bloomRef.current.has(id)) bloomRef.current.set(id, now);
    }
  }, [newIds]);

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth - 220;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // RAF draw loop — draws cluster blobs + orbs + tooltip
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(draw); return; }

      const W = canvas.width;
      const H = canvas.height;
      const t = transformRef.current;
      const ns = nodesRef.current;
      const centers = clusterCentersRef.current;
      const hovId = hoveredIdRef.current;
      const selId = selectedIdRef.current;
      const now = Date.now();

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // 1. Cluster background blobs
      for (const [repo, center] of Object.entries(centers)) {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, 120, 100, 0, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${center.hue}, 30%, 75%, 0.06)`;
        ctx.fill();

        // Repo name label above blob
        ctx.font = '11px DM Sans, system-ui';
        ctx.fillStyle = 'rgba(100,80,60,0.45)';
        ctx.textAlign = 'center';
        ctx.fillText(repo.slice(0, 24), center.x, center.y - 115);
      }

      // 2. Orbs
      for (const node of ns) {
        const isRunning = node.status?.toLowerCase() === 'running';
        const isSelected = selId === node.id;
        const isHovered = hovId === node.id;

        const fill = statusFill(node.status);
        const glowColor = statusGlowColor(node.status);

        // Bloom scale for new orbs
        let scale = 1;
        const bStart = bloomRef.current.get(node.id);
        if (bStart !== undefined) {
          const elapsed = now - bStart;
          if (elapsed < 400) {
            scale = elapsed / 400;
          } else {
            bloomRef.current.delete(node.id);
          }
        }

        // Pulsing radius for running orbs
        const r = isRunning ? ORB_R + Math.sin(now / 600) * 2 : ORB_R;

        ctx.save();
        if (scale < 1) {
          ctx.translate(node.x, node.y);
          ctx.scale(scale, scale);
          ctx.translate(-node.x, -node.y);
        }

        // Glow — radial gradient from fill color to transparent
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 1.8);
        grd.addColorStop(0, fill);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Main orb fill
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Highlight shine (top-left)
        const shine = ctx.createRadialGradient(
          node.x - r * 0.35, node.y - r * 0.3, 0,
          node.x - r * 0.35, node.y - r * 0.3, r * 0.8
        );
        shine.addColorStop(0, 'rgba(255,255,255,0.45)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        // Selection / hover ring
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = fill;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Running orb pulse ring
        if (isRunning) {
          const pulseR = r * 1.8 + Math.sin(now / 500) * 5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Status dot (top-right corner)
        const dotX = node.x + r * 0.65;
        const dotY = node.y - r * 0.65;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250,246,238,0.9)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.restore();
      }

      // 3. Canvas tooltip for hovered node
      if (hovId && t.k > 0.4) {
        const hn = ns.find(n => n.id === hovId);
        if (hn) {
          const label = (hn.title || hn.task || hn.id).slice(0, 40);
          ctx.font = 'bold 11px DM Sans, system-ui';
          const tw = ctx.measureText(label).width;
          const pw = tw + 18;
          const ph = 24;
          const px = hn.x - pw / 2;
          const py = hn.y - ORB_R * 1.8 - ph - 6;

          drawRoundedRect(ctx, px, py, pw, ph, 5);
          ctx.fillStyle = 'rgba(245,240,232,0.92)';
          ctx.fill();

          ctx.fillStyle = '#3D2E1E';
          ctx.textAlign = 'center';
          ctx.fillText(label, hn.x, py + ph - 7);
        }
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []); // empty — uses refs only

  // Pan to repo
  useEffect(() => {
    if (!panToRepo || !nodes.length) return;
    const repoNodes = nodes.filter(n => getRepo(n) === panToRepo);
    if (!repoNodes.length) { onPanComplete(); return; }
    const cx = repoNodes.reduce((s, n) => s + n.x, 0) / repoNodes.length;
    const cy = repoNodes.reduce((s, n) => s + n.y, 0) / repoNodes.length;
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const targetK = 0.85;
    setTransform({ x: vw / 2 - cx * targetK, y: vh / 2 - cy * targetK, k: targetK });
    onPanComplete();
  }, [panToRepo, nodes, onPanComplete]);

  // Wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform(t => {
      const newK = Math.min(3, Math.max(0.1, t.k * factor));
      const canvas = canvasRef.current;
      if (!canvas) return t;
      const rect = canvas.getBoundingClientRect();
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Interaction state
  const dragging = useRef(false);
  const didPan = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastTouchDist = useRef<number | null>(null);

  // Convert screen coords → world coords
  const screenToWorld = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  };

  // Find node near world point
  const findNode = (wx: number, wy: number, radius: number): OrbNode | null => {
    let closest: OrbNode | null = null;
    let minDist = radius;
    for (const node of nodesRef.current) {
      const d = Math.sqrt((node.x - wx) ** 2 + (node.y - wy) ** 2);
      if (d < minDist) { minDist = d; closest = node; }
    }
    return closest;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    didPan.current = false;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.style.cursor = 'grabbing';
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;

    if (dragging.current) {
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy }));
      return;
    }

    // Hover detection
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY, canvas);
    const found = findNode(wx, wy, 30);
    const newId = found?.id ?? null;
    if (newId !== hoveredIdRef.current) {
      hoveredIdRef.current = newId;
      canvas.style.cursor = newId ? 'pointer' : 'grab';
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    e.currentTarget.style.cursor = hoveredIdRef.current ? 'pointer' : 'grab';
  };

  const onMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragging.current = false;
    hoveredIdRef.current = null;
    e.currentTarget.style.cursor = 'grab';
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (didPan.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY, canvas);
    const found = findNode(wx, wy, 22);
    if (found) {
      onSelect(found.id === selectedIdRef.current ? null : found.id);
    } else {
      onSelect(null);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      dragging.current = true;
      didPan.current = false;
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
      setTransform(t => ({ ...t, k: Math.min(3, Math.max(0.1, t.k * factor)) }));
    }
  };

  const onTouchEnd = () => {
    dragging.current = false;
    lastTouchDist.current = null;
  };

  // Build dependency links for SVG overlay — use dependsOn array with resumedFrom fallback
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const links: { sourceId: string; targetId: string }[] = [];
  jobs.forEach(j => {
    const parents = j.dependsOn?.length
      ? j.dependsOn
      : j.depends_on ? [j.depends_on] : [];
    parents.forEach(parentId => {
      if (nodeMap.has(parentId) && nodeMap.has(j.id)) {
        links.push({ sourceId: parentId, targetId: j.id });
      }
    });
  });

  return (
    <div style={{
      position: 'fixed',
      left: 220, top: 0,
      width: 'calc(100vw - 220px)',
      height: '100vh',
      overflow: 'hidden',
    }}>
      {/* Main canvas — orbs, blobs, tooltip */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', inset: 0,
          background: '#F5F0E8',
          cursor: 'grab',
          userSelect: 'none',
          display: 'block',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* SVG overlay — dependency curves only, pointer-events disabled */}
      <svg
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(100,80,60,0.3)" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          {links.map(l => {
            const src = nodeMap.get(l.sourceId);
            const tgt = nodeMap.get(l.targetId);
            if (!src || !tgt) return null;
            return (
              <path
                key={`${l.sourceId}-${l.targetId}`}
                d={getLinkPath(src.x, src.y, tgt.x, tgt.y)}
                fill="none"
                stroke="rgba(100,80,60,0.22)"
                strokeWidth={1.2}
                markerEnd="url(#arrow)"
              />
            );
          })}
        </g>
      </svg>

      {/* Zoom hint */}
      <div style={{
        position: 'absolute', left: 20, top: 16,
        fontSize: 11, color: 'rgba(100,80,50,0.35)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        scroll to zoom · drag to pan
      </div>
    </div>
  );
}
