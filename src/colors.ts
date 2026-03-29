// Hub colors — warm distinct hues, low saturation (Gource-style solar system)
export const HUB_COLORS = [
  { fill: '#C4A882', glow: 'rgba(196,168,130,0.5)' },  // warm sand
  { fill: '#82B4C4', glow: 'rgba(130,180,196,0.5)' },  // soft blue
  { fill: '#A8C482', glow: 'rgba(168,196,130,0.5)' },  // soft green
  { fill: '#C482A8', glow: 'rgba(196,130,168,0.5)' },  // muted rose
  { fill: '#C4C482', glow: 'rgba(196,196,130,0.5)' },  // warm yellow
  { fill: '#A882C4', glow: 'rgba(168,130,196,0.5)' },  // soft purple
  { fill: '#82C4A8', glow: 'rgba(130,196,168,0.5)' },  // teal
  { fill: '#C49882', glow: 'rgba(196,152,130,0.5)' },  // terracotta
];

const repoColorIdxMap = new Map<string, number>();
let colorIndex = 0;

export function getRepoColorIndex(repo: string): number {
  if (!repoColorIdxMap.has(repo)) {
    repoColorIdxMap.set(repo, colorIndex % HUB_COLORS.length);
    colorIndex++;
  }
  return repoColorIdxMap.get(repo)!;
}

export function getRepoColor(repo: string): string {
  return HUB_COLORS[getRepoColorIndex(repo)].fill;
}

export function getHubColorByIdx(idx: number) {
  return HUB_COLORS[idx % HUB_COLORS.length];
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
