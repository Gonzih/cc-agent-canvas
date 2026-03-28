// Warm hue families for repos — soft, desaturated
const REPO_PALETTE = [
  '#8BA888', // soft sage green
  '#A88B8B', // dusty rose
  '#8B9BA8', // slate blue
  '#A8A08B', // warm tan
  '#9B8BA8', // muted lavender
  '#A89B8B', // warm brown
  '#8BA8A0', // seafoam
  '#A8908B', // terracotta
];

const repoColorMap = new Map<string, string>();
let colorIndex = 0;

export function getRepoColor(repo: string): string {
  if (!repoColorMap.has(repo)) {
    repoColorMap.set(repo, REPO_PALETTE[colorIndex % REPO_PALETTE.length]);
    colorIndex++;
  }
  return repoColorMap.get(repo)!;
}

export const STATUS_GLOW: Record<string, { fill: string; glow: string; opacity: number }> = {
  running:   { fill: '#7BB3D4', glow: 'rgba(123,179,212,0.6)', opacity: 1 },
  done:      { fill: '#7DC4A0', glow: 'rgba(125,196,160,0.55)', opacity: 1 },
  failed:    { fill: '#D47B7B', glow: 'rgba(212,123,123,0.6)', opacity: 1 },
  pending:   { fill: '#C4B8A8', glow: 'rgba(196,184,168,0.35)', opacity: 0.75 },
  cancelled: { fill: '#B0A898', glow: 'rgba(176,168,152,0.2)', opacity: 0.45 },
};

export function getStatusStyle(status?: string) {
  return STATUS_GLOW[status?.toLowerCase() ?? ''] ?? STATUS_GLOW['pending'];
}
