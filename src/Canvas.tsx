import { useRef, useEffect, useState, useCallback } from 'react';
import type { CanvasNode, HubNode, JobNode } from './types';
import { getHubColorByIdx, getStatusStyle } from './colors';

interface CanvasProps {
  nodes: CanvasNode[];
  nodesRef: React.MutableRefObject<CanvasNode[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectRepo: (repo: string | null) => void;
  panToRepo: string | null;
  onPanComplete: () => void;
  newIds: Set<string>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const HUB_R = 40;
const JOB_R = 16;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

export function Canvas({
  nodes, nodesRef, selectedId, onSelect, onSelectRepo,
  panToRepo, onPanComplete, newIds,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<Transform>(() => {
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const k = 0.65;
    return { x: vw / 2 - 1500 * k, y: vh / 2 - 1500 * k, k };
  });

  const transformRef = useRef(transform);
  const selectedIdRef = useRef(selectedId);
  const hoveredIdRef = useRef<string | null>(null);
  const bloomRef = useRef<Map<string, number>>(new Map());

  useEffect(() => { transformRef.current = transform; }, [transform]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // Track bloom start times for new job orbs
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
      const selId = selectedIdRef.current;
      const hovId = hoveredIdRef.current;
      const now = Date.now();

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#F5F0E8';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Separate hubs and jobs
      const hubs: HubNode[] = [];
      const jobs: JobNode[] = [];
      for (const n of ns) {
        if (n.nodeType === 'hub') hubs.push(n as HubNode);
        else jobs.push(n as JobNode);
      }

      // Build job-by-repo map for spoke drawing
      const jobsByRepo = new Map<string, JobNode[]>();
      for (const jn of jobs) {
        if (!jobsByRepo.has(jn.repo)) jobsByRepo.set(jn.repo, []);
        jobsByRepo.get(jn.repo)!.push(jn);
      }
      // --- Layer 1: Hub glow blobs ---
      for (const hub of hubs) {
        const fill = getHubColorByIdx(hub.colorIdx).fill;
        const grd = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, 170);
        grd.addColorStop(0, hexToRgba(fill, 0.10));
        grd.addColorStop(0.5, hexToRgba(fill, 0.05));
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, 170, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }

      // --- Layer 2: Spoke lines (hub → job) with time wobble ---
      for (const hub of hubs) {
        const fill = getHubColorByIdx(hub.colorIdx).fill;
        const repoJobs = jobsByRepo.get(hub.repo) ?? [];
        for (const jn of repoJobs) {
          const wobble = Math.sin(now / 2200 + (jn.index ?? 0) * 0.8) * 7;
          const midX = (hub.x + jn.x) / 2 + (jn.y - hub.y) * 0.12 + wobble;
          const midY = (hub.y + jn.y) / 2 - (jn.x - hub.x) * 0.12 + wobble * 0.4;
          ctx.beginPath();
          ctx.moveTo(hub.x, hub.y);
          ctx.quadraticCurveTo(midX, midY, jn.x, jn.y);
          ctx.strokeStyle = hexToRgba(fill, 0.18);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // --- Layer 3: Dependency curves between jobs ---
      const jobById = new Map(jobs.map(jn => [jn.id, jn]));
      for (const jn of jobs) {
        const parents = jn.dependsOn?.length
          ? jn.dependsOn
          : jn.depends_on ? [jn.depends_on] : [];
        for (const pid of parents) {
          const src = jobById.get(pid);
          if (!src) continue;
          const mx = (src.x + jn.x) / 2 + (jn.y - src.y) * 0.3;
          const my = (src.y + jn.y) / 2 - (jn.x - src.x) * 0.3;
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.quadraticCurveTo(mx, my, jn.x, jn.y);
          ctx.strokeStyle = 'rgba(100,80,60,0.18)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // --- Layer 4: Job orbs ---
      for (const jn of jobs) {
        const isRunning = jn.status?.toLowerCase() === 'running';
        const isSelected = selId === jn.id;
        const isHovered = hovId === jn.id;
        const style = getStatusStyle(jn.status);

        // Bloom scale
        let scale = 1;
        const bStart = bloomRef.current.get(jn.id);
        if (bStart !== undefined) {
          const elapsed = now - bStart;
          if (elapsed < 450) {
            scale = elapsed / 450;
          } else {
            bloomRef.current.delete(jn.id);
          }
        }

        const r = isRunning ? JOB_R + Math.sin(now / 600) * 2 : JOB_R;

        ctx.save();
        if (scale < 1) {
          ctx.translate(jn.x, jn.y);
          ctx.scale(scale, scale);
          ctx.translate(-jn.x, -jn.y);
        }

        // Soft glow
        const grd = ctx.createRadialGradient(jn.x, jn.y, 0, jn.x, jn.y, r * 2.2);
        grd.addColorStop(0, style.glow);
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(jn.x, jn.y, r * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Main orb
        ctx.beginPath();
        ctx.arc(jn.x, jn.y, r, 0, Math.PI * 2);
        ctx.fillStyle = style.fill;
        ctx.fill();

        // Shine
        const shine = ctx.createRadialGradient(
          jn.x - r * 0.3, jn.y - r * 0.3, 0,
          jn.x - r * 0.3, jn.y - r * 0.3, r * 0.8
        );
        shine.addColorStop(0, 'rgba(255,255,255,0.4)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(jn.x, jn.y, r, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        // Selection/hover ring
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(jn.x, jn.y, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = style.fill;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Running pulse ring
        if (isRunning) {
          const pulseR = r * 1.9 + Math.sin(now / 500) * 6;
          ctx.beginPath();
          ctx.arc(jn.x, jn.y, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = style.glow;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.restore();
      }

      // --- Layer 5: Hub orbs ---
      for (const hub of hubs) {
        const fill = getHubColorByIdx(hub.colorIdx).fill;
        const isHovered = hovId === hub.id;

        // Large glow
        const grd = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, HUB_R * 2.5);
        grd.addColorStop(0, hexToRgba(fill, 0.45));
        grd.addColorStop(0.6, hexToRgba(fill, 0.15));
        grd.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, HUB_R * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Orb body
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, HUB_R, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        // Shine
        const shine = ctx.createRadialGradient(
          hub.x - HUB_R * 0.28, hub.y - HUB_R * 0.28, 0,
          hub.x - HUB_R * 0.28, hub.y - HUB_R * 0.28, HUB_R * 0.9
        );
        shine.addColorStop(0, 'rgba(255,255,255,0.5)');
        shine.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, HUB_R, 0, Math.PI * 2);
        ctx.fillStyle = shine;
        ctx.fill();

        // Hover ring
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(hub.x, hub.y, HUB_R + 6, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(fill, 0.6);
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Initial letter
        ctx.font = `bold 20px DM Sans, system-ui`;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hub.repo.charAt(0).toUpperCase(), hub.x, hub.y);
      }

      // --- Layer 6: Hub labels (always visible) ---
      for (const hub of hubs) {
        ctx.font = '11px DM Sans, system-ui';
        ctx.fillStyle = 'rgba(80,60,40,0.55)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(hub.repo.slice(0, 24), hub.x, hub.y + HUB_R + 8);
      }

      // --- Layer 7: Tooltip for hovered node ---
      if (hovId && t.k > 0.35) {
        const hn = ns.find(n => n.id === hovId);
        if (hn) {
          let label: string;
          if (hn.nodeType === 'hub') {
            label = hn.repo + ' (hub)';
          } else {
            const jn = hn as JobNode;
            label = (jn.title || jn.task || jn.id).replace(/^#+\s*/, '').slice(0, 44);
          }
          const nodeY = hn.nodeType === 'hub' ? hn.y - HUB_R : hn.y - JOB_R;
          ctx.font = 'bold 11px DM Sans, system-ui';
          const tw = ctx.measureText(label).width;
          const pw = tw + 18;
          const ph = 24;
          const px = hn.x - pw / 2;
          const py = nodeY - ph - 8;
          drawRoundedRect(ctx, px, py, pw, ph, 5);
          ctx.fillStyle = 'rgba(245,240,232,0.94)';
          ctx.fill();
          ctx.fillStyle = '#3D2E1E';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, hn.x, py + ph / 2);
        }
      }

      // Repo filter: dim jobs not in the selected hub's repo
      // (handled via selectedRepo logic in App, no extra canvas work needed)

      ctx.restore();
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []); // empty — uses refs only

  // Pan to repo hub
  useEffect(() => {
    if (!panToRepo) return;
    const hub = nodesRef.current.find(n => n.nodeType === 'hub' && (n as HubNode).repo === panToRepo);
    if (!hub) { onPanComplete(); return; }
    const vw = window.innerWidth - 220;
    const vh = window.innerHeight;
    const targetK = 1.4;
    setTransform({ x: vw / 2 - hub.x * targetK, y: vh / 2 - hub.y * targetK, k: targetK });
    onPanComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panToRepo, nodes]);

  // Wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setTransform(t => {
      const newK = Math.min(4, Math.max(0.08, t.k * factor));
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

  const dragging = useRef(false);
  const didPan = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastTouchDist = useRef<number | null>(null);

  const screenToWorld = (clientX: number, clientY: number, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    };
  };

  const findNode = (wx: number, wy: number): CanvasNode | null => {
    let closest: CanvasNode | null = null;
    let minDist = Infinity;
    for (const node of nodesRef.current) {
      const d = Math.sqrt((node.x - wx) ** 2 + (node.y - wy) ** 2);
      const hitR = node.nodeType === 'hub' ? HUB_R + 12 : JOB_R + 8;
      if (d < hitR && d < minDist) { minDist = d; closest = node; }
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
    if (found?.nodeType === 'hub') {
      onSelectRepo((found as HubNode).repo);
    } else if (found?.nodeType === 'job') {
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
      setTransform(t => ({ ...t, k: Math.min(4, Math.max(0.08, t.k * factor)) }));
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
      <div style={{
        position: 'absolute', left: 20, top: 16,
        fontSize: 11, color: 'rgba(100,80,50,0.35)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        scroll to zoom · drag to pan · click hub to focus repo
      </div>
    </div>
  );
}
