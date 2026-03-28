import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStatusStyle } from './colors';
import type { OrbNode } from './types';

interface DetailPanelProps {
  job: OrbNode | null;
  onClose: () => void;
}

function getRepoName(repoUrl?: string): string {
  if (!repoUrl) return 'unknown';
  return repoUrl.split('/').pop() ?? repoUrl;
}

function timeSince(ts?: string): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function DetailPanel({ job, onClose }: DetailPanelProps) {
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!job) { setOutputLines([]); return; }
    setLoading(true);
    fetch(`/api/job/${job.id}/output`)
      .then(r => r.json())
      .then(lines => { setOutputLines(lines); setLoading(false); })
      .catch(() => setLoading(false));
  }, [job?.id]);

  const style = getStatusStyle(job?.status);

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          key={job.id}
          initial={{ x: 360, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 360, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          style={{
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            width: 340,
            background: 'rgba(250, 246, 238, 0.97)',
            backdropFilter: 'blur(12px)',
            borderLeft: '1px solid rgba(180,160,130,0.25)',
            boxShadow: '-8px 0 32px rgba(100,80,50,0.1)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
            fontFamily: 'DM Sans, system-ui, sans-serif',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(180,160,130,0.2)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: style.fill,
              boxShadow: `0 0 8px ${style.glow}`,
              marginTop: 4, flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2E1E', lineHeight: 1.4, wordBreak: 'break-word' }}>
                {job.title || job.task || job.id}
              </div>
              <div style={{ fontSize: 11, color: '#8B7355', marginTop: 4 }}>
                {getRepoName(job.repo_url)} · {job.namespace}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#8B7355', fontSize: 18, lineHeight: 1, padding: '2px 4px',
                borderRadius: 4, flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Meta */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(180,160,130,0.12)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 12,
                background: `${style.fill}22`, color: '#5A4535',
                border: `1px solid ${style.fill}44`,
              }}>
                {job.status || 'unknown'}
              </span>
              {job.created_at && (
                <span style={{ fontSize: 11, color: '#8B7355', padding: '3px 0' }}>
                  {timeSince(job.created_at)}
                </span>
              )}
            </div>
            {job.id && (
              <div style={{ fontSize: 10, color: '#B0998A', marginTop: 8, fontFamily: 'monospace' }}>
                {job.id}
              </div>
            )}
          </div>

          {/* Output */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 0 0' }}>
            <div style={{ fontSize: 11, color: '#8B7355', fontWeight: 600, padding: '0 20px 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Recent output
            </div>
            <div style={{
              flex: 1, overflowY: 'auto', padding: '0 16px 16px',
              fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6,
              color: '#4A3828',
            }}>
              {loading ? (
                <div style={{ color: '#B0998A', padding: '8px 0' }}>loading…</div>
              ) : outputLines.length === 0 ? (
                <div style={{ color: '#B0998A', padding: '8px 0' }}>no output</div>
              ) : (
                outputLines.map((line, i) => (
                  <div key={i} style={{
                    padding: '1px 0',
                    borderBottom: '1px solid rgba(180,160,130,0.06)',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
