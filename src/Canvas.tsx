import { useRef, useEffect, useState, useCallback } from 'react';
import type { CanvasNode, HubNode, JobNode, SimLink } from './useCanvas';
import { HUB_COLORS } from './colors';

interface CanvasProps {
  nodes: CanvasNode[];
  links: SimLink[];
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

const STATUS_FILL: Record<string, string> = {
  running:   '#7BB3D4',
  done:      '#7DC4A0',
  failed:    '#D47B7B',
  cancelled: '#B8A898',
  pending:   '#C4B8A8',
};

const STATUS_GLOW: Record<string, string> = {
  running:   'rgba(123,179,212,0.35)',
  done:      'rgba(125,196,160,0.25)',
  failed:    'rgba(212,123,123,0.25)',
  cancelled: 'rgba(184,168,152,0.12)',
  pending:   'rgba(196,184,168,0.15)',
};

function statusFill(s?: string): string {
  return STATUS_FILL[s?.toLowerCase() ?? ''] ?? STATUS_FILL.pending;
}

function statusGlowColor(s?: string): string {
  return STATUS_GLOW[s?.toLowerCase() ?? ''] ?? STATUS_GLOW.pending;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

const HUB_R_BASE = 40;
const JOB_R_BASE = 16;

export function Canvas({
  nodes, links, selectedId, onSelect,
  panToRepo, onPanComplete, newIds,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<Transform>(() => {
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const k = 0.55;
    return { x: vw / 2 - 1500 * k, y: vh / 2 - 1500 * k, k };
  });

  const nodesRef = useRef<CanvasNode[]>(nodes);
  const linksRef = useRef<SimLink[]>(links);
  const centeredRef = useRef(false);
  const transformRef = useRef(transform);
  const orbSizesRef = useRef({ hubR: HUB_R_BASE, jobR: JOB_R_BASE });
  const selectedIdRef = useRef(selectedId);
  const hoveredIdRef = useRef<string | null>(null);
  const bloomRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { transformRef.current = transform; }, [transform]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Track bloom start times for new job orbs
  useEffect(() => {
    const now = Date.now();
    for (const id of newIds) {
      if (!bloomRef.current.has(id)) bloomRef.current.set(id, now);
    }
  }, [newIds]);

  // Auto-center viewport once after simulation stabilizes (~300 ticks ≈ 2s)
  useEffect(() => {
    if (centeredRef.current) return;
    if (!nodes.length) return;
    const hasPositions = nodes.every(n => n.x !== undefined && n.y !== undefined);
    if (!hasPositions) return;

    const timer = setTimeout(() => {
      if (centeredRef.current) return;
      centeredRef.current = true;
      const ns = nodesRef.current;
      if (!ns.length) return;
      const xs = ns.map(n => n.x ?? 0);
      const ys = ns.map(n => n.y ?? 0);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const padding = 80;
      const cw = window.innerWidth - 220;
      const ch = window.innerHeight;
      const scaleX = cw / (maxX - minX + padding * 2);
      const scaleY = ch / (maxY - minY + padding * 2);
      const scale = Math.min(scaleX, scaleY, 1.2);
      const tx = (cw - (maxX + minX) * scale) / 2;
      const ty = (ch - (maxY + minY) * scale) / 2;
      setTransform({ x: tx, y: ty, k: scale });
    }, 2000);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length > 0]);

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

  // RAF draw loop
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
      const ls = linksRef.current;
      const hovId = hoveredIdRef.current;
      const selId = selectedIdRef.current;
      const now = Date.now();

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Zoom-aware orb sizes
      const HUB_R = t.k < 0.3 ? 20 : HUB_R_BASE;
      const JOB_R = t.k < 0.3 ? 6 : t.k < 0.6 ? 12 : JOB_R_BASE;
      orbSizesRef.current = { hubR: HUB_R, jobR: JOB_R };

      const hubs = ns.filter((n): n is HubNode => n.type === 'hub');
      const jobs = ns.filter((n): n is JobNode => n.type === 'job');

      // Count visible job nodes per repo (for spoke threshold)
      const visibleCountByRepo = new Map<string, number>();
      for (const jn of jobs) {
        visibleCountByRepo.set(jn.repo, (visibleCountByRepo.get(jn.repo) ?? 0) + 1);
      }

      // 1. Hub glow blobs (large radial gradient, very low opacity)
      for (const hub of hubs) {
        const hx = hub.x ?? 0;
        const hy = hub.y ?? 0;
        const color = HUB_COLORS[hub.colorIndex];
        const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, 160);
        grd.addColorStop(0, color.glow.replace('0.4)', '0.08)'));
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hx, hy, 160, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // 2. Spoke lines (hub → job) with gentle sinusoidal wobble
      // Skip spokes for repos with >30 visible nodes — force clustering is visually obvious
      for (const link of ls) {
        if (link.linkType !== 'hub-spoke') continue;
        const src = link.source as CanvasNode;
        const tgt = link.target as CanvasNode;
        const hub = (tgt.type === 'hub' ? tgt : src) as HubNode;
        if ((visibleCountByRepo.get(hub.repo) ?? 0) > 30) continue;
        const sx = src.x ?? 0;
        const sy = src.y ?? 0;
        const tx = tgt.x ?? 0;
        const ty = tgt.y ?? 0;

        // Hub is target, job is source — get the hub's color
        const hubColor = HUB_COLORS[hub.colorIndex];

        // Perpendicular wobble
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const jobNode = (src.type === 'job' ? src : tgt) as JobNode;
        const wobble = Math.sin(now / 2000 + (jobNode.x ?? 0) * 0.01) * 12;
        const mx = (sx + tx) / 2 + px * wobble;
        const my = (sy + ty) / 2 + py * wobble;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, tx, ty);
        ctx.strokeStyle = hubColor.fill + '2e'; // ~18% opacity
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 3. Dependency curves between job nodes
      for (const link of ls) {
        if (link.linkType !== 'dep') continue;
        const src = link.source as CanvasNode;
        const tgt = link.target as CanvasNode;
        const sx = src.x ?? 0;
        const sy = src.y ?? 0;
        const tx = tgt.x ?? 0;
        const ty = tgt.y ?? 0;
        const mx = (sx + tx) / 2 + (ty - sy) * 0.3;
        const my = (sy + ty) / 2 - (tx - sx) * 0.3;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, tx, ty);
        ctx.strokeStyle = 'rgba(100,80,60,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 4. Hub orbs (large, with initial letter + strong glow)
      for (const hub of hubs) {
        const hx = hub.x ?? 0;
        const hy = hub.y ?? 0;
        const color = HUB_COLORS[hub.colorIndex];
        const isHovered = hovId === hub.id;
        const isSelected = selId === hub.id;

        // Hub glow
        const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, HUB_R * 2.2);
        grd.addColorStop(0, color.fill + 'aa');
        grd.addColorStop(0.5, color.glow);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hx, hy, HUB_R * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Hub fill
        ctx.beginPath();
        ctx.arc(hx, hy, HUB_R, 0, Math.PI * 2);
        ctx.fillStyle = color.fill;
        ctx.fill();

        // Hub shine
        const shine = ctx.createRadialGradient(hx - HUB_R * 0.3, hy - HUB_R * 0.3, 0, hx - HUB_R * 0.3, hy - HUB_R * 0.3, HUB_R * 0.8);
        shine.addColorStop(0, 'rgba(255,255,255,0.55)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hx, hy, HUB_R, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        // Hub initial letter
        ctx.font = `bold ${HUB_R * 0.8}px DM Sans, system-ui`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hub.label[0]?.toUpperCase() ?? '?', hx, hy + 1);
        ctx.textBaseline = 'alphabetic';

        // Repo name below hub
        ctx.font = '12px DM Sans, system-ui';
        ctx.fillStyle = 'rgba(80,60,40,0.65)';
        ctx.textAlign = 'center';
        ctx.fillText(hub.label.slice(0, 22), hx, hy + HUB_R + 16);

        // Total job count below repo name
        ctx.font = '9px system-ui';
        ctx.fillStyle = 'rgba(80,60,40,0.5)';
        ctx.fillText(`${hub.totalCount} jobs`, hx, hy + HUB_R + 29);

        // Hover/selection ring
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(hx, hy, HUB_R + 6, 0, Math.PI * 2);
          ctx.strokeStyle = color.fill;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // 5. Job orbs
      for (const jn of jobs) {
        const jx = jn.x ?? 0;
        const jy = jn.y ?? 0;
        // Render offset wobble — independent per-planet using x/y as phase seeds
        const wobbleX = Math.sin(now / 900 + jx * 0.05) * 4;
        const wobbleY = Math.cos(now / 1100 + jy * 0.05) * 4;
        const rx = jx + wobbleX;
        const ry = jy + wobbleY;
        const status = jn.job.status;
        const isRunning = status?.toLowerCase() === 'running';
        const isSelected = selId === jn.id;
        const isHovered = hovId === jn.id;

        const fill = statusFill(status);
        const glowColor = statusGlowColor(status);

        // Bloom scale for new orbs
        let scale = 1;
        const bStart = bloomRef.current.get(jn.id);
        if (bStart !== undefined) {
          const elapsed = now - bStart;
          if (elapsed < 400) {
            scale = elapsed / 400;
          } else {
            bloomRef.current.delete(jn.id);
          }
        }

        // Pulsing radius for running orbs
        const r = isRunning ? JOB_R + Math.sin(now / 600) * 2 : JOB_R;

        ctx.save();
        if (scale < 1) {
          ctx.translate(rx, ry);
          ctx.scale(scale, scale);
          ctx.translate(-rx, -ry);
        }

        // Job glow
        const grd = ctx.createRadialGradient(rx, ry, 0, rx, ry, r * 1.8);
        grd.addColorStop(0, fill);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(rx, ry, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Job fill
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Job shine
        const shine = ctx.createRadialGradient(rx - r * 0.35, ry - r * 0.3, 0, rx - r * 0.35, ry - r * 0.3, r * 0.8);
        shine.addColorStop(0, 'rgba(255,255,255,0.45)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        // Selection / hover ring
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(rx, ry, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = fill;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Running pulse ring
        if (isRunning) {
          const pulseR = r * 1.8 + Math.sin(now / 500) * 5;
          ctx.beginPath();
          ctx.arc(rx, ry, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Status dot (top-right)
        const dotX = rx + r * 0.65;
        const dotY = ry - r * 0.65;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250,246,238,0.9)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.restore();
      }

      // 6. Tooltip for hovered node
      if (hovId && t.k > 0.3) {
        const hn = ns.find(n => n.id === hovId);
        if (hn) {
          let label = '';
          if (hn.type === 'job') {
            const j = hn.job;
            label = (j.title || j.task || j.id).replace(/^#+\s*/, '').split('\n')[0].trim().slice(0, 40);
          } else {
            label = hn.label;
          }
          const hx = hn.x ?? 0;
          const hy = hn.y ?? 0;
          const orbR = hn.type === 'hub' ? HUB_R : JOB_R; // HUB_R/JOB_R are in scope here

          ctx.font = 'bold 11px DM Sans, system-ui';
          const tw = ctx.measureText(label).width;
          const pw = tw + 18;
          const ph = 24;
          const px = hx - pw / 2;
          const py = hy - orbR * 1.8 - ph - 8;

          drawRoundedRect(ctx, px, py, pw, ph, 5);
          ctx.fillStyle = 'rgba(245,240,232,0.95)';
          ctx.fill();

          ctx.fillStyle = '#3D2E1E';
          ctx.textAlign = 'center';
          ctx.fillText(label, hx, py + ph - 7);
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

  // Pan to repo hub: zoom in so hub fills ~1/4 of screen
  useEffect(() => {
    if (!panToRepo) return;
    const hub = nodesRef.current.find(n => n.type === 'hub' && n.id === `hub:${panToRepo}`) as HubNode | undefined;
    if (!hub) {
      // Fall back to job cluster centroid
      const repoJobs = nodesRef.current.filter(n => n.type === 'job' && (n as JobNode).repo === panToRepo) as JobNode[];
      if (!repoJobs.length) { onPanComplete(); return; }
      const cx = repoJobs.reduce((s, n) => s + (n.x ?? 0), 0) / repoJobs.length;
      const cy = repoJobs.reduce((s, n) => s + (n.y ?? 0), 0) / repoJobs.length;
      const vw = window.innerWidth - 220;
      const vh = window.innerHeight;
      const targetK = 1.2;
      setTransform({ x: vw / 2 - cx * targetK, y: vh / 2 - cy * targetK, k: targetK });
      onPanComplete();
      return;
    }
    const hx = hub.x ?? 1500;
    const hy = hub.y ?? 1500;
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const targetK = 1.4; // hub fills ~1/4 screen
    setTransform({ x: vw / 2 - hx * targetK, y: vh / 2 - hy * targetK, k: targetK });
    onPanComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panToRepo]);

  // Wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform(t => {
      const newK = Math.min(4, Math.max(0.1, t.k * factor));
      const canvas = canvasRef.current;
      if (!canvas) return t;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return { k: newK, x: cx - (cx - t.x) * (newK / t.k), y: cy - (cy - t.y) * (newK / t.k) };
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

  const screenToWorld = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return { x: (clientX - rect.left - t.x) / t.k, y: (clientY - rect.top - t.y) / t.k };
  };

  const findNode = (wx: number, wy: number): CanvasNode | null => {
    const { hubR, jobR } = orbSizesRef.current;
    // Check hubs first (larger hit area)
    for (const n of nodesRef.current) {
      if (n.type !== 'hub') continue;
      const r = hubR + 8;
      if (Math.sqrt(((n.x ?? 0) - wx) ** 2 + ((n.y ?? 0) - wy) ** 2) < r) return n;
    }
    // Then jobs
    let closest: CanvasNode | null = null;
    let minDist = jobR + 10;
    for (const n of nodesRef.current) {
      if (n.type !== 'job') continue;
      const d = Math.sqrt(((n.x ?? 0) - wx) ** 2 + ((n.y ?? 0) - wy) ** 2);
      if (d < minDist) { minDist = d; closest = n; }
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

    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY, canvas);
    const found = findNode(wx, wy);
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
    const found = findNode(wx, wy);
    if (found) {
      if (found.type === 'job') {
        onSelect(found.id === selectedIdRef.current ? null : found.id);
      } else {
        // Hub clicked — zoom to it
        const hx = found.x ?? 1500;
        const hy = found.y ?? 1500;
        const vw = window.innerWidth - 220;
        const vh = window.innerHeight;
        const targetK = 1.4;
        setTransform({ x: vw / 2 - hx * targetK, y: vh / 2 - hy * targetK, k: targetK });
      }
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
      setTransform(t => ({ ...t, k: Math.min(4, Math.max(0.1, t.k * factor)) }));
    }
  };

  const onTouchEnd = () => {
    dragging.current = false;
    lastTouchDist.current = null;
  };

  return (
    <div style={{
      position: 'fixed',
      left: 220, top: 0,
      width: 'calc(100vw - 220px)',
      height: '100vh',
      overflow: 'hidden',
    }}>
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

      {/* Zoom hint */}
      <div style={{
        position: 'absolute', left: 20, top: 16,
        fontSize: 11, color: 'rgba(100,80,50,0.35)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        scroll to zoom · drag to pan · click hub to focus
      </div>
    </div>
  );
}
