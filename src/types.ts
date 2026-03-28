export interface Job {
  id: string;
  title?: string;
  task?: string;
  status?: string;
  repo_url?: string;
  namespace?: string;
  created_at?: string;
  updated_at?: string;
  depends_on?: string;
  // d3 simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface OrbNode extends Job {
  x: number;
  y: number;
}
