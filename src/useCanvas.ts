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

function buildSimForces(
  sim: d3.Simulation<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>,
  hubJobCounts: Map<string, number>,
) {
  sim.force('charge', d3.forceManyBody().strength((n: d3.SimulationNodeDatum) => {
    const cn = n as CanvasNode;
    if (cn.type === 'hub') {
      const count = hubJobCounts.get(cn.id) ?? 0;
      return count === 0 ? -100 : Math.max(-2000, -400 - ((cn as HubNode).totalCount * 8));
    }
    return -150;
  }));
  sim.force('collide', d3.forceCollide((n: d3.SimulationNodeDatum) => {
    const cn = n as CanvasNode;
    if (cn.type === 'hub') {
      const count = hubJobCounts.get(cn.id) ?? 0;
      return count === 0 ? 20 : Math.min(20 + (cn as HubNode).totalCount * 0.4, 120);
    }
    return 32;
  }));
}

export function useCanvas(jobs: Job[], activeFilters: string[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const simRef = useRef<d3.Simulation<CanvasNode, SimLink> | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  // Full unfiltered pool: all hubs + all LOD-visible jobs
  const allNodesRef = useRef<CanvasNode[]>([]);
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

    // Build hub nodes — all start clustered near center, physics drifts them apart by mass
    const hubNodes: HubNode[] = repos.map((repo) => {
      const hubId = `hub:${repo}`;
      const pos = existingPositions.get(hubId);
      return {
        type: 'hub' as const,
        id: hubId,
        repo,
        label: repo,
        colorIndex: getRepoColorIndex(repo),
        totalCount: totalCountByRepo.get(repo) ?? 0,
        x: pos?.x ?? WIDTH / 2 + (Math.random() - 0.5) * 60,
        y: pos?.y ?? HEIGHT / 2 + (Math.random() - 0.5) * 60,
      };
    });

    // Build job nodes — only LOD-visible jobs (visible !== false)
    const lodVisibleJobs = jobs.filter(j => j.visible !== false);
    const allJobNodes: JobNode[] = lodVisibleJobs.map(j => {
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

    // Store unfiltered pool
    allNodesRef.current = [...hubNodes, ...allJobNodes];

    // Apply status filter
    const filterSet = new Set(activeFilters.map(f => f.toLowerCase()));
    const filterActive = filterSet.size > 0;
    const jobNodes = filterActive
      ? allJobNodes.filter(jn => filterSet.has(jn.job.status?.toLowerCase() ?? 'pending'))
      : allJobNodes;

    const allNodes: CanvasNode[] = [...hubNodes, ...jobNodes];
    const nodeIdSet = new Set(allNodes.map(n => n.id));

    // Build links
    const rawLinks: { source: string; target: string; linkType: 'hub-spoke' | 'dep' }[] = [];

    for (const jn of jobNodes) {
      const hubId = `hub:${jn.repo}`;
      if (nodeIdSet.has(hubId)) {
        rawLinks.push({ source: jn.id, target: hubId, linkType: 'hub-spoke' });
      }
    }

    for (const j of lodVisibleJobs) {
      const parents = j.dependsOn?.length ? j.dependsOn : j.depends_on ? [j.depends_on] : [];
      for (const parentId of parents) {
        if (nodeIdSet.has(parentId) && nodeIdSet.has(j.id)) {
          rawLinks.push({ source: parentId, target: j.id, linkType: 'dep' });
        }
      }
    }

    // Count visible jobs per hub for force adjustment
    const hubJobCounts = new Map<string, number>();
    for (const jn of jobNodes) {
      const hubId = `hub:${jn.repo}`;
      hubJobCounts.set(hubId, (hubJobCounts.get(hubId) ?? 0) + 1);
    }

    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>(allNodes)
      .force('link', d3.forceLink<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>(rawLinks)
        .id(d => d.id)
        .strength(l => l.linkType === 'hub-spoke' ? 0.4 : 0.15)
        .distance(l => l.linkType === 'hub-spoke' ? 100 : 70))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.03))
      .alphaDecay(0.005)
      .alphaMin(0.001) // never fully stops — gives Gource living feel
      .on('tick', () => {
        setNodes([...sim.nodes()]);
        const lf = sim.force<d3.ForceLink<CanvasNode, SimLink>>('link');
        if (lf) setLinks([...(lf.links() as SimLink[])]);
      });

    buildSimForces(sim, hubJobCounts);
    simRef.current = sim;

    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map(j => j.id + j.status).join(',')]);

  // Re-filter effect: when activeFilters changes without job set changing
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !allNodesRef.current.length) return;

    const filterSet = new Set(activeFilters.map(f => f.toLowerCase()));
    const filterActive = filterSet.size > 0;

    const hubs = allNodesRef.current.filter((n): n is HubNode => n.type === 'hub');
    const allJobs = allNodesRef.current.filter((n): n is JobNode => n.type === 'job');

    const filteredJobs = filterActive
      ? allJobs.filter(jn => filterSet.has(jn.job.status?.toLowerCase() ?? 'pending'))
      : allJobs;

    const filteredNodes: CanvasNode[] = [...hubs, ...filteredJobs];
    const nodeIdSet = new Set(filteredNodes.map(n => n.id));

    // Rebuild links
    const rawLinks: { source: string; target: string; linkType: 'hub-spoke' | 'dep' }[] = [];
    for (const jn of filteredJobs) {
      const hubId = `hub:${jn.repo}`;
      if (nodeIdSet.has(hubId)) rawLinks.push({ source: jn.id, target: hubId, linkType: 'hub-spoke' });
    }
    for (const jn of filteredJobs) {
      const parents = jn.job.dependsOn?.length ? jn.job.dependsOn : jn.job.depends_on ? [jn.job.depends_on] : [];
      for (const parentId of parents) {
        if (nodeIdSet.has(parentId) && nodeIdSet.has(jn.id)) {
          rawLinks.push({ source: parentId, target: jn.id, linkType: 'dep' });
        }
      }
    }

    // Count jobs per hub
    const hubJobCounts = new Map<string, number>();
    for (const jn of filteredJobs) {
      const hubId = `hub:${jn.repo}`;
      hubJobCounts.set(hubId, (hubJobCounts.get(hubId) ?? 0) + 1);
    }

    // Update simulation nodes and links
    sim.nodes(filteredNodes);
    const lf = sim.force<d3.ForceLink<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>>('link');
    if (lf) lf.links(rawLinks);

    // Update forces for new hub job counts
    buildSimForces(sim, hubJobCounts);

    // Heat up simulation
    sim.alpha(0.4).restart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters.join(',')]);

  return { nodes, links, simRef };
}
