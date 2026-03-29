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
  visible?: boolean;
  // d3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

// Kept for backwards compat — represents a job node with resolved position
export interface OrbNode extends Job {
  x: number;
  y: number;
}
