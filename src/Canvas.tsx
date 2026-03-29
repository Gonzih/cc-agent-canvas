import { useRef, useEffect, useCallback, useState } from 'react';
import * as d3 from 'd3';
import type { CanvasNode, HubNode, JobNode, SimLink } from './useCanvas';
import { HUB_COLORS, getRepoColorIndex } from './colors';

interface CanvasProps {
  nodes: CanvasNode[];
  links: SimLink[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  panToRepo: string | null;
  onPanComplete: () => void;
  newIds: Set<string>;
  activeFilters: Set<string> | null;
  onFiltersChange: (filters: Set<string>) => void;
  availableStatuses: Map<string, number>;
  simRef: React.MutableRefObject<d3.Simulation<CanvasNode, SimLink> | null>;
  blackHoleStrengthRef: React.MutableRefObject<number>;
  sunFieldRef: React.MutableRefObject<number>;
  planetFieldRef: React.MutableRefObject<number>;
  hoveredRepo: string | null;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const STATUS_FILL: Record<string, string> = {
  running:          '#7BB3D4',
  done:             '#7DC4A0',
  failed:           '#D47B7B',
  cancelled:        '#B8A898',
  pending:          '#C4B8A8',
  pending_approval: '#D4B87B',
  interrupted:      '#C4A0B8',
};

const STATUS_GLOW: Record<string, string> = {
  running:          'rgba(123,179,212,0.35)',
  done:             'rgba(125,196,160,0.25)',
  failed:           'rgba(212,123,123,0.25)',
  cancelled:        'rgba(184,168,152,0.12)',
  pending:          'rgba(196,184,168,0.15)',
  pending_approval: 'rgba(212,184,123,0.20)',
  interrupted:      'rgba(196,160,184,0.18)',
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

// Constants used for hit detection (interaction) — always full size
const HUB_R = 40;
const JOB_R = 16;

function computeFitTransform(ns: CanvasNode[], padding = 80): Transform | null {
  if (!ns.length) return null;
  const xs = ns.map(n => n.x ?? 0);
  const ys = ns.map(n => n.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cw = window.innerWidth - 220;
  const ch = window.innerHeight;
  const scaleX = cw / (maxX - minX + padding * 2);
  const scaleY = ch / (maxY - minY + padding * 2);
  const scale = Math.min(scaleX, scaleY, 1.2);
  const tx = (cw - (maxX + minX) * scale) / 2;
  const ty = (ch - (maxY + minY) * scale) / 2;
  return { x: tx, y: ty, k: scale };
}

export function Canvas({
  nodes, links, selectedId, onSelect,
  panToRepo, onPanComplete, newIds,
  activeFilters, onFiltersChange, availableStatuses, simRef,
  blackHoleStrengthRef, sunFieldRef, planetFieldRef, hoveredRepo,
}: CanvasProps) {
  const [displayBlackHole, setDisplayBlackHole] = useState(0.08);
  const [displaySunField, setDisplaySunField] = useState(2.0);
  const [displayPlanetField, setDisplayPlanetField] = useState(1.0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Transform stored purely in a ref — no React state needed since canvas draws via RAF
  const vw0 = window.innerWidth - 220;
  const vh0 = window.innerHeight;
  const k0 = 0.55;
  const transformRef = useRef<Transform>({ x: vw0 / 2 - 1500 * k0, y: vh0 / 2 - 1500 * k0, k: k0 });

  const nodesRef = useRef<CanvasNode[]>(nodes);
  const linksRef = useRef<SimLink[]>(links);
  const centeredRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredRepoRef = useRef<string | null>(hoveredRepo);
  const bloomRef = useRef<Map<string, number>>(new Map());

  // Dynamic zoom tracking
  const userInteractedRef = useRef(false);
  const lastBBoxUpdateRef = useRef(0);
  const dynTargetRef = useRef<Transform | null>(null);

  // Filter version counter: increments on filter change to reset userInteracted
  const filterVersionRef = useRef(0);
  const prevFilterKeyRef = useRef('');

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { hoveredRepoRef.current = hoveredRepo; }, [hoveredRepo]);

  // Detect filter changes and reset userInteracted so dynamic zoom resumes
  const filterKey = activeFilters ? [...activeFilters].sort().join(',') : '__all__';
  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey;
      filterVersionRef.current++;
      userInteractedRef.current = false;
      lastBBoxUpdateRef.current = 0; // force immediate bbox update
      dynTargetRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

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
      const fit = computeFitTransform(nodesRef.current);
      if (fit) transformRef.current = fit;
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

      // --- Dynamic zoom tracking ---
      const simAlpha = simRef.current?.alpha() ?? 0;
      if (simAlpha > 0.01 && !userInteractedRef.current) {
        const now2 = Date.now();
        if (now2 - lastBBoxUpdateRef.current > 2000) {
          lastBBoxUpdateRef.current = now2;
          const fit = computeFitTransform(nodesRef.current);
          if (fit) dynTargetRef.current = fit;
        }
        if (dynTargetRef.current) {
          const dt = dynTargetRef.current;
          const ct = transformRef.current;
          const lf = 0.04;
          transformRef.current = {
            x: ct.x + (dt.x - ct.x) * lf,
            y: ct.y + (dt.y - ct.y) * lf,
            k: ct.k + (dt.k - ct.k) * lf,
          };
        }
      } else if (simAlpha <= 0.01) {
        dynTargetRef.current = null;
      }

      const W = canvas.width;
      const H = canvas.height;
      const t = transformRef.current;
      const ns = nodesRef.current;
      const ls = linksRef.current;
      const hovId = hoveredIdRef.current;
      const selId = selectedIdRef.current;
      const hovRepo = hoveredRepoRef.current;
      const now = Date.now();

      // Lerp highlightAlpha on all nodes toward their target
      for (const n of ns) {
        const nodeRepo = n.type === 'hub' ? n.repo : n.repo;
        const target = hovRepo === null ? 1.0 : (nodeRepo === hovRepo ? 1.0 : 0.25);
        const cur = n.highlightAlpha ?? 1.0;
        n.highlightAlpha = cur + (target - cur) * 0.12;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // zoom-aware orb sizes
      const hubR = t.k < 0.3 ? 20 : 40;
      const jobR = t.k < 0.3 ? 6 : t.k < 0.6 ? 12 : 16;

      const hubs = ns.filter((n): n is HubNode => n.type === 'hub');
      const jobs = ns.filter((n): n is JobNode => n.type === 'job');

      // count visible job nodes per hub for spoke culling
      const hubJobCounts = new Map<string, number>();
      for (const jn of jobs) {
        const hubId = `hub:${jn.repo}`;
        hubJobCounts.set(hubId, (hubJobCounts.get(hubId) ?? 0) + 1);
      }

      // 0. Black hole — subtle warm glow at simulation center (1500, 1500)
      const SIM_CENTER = 1500;
      const bhGrd = ctx.createRadialGradient(SIM_CENTER, SIM_CENTER, 0, SIM_CENTER, SIM_CENTER, 40);
      bhGrd.addColorStop(0, 'rgba(100,80,60,0.12)');
      bhGrd.addColorStop(1, 'rgba(100,80,60,0)');
      ctx.fillStyle = bhGrd;
      ctx.beginPath();
      ctx.arc(SIM_CENTER, SIM_CENTER, 40, 0, Math.PI * 2);
      ctx.fill();

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
      for (const link of ls) {
        if (link.linkType !== 'hub-spoke') continue;
        const src = link.source as CanvasNode;
        const tgt = link.target as CanvasNode;
        const sx = src.x ?? 0;
        const sy = src.y ?? 0;
        const tx2 = tgt.x ?? 0;
        const ty2 = tgt.y ?? 0;

        const hub = (tgt.type === 'hub' ? tgt : src) as HubNode;

        if ((hubJobCounts.get(hub.id) ?? 0) > 30) continue;
        const hubColor = HUB_COLORS[hub.colorIndex];
        const spokeAlpha = hub.highlightAlpha ?? 1.0;

        const dx = tx2 - sx;
        const dy = ty2 - sy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const jobNode = (src.type === 'job' ? src : tgt) as JobNode;
        const wobble = Math.sin(now / 2000 + (jobNode.x ?? 0) * 0.01) * 12;
        const mx = (sx + tx2) / 2 + px * wobble;
        const my = (sy + ty2) / 2 + py * wobble;

        ctx.globalAlpha = spokeAlpha;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, tx2, ty2);
        ctx.strokeStyle = hubColor.fill + '2e';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 3. Dependency curves between job nodes
      for (const link of ls) {
        if (link.linkType !== 'dep') continue;
        const src = link.source as CanvasNode;
        const tgt = link.target as CanvasNode;
        const sx = src.x ?? 0;
        const sy = src.y ?? 0;
        const tx2 = tgt.x ?? 0;
        const ty2 = tgt.y ?? 0;
        const mx = (sx + tx2) / 2 + (ty2 - sy) * 0.3;
        const my = (sy + ty2) / 2 - (tx2 - sx) * 0.3;

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, tx2, ty2);
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
        const isRepoHovered = hovRepo === hub.repo;
        const alpha = hub.highlightAlpha ?? 1.0;

        ctx.globalAlpha = alpha;

        // Extra outer glow ring when this repo is hovered from sidebar
        if (isRepoHovered) {
          ctx.shadowColor = color.fill;
          ctx.shadowBlur = 30;
        }

        const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, hubR * 2.2);
        grd.addColorStop(0, color.fill + 'aa');
        grd.addColorStop(0.5, color.glow);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hx, hy, hubR * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Extra glow ring at 1.6x radius for repo hover
        if (isRepoHovered) {
          const outerGrd = ctx.createRadialGradient(hx, hy, hubR, hx, hy, hubR * 1.6);
          outerGrd.addColorStop(0, color.fill + '55');
          outerGrd.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(hx, hy, hubR * 1.6, 0, Math.PI * 2);
          ctx.fillStyle = outerGrd;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(hx, hy, hubR, 0, Math.PI * 2);
        ctx.fillStyle = color.fill;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        const shine = ctx.createRadialGradient(hx - hubR * 0.3, hy - hubR * 0.3, 0, hx - hubR * 0.3, hy - hubR * 0.3, hubR * 0.8);
        shine.addColorStop(0, 'rgba(255,255,255,0.55)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hx, hy, hubR, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        ctx.font = `bold ${hubR * 0.8}px DM Sans, system-ui`;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hub.label[0]?.toUpperCase() ?? '?', hx, hy + 1);
        ctx.textBaseline = 'alphabetic';

        ctx.font = '12px DM Sans, system-ui';
        ctx.fillStyle = 'rgba(80,60,40,0.65)';
        ctx.textAlign = 'center';
        ctx.fillText(hub.label.slice(0, 22), hx, hy + hubR + 16);

        ctx.font = '9px system-ui';
        ctx.fillStyle = 'rgba(80,60,40,0.5)';
        ctx.fillText(`${hub.totalCount} jobs`, hx, hy + hubR + 30);

        if (isHovered || isSelected || isRepoHovered) {
          ctx.beginPath();
          ctx.arc(hx, hy, hubR + 6, 0, Math.PI * 2);
          ctx.strokeStyle = color.fill;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.globalAlpha = alpha * 0.7;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
      }

      // 5. Job orbs
      for (const jn of jobs) {
        const jx = jn.x ?? 0;
        const jy = jn.y ?? 0;
        const wobbleX = Math.sin(now / 900 + jx * 0.05) * 4;
        const wobbleY = Math.cos(now / 1100 + jy * 0.05) * 4;
        const rx = jx + wobbleX;
        const ry = jy + wobbleY;
        const status = jn.job.status;
        const isRunning = status?.toLowerCase() === 'running';
        const isSelected = selId === jn.id;
        const isHovered = hovId === jn.id;
        const isRepoHovered = hovRepo === jn.repo;
        const alpha = jn.highlightAlpha ?? 1.0;

        const fill = statusFill(status);
        const glowColor = statusGlowColor(status);

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

        const r = isRunning ? jobR + Math.sin(now / 600) * 2 : jobR;

        ctx.save();
        ctx.globalAlpha = alpha;

        if (scale < 1) {
          ctx.translate(rx, ry);
          ctx.scale(scale, scale);
          ctx.translate(-rx, -ry);
        }

        if (isRepoHovered) {
          ctx.shadowColor = HUB_COLORS[getRepoColorIndex(jn.repo)].fill;
          ctx.shadowBlur = 18;
        }

        const grd = ctx.createRadialGradient(rx, ry, 0, rx, ry, r * 1.8);
        grd.addColorStop(0, fill);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(rx, ry, r * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        // Full opacity fill when repo hovered
        ctx.fillStyle = isRepoHovered ? fill : fill;
        ctx.globalAlpha = isRepoHovered ? alpha : alpha;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        const shine = ctx.createRadialGradient(rx - r * 0.35, ry - r * 0.3, 0, rx - r * 0.35, ry - r * 0.3, r * 0.8);
        shine.addColorStop(0, 'rgba(255,255,255,0.45)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(rx, ry, r, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(rx, ry, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = fill;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.globalAlpha = alpha * 0.7;
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }

        // Thin colored ring for repo-hovered orbs
        if (isRepoHovered) {
          ctx.beginPath();
          ctx.arc(rx, ry, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = HUB_COLORS[getRepoColorIndex(jn.repo)].fill;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = alpha * 0.8;
          ctx.stroke();
          ctx.globalAlpha = alpha;
        }

        if (isRunning) {
          const pulseR = r * 1.8 + Math.sin(now / 500) * 5;
          ctx.beginPath();
          ctx.arc(rx, ry, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = glowColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

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
          const orbR = hn.type === 'hub' ? hubR : jobR;

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
      const repoJobs = nodesRef.current.filter(n => n.type === 'job' && (n as JobNode).repo === panToRepo) as JobNode[];
      if (!repoJobs.length) { onPanComplete(); return; }
      const cx = repoJobs.reduce((s, n) => s + (n.x ?? 0), 0) / repoJobs.length;
      const cy = repoJobs.reduce((s, n) => s + (n.y ?? 0), 0) / repoJobs.length;
      const vw = window.innerWidth - 220;
      const vh = window.innerHeight;
      const targetK = 1.2;
      userInteractedRef.current = true;
      transformRef.current = { x: vw / 2 - cx * targetK, y: vh / 2 - cy * targetK, k: targetK };
      onPanComplete();
      return;
    }
    const hx = hub.x ?? 1500;
    const hy = hub.y ?? 1500;
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const targetK = 1.4;
    userInteractedRef.current = true;
    transformRef.current = { x: vw / 2 - hx * targetK, y: vh / 2 - hy * targetK, k: targetK };
    onPanComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panToRepo]);

  // Wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    userInteractedRef.current = true;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const t = transformRef.current;
    const newK = Math.min(4, Math.max(0.1, t.k * factor));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    transformRef.current = { k: newK, x: cx - (cx - t.x) * (newK / t.k), y: cy - (cy - t.y) * (newK / t.k) };
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
    for (const n of nodesRef.current) {
      if (n.type !== 'hub') continue;
      const r = HUB_R + 8;
      if (Math.sqrt(((n.x ?? 0) - wx) ** 2 + ((n.y ?? 0) - wy) ** 2) < r) return n;
    }
    let closest: CanvasNode | null = null;
    let minDist = JOB_R + 10;
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
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didPan.current = true;
        userInteractedRef.current = true;
      }
      lastPos.current = { x: e.clientX, y: e.clientY };
      const t = transformRef.current;
      transformRef.current = { ...t, x: t.x + dx, y: t.y + dy };
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
        const hx = found.x ?? 1500;
        const hy = found.y ?? 1500;
        const vw = window.innerWidth - 220;
        const vh = window.innerHeight;
        const targetK = 1.4;
        userInteractedRef.current = true;
        transformRef.current = { x: vw / 2 - hx * targetK, y: vh / 2 - hy * targetK, k: targetK };
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
      userInteractedRef.current = true;
      const t = transformRef.current;
      transformRef.current = { ...t, x: t.x + dx, y: t.y + dy };
    } else if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const factor = newDist / lastTouchDist.current;
      lastTouchDist.current = newDist;
      userInteractedRef.current = true;
      const t = transformRef.current;
      transformRef.current = { ...t, k: Math.min(4, Math.max(0.1, t.k * factor)) };
    }
  };

  const onTouchEnd = () => {
    dragging.current = false;
    lastTouchDist.current = null;
  };

  // Determine active filter set for pill rendering
  const allStatusKeys = [...availableStatuses.keys()];
  const effectiveActiveSet: Set<string> = activeFilters ?? new Set(allStatusKeys);

  const handlePillClick = (status: string) => {
    const current = activeFilters ?? new Set(allStatusKeys);
    const next = new Set(current);
    if (next.has(status)) {
      next.delete(status);
      // Don't allow deselecting all — keep at least one
      if (next.size === 0) return;
    } else {
      next.add(status);
    }
    // If all are selected again, normalize back to null (all)
    if (next.size === allStatusKeys.length) {
      onFiltersChange(next); // pass the full set — App normalizes to null? No, let's just pass it
    }
    onFiltersChange(next);
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

      {/* Status filter pills — top-left overlay (always shown) */}
      <div style={{
        position: 'absolute', left: 16, top: 16,
        display: 'flex', flexWrap: 'wrap', gap: 6,
        pointerEvents: 'auto',
        zIndex: 10,
      }}>
        {[...availableStatuses.entries()].map(([status, count]) => {
          const isActive = effectiveActiveSet.has(status);
          const isEmpty = count === 0;
          const color = STATUS_FILL[status] ?? STATUS_FILL.pending;
          return (
            <button
              key={status}
              onClick={() => handlePillClick(status)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px',
                borderRadius: 999,
                border: isActive && !isEmpty ? `1.5px solid ${color}` : '1.5px solid transparent',
                background: '#EDE8DF',
                cursor: 'pointer',
                fontFamily: 'DM Sans, system-ui, sans-serif',
                fontSize: 12,
                color: isActive && !isEmpty ? '#3D2E1E' : 'rgba(100,80,50,0.35)',
                opacity: isEmpty ? 0.35 : isActive ? 1 : 0.55,
                transition: 'opacity 0.15s, border-color 0.15s, color 0.15s',
                outline: 'none',
                boxShadow: isActive && !isEmpty ? `0 0 0 2px ${color}22` : 'none',
                userSelect: 'none',
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: color,
                display: 'inline-block',
                flexShrink: 0,
                opacity: isEmpty ? 0.25 : isActive ? 1 : 0.4,
              }} />
              <span>{status}</span>
              <span style={{
                marginLeft: 2,
                fontSize: 10,
                color: isEmpty ? 'rgba(100,80,50,0.2)' : isActive ? 'rgba(80,60,40,0.5)' : 'rgba(100,80,50,0.25)',
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Zoom hint — below filter pills */}
      <div style={{
        position: 'absolute', left: 20,
        top: 52,
        fontSize: 11, color: 'rgba(100,80,50,0.35)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        scroll to zoom · drag to pan · click hub to focus
      </div>

      {/* Physics sliders — bottom right */}
      <div style={{
        position: 'absolute', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 6,
        fontSize: 11, color: 'rgba(80,60,40,0.5)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        pointerEvents: 'auto',
        zIndex: 10,
        userSelect: 'none',
      }}>
        {/* Black hole pull */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 72, textAlign: 'right' }}>black hole</span>
          <input
            type="range"
            min={0.01}
            max={2.0}
            step={0.01}
            value={displayBlackHole}
            onChange={e => {
              const val = parseFloat(e.target.value);
              blackHoleStrengthRef.current = val;
              setDisplayBlackHole(val);
              if (simRef.current) simRef.current.alpha(0.3).restart();
            }}
            style={{ width: 100, accentColor: 'rgba(80,60,40,0.4)', cursor: 'pointer' }}
          />
          <span style={{ width: 38 }}>{displayBlackHole.toFixed(2)}x</span>
        </div>
        {/* Sun field */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 72, textAlign: 'right' }}>sun field</span>
          <input
            type="range"
            min={0.5}
            max={100}
            step={0.5}
            value={displaySunField}
            onChange={e => {
              const val = parseFloat(e.target.value);
              sunFieldRef.current = val;
              setDisplaySunField(val);
              if (simRef.current) simRef.current.alpha(0.3).restart();
            }}
            style={{ width: 100, accentColor: 'rgba(80,60,40,0.4)', cursor: 'pointer' }}
          />
          <span style={{ width: 38 }}>{displaySunField.toFixed(1)}x</span>
        </div>
        {/* Planet field */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 72, textAlign: 'right' }}>planet field</span>
          <input
            type="range"
            min={0.5}
            max={50}
            step={0.5}
            value={displayPlanetField}
            onChange={e => {
              const val = parseFloat(e.target.value);
              planetFieldRef.current = val;
              setDisplayPlanetField(val);
              if (simRef.current) simRef.current.alpha(0.3).restart();
            }}
            style={{ width: 100, accentColor: 'rgba(80,60,40,0.4)', cursor: 'pointer' }}
          />
          <span style={{ width: 38 }}>{displayPlanetField.toFixed(1)}x</span>
        </div>
      </div>
    </div>
  );
}
