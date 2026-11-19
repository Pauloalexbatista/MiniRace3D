import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';

export interface DriverNameplateProps {
  name: string;
  primaryColor: string;
  positionRank?: number;
  isAi?: boolean;
  inPit?: boolean;
  finished?: boolean;
  connected?: boolean;
}

export const DriverNameplateSprite: React.FC<DriverNameplateProps> = React.memo(({
  name,
  primaryColor,
  positionRank,
  isAi = false,
  inPit = false,
  finished = false,
  connected = true,
}) => {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 512, 120);

      // Rounded pill background
      const x = 12;
      const y = 14;
      const w = 488;
      const h = 92;
      const r = 24;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();

      ctx.fillStyle = connected ? 'rgba(9, 13, 24, 0.88)' : 'rgba(51, 20, 25, 0.88)';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = connected ? 'rgba(255, 255, 255, 0.28)' : '#ef4444';
      ctx.stroke();

      // Left team color stripe
      ctx.fillStyle = primaryColor || '#38bdf8';
      ctx.fillRect(28, 30, 14, 60);

      // Rank pill + Name + Status badge
      const rankText = positionRank ? `P${positionRank}` : '--';
      ctx.fillStyle = positionRank === 1 ? '#facc15' : '#38bdf8';
      ctx.font = '900 34px system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(rankText, 56, 61);

      const badge = !connected
        ? 'OFF'
        : finished
        ? 'FIN'
        : inPit
        ? 'BOX'
        : isAi
        ? 'IA'
        : '';

      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 32px system-ui, -apple-system, sans-serif';
      const maxNameChars = badge ? 13 : 16;
      const shortName = name.length > maxNameChars ? `${name.slice(0, maxNameChars - 1)}…` : name;
      ctx.fillText(shortName, 132, 61);

      if (badge) {
        const bx = 414;
        const by = 36;
        const bw = 68;
        const bh = 48;
        ctx.fillStyle = !connected
          ? '#ef4444'
          : finished
          ? '#10b981'
          : inPit
          ? '#facc15'
          : '#475569';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = inPit ? '#090d16' : '#ffffff';
        ctx.font = '900 24px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(badge, bx + bw * 0.5, 61);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [name, primaryColor, positionRank, isAi, inPit, finished, connected]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  return (
    <sprite position={[0, 2.85, 0]} scale={[5.8, 1.35, 1]}>
      <spriteMaterial map={texture} transparent depthTest={true} depthWrite={false} />
    </sprite>
  );
});
