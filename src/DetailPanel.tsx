import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getStatusStyle } from './colors';
import type { JobNode } from './types';

interface DetailPanelProps {
  job: JobNode | null;
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

// Extract first meaningful line from task text, stripping markdown
function extractTitle(task?: string, fallback?: string): string {
  if (!task) return fallback ?? '';
  const lines = task.split('\n');
  for (const raw of lines) {
    const line = raw
      .replace(/^#+\s*/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (line.length > 0) return line.slice(0, 80);
  }
  return fallback ?? '';
}

function lineColor(line: string): string {
  if (line.startsWith('[tool]')) return '#60a5fa';
  if (line.startsWith('[cc-agent]')) return '#94a3b8';
  if (/error|Error|failed/i.test(line)) return '#D47B7B';
  if (line.startsWith('##') || line.startsWith('**')) return '#7DC4A0';
  return '#4a3f35';
}

export function DetailPanel({ job, onClose }: DetailPanelProps) {
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!job) { setOutputLines([]); return; }
    setLoading(true);
    fetch(`/api/job/${job.id}/output`)
      .then(r => r.json())
      .then((lines: string[]) => { setOutputLines(lines); setLoading(false); })
      .catch(() => setLoading(false));
  }, [job?.id]);

  // Auto-scroll to bottom when output arrives or panel opens
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [outputLines]);

  const style = getStatusStyle(job?.status);
  const title = extractTitle(job?.task, job?.title || job?.id);
  const repoUrl = job?.repo_url || job?.repoUrl;

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
          {/* Header — title */}
          <div style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(180,160,130,0.2)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 14, fontWeight: 600, color: '#3D2E1E',
                lineHeight: 1.4, wordBreak: 'break-word',
              }}>
                {title}
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

          {/* Status badge + repo link */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(180,160,130,0.12)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 12,
                background: `${style.fill}22`, color: '#5A4535',
                border: `1px solid ${style.fill}44`,
              }}>
                {job.status || 'unknown'}
              </span>
              {job.created_at && (
                <span style={{ fontSize: 11, color: '#8B7355' }}>
                  {timeSince(job.created_at)}
                </span>
              )}
            </div>
            {/* Repo link */}
            {repoUrl && (
              <div style={{ marginTop: 8 }}>
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, color: '#7BB3D4', textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  {getRepoName(repoUrl)}
                </a>
                {job.namespace && (
                  <span style={{ fontSize: 11, color: '#B0998A' }}> · {job.namespace}</span>
                )}
              </div>
            )}
            {job.id && (
              <div style={{ fontSize: 10, color: '#B0998A', marginTop: 6, fontFamily: 'monospace' }}>
                {job.id}
              </div>
            )}
          </div>

          {/* Output — color-coded, auto-scroll */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '12px 0 0' }}>
            <div style={{
              fontSize: 11, color: '#8B7355', fontWeight: 600,
              padding: '0 20px 8px', textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Output
            </div>
            <div
              ref={outputRef}
              style={{
                flex: 1, overflowY: 'auto', padding: '0 16px 16px',
                fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6,
              }}
            >
              {loading ? (
                <div style={{ color: '#B0998A', padding: '8px 0' }}>loading…</div>
              ) : outputLines.length === 0 ? (
                <div style={{ color: '#B0998A', padding: '8px 0' }}>no output</div>
              ) : (
                outputLines.map((line, i) => (
                  <div key={i} style={{
                    padding: '1px 0',
                    borderBottom: '1px solid rgba(180,130,80,0.06)',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    color: lineColor(line),
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
