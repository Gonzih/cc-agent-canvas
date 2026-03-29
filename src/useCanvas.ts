import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { Job, OrbNode } from './types';

interface SimLink {
  source: string;
  target: string;
}

export interface ClusterCenter {
  x: number;
  y: number;
  hue: number;
}

const WIDTH = 3000;
const HEIGHT = 3000;

function getRepo(j: Job): string {
  return (j.repo_url || j.repoUrl || '').split('/').pop() || 'unknown';
}

export function useCanvas(jobs: Job[]) {
  const [nodes, setNodes] = useState<OrbNode[]>([]);
  const [clusterCenters, setClusterCenters] = useState<Record<string, ClusterCenter>>({});
  const simRef = useRef<d3.Simulation<OrbNode, SimLink> | null>(null);
  // stable ref for reading existing positions inside the effect without stale closure
  const nodesRef = useRef<OrbNode[]>([]);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!jobs.length) return;

    // Build cluster centers — each repo gets an angular position on a circle
    const repos = [...new Set(jobs.map(getRepo))];
    const centers: Record<string, ClusterCenter> = {};
    repos.forEach((repo, i) => {
      const angle = (i / repos.length) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.min(WIDTH, HEIGHT) * 0.32;
      centers[repo] = {
        x: WIDTH / 2 + Math.cos(angle) * radius,
        y: HEIGHT / 2 + Math.sin(angle) * radius,
        hue: (i / repos.length) * 360,
      };
    });
    setClusterCenters(centers);

    // Preserve existing node positions across re-runs
    const existingPositions: Record<string, { x: number; y: number }> = {};
    for (const n of nodesRef.current) {
      existingPositions[n.id] = { x: n.x, y: n.y };
    }

    const newNodes: OrbNode[] = jobs.map(j => {
      const pos = existingPositions[j.id];
      const center = centers[getRepo(j)];
      return {
        ...j,
        x: pos?.x ?? (center?.x ?? WIDTH / 2) + (Math.random() - 0.5) * 200,
        y: pos?.y ?? (center?.y ?? HEIGHT / 2) + (Math.random() - 0.5) * 200,
      };
    });

    const nodeIdSet = new Set(newNodes.map(n => n.id));
    const links: SimLink[] = [];
    jobs.forEach(j => {
      const parents = j.dependsOn?.length
        ? j.dependsOn
        : j.depends_on ? [j.depends_on] : [];
      parents.forEach(parentId => {
        if (nodeIdSet.has(parentId) && nodeIdSet.has(j.id)) {
          links.push({ source: parentId, target: j.id });
        }
      });
    });

    if (simRef.current) simRef.current.stop();

    let ticks = 0;
    const sim = d3.forceSimulation<OrbNode, SimLink>(newNodes)
      .force('link', d3.forceLink<OrbNode, SimLink>(links)
        .id(d => d.id)
        .distance(80)
        .strength(0.3))
      .force('x', d3.forceX((n: OrbNode) => centers[getRepo(n)]?.x ?? WIDTH / 2).strength(0.12))
      .force('y', d3.forceY((n: OrbNode) => centers[getRepo(n)]?.y ?? HEIGHT / 2).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-60))
      .force('collide', d3.forceCollide(28))
      .alphaDecay(0.02)
      .on('tick', () => {
        ticks++;
        if (ticks >= 200) sim.stop();
        setNodes([...sim.nodes()]);
      })
      .on('end', () => {
        setNodes([...sim.nodes()]);
      });

    simRef.current = sim;

    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map(j => j.id + j.status).join(',')]);

  const getLinks = useCallback((): SimLink[] => {
    if (!simRef.current) return [];
    const linkForce = simRef.current.force<d3.ForceLink<OrbNode, SimLink>>('link');
    if (!linkForce) return [];
    return linkForce.links() as SimLink[];
  }, []);

  return { nodes, clusterCenters, getLinks };
}
