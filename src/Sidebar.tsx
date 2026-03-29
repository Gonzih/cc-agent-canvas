import { motion } from 'framer-motion';
import { getRepoColor, getStatusStyle } from './colors';
import type { Job } from './types';

interface SidebarProps {
  jobs: Job[];
  displayCount: number;
  selectedRepo: string | null;
  onSelectRepo: (repo: string | null) => void;
  connected: boolean;
}

function getRepoName(repoUrl?: string): string {
  if (!repoUrl) return 'unknown';
  return repoUrl.split('/').pop() ?? repoUrl;
}

interface RepoStats {
  name: string;
  running: number;
  done: number;
  failed: number;
  total: number;
}

function buildRepoStats(jobs: Job[]): RepoStats[] {
  const map = new Map<string, RepoStats>();
  for (const j of jobs) {
    const name = getRepoName(j.repo_url);
    if (!map.has(name)) map.set(name, { name, running: 0, done: 0, failed: 0, total: 0 });
    const s = map.get(name)!;
    s.total++;
    const st = j.status?.toLowerCase();
    if (st === 'running') s.running++;
    else if (st === 'done') s.done++;
    else if (st === 'failed') s.failed++;
  }
  return [...map.values()].sort((a, b) => b.running - a.running || b.total - a.total);
}

export function Sidebar({ jobs, displayCount, selectedRepo, onSelectRepo, connected }: SidebarProps) {
  const repos = buildRepoStats(jobs);

  return (
    <div style={{
      position: 'fixed',
      left: 0, top: 0, bottom: 0,
      width: 220,
      background: 'rgba(248, 244, 236, 0.95)',
      backdropFilter: 'blur(12px)',
      borderRight: '1px solid rgba(180,160,130,0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 50,
      fontFamily: 'DM Sans, system-ui, sans-serif',
      boxShadow: '4px 0 20px rgba(100,80,50,0.06)',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 18px 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#3D2E1E', letterSpacing: '-0.02em' }}>
          cc-agent-canvas
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? '#7DC4A0' : '#D47B7B',
            boxShadow: connected ? '0 0 6px rgba(125,196,160,0.8)' : 'none',
          }} />
          <span style={{ fontSize: 11, color: '#8B7355' }}>
            {connected ? 'live' : 'reconnecting…'}
          </span>
        </div>
      </div>

      {/* Total count */}
      <div style={{ padding: '0 18px 16px', borderBottom: '1px solid rgba(180,160,130,0.15)' }}>
        <div style={{ fontSize: 11, color: '#8B7355' }}>
          {jobs.length} job{jobs.length !== 1 ? 's' : ''} total
          {displayCount < jobs.length && (
            <span style={{ color: '#B0998A' }}> · showing {displayCount} most recent</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          {(['running', 'done', 'failed'] as const).map(st => {
            const count = jobs.filter(j => j.status?.toLowerCase() === st).length;
            const s = getStatusStyle(st);
            return (
              <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.fill }} />
                <span style={{ fontSize: 11, color: '#6B5E4E' }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Repo list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        <div style={{ fontSize: 10, color: '#B0998A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 8px 8px' }}>
          Repos
        </div>

        {selectedRepo && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelectRepo(null)}
            style={{
              width: '100%', textAlign: 'left', padding: '7px 10px',
              marginBottom: 4, borderRadius: 10, border: 'none',
              background: 'rgba(180,160,130,0.12)',
              cursor: 'pointer', fontSize: 11, color: '#8B7355',
              fontFamily: 'DM Sans, system-ui, sans-serif',
            }}
          >
            ← all repos
          </motion.button>
        )}

        {repos.map(r => {
          const color = getRepoColor(r.name);
          const isSelected = selectedRepo === r.name;
          return (
            <motion.button
              key={r.name}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectRepo(isSelected ? null : r.name)}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 10px',
                marginBottom: 3, borderRadius: 12, border: 'none',
                background: isSelected ? `${color}22` : 'transparent',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'DM Sans, system-ui, sans-serif',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: color, flexShrink: 0,
                  boxShadow: isSelected ? `0 0 6px ${color}` : 'none',
                }} />
                <span style={{
                  fontSize: 12, color: '#3D2E1E', fontWeight: isSelected ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.name}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {r.running > 0 && (
                  <span style={{ fontSize: 10, color: '#7BB3D4', fontWeight: 600 }}>{r.running}</span>
                )}
                <span style={{ fontSize: 10, color: '#B0998A' }}>{r.total}</span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
