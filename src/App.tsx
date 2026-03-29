import { useState, useRef, useEffect, useMemo } from 'react';
import { useWebSocket } from './useWebSocket';
import { useCanvas } from './useCanvas';
import type { JobNode } from './useCanvas';
import { Sidebar } from './Sidebar';
import { Canvas } from './Canvas';
import { DetailPanel } from './DetailPanel';
import type { Job } from './types';

export default function App() {
  const { jobs, connected } = useWebSocket();
  const { nodes, links } = useCanvas(jobs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [panToRepo, setPanToRepo] = useState<string | null>(null);
  const prevJobIds = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Dismiss loading overlay on first data
  useEffect(() => {
    if (loading && jobs.length > 0) setLoading(false);
  }, [jobs, loading]);

  // Track newly arriving jobs for bloom animation
  useEffect(() => {
    const current = new Set(jobs.map(j => j.id));
    const fresh = new Set<string>();
    for (const id of current) {
      if (!prevJobIds.current.has(id)) fresh.add(id);
    }
    if (fresh.size > 0) {
      setNewIds(fresh);
      const t = setTimeout(() => setNewIds(new Set()), 2000);
      prevJobIds.current = current;
      return () => clearTimeout(t);
    }
    prevJobIds.current = current;
  }, [jobs]);

  const selectedJob = useMemo<Job | null>(() => {
    if (!selectedId) return null;
    const node = nodes.find(n => n.id === selectedId);
    if (!node || node.type !== 'job') return null;
    return (node as JobNode).job;
  }, [selectedId, nodes]);

  const handleSelectRepo = (repo: string | null) => {
    setSelectedRepo(repo);
    if (repo) setPanToRepo(repo);
  };

  return (
    <div style={{ background: '#F5F0E8', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {loading && (
        <div style={{
          position: 'fixed', inset: 0,
          background: '#F5F0E8',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 100,
          fontFamily: 'DM Sans, system-ui',
        }}>
          <div style={{ fontSize: 72, animation: 'mousey 1.2s ease-in-out infinite' }}>
            🐭
          </div>
          <div style={{ marginTop: 24, color: '#8B7355', fontSize: 14, letterSpacing: '0.05em' }}>
            loading your universe...
          </div>
        </div>
      )}
      <Sidebar
        jobs={jobs}
        selectedRepo={selectedRepo}
        onSelectRepo={handleSelectRepo}
        connected={connected}
      />
      <Canvas
        nodes={nodes}
        links={links}
        selectedId={selectedId}
        onSelect={setSelectedId}
        panToRepo={panToRepo}
        onPanComplete={() => setPanToRepo(null)}
        newIds={newIds}
      />
      <DetailPanel
        job={selectedJob}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
