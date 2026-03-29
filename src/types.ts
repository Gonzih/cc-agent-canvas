export interface Job {
  id: string;
  title?: string;
  task?: string;
  status?: string;
  repo_url?: string;
  repoUrl?: string;
  namespace?: string;
  created_at?: string;
  startedAt?: string;
  updated_at?: string;
  depends_on?: string;
  dependsOn?: string[];
  resumedFrom?: string;
}

export interface HubNode {
  nodeType: 'hub';
  id: string;       // 'hub:' + repo name
  repo: string;
  colorIdx: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export interface JobNode {
  nodeType: 'job';
  id: string;
  repo: string;
  status?: string;
  title?: string;
  task?: string;
  created_at?: string;
  startedAt?: string;
  repo_url?: string;
  repoUrl?: string;
  namespace?: string;
  depends_on?: string;
  dependsOn?: string[];
  resumedFrom?: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

export type CanvasNode = HubNode | JobNode;

// Legacy alias kept for DetailPanel
export type OrbNode = JobNode;
