import { motion } from 'framer-motion';
import { getStatusStyle, getRepoColor } from './colors';
import type { OrbNode } from './types';

interface OrbProps {
  node: OrbNode;
  zoom: number;
  selected: boolean;
  onClick: () => void;
  onHover: (id: string | null) => void;
  hovered: boolean;
  isNew: boolean;
}

const ORB_RADIUS = 36;

function getRepoName(repoUrl?: string): string {
  if (!repoUrl) return 'unknown';
  return repoUrl.split('/').pop() ?? repoUrl;
}

export function Orb({ node, zoom, selected, onClick, onHover, hovered, isNew }: OrbProps) {
  const style = getStatusStyle(node.status);
  const repoName = getRepoName(node.repo_url);
  const repoColor = getRepoColor(repoName);
  const label = (node.title || node.task || node.id).slice(0, 32);
  const showLabel = zoom > 0.45;

  const isRunning = node.status?.toLowerCase() === 'running';

  return (
    <motion.g
      style={{ cursor: 'pointer' }}
      initial={isNew ? { scale: 0, opacity: 0 } : { scale: 1, opacity: style.opacity }}
      animate={{ scale: 1, opacity: style.opacity }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      onClick={onClick}
      onHoverStart={() => onHover(node.id)}
      onHoverEnd={() => onHover(null)}
      transform={`translate(${node.x}, ${node.y})`}
    >
      {/* Glow filter backdrop */}
      <motion.circle
        r={ORB_RADIUS + 14}
        fill={style.glow}
        style={{ filter: 'blur(12px)' }}
        animate={isRunning ? {
          r: [ORB_RADIUS + 14, ORB_RADIUS + 22, ORB_RADIUS + 14],
          opacity: [0.7, 1, 0.7],
        } : { r: ORB_RADIUS + 14, opacity: 0.6 }}
        transition={isRunning ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
      />

      {/* Main orb */}
      <motion.circle
        r={ORB_RADIUS}
        fill={`url(#grad-${node.id})`}
        stroke={selected ? repoColor : 'rgba(255,255,255,0.4)'}
        strokeWidth={selected ? 2.5 : 1}
        animate={isRunning ? {
          scale: [1, 1.08, 1],
        } : { scale: 1 }}
        transition={isRunning ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
      />

      {/* Hover ring */}
      {(hovered || selected) && (
        <circle
          r={ORB_RADIUS + 5}
          fill="none"
          stroke={repoColor}
          strokeWidth={1.5}
          opacity={0.5}
        />
      )}

      {/* Label */}
      {showLabel && (
        <text
          y={ORB_RADIUS + 16}
          textAnchor="middle"
          fontSize={11}
          fill="#6B5E4E"
          fontFamily="DM Sans, system-ui, sans-serif"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {label}
        </text>
      )}

      {/* Status dot */}
      <circle
        cx={ORB_RADIUS - 8}
        cy={-(ORB_RADIUS - 8)}
        r={5}
        fill={style.fill}
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={1}
      />

      {/* Gradient def */}
      <defs>
        <radialGradient id={`grad-${node.id}`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="60%" stopColor={style.fill} stopOpacity="0.8" />
          <stop offset="100%" stopColor={style.fill} stopOpacity="0.4" />
        </radialGradient>
      </defs>
    </motion.g>
  );
}
