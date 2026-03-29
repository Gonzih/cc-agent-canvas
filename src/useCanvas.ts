import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Job, CanvasNode, HubNode, JobNode } from './types';
import { getRepoColorIndex } from './colors';

const WIDTH = 3000;
const HEIGHT = 3000;

function getRepo(j: Job): string {
  return (j.repo_url || j.repoUrl || '').split('/').pop() || 'unknown';
}

interface SimLink {
  source: string | CanvasNode;
  target: string | CanvasNode;
  linkType: 'spoke' | 'dep';
}

export function useCanvas(jobs: Job[]) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const simRef = useRef<d3.Simulation<CanvasNode, SimLink> | null>(null);
  // Stable ref to current sim nodes — RAF loop reads positions directly from here
  const nodesRef = useRef<CanvasNode[]>([]);

  useEffect(() => {
    if (!jobs.length) return;

    // Assign stable color indices per repo
    const repos = [...new Set(jobs.map(getRepo))];
    // Register repos in color module to get stable indices
    repos.forEach(repo => getRepoColorIndex(repo));

    // Preserve existing positions
    const existingById = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      existingById.set(n.id, { x: n.x, y: n.y });
    }

    // Build hub nodes (one per repo) placed around a circle
    const hubNodes: HubNode[] = repos.map((repo, i) => {
      const angle = (i / repos.length) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.min(WIDTH, HEIGHT) * 0.28;
      const hubId = 'hub:' + repo;
      const existing = existingById.get(hubId);
      return {
        nodeType: 'hub' as const,
        id: hubId,
        repo,
        colorIdx: getRepoColorIndex(repo),
        x: existing?.x ?? WIDTH / 2 + Math.cos(angle) * radius,
        y: existing?.y ?? HEIGHT / 2 + Math.sin(angle) * radius,
      };
    });

    const hubByRepo = new Map(hubNodes.map(h => [h.repo, h]));

    // Build job nodes
    const jobNodeSet = new Set(jobs.map(j => j.id));
    const jobNodes: JobNode[] = jobs.map(j => {
      const repo = getRepo(j);
      const hub = hubByRepo.get(repo);
      const existing = existingById.get(j.id);
      return {
        nodeType: 'job' as const,
        id: j.id,
        repo,
        status: j.status,
        title: j.title,
        task: j.task,
        created_at: j.created_at,
        startedAt: j.startedAt,
        repo_url: j.repo_url,
        repoUrl: j.repoUrl,
        namespace: j.namespace,
        depends_on: j.depends_on,
        dependsOn: j.dependsOn,
        resumedFrom: j.resumedFrom,
        x: existing?.x ?? (hub?.x ?? WIDTH / 2) + (Math.random() - 0.5) * 120,
        y: existing?.y ?? (hub?.y ?? HEIGHT / 2) + (Math.random() - 0.5) * 120,
      };
    });

    const allNodes: CanvasNode[] = [...hubNodes, ...jobNodes];

    // Build links
    const links: SimLink[] = [];
    // Hub-spoke links
    for (const jn of jobNodes) {
      const hub = hubByRepo.get(jn.repo);
      if (hub) links.push({ source: hub.id, target: jn.id, linkType: 'spoke' });
    }
    // Dependency links between jobs
    for (const j of jobs) {
      const parents = j.dependsOn?.length ? j.dependsOn : j.depends_on ? [j.depends_on] : [];
      for (const parentId of parents) {
        if (jobNodeSet.has(parentId) && jobNodeSet.has(j.id)) {
          links.push({ source: parentId, target: j.id, linkType: 'dep' });
        }
      }
    }

    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation<CanvasNode, SimLink>(allNodes)
      .force('link', d3.forceLink<CanvasNode, SimLink>(links)
        .id(d => d.id)
        .strength(l => l.linkType === 'spoke' ? 0.4 : 0.15)
        .distance(l => l.linkType === 'spoke' ? 100 : 70))
      .force('charge', d3.forceManyBody<CanvasNode>()
        .strength(n => n.nodeType === 'hub' ? -800 : -80))
      .force('collide', d3.forceCollide<CanvasNode>(n => n.nodeType === 'hub' ? 55 : 22))
      .force('center', d3.forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.03))
      // Never fully stop — gives the living, breathing Gource feel
      .alphaDecay(0.005)
      .alphaMin(0.001);

    simRef.current = sim;
    nodesRef.current = sim.nodes();
    // Initial state push so Canvas mounts with nodes
    setNodes([...sim.nodes()]);

    // Update React state on significant structural changes only (not every tick)
    // The RAF loop reads positions directly from nodesRef.current (d3 mutates in place)
    let lastStructuralTick = 0;
    sim.on('tick', () => {
      lastStructuralTick++;
      // Push state update every ~30 ticks while alpha is high (settling), then stop
      if (lastStructuralTick <= 60 && lastStructuralTick % 5 === 0) {
        setNodes([...sim.nodes()]);
      }
    });
    sim.on('end', () => {
      setNodes([...sim.nodes()]);
    });

    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map(j => j.id + (j.status ?? '')).join(',')]);

  return { nodes, nodesRef };
}
