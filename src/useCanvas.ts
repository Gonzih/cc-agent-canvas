import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { Job, OrbNode } from './types';

interface SimLink {
  source: string;
  target: string;
}

export function useCanvas(jobs: Job[]) {
  const [nodes, setNodes] = useState<OrbNode[]>([]);
  const simRef = useRef<d3.Simulation<OrbNode, SimLink> | null>(null);

  const WIDTH = 3000;
  const HEIGHT = 3000;

  useEffect(() => {
    if (!jobs.length) return;

    // Preserve existing positions
    const existingPositions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      existingPositions[n.id] = { x: n.x, y: n.y };
    }

    const newNodes: OrbNode[] = jobs.map(j => {
      const pos = existingPositions[j.id];
      return {
        ...j,
        x: pos?.x ?? WIDTH / 2 + (Math.random() - 0.5) * 400,
        y: pos?.y ?? HEIGHT / 2 + (Math.random() - 0.5) * 400,
      };
    });

    const links: SimLink[] = jobs
      .filter(j => j.depends_on)
      .map(j => ({ source: j.depends_on!, target: j.id }))
      .filter(l => newNodes.some(n => n.id === l.source) && newNodes.some(n => n.id === l.target));

    if (simRef.current) simRef.current.stop();

    let ticks = 0;
    const sim = d3.forceSimulation<OrbNode, SimLink>(newNodes)
      .force('link', d3.forceLink<OrbNode, SimLink>(links)
        .id(d => d.id)
        .distance(220)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collide', d3.forceCollide(90))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2))
      .alphaDecay(0.02)
      .on('tick', () => {
        ticks++;
        if (ticks >= 200) {
          sim.stop();
          setNodes([...sim.nodes()]);
        } else {
          setNodes([...sim.nodes()]);
        }
      })
      .on('end', () => {
        setNodes([...sim.nodes()]);
      });

    simRef.current = sim;

    return () => {
      sim.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map(j => j.id + j.status).join(',')]);

  const getLinks = useCallback((): SimLink[] => {
    if (!simRef.current) return [];
    const linkForce = simRef.current.force<d3.ForceLink<OrbNode, SimLink>>('link');
    if (!linkForce) return [];
    return linkForce.links() as SimLink[];
  }, []);

  return { nodes, getLinks };
}
