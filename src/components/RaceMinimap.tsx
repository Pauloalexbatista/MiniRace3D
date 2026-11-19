import React, { useEffect, useMemo, useRef } from 'react';
import type { RoadBranch, SplineNode } from '../tracks';

export interface MinimapDriverDot {
  id: string;
  x: number;
  z: number;
  color: string;
  isMe: boolean;
  isAi: boolean;
  connected: boolean;
  finished: boolean;
  position: number;
}

export interface RaceMinimapProps {
  spline: SplineNode[];
  isClosed: boolean;
  branches?: RoadBranch[];
  pitSpline?: SplineNode[];
  dotsRef: React.MutableRefObject<MinimapDriverDot[]>;
  circuitName?: string;
}

const WIDTH = 220;
const HEIGHT = 175;
const PADDING = 18;

export const RaceMinimap: React.FC<RaceMinimapProps> = React.memo(({
  spline,
  isClosed,
  branches,
  pitSpline,
  dotsRef,
  circuitName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const proj = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    const consider = (x: number, z: number) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    };

    for (const p of spline) consider(p.x, p.y);
    if (branches) {
      for (const b of branches) {
        for (const p of b.points || []) consider(p.x, p.y);
      }
    }
    if (pitSpline) {
      for (const p of pitSpline) consider(p.x, p.y);
    }

    if (!Number.isFinite(minX)) {
      minX = -100;
      maxX = 100;
      minZ = -100;
      maxZ = 100;
    }

    const spanX = Math.max(20, maxX - minX);
    const spanZ = Math.max(20, maxZ - minZ);
    const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const toPx = (wx: number, wz: number): [number, number] => [
      WIDTH * 0.5 + (wx - cx) * scale,
      HEIGHT * 0.5 + (wz - cz) * scale,
    ];

    return { toPx };
  }, [spline, branches, pitSpline]);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, WIDTH, HEIGHT);

          // Draw pit / branch roads first
          const drawPath = (pts: SplineNode[], closed: boolean, stroke: string, lineWidth: number) => {
            if (!pts || pts.length < 2) return;
            ctx.beginPath();
            const [x0, y0] = proj.toPx(pts[0].x, pts[0].y);
            ctx.moveTo(x0, y0);
            for (let i = 1; i < pts.length; i++) {
              const [px, py] = proj.toPx(pts[i].x, pts[i].y);
              ctx.lineTo(px, py);
            }
            if (closed) ctx.closePath();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
          };

          if (branches) {
            for (const b of branches) {
              drawPath(b.points, false, 'rgba(250, 204, 21, 0.5)', 3);
            }
          }
          if (pitSpline && pitSpline.length >= 2) {
            drawPath(pitSpline, false, 'rgba(250, 204, 21, 0.55)', 3);
          }

          // Main track outer border + asphalt core
          drawPath(spline, isClosed, 'rgba(148, 163, 184, 0.45)', 7.5);
          drawPath(spline, isClosed, '#334155', 4.5);

          // Start / finish line marker at spline[0]
          if (spline.length >= 2) {
            const p0 = spline[0];
            const p1 = spline[1];
            const dx = p1.x - p0.x;
            const dz = p1.y - p0.y;
            const len = Math.hypot(dx, dz) || 1;
            const nx = -dz / len;
            const nz = dx / len;
            const [sx0, sy0] = proj.toPx(p0.x - nx * 12, p0.y - nz * 12);
            const [sx1, sy1] = proj.toPx(p0.x + nx * 12, p0.y + nz * 12);
            ctx.beginPath();
            ctx.moveTo(sx0, sy0);
            ctx.lineTo(sx1, sy1);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          // Draw AI & remote drivers first, then local player on top
          const dots = dotsRef.current || [];
          const sortedDots = [...dots].sort((a, b) => (a.isMe === b.isMe ? 0 : a.isMe ? 1 : -1));
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);

          for (const d of sortedDots) {
            const [px, py] = proj.toPx(d.x, d.z);
            if (d.isMe) {
              ctx.beginPath();
              ctx.arc(px, py, 7 + pulse * 3, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
              ctx.lineWidth = 1.6;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(px, py, 5.2, 0, Math.PI * 2);
              ctx.fillStyle = d.color || '#e11d48';
              ctx.fill();
              ctx.lineWidth = 2;
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(px, py, d.isAi ? 3.4 : 4.2, 0, Math.PI * 2);
              ctx.fillStyle = d.connected ? d.color || '#38bdf8' : '#64748b';
              ctx.fill();
              ctx.lineWidth = 1.2;
              ctx.strokeStyle = d.finished ? '#10b981' : '#020617';
              ctx.stroke();
            }
          }
        }
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(rafId);
  }, [proj, spline, isClosed, branches, pitSpline, dotsRef]);

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: 20,
      background: 'rgba(15, 23, 42, 0.90)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.14)',
      borderRadius: 16,
      padding: '8px 10px 6px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
      zIndex: 40,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
        padding: '0 4px',
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 900, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          🗺️ {circuitName || 'RADAR PISTA'}
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#38bdf8' }}>AO VIVO</span>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ display: 'block' }} />
    </div>
  );
});
