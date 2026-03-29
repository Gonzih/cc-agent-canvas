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
  visibleJobCount: number;
  collideRadius: number;
  highlightAlpha?: number;
}

export interface JobNode extends d3.SimulationNodeDatum {
  type: 'job';
  id: string;
  repo: string;
  job: Job;
  orbitRadius: number;
  highlightAlpha?: number;
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

function makeBlackHoleForce(strengthRef: { current: number }): d3.Force<CanvasNode, SimLink> {
  let _nodes: CanvasNode[] = [];
  function force(alpha: number) {
    for (const n of _nodes) {
      if (n.type !== 'hub') continue;
      const strength = strengthRef.current * alpha;
      n.vx = (n.vx ?? 0) - ((n.x ?? WIDTH / 2) - WIDTH / 2) * strength;
      n.vy = (n.vy ?? 0) - ((n.y ?? HEIGHT / 2) - HEIGHT / 2) * strength;
    }
  }
  force.initialize = (nodes: CanvasNode[], _random: () => number) => { _nodes = nodes; };
  return force;
}

function makePlanetTrailForce(): d3.Force<CanvasNode, SimLink> {
  let _nodes: CanvasNode[] = [];
  function force(alpha: number) {
    const hubMap = new Map<string, HubNode>();
    for (const n of _nodes) {
      if (n.type === 'hub') hubMap.set((n as HubNode).repo, n as HubNode);
    }
    for (const n of _nodes) {
      if (n.type !== 'job') continue;
      const jn = n as JobNode;
      const hub = hubMap.get(jn.repo);
      if (!hub) continue;
      const dx = (hub.x ?? WIDTH / 2) - (jn.x ?? WIDTH / 2);
      const dy = (hub.y ?? HEIGHT / 2) - (jn.y ?? HEIGHT / 2);
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 30 + jn.orbitRadius;
      const pull = (dist - targetDist) / dist * 0.15 * alpha;
      jn.vx = (jn.vx ?? 0) + dx * pull;
      jn.vy = (jn.vy ?? 0) + dy * pull;
    }
  }
  force.initialize = (nodes: CanvasNode[], _random: () => number) => { _nodes = nodes; };
  return force;
}

function buildSimForces(
  sim: d3.Simulation<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>,
  blackHoleStrengthRef: { current: number },
  sunFieldRef: { current: number },
  planetFieldRef: { current: number },
) {
  // Charge: hub repulsion is filter-reactive (reads visibleJobCount), jobs scale with planetFieldRef
  sim.force('charge', d3.forceManyBody<CanvasNode>()
    .strength(n => {
      if (n.type === 'hub') {
        const jobs = (n as HubNode).visibleJobCount ?? 0;
        return Math.max(-60, -(160 + jobs * sunFieldRef.current * 12));
      }
      return -(150 * planetFieldRef.current);
    })
    .distanceMax(600)
  );

  // Collision — hub radius from collideRadius property, job radius fixed
  sim.force('collide', d3.forceCollide<CanvasNode>(n => {
    if (n.type === 'hub') return (n as HubNode).collideRadius ?? 20;
    return 32;
  }));

  // Black hole — persistent central attractor pulling hubs toward sim center
  sim.force('blackhole', makeBlackHoleForce(blackHoleStrengthRef));

  // Planet trail — jobs spring toward their parent hub at desired orbit distance
  sim.force('planetTrail', makePlanetTrailForce());
}

export function useCanvas(jobs: Job[], activeFilters: string[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const simRef = useRef<d3.Simulation<CanvasNode, SimLink> | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  // Full unfiltered pool: all hubs + all LOD-visible jobs
  const allNodesRef = useRef<CanvasNode[]>([]);
  const blackHoleStrengthRef = useRef(0.08);
  const sunFieldRef = useRef(2.0);
  const planetFieldRef = useRef(1.0);
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
        visibleJobCount: 0,   // set below after hubJobCounts is computed
        collideRadius: 20,    // set below
        x: pos?.x ?? WIDTH / 2 + (Math.random() - 0.5) * 60,
        y: pos?.y ?? HEIGHT / 2 + (Math.random() - 0.5) * 60,
      };
    });

    // Build job nodes — all jobs (no per-cluster visibility cap)
    const lodVisibleJobs = jobs;
    const allJobNodes: JobNode[] = lodVisibleJobs.map(j => {
      const pos = existingPositions.get(j.id);
      const hub = hubNodes.find(h => h.repo === getRepo(j));
      return {
        type: 'job' as const,
        id: j.id,
        repo: getRepo(j),
        job: j,
        orbitRadius: 20 + Math.random() * 40, // refined after hubJobCounts below
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

    // Stamp visibleJobCount and collideRadius onto each hub node
    for (const hub of hubNodes) {
      const count = hubJobCounts.get(hub.id) ?? 0;
      hub.visibleJobCount = count;
      hub.collideRadius = count === 0 ? 15 : Math.min(20 + count * 1.0, 80);
    }

    // Refine orbitRadius for each job based on its hub's visible count
    for (const jn of allJobNodes) {
      const hubCount = Math.max(hubJobCounts.get(`hub:${jn.repo}`) ?? 1, 1);
      jn.orbitRadius = 20 + Math.random() * Math.sqrt(hubCount) * 8;
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

    buildSimForces(sim, blackHoleStrengthRef, sunFieldRef, planetFieldRef);
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

    // Count visible jobs per hub after filter
    const hubJobCounts = new Map<string, number>();
    for (const jn of filteredJobs) {
      const hubId = `hub:${jn.repo}`;
      hubJobCounts.set(hubId, (hubJobCounts.get(hubId) ?? 0) + 1);
    }

    // Stamp updated visibleJobCount and collideRadius onto hub nodes
    for (const hub of hubs) {
      const count = hubJobCounts.get(hub.id) ?? 0;
      hub.visibleJobCount = count;
      hub.collideRadius = count === 0 ? 15 : Math.min(20 + count * 1.0, 80);
    }

    // Update simulation nodes and links
    sim.nodes(filteredNodes);
    const lf = sim.force<d3.ForceLink<CanvasNode, { source: string; target: string; linkType: 'hub-spoke' | 'dep' }>>('link');
    if (lf) lf.links(rawLinks);

    // Rebuild forces — hubRepulsion will reinitialize with updated node properties
    buildSimForces(sim, blackHoleStrengthRef, sunFieldRef, planetFieldRef);

    // Heat up simulation so nodes find new equilibrium
    sim.alpha(0.5).restart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters.join(',')]);

  return { nodes, links, simRef, blackHoleStrengthRef, sunFieldRef, planetFieldRef };
}
