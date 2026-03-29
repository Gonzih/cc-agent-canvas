#!/usr/bin/env node
/**
 * cc-agent-canvas server
 *
 * Redis keys (same schema as cc-agent-ui v1):
 *   cca:jobs:{namespace}      → Redis SET of job IDs
 *   cca:job:{UUID}            → Redis STRING (JSON) — job metadata
 *   cca:job:{UUID}:output     → Redis LIST — log lines
 *   cca:events                → Redis pub/sub channel for live updates
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createClient } from 'redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.CC_AGENT_CANVAS_PORT || process.env.PORT || '7702', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JOBS_DIR = path.join(os.homedir(), '.cc-agent', 'jobs');
const DIST_DIR = path.join(__dirname, 'dist');
const TAIL_LINES = 20;

// ── Redis ─────────────────────────────────────────────────────────────────
const redis = createClient({ url: REDIS_URL });
const redisSub = redis.duplicate();
redis.on('error', e => console.error('[redis]', e.message));
redisSub.on('error', e => console.error('[redis-sub]', e.message));
await redis.connect();
await redisSub.connect();
console.log(`[redis] connected to ${REDIS_URL}`);

// ── State ─────────────────────────────────────────────────────────────────
const clients = new Set();
const outputLengths = {};

// ── Helpers ───────────────────────────────────────────────────────────────
function broadcast(evt) {
  const msg = JSON.stringify(evt);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function parseJob(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function getNamespaces() {
  const keys = await redis.keys('cca:jobs:*');
  return keys
    .filter(k => !k.includes(':index'))
    .map(k => k.replace('cca:jobs:', ''));
}

async function getJobIds(namespace) {
  return redis.sMembers(`cca:jobs:${namespace}`);
}

async function fetchJob(id) {
  const raw = await redis.get(`cca:job:${id}`);
  const job = parseJob(raw);
  if (job) {
    job.id = job.id || id;
    job.repo_url = job.repo_url || job.repoUrl || '';
  }
  return job;
}

async function fetchJobs(ids) {
  if (!ids.length) return [];
  const pipeline = redis.multi();
  for (const id of ids) pipeline.get(`cca:job:${id}`);
  const results = await pipeline.exec();
  return results
    .map((raw, i) => {
      const j = parseJob(raw);
      if (j) {
        j.id = j.id || ids[i];
        j.repo_url = j.repo_url || j.repoUrl || '';
      }
      return j;
    })
    .filter(Boolean);
}

async function getOutputTail(id, n = TAIL_LINES) {
  try {
    const len = await redis.lLen(`cca:job:${id}:output`);
    if (len > 0) {
      outputLengths[id] = len;
      const start = Math.max(0, len - n);
      return redis.lRange(`cca:job:${id}:output`, start, -1);
    }
  } catch {}
  try {
    const content = fs.readFileSync(path.join(JOBS_DIR, `${id}.log`), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    outputLengths[id] = lines.length;
    return lines.slice(-n);
  } catch { return []; }
}

async function buildSnapshot() {
  const namespaces = await getNamespaces();
  const allJobs = [];
  for (const ns of namespaces) {
    const ids = await getJobIds(ns);
    const jobs = await fetchJobs(ids);
    for (const j of jobs) {
      j.namespace = j.namespace || ns;
      allJobs.push(j);
    }
  }
  return allJobs;
}

// ── HTTP server ───────────────────────────────────────────────────────────
function serveFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // API: job output
  const outputMatch = req.url?.match(/^\/api\/job\/([^/]+)\/output$/);
  if (outputMatch) {
    const id = outputMatch[1];
    getOutputTail(id, 50).then(lines => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lines));
    }).catch(() => { res.writeHead(500); res.end('[]'); });
    return;
  }

  // API: all jobs snapshot
  if (req.url === '/api/jobs') {
    buildSnapshot().then(jobs => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jobs));
    }).catch(() => { res.writeHead(500); res.end('[]'); });
    return;
  }

  // Static files from dist/
  let urlPath = req.url?.split('?')[0] || '/';
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(DIST_DIR, urlPath);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  if (fs.existsSync(filePath)) {
    serveFile(res, filePath, mime);
  } else {
    // SPA fallback
    serveFile(res, path.join(DIST_DIR, 'index.html'), 'text/html');
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws) => {
  clients.add(ws);
  console.log(`[ws] client connected (total: ${clients.size})`);

  try {
    const jobs = await buildSnapshot();
    ws.send(JSON.stringify({ type: 'snapshot', jobs }));
  } catch (e) {
    console.error('[ws] snapshot error', e);
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (total: ${clients.size})`);
  });

  ws.on('error', (e) => {
    console.error('[ws] error', e.message);
    clients.delete(ws);
  });
});

// ── Redis pub/sub ─────────────────────────────────────────────────────────
await redisSub.subscribe('cca:events', async (message) => {
  let event;
  try { event = JSON.parse(message); } catch { return; }

  // Re-fetch the updated job and broadcast
  if (event.job_id || event.id) {
    const id = event.job_id || event.id;
    try {
      const job = await fetchJob(id);
      if (job) {
        broadcast({ type: 'job_update', job });
      }
    } catch (e) {
      console.error('[redis-sub] fetch error', e.message);
    }
  }

  // Also broadcast raw event for any other consumers
  broadcast({ type: 'event', event });
});

console.log(`[cc-agent-canvas] listening on http://0.0.0.0:${PORT}`);
server.listen(PORT);
