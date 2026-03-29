import { useState, useRef, useEffect, useMemo } from 'react';
import { useWebSocket } from './useWebSocket';
import { useCanvas } from './useCanvas';
import { Sidebar } from './Sidebar';
import { Canvas } from './Canvas';
import { DetailPanel } from './DetailPanel';
import type { OrbNode } from './types';

const MAX_DISPLAY_JOBS = 300;

export default function App() {
  const { jobs, connected } = useWebSocket();

  // Limit to most recent 300 jobs for performance
  const displayJobs = useMemo(() => {
    if (jobs.length <= MAX_DISPLAY_JOBS) return jobs;
    return [...jobs]
      .sort((a, b) => (b.startedAt || b.created_at || '').localeCompare(a.startedAt || a.created_at || ''))
      .slice(0, MAX_DISPLAY_JOBS);
  }, [jobs]);

  const { nodes } = useCanvas(displayJobs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [panToRepo, setPanToRepo] = useState<string | null>(null);
  const prevJobIds = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

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

  const selectedJob = useMemo<OrbNode | null>(() => {
    if (!selectedId) return null;
    return nodes.find(n => n.id === selectedId) ?? null;
  }, [selectedId, nodes]);

  const handleSelectRepo = (repo: string | null) => {
    setSelectedRepo(repo);
    if (repo) setPanToRepo(repo);
  };

  return (
    <div style={{ background: '#F5F0E8', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        jobs={jobs}
        displayCount={displayJobs.length}
        selectedRepo={selectedRepo}
        onSelectRepo={handleSelectRepo}
        connected={connected}
      />
      <Canvas
        nodes={nodes}
        jobs={displayJobs}
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
