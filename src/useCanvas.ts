import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Job } from './types';
import { getRepoColorIndex } from './colors';

export interface HubNode extends d3.SimulationNodeDatum {
  type: 'hub';
  id: string;
  repo: string;
  label: string;
  colorIndex: number;
  totalCount: number;
}

export interface JobNode extends d3.SimulationNodeDatum {
  type: 'job';
  id: string;
  repo: string;
  job: Job;
}

export type CanvasNode = HubNode | JobNode;

export interface SimLink {
  source: CanvasNode;
  target: CanvasNode;
  linkType: 'hub-spoke' | 'dep';
}

const WIDTH = 3000;
const HEIGHT = 3000;

function getRepo(j: Job): string {
  return (j.repo_url || j.repoUrl || '').split('/').pop() || 'unknown';
}

export function useCanvas(jobs: Job[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const simRef = useRef<d3.Simulation<CanvasNode, SimLink> | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!jobs.length) return;

    const repos = [...new Set(jobs.map(getRepo))];

    // Preserve existing node positions across re-runs
    const existingPositions = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      if (n.x !== undefined && n.y !== undefined) {
        existingPositions.set(n.id, { x: n.x!, y: n.y! });
      }
    }

    // Count total jobs per repo (before visibility filter)
    const totalCountByRepo = new Map<string, number>();
    for (const j of jobs) {
      const repo = getRepo(j);
      totalCountByRepo.set(repo, (totalCountByRepo.get(repo) ?? 0) + 1);
    }

    // Build hub nodes — one per repo, arranged on a circle
    const hubNodes: HubNode[] = repos.map((repo, i) => {
      const angle = (i / repos.length) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.min(WIDTH, HEIGHT) * 0.32;
      const hubId = `hub:${repo}`;
      const pos = existingPositions.get(hubId);
      return {
        type: 'hub' as const,
        id: hubId,
        repo,
        label: repo,
        colorIndex: getRepoColorIndex(repo),
        totalCount: totalCountByRepo.get(repo) ?? 0,
        x: pos?.x ?? WIDTH / 2 + Math.cos(angle) * radius,
        y: pos?.y ?? HEIGHT / 2 + Math.sin(angle) * radius,
      };
    });

    // Build job nodes — only simulate visible jobs (visible !== false)
    const visibleJobs = jobs.filter(j => j.visible !== false);
    const jobNodes: JobNode[] = visibleJobs.map(j => {
      const pos = existingPositions.get(j.id);
      const hub = hubNodes.find(h => h.repo === getRepo(j));
      return {
        type: 'job' as const,
        id: j.id,
        repo: getRepo(j),
        job: j,
        x: pos?.x ?? (hub?.x ?? WIDTH / 2) + (Math.random() - 0.5) * 120,
        y: pos?.y ?? (hub?.y ?? HEIGHT / 2) + (Math.random() - 0.5) * 120,
      };
    });

    const allNodes: CanvasNode[] = [...hubNodes, ...jobNodes];
    const nodeIdSet = new Set(allNodes.map(n => n.id));

    // Build links
    const rawLinks: { source: string; target: string; linkType: 'hub-spoke' | 'dep' }[] = [];

    // Hub-spoke links: each job → its repo hub
    for (const jn of jobNodes) {
      const hubId = `hub:${jn.repo}`;
      if (nodeIdSet.has(hubId)) {
        rawLinks.push({ source: jn.id, target: hubId, linkType: 'hub-spoke' });
      }
    }

    // Dependency links between jobs
    for (const j of visibleJobs) {
      const parents = j.dependsOn?.length ? j.dependsOn : j.depends_on ? [j.depends_on] : [];
      for (const parentId of parents) {
        if (nodeIdSet.has(parentId) && nodeIdSet.has(j.id)) {
          rawLinks.push({ source: parentId, target: j.id, linkType: 'dep' });
        }
      }
    }

    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>(allNodes)
      .force('link', d3.forceLink<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>(rawLinks)
        .id(d => d.id)
        .strength(l => l.linkType === 'hub-spoke' ? 0.4 : 0.15)
        .distance(l => l.linkType === 'hub-spoke' ? 100 : 70))
      .force('charge', d3.forceManyBody().strength((n: d3.SimulationNodeDatum) => (n as CanvasNode).type === 'hub' ? -800 : -150))
      .force('collide', d3.forceCollide((n: d3.SimulationNodeDatum) => (n as CanvasNode).type === 'hub' ? 55 : 32))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.03))
      .alphaDecay(0.005)
      .alphaMin(0.001) // never fully stops — gives Gource living feel
      .on('tick', () => {
        setNodes([...sim.nodes()]);
        const lf = sim.force<d3.ForceLink<CanvasNode, SimLink>>('link');
        if (lf) setLinks([...(lf.links() as SimLink[])]);
      });

    simRef.current = sim;

    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map(j => j.id + j.status).join(',')]);

  return { nodes, links };
}
