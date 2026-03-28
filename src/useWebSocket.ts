import { useEffect, useRef, useState, useCallback } from 'react';
import type { Job } from './types';

type WsMsg =
  | { type: 'snapshot'; jobs: Job[] }
  | { type: 'job_update'; job: Job }
  | { type: 'event'; event: unknown };

export function useWebSocket() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (e) => {
      let msg: WsMsg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'snapshot') {
        setJobs(msg.jobs);
      } else if (msg.type === 'job_update') {
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === msg.job.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...msg.job };
            return next;
          }
          return [...prev, msg.job];
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { jobs, connected };
}
