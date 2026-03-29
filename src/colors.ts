// Hub orb fill colors — warm, distinct, desaturated
export const HUB_PALETTE = [
  '#C4A882',  // warm sand
  '#82B4C4',  // soft blue
  '#A8C482',  // soft green
  '#C482A8',  // muted rose
  '#C4C482',  // warm yellow
  '#A882C4',  // soft purple
  '#82C4A8',  // teal
  '#C49882',  // terracotta
];

const repoColorMap = new Map<string, string>();
let colorIndex = 0;

export function getRepoColor(repo: string): string {
  if (!repoColorMap.has(repo)) {
    repoColorMap.set(repo, HUB_PALETTE[colorIndex % HUB_PALETTE.length]);
    colorIndex++;
  }
  return repoColorMap.get(repo)!;
}

export function getRepoColorByIdx(idx: number): string {
  return HUB_PALETTE[idx % HUB_PALETTE.length];
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
