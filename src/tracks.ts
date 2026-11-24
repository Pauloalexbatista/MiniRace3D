// RAW_TRACKS definido estaticamente
import { interpZones } from './trackCorridor';

export interface RoadBranch {
  id: string;
  name?: string;
  points: SplineNode[];
}

export interface SplineNode {
  x: number;
  y: number; // 2D Y (maps to 3D Z depth in Three.js)
  z: number; // 3D Height / Elevation (maps to 3D Y up in Three.js)
  width: number;
  nodeIndex?: number;
  linkedMainNodeIndex?: number; // Índice exato do nó na pista principal ao qual está cravado
  distFromStart?: number;
  banking?: number; // Roll angle in degrees or radians
  isTight?: boolean;
  isExtendedTight?: boolean;
  isApexTight?: boolean;
  isTunnel?: boolean;
  isPitBox?: boolean;
  isAttackZone?: boolean;
  isChargeZone?: boolean;
  maxWallRadius?: number;
  shoulderWidth?: number;
  whiteLineWidth?: number;
  curbYellowWidth?: number;
  curbRedWidth?: number;
  grassWidth?: number;
  sandWidth?: number;
  gravelWidth?: number;
  wallThickness?: number;
  // Valores específicos por lado (L = esquerda, R = direita). Se ausentes usa o valor comum.
  whiteLineWidthL?: number; whiteLineWidthR?: number;
  curbYellowWidthL?: number; curbYellowWidthR?: number;
  curbRedWidthL?: number; curbRedWidthR?: number;
  grassWidthL?: number; grassWidthR?: number;
  sandWidthL?: number; sandWidthR?: number;
  gravelWidthL?: number; gravelWidthR?: number;
  wallThicknessL?: number; wallThicknessR?: number;
  // Cores personalizadas por ponto e por lado
  asphaltColor?: string;
  whiteLineColor?: string;
  whiteLineColorL?: string;
  whiteLineColorR?: string;
  curbYellowColor?: string;
  curbYellowColorL?: string;
  curbYellowColorR?: string;
  curbRedColor?: string;
  curbRedColorL?: string;
  curbRedColorR?: string;
  grassColor?: string;
  grassColorL?: string;
  grassColorR?: string;
  sandColor?: string;
  sandColorL?: string;
  sandColorR?: string;
  gravelColor?: string;
  gravelColorL?: string;
  gravelColorR?: string;
  wallColor?: string;
  wallColorL?: string;
  wallColorR?: string;
}

export type SprayCanType = 'mountain' | 'forest' | 'city' | 'grandstand' | 'pitbox' | 'desert' | 'water' | 'eraser';

export interface SceneryPatch {
  id: string;
  type: Exclude<SprayCanType, 'eraser'>;
  x: number;
  z: number;
  radius: number;
  intensity: number;
  seed: number;
}

export interface SavedCircuit {
  id: string;
  name: string;
  fileName?: string;
  controlPoints: SplineNode[];
  customPitNodes?: SplineNode[] | null;
  branches?: RoadBranch[];
  sceneryPatches?: SceneryPatch[];
  isClosed: boolean;
  mapImageUrl?: string | null;
  mapSize?: number;
  mapOffsetX?: number;
  mapOffsetZ?: number;
  mapRotation?: number;
  trackThemeId?: 'f1' | 'rally' | 'monaco';
  savedAt: number;
}

export interface TrackDef {
  id: string;
  name: string;
  svg_data: string;
  pit_svg_data?: string;
  controlPoints: SplineNode[];
  spline: SplineNode[];
  totalLength: number;
  elevationMin: number;
  elevationMax: number;
}

export function computeSpline(
  nodes: SplineNode[],
  isClosed = true,
  pStartTangent?: SplineNode,
  pEndTangent?: SplineNode
): SplineNode[] {
  if (nodes.length < 2) return nodes;

  const spline: SplineNode[] = [];
  const len = nodes.length;
  let runningDist = 0;
  const numSegments = isClosed ? len : len - 1;

  // --- Elevação suave (PCHIP monótono): sem overshoot, sem dobras, declive contínuo ---
  const zH: number[] = [];
  const zD: number[] = [];
  for (let k = 0; k < len; k++) {
    const a = nodes[k];
    const b = nodes[(k + 1) % len];
    const h = Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y));
    zH.push(h);
    zD.push(((b.z ?? 0) - (a.z ?? 0)) / h);
  }
  const zTan: number[] = [];
  for (let k = 0; k < len; k++) {
    const hasPrev = isClosed || k > 0;
    const hasNext = isClosed || k < len - 1;
    const kp = (k - 1 + len) % len;
    if (!hasPrev) { zTan.push(zD[0]); continue; }
    if (!hasNext) { zTan.push(zD[Math.max(0, len - 2)]); continue; }
    const d0 = zD[kp], d1 = zD[k];
    const h0 = zH[kp], h1 = zH[k];
    if (d0 * d1 <= 0) { zTan.push(0); continue; }
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    zTan.push((w1 + w2) / (w1 / d0 + w2 / d1));
  }

  let totalControlDist = 0;
  for (let i = 0; i < numSegments; i++) {
    const a = nodes[i];
    const b = isClosed ? nodes[(i + 1) % len] : nodes[i + 1];
    totalControlDist += Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
  }
  const MAX_SPLINE_SAMPLES = 3500;
  const stepSpacing = Math.max(4, totalControlDist / MAX_SPLINE_SAMPLES);

  for (let i = 0; i < numSegments; i++) {
    const p1 = nodes[i];
    const p2 = isClosed ? nodes[(i + 1) % len] : nodes[i + 1];
    const p0: SplineNode = isClosed
      ? nodes[(i - 1 + len) % len]
      : i === 0
      ? pStartTangent ?? { ...p1, x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y }
      : nodes[i - 1];
    const p3: SplineNode = isClosed
      ? nodes[(i + 2) % len]
      : i === numSegments - 1
      ? pEndTangent ?? { ...p2, x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y }
      : nodes[i + 2];

    // 3D Distance between control points
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = (p2.z ?? 0) - (p1.z ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Centripetal Catmull-Rom (alpha = 0.5) knot intervals prevent loops/overshoots near short segments
    const dt01 = Math.pow(Math.max(1e-4, Math.hypot(p1.x - p0.x, p1.y - p0.y)), 0.5);
    const dt12 = Math.pow(Math.max(1e-4, Math.hypot(p2.x - p1.x, p2.y - p1.y)), 0.5);
    const dt23 = Math.pow(Math.max(1e-4, Math.hypot(p3.x - p2.x, p3.y - p2.y)), 0.5);
    const kt0 = 0;
    const kt1 = kt0 + dt01;
    const kt2 = kt1 + dt12;
    const kt3 = kt2 + dt23;
    const inv01 = 1 / Math.max(1e-8, kt1 - kt0);
    const inv12 = 1 / Math.max(1e-8, kt2 - kt1);
    const inv23 = 1 / Math.max(1e-8, kt3 - kt2);
    const inv02 = 1 / Math.max(1e-8, kt2 - kt0);
    const inv13 = 1 / Math.max(1e-8, kt3 - kt1);

    // Smooth step sampling ~4 units per sample (capped overall via stepSpacing for huge tracks)
    const steps = Math.max(6, Math.floor(dist / stepSpacing));

    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      const u = kt1 + t * (kt2 - kt1);
      const w01 = (u - kt0) * inv01;
      const w12 = (u - kt1) * inv12;
      const w23 = (u - kt2) * inv23;
      const w02 = (u - kt0) * inv02;
      const w13 = (u - kt1) * inv13;

      const a1x = p0.x + (p1.x - p0.x) * w01;
      const a1y = p0.y + (p1.y - p0.y) * w01;
      const a2x = p1.x + (p2.x - p1.x) * w12;
      const a2y = p1.y + (p2.y - p1.y) * w12;
      const a3x = p2.x + (p3.x - p2.x) * w23;
      const a3y = p2.y + (p3.y - p2.y) * w23;

      const b1x = a1x + (a2x - a1x) * w02;
      const b1y = a1y + (a2y - a1y) * w02;
      const b2x = a2x + (a3x - a2x) * w13;
      const b2y = a2y + (a3y - a2y) * w13;

      const x = b1x + (b2x - b1x) * w12;
      const y = b1y + (b2y - b1y) * w12;

      const zh = zH[i];
      const zA = p1.z ?? 0;
      const zB = p2.z ?? 0;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const z = h00 * zA + h10 * zh * zTan[i] + h01 * zB + h11 * zh * zTan[(i + 1) % len];

      const width = p1.width + (p2.width - p1.width) * t;
      const wl1 = p1.whiteLineWidth ?? 0.4;
      const wl2 = p2.whiteLineWidth ?? 0.4;
      const whiteLineWidth = wl1 + (wl2 - wl1) * t;

      const cy1 = p1.curbYellowWidth ?? 0.6;
      const cy2 = p2.curbYellowWidth ?? 0.6;
      const curbYellowWidth = cy1 + (cy2 - cy1) * t;

      const cr1 = p1.curbRedWidth ?? 0.6;
      const cr2 = p2.curbRedWidth ?? 0.6;
      const curbRedWidth = cr1 + (cr2 - cr1) * t;

      const gr1 = p1.grassWidth ?? 2.0;
      const gr2 = p2.grassWidth ?? 2.0;
      const grassWidth = gr1 + (gr2 - gr1) * t;

      const sa1 = p1.sandWidth ?? 1.5;
      const sa2 = p2.sandWidth ?? 1.5;
      const sandWidth = sa1 + (sa2 - sa1) * t;

      const gv1 = p1.gravelWidth ?? 2.0;
      const gv2 = p2.gravelWidth ?? 2.0;
      const gravelWidth = gv1 + (gv2 - gv1) * t;

      const wt1 = p1.wallThickness ?? 0.8;
      const wt2 = p2.wallThickness ?? 0.8;
      const wallThickness = wt1 + (wt2 - wt1) * t;

      const defaultBermas = whiteLineWidth + curbYellowWidth + curbRedWidth + grassWidth + sandWidth + gravelWidth;
      const sh1 = p1.shoulderWidth ?? defaultBermas;
      const sh2 = p2.shoulderWidth ?? defaultBermas;
      const shoulderWidth = Math.max(defaultBermas, sh1 + (sh2 - sh1) * t);

      const b1 = p1.banking ?? 0;
      const b2 = p2.banking ?? 0;
      const banking = b1 + (b2 - b1) * t;

      const isTunnel = Boolean(
        (p1.isTunnel && p2.isTunnel) ||
        (p1.isTunnel && t <= 0.5) ||
        (p2.isTunnel && t >= 0.5)
      );

      if (spline.length > 0) {
        const last = spline[spline.length - 1];
        const segDist = Math.hypot(x - last.x, y - last.y, z - last.z);
        runningDist += segDist;
      }

      spline.push({
        x,
        y,
        z,
        width,
        shoulderWidth,
        whiteLineWidth,
        curbYellowWidth,
        curbRedWidth,
        grassWidth,
        sandWidth,
        gravelWidth,
        wallThickness,
        banking,
        isTunnel,
        ...interpZones(p1, p2, t),
        nodeIndex: i,
        distFromStart: runningDist
      });
    }
  }

  // Ensure open spline terminates exactly on the final node
  if (!isClosed && nodes.length > 0) {
    const lastNode = nodes[nodes.length - 1];
    const lastSpline = spline[spline.length - 1];
    if (lastSpline && Math.hypot(lastNode.x - lastSpline.x, lastNode.y - lastSpline.y) > 0.05) {
      runningDist += Math.hypot(lastNode.x - lastSpline.x, lastNode.y - lastSpline.y, (lastNode.z ?? 0) - (lastSpline.z ?? 0));
      spline.push({
        x: lastNode.x,
        y: lastNode.y,
        z: lastNode.z ?? 0,
        width: lastNode.width,
        shoulderWidth: lastNode.shoulderWidth ?? 7.1,
        whiteLineWidth: lastNode.whiteLineWidth ?? 0.4,
        curbYellowWidth: lastNode.curbYellowWidth ?? 0.6,
        curbRedWidth: lastNode.curbRedWidth ?? 0.6,
        grassWidth: lastNode.grassWidth ?? 2.0,
        sandWidth: lastNode.sandWidth ?? 1.5,
        gravelWidth: lastNode.gravelWidth ?? 2.0,
        wallThickness: lastNode.wallThickness ?? 0.8,
        banking: lastNode.banking ?? 0,
        isTunnel: Boolean(lastNode.isTunnel),
        ...interpZones(lastNode, lastNode, 0),
        nodeIndex: len - 1,
        distFromStart: runningDist
      });
    }
  }

  // Suavização longitudinal progressiva da elevação Z (evita degraus/quebras bruscas de inclinação em curvas apertadas)
  const splineLen = spline.length;
  if (splineLen > 8) {
    for (let pass = 0; pass < 10; pass++) {
      const nextZ = new Array<number>(splineLen);
      for (let i = 0; i < splineLen; i++) {
        if (!isClosed && (i === 0 || i === splineLen - 1)) {
          nextZ[i] = spline[i].z ?? 0;
          continue;
        }
        const prev2 = spline[isClosed ? (i - 2 + splineLen) % splineLen : Math.max(0, i - 2)].z ?? 0;
        const prev1 = spline[isClosed ? (i - 1 + splineLen) % splineLen : Math.max(0, i - 1)].z ?? 0;
        const curr = spline[i].z ?? 0;
        const next1 = spline[isClosed ? (i + 1) % splineLen : Math.min(splineLen - 1, i + 1)].z ?? 0;
        const next2 = spline[isClosed ? (i + 2) % splineLen : Math.min(splineLen - 1, i + 2)].z ?? 0;
        nextZ[i] = 0.1 * prev2 + 0.225 * prev1 + 0.35 * curr + 0.225 * next1 + 0.1 * next2;
      }
      for (let i = 0; i < splineLen; i++) {
        spline[i].z = nextZ[i];
      }
    }
  }

  // MiniF1 Mathematical Curve & Kerb detection
  if (splineLen > 4) {
    for (let i = 0; i < splineLen; i++) {
      const prev = isClosed ? spline[(i - 1 + splineLen) % splineLen] : spline[Math.max(0, i - 1)];
      const curr = spline[i];
      const next = isClosed ? spline[(i + 1) % splineLen] : spline[Math.min(splineLen - 1, i + 1)];

      const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      // When angular turn exceeds threshold per segment
      if (Math.abs(diff) > 0.02) {
        spline[i].isTight = true;
      }
    }

    const flagZones = (range: number, flagProp: 'isApexTight' | 'isExtendedTight') => {
      let lastTightDist = -10000;
      for (let i = 0; i < splineLen; i++) {
        const d = spline[i].distFromStart || 0;
        if (spline[i].isTight) lastTightDist = d;
        if (d - lastTightDist <= range) spline[i][flagProp] = true;
      }
      lastTightDist = 1000000;
      for (let i = splineLen - 1; i >= 0; i--) {
        const d = spline[i].distFromStart || 0;
        if (spline[i].isTight) lastTightDist = d;
        if (lastTightDist - d <= range) spline[i][flagProp] = true;
      }

      if (isClosed && splineLen > 10) {
        const totalLen = spline[splineLen - 1].distFromStart || 0;
        lastTightDist = -10000;
        for (let i = splineLen - 1; i >= 0; i--) {
          if (spline[i].isTight) {
            lastTightDist = (spline[i].distFromStart || 0) - totalLen;
            break;
          }
        }
        for (let i = 0; i < splineLen; i++) {
          const d = spline[i].distFromStart || 0;
          if (d - lastTightDist <= range) spline[i][flagProp] = true;
        }

        lastTightDist = 1000000;
        for (let i = 0; i < splineLen; i++) {
          if (spline[i].isTight) {
            lastTightDist = (spline[i].distFromStart || 0) + totalLen;
            break;
          }
        }
        for (let i = splineLen - 1; i >= 0; i--) {
          const d = spline[i].distFromStart || 0;
          if (lastTightDist - d <= range) spline[i][flagProp] = true;
        }
      }
    };

    // 1: Zonas Amarelas (Faixa Amarela 45m antes e depois da curva)
    flagZones(45, 'isExtendedTight');

    // 2: Zonas de Apex Crítico (Faixa Vermelha 15m no coração da curva)
    flagZones(15, 'isApexTight');
  }

  return spline;
}

export function parseStudioControlPoints(
  d: string,
  scale: number = 0.8,
  width: number = 18,
  isClosed: boolean = true
): SplineNode[] {
  const regex = /([ML])\s*([0-9\.-]+),([0-9\.-]+)/g;
  const rawPoints: { x: number; y: number }[] = [];

  let match;
  while ((match = regex.exec(d)) !== null) {
    rawPoints.push({
      x: parseFloat(match[2]),
      y: parseFloat(match[3])
    });
  }

  if (rawPoints.length < 2) return [];

  if (isClosed && rawPoints.length > 2) {
    const first = rawPoints[0];
    const last = rawPoints[rawPoints.length - 1];
    const distSq = (last.x - first.x) ** 2 + (last.y - first.y) ** 2;
    if (distSq < 900) {
      rawPoints.pop();
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  rawPoints.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return rawPoints.map((p, idx) => ({
    x: (p.x - cx) * scale,
    y: (p.y - cy) * scale,
    z: 0,
    width,
    nodeIndex: idx
  }));
}

export function applyElevationProfile(
  controlPoints: SplineNode[],
  type: 'flat' | 'hills' | 'spa_style' | 'rollercoaster' | 'custom' = 'hills',
  amplitude: number = 12
): SplineNode[] {
  const n = controlPoints.length;
  if (n < 2) return controlPoints;

  return controlPoints.map((cp, i) => {
    const t = i / n;
    let z = 0;
    let banking = 0;

    if (type === 'flat') {
      z = 0;
    } else if (type === 'hills') {
      z = Math.sin(t * Math.PI * 2) * (amplitude * 0.8) +
          Math.sin(t * Math.PI * 4) * (amplitude * 0.4);
    } else if (type === 'spa_style') {
      if (t < 0.25) {
        z = (t / 0.25) * amplitude * 1.5;
      } else if (t < 0.6) {
        z = amplitude * 1.5 - ((t - 0.25) / 0.35) * amplitude * 1.8;
      } else {
        const back = (t - 0.6) / 0.4;
        z = -amplitude * 0.3 + back * amplitude * 0.3;
      }
    } else if (type === 'rollercoaster') {
      z = Math.sin(t * Math.PI * 6) * amplitude +
          Math.cos(t * Math.PI * 2) * (amplitude * 0.6);
      banking = Math.sin(t * Math.PI * 6) * 0.12;
    }

    return {
      ...cp,
      z: Math.round(z * 10) / 10,
      banking
    };
  });
}

export function buildTrack(
  trackRaw: { id: string; name: string; svg_data: string; pit_svg_data?: string },
  elevationType: 'flat' | 'hills' | 'spa_style' | 'rollercoaster' = 'hills',
  elevationAmplitude: number = 10,
  scale: number = 0.9,
  width: number = 18
): TrackDef {
  const baseCP = parseStudioControlPoints(trackRaw.svg_data, scale, width, true);
  const cpsWithElevation = applyElevationProfile(baseCP, elevationType, elevationAmplitude);
  const spline = computeSpline(cpsWithElevation, true);

  let zMin = Infinity;
  let zMax = -Infinity;
  spline.forEach(p => {
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  });

  const totalLength = spline.length > 0 ? (spline[spline.length - 1].distFromStart ?? 0) : 0;

  return {
    id: trackRaw.id,
    name: trackRaw.name,
    svg_data: trackRaw.svg_data,
    pit_svg_data: trackRaw.pit_svg_data,
    controlPoints: cpsWithElevation,
    spline,
    totalLength: Math.round(totalLength),
    elevationMin: isFinite(zMin) ? Math.round(zMin * 10) / 10 : 0,
    elevationMax: isFinite(zMax) ? Math.round(zMax * 10) / 10 : 0
  };
}

export const RAW_TRACKS: { id: string; name: string; svg_data: string; pit_svg_data?: string }[] = [
  {
    id: 'nova_pista',
    name: 'NOVA PISTA (DO ZERO)',
    svg_data: ''
  }
];

export function parsePitControlPoints(
  d: string,
  scale: number = 0.9,
  width: number = 11,
  svgDataMain: string
): SplineNode[] {
  const regexBounds = /([ML])\s*([0-9\.-]+),([0-9\.-]+)/g;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let mb;
  while ((mb = regexBounds.exec(svgDataMain)) !== null) {
    const x = parseFloat(mb[2]);
    const y = parseFloat(mb[3]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const regexPit = /([ML])\s*([0-9\.-]+),([0-9\.-]+)/g;
  const raw: { x: number; y: number }[] = [];
  let mp;
  while ((mp = regexPit.exec(d)) !== null) {
    raw.push({
      x: parseFloat(mp[2]),
      y: parseFloat(mp[3])
    });
  }
  if (raw.length < 2) return [];

  return raw.map((p, idx) => ({
    x: (p.x - cx) * scale,
    y: (p.y - cy) * scale,
    z: 0,
    width,
    nodeIndex: idx
  }));
}

export function fuseAndComputePitLane(
  mainCP: SplineNode[],
  pitCP: SplineNode[],
  mainSpline?: SplineNode[]
): SplineNode[] {
  if (pitCP.length < 2) return [];
  if (mainCP.length < 3 && (!mainSpline || mainSpline.length < 3)) {
    return computeSpline(pitCP, false);
  }

  // If pitCP is already a finely-sampled generated spline (> 15 nodes), compute spline directly
  if (pitCP.length >= 15) {
    return computeSpline(pitCP, false);
  }

  // Use dense mainSpline if provided for millimeter-precise track reference, otherwise fallback to mainCP
  const trackRef = (mainSpline && mainSpline.length >= 10) ? mainSpline : mainCP;
  const M = trackRef.length;

  const rawStart = pitCP[0];
  const rawEnd = pitCP[pitCP.length - 1];

  // 1. Find closest track point to Entry (rawStart)
  let startIdx = 0;
  let minDStart = Infinity;
  for (let i = 0; i < M; i++) {
    const dS = Math.hypot(trackRef[i].x - rawStart.x, trackRef[i].y - rawStart.y);
    if (dS < minDStart) {
      minDStart = dS;
      startIdx = i;
    }
  }

  // 2. Find closest track point to Exit (rawEnd)
  let endIdx = 0;
  let minDEnd = Infinity;
  for (let i = 0; i < M; i++) {
    const dE = Math.hypot(trackRef[i].x - rawEnd.x, trackRef[i].y - rawEnd.y);
    if (dE < minDEnd) {
      minDEnd = dE;
      endIdx = i;
    }
  }

  const pStartRef = trackRef[startIdx];
  const pStartPrev = trackRef[(startIdx - 1 + M) % M];
  const pStartNext = trackRef[(startIdx + 1) % M];

  // Start tangent & normal
  const sDx = pStartNext.x - pStartPrev.x;
  const sDy = pStartNext.y - pStartPrev.y;
  const sLen = Math.hypot(sDx, sDy) || 1;
  const sTx = sDx / sLen;
  const sTy = sDy / sLen;
  const sNx = -sTy;
  const sNy = sTx;

  // Determine side at entry by looking at second pit point (or rawStart)
  const toPitStartX = (pitCP.length > 1 ? pitCP[1].x : rawStart.x) - pStartRef.x;
  const toPitStartY = (pitCP.length > 1 ? pitCP[1].y : rawStart.y) - pStartRef.y;
  const sideSignStart = (toPitStartX * sNx + toPitStartY * sNy) >= 0 ? 1 : -1;

  const halfTrackStart = (pStartRef.width || 18) / 2;
  const pitWidth = 8.5;
  const halfPit = pitWidth / 2;

  // Snapped entry point: along the outer boundary of the track lane
  const pStart: SplineNode = minDStart < 150 ? {
    x: pStartRef.x + sNx * sideSignStart * (halfTrackStart - halfPit * 0.3),
    y: pStartRef.y + sNy * sideSignStart * (halfTrackStart - halfPit * 0.3),
    z: pStartRef.z ?? 0,
    width: pitWidth,
    shoulderWidth: 3.5,
    banking: pStartRef.banking ?? 0
  } : {
    ...rawStart,
    width: pitWidth,
    shoulderWidth: 3.5
  };

  // 3. Exit tangent & normal (computed completely independently of start!)
  const pEndRef = trackRef[endIdx];
  const pEndPrev = trackRef[(endIdx - 1 + M) % M];
  const pEndNext = trackRef[(endIdx + 1) % M];

  const eDx = pEndNext.x - pEndPrev.x;
  const eDy = pEndNext.y - pEndPrev.y;
  const eLen = Math.hypot(eDx, eDy) || 1;
  const eTx = eDx / eLen;
  const eTy = eDy / eLen;
  const eNx = -eTy;
  const eNy = eTx;

  // Determine side at exit by looking at penultimate pit point (or rawEnd)
  const penultimate = pitCP[pitCP.length - 2] || rawEnd;
  const toPitEndX = penultimate.x - pEndRef.x;
  const toPitEndY = penultimate.y - pEndRef.y;
  const sideSignEnd = (toPitEndX * eNx + toPitEndY * eNy) >= 0 ? 1 : -1;

  const halfTrackEnd = (pEndRef.width || 18) / 2;

  // Snapped exit point: along the outer boundary of the track lane
  const pEnd: SplineNode = minDEnd < 150 ? {
    x: pEndRef.x + eNx * sideSignEnd * (halfTrackEnd - halfPit * 0.3),
    y: pEndRef.y + eNy * sideSignEnd * (halfTrackEnd - halfPit * 0.3),
    z: pEndRef.z ?? 0,
    width: pitWidth,
    shoulderWidth: 3.5,
    banking: pEndRef.banking ?? 0
  } : {
    ...rawEnd,
    width: pitWidth,
    shoulderWidth: 3.5
  };

  // Interpolate elevation Z smoothly between intermediate nodes if they don't have explicit Z
  const updatedPit: SplineNode[] = pitCP.map((p, idx) => {
    if (idx === 0) return pStart;
    if (idx === pitCP.length - 1) return pEnd;
    const t = idx / (pitCP.length - 1);
    const interpZ = (pStart.z ?? 0) + ((pEnd.z ?? 0) - (pStart.z ?? 0)) * t;
    return {
      ...p,
      z: p.z !== undefined && p.z !== 0 ? p.z : interpZ,
      width: pitWidth,
      shoulderWidth: 3.5
    };
  });

  // Start & End tangents to ensure smooth branching & merging with zero kinks
  const tangentScale = 40;
  const pStartTangent: SplineNode = {
    x: pStart.x - sTx * tangentScale,
    y: pStart.y - sTy * tangentScale,
    z: pStart.z ?? 0,
    width: pitWidth
  };
  const pEndTangent: SplineNode = {
    x: pEnd.x + eTx * tangentScale,
    y: pEnd.y + eTy * tangentScale,
    z: pEnd.z ?? 0,
    width: pitWidth
  };

  return computeSpline(updatedPit, false, pStartTangent, pEndTangent);
}

export function generatePitLaneFromNodes(
  mainCP: SplineNode[],
  entryIdx: number,
  exitIdx: number,
  offsetDistance: number = 18
): SplineNode[] {
  if (entryIdx === exitIdx || mainCP.length < 3) return [];
  const N = mainCP.length;

  // Collect control point path from entryIdx to exitIdx
  const path: SplineNode[] = [];
  let curr = entryIdx;
  let steps = 0;
  while (curr !== exitIdx && steps < N) {
    path.push(mainCP[curr]);
    curr = (curr + 1) % N;
    steps++;
  }
  path.push(mainCP[exitIdx]);

  if (path.length < 2) return [];

  // Compute smooth spline along this path so normal vectors rotate continuously without kinks
  const smoothTrack = computeSpline(path, false);
  if (smoothTrack.length < 3) return [];

  const M = smoothTrack.length;
  const totalDist = smoothTrack[M - 1].distFromStart || 1;
  const sideSign = Math.sign(offsetDistance) || 1;
  const absOffset = Math.abs(offsetDistance);
  const pitWidth = 8.5;
  const halfPitW = pitWidth / 2;

  // S-Curve deceleration flare (entry) and acceleration merge (exit)
  const uEntry = Math.max(0.12, Math.min(0.25, 45 / totalDist));
  const uExit = Math.max(0.12, Math.min(0.25, 45 / totalDist));

  const pitNodes: SplineNode[] = [];

  for (let k = 0; k < M; k++) {
    const pt = smoothTrack[k];
    const u = (pt.distFromStart || 0) / totalDist;

    // Continuous tangent from smooth neighbors
    const pPrev = smoothTrack[Math.max(0, k - 1)];
    const pNext = smoothTrack[Math.min(M - 1, k + 1)];
    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    const hwMain = (pt.width || 18) / 2;
    const baseOffset = Math.max(2.0, hwMain - halfPitW);

    let smooth = 0;
    if (u < uEntry) {
      const tau = u / uEntry;
      smooth = tau * tau * tau * (tau * (tau * 6 - 15) + 10);
    } else if (u > 1 - uExit) {
      const tau = (1 - u) / uExit;
      smooth = tau * tau * tau * (tau * (tau * 6 - 15) + 10);
    } else {
      smooth = 1.0;
    }

    const latDist = baseOffset + (absOffset - baseOffset) * smooth;

    pitNodes.push({
      x: pt.x + nx * sideSign * latDist,
      y: pt.y + ny * sideSign * latDist,
      z: pt.z,
      width: pitWidth,
      nodeIndex: k,
      shoulderWidth: 3.5
    });
  }

  return pitNodes;
}


/**
 * Calculates the 2D geometric centroid of an array of SplineNodes.
 */
export function computeCentroid2D(nodes: SplineNode[]): { cx: number; cy: number } {
  if (nodes.length === 0) return { cx: 0, cy: 0 };
  let sumX = 0;
  let sumY = 0;
  for (const n of nodes) {
    sumX += n.x;
    sumY += n.y;
  }
  return { cx: sumX / nodes.length, cy: sumY / nodes.length };
}

/**
 * Scales an array of nodes around a specific 2D center by a scaleFactor.
 * Keeps elevation (z), width, shoulderWidth and banking unchanged in physical meters/degrees.
 */
export function scaleNodes2D(
  nodes: SplineNode[],
  cx: number,
  cy: number,
  scaleFactor: number
): SplineNode[] {
  return nodes.map(node => ({
    ...node,
    x: cx + (node.x - cx) * scaleFactor,
    y: cy + (node.y - cy) * scaleFactor
  }));
}

export const MIN_TRACK_LENGTH_KM = 0.2;
export const MAX_TRACK_LENGTH_KM = 30;

/**
 * Parses a km length input string supporting either comma or dot decimal separators.
 */
export function parseTrackLengthKmInput(raw: string): number {
  const trimmed = (raw || '').trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) return NaN;
  const normalized = trimmed.replace(',', '.');
  const val = Number.parseFloat(normalized);
  return Number.isFinite(val) ? val : NaN;
}

/**
 * Derives a clean human-readable circuit name from a file name or uploaded blueprint URL.
 */
export function formatBlueprintDisplayName(source: string): string {
  const trimmed = (source || '').trim();
  if (!trimmed || trimmed.startsWith('data:')) return 'Circuito';
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const segments = withoutQuery.split(/[/\\]/);
  const rawBase = segments[segments.length - 1] || '';
  let decodedBase = rawBase;
  try {
    decodedBase = decodeURIComponent(rawBase);
  } catch {
    decodedBase = rawBase;
  }
  const withoutExt = decodedBase.replace(/\.[^/.]+$/, '');
  const withoutUploadDecorations = withoutExt
    .replace(/^upload_/i, '')
    .replace(/_\d{10,}$/, '');
  const clean = withoutUploadDecorations.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || 'Circuito';
}

/**
 * Computes a fast polyline length estimate from control points (3D Euclidean).
 */
export function estimateControlPointsLength(nodes: SplineNode[], isClosed = true): number {
  if (!nodes || nodes.length < 2) return 0;
  let total = 0;
  const numSegs = isClosed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < numSegs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    total += Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
  }
  return total;
}

/**
 * Rescales control points so that the total track length matches targetLengthMeters.
 */
export function scaleControlPointsToLength(
  nodes: SplineNode[],
  targetLengthMeters: number,
  isClosed = true
): { scaledNodes: SplineNode[]; scaleFactor: number; centroid: { cx: number; cy: number } } {
  if (nodes.length < 2 || targetLengthMeters <= 0) {
    return { scaledNodes: nodes, scaleFactor: 1.0, centroid: computeCentroid2D(nodes) };
  }

  const tempSpline = computeSpline(nodes, isClosed);
  if (tempSpline.length < 2) {
    return { scaledNodes: nodes, scaleFactor: 1.0, centroid: computeCentroid2D(nodes) };
  }

  const currentLength = tempSpline[tempSpline.length - 1]?.distFromStart || 0;
  if (currentLength <= 0) {
    return { scaledNodes: nodes, scaleFactor: 1.0, centroid: computeCentroid2D(nodes) };
  }

  const scaleFactor = targetLengthMeters / currentLength;
  const centroid = computeCentroid2D(nodes);
  const scaledNodes = scaleNodes2D(nodes, centroid.cx, centroid.cy, scaleFactor);

  return { scaledNodes, scaleFactor, centroid };
}

export function createDefaultCircuit(): SplineNode[] {
  const coords = [
    [-180, -120], [-100, -150], [0, -150], [120, -140], [200, -80],
    [220, 0], [180, 80], [120, 140], [40, 160], [-40, 120],
    [-80, 80], [-140, 120], [-200, 100], [-240, 40], [-230, -40], [-200, -90]
  ];
  return coords.map(([x, y], idx) => ({
    x,
    y,
    z: 0,
    width: 16,
    shoulderWidth: 6.5,
    banking: 0,
    nodeIndex: idx
  }));
}

export interface NodeSlopeInfo {
  prevSlopePct: number;
  nextSlopePct: number;
  maxSlopePct: number;
  prevDist: number;
  nextDist: number;
  status: 'ok' | 'steep' | 'wall';
}

/**
 * Computes longitudinal slope grade (%) entering and leaving control point `index`.
 * Real-world reference: F1 <= 15%, Alpine/Rally/Pikes Peak <= 25%, > 25% is wall-like.
 */
export function computeNodeSlopeInfo(
  nodes: SplineNode[],
  index: number,
  isClosed: boolean
): NodeSlopeInfo {
  const N = nodes.length;
  if (N < 2 || index < 0 || index >= N) {
    return { prevSlopePct: 0, nextSlopePct: 0, maxSlopePct: 0, prevDist: 0, nextDist: 0, status: 'ok' };
  }
  const curr = nodes[index];
  const cz = curr.z ?? 0;

  let prevSlopePct = 0;
  let prevDist = 0;
  if (isClosed || index > 0) {
    const prev = nodes[(index - 1 + N) % N];
    prevDist = Math.max(1, Math.hypot(curr.x - prev.x, curr.y - prev.y));
    prevSlopePct = (Math.abs(cz - (prev.z ?? 0)) / prevDist) * 100;
  }

  let nextSlopePct = 0;
  let nextDist = 0;
  if (isClosed || index < N - 1) {
    const next = nodes[(index + 1) % N];
    nextDist = Math.max(1, Math.hypot(next.x - curr.x, next.y - curr.y));
    nextSlopePct = (Math.abs((next.z ?? 0) - cz) / nextDist) * 100;
  }

  const maxSlopePct = Math.max(prevSlopePct, nextSlopePct);
  const status: 'ok' | 'steep' | 'wall' =
    maxSlopePct > 25 ? 'wall' : maxSlopePct > 15 ? 'steep' : 'ok';

  return {
    prevSlopePct: Math.round(prevSlopePct * 10) / 10,
    nextSlopePct: Math.round(nextSlopePct * 10) / 10,
    maxSlopePct: Math.round(maxSlopePct * 10) / 10,
    prevDist: Math.round(prevDist * 10) / 10,
    nextDist: Math.round(nextDist * 10) / 10,
    status,
  };
}

/**
 * Enforces a maximum longitudinal grade (%) across all consecutive control points
 * by smoothly relaxing any cliff-like elevation jumps without flattening valid hills.
 */
export function smoothTrackSlopes(
  nodes: SplineNode[],
  isClosed: boolean,
  maxSlopePct: number = 22
): { nodes: SplineNode[]; adjustedCount: number } {
  const N = nodes.length;
  if (N < 2) return { nodes, adjustedCount: 0 };

  const out = nodes.map(n => ({ ...n, z: n.z ?? 0 }));
  const segCount = isClosed ? N : N - 1;
  const maxRatio = Math.max(0.02, maxSlopePct / 100);
  const touched = new Set<number>();

  for (let pass = 0; pass < 48; pass++) {
    let changed = false;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % N;
      const a = out[i];
      const b = out[j];
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const maxDelta = dist * maxRatio;
      const diff = (b.z ?? 0) - (a.z ?? 0);
      if (Math.abs(diff) > maxDelta + 0.01) {
        const excess = Math.abs(diff) - maxDelta;
        const shift = (excess * 0.5) * Math.sign(diff);
        a.z = (a.z ?? 0) + shift;
        b.z = (b.z ?? 0) - shift;
        touched.add(i);
        touched.add(j);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const n of out) {
    n.z = Math.round((n.z ?? 0) * 10) / 10;
  }
  return { nodes: out, adjustedCount: touched.size };
}

export interface PitStopZonePoint {
  x: number;
  y: number; // 2D Y -> Three.js Z
  z: number; // 3D elevation -> Three.js Y
  width: number;
  dist: number; // 0 .. totalZoneLength
}

export interface PitStopZone {
  id: string;
  pts: PitStopZonePoint[];
  length: number;
  centerX: number;
  centerZ: number; // Three.js Z (node.y)
  centerY: number; // Three.js Y (node.z)
}

/**
 * Extracts a 50m pit-stop repair strip (25m before + 25m after the midpoint)
 * for every pit-lane / branch road present in the circuit.
 */
export function computePitStopZones(
  branches?: RoadBranch[],
  pitSpline?: SplineNode[]
): PitStopZone[] {
  const zones: PitStopZone[] = [];
  const candidates: Array<{ id: string; dense: SplineNode[]; pitBoxNode?: SplineNode }> = [];
  const anyExplicitPitBox = Boolean(branches?.some(b => b.points?.some(p => p.isPitBox)));

  if (branches && branches.length > 0) {
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (!b.points || b.points.length < 2) continue;
      const pitBoxNode = b.points.find(p => p.isPitBox);
      if (anyExplicitPitBox && !pitBoxNode) continue;
      const dense = computeSpline(b.points, false);
      if (dense.length >= 2) {
        candidates.push({ id: b.id || `branch_${i}`, dense, pitBoxNode });
      }
    }
  }
  if (!anyExplicitPitBox && pitSpline && pitSpline.length >= 2) {
    candidates.push({ id: 'pit_spline', dense: pitSpline });
  }

  for (const cand of candidates) {
    const { id, dense, pitBoxNode } = cand;
    const N = dense.length;
    const cumDist = new Float64Array(N);
    cumDist[0] = 0;
    for (let i = 1; i < N; i++) {
      const a = dense[i - 1];
      const b = dense[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
      cumDist[i] = cumDist[i - 1] + seg;
    }

    const totalL = cumDist[N - 1];
    if (totalL < 8) continue;

    let mid = totalL * 0.5;
    if (pitBoxNode) {
      let bestIdx = 0;
      let bestSq = Infinity;
      for (let k = 0; k < N; k++) {
        const dx = dense[k].x - pitBoxNode.x;
        const dy = dense[k].y - pitBoxNode.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestSq) {
          bestSq = dSq;
          bestIdx = k;
        }
      }
      mid = cumDist[bestIdx];
    }

    const desiredLen = Math.min(50, totalL);
    let startD = mid - desiredLen * 0.5;
    let endD = mid + desiredLen * 0.5;
    if (startD < 0) {
      startD = 0;
      endD = desiredLen;
    } else if (endD > totalL) {
      endD = totalL;
      startD = Math.max(0, totalL - desiredLen);
    }
    const zoneLen = endD - startD;
    if (zoneLen < 4) continue;

    const sampleAtDist = (targetD: number): PitStopZonePoint => {
      if (targetD <= 0) {
        const n = dense[0];
        return { x: n.x, y: n.y, z: n.z ?? 0, width: n.width || 8.5, dist: 0 };
      }
      if (targetD >= totalL) {
        const n = dense[N - 1];
        return { x: n.x, y: n.y, z: n.z ?? 0, width: n.width || 8.5, dist: targetD - startD };
      }
      for (let i = 1; i < N; i++) {
        if (cumDist[i] >= targetD) {
          const d0 = cumDist[i - 1];
          const d1 = cumDist[i];
          const span = Math.max(1e-6, d1 - d0);
          const t = Math.max(0, Math.min(1, (targetD - d0) / span));
          const a = dense[i - 1];
          const b = dense[i];
          return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
            width: (a.width || 8.5) + ((b.width || 8.5) - (a.width || 8.5)) * t,
            dist: targetD - startD,
          };
        }
      }
      const last = dense[N - 1];
      return { x: last.x, y: last.y, z: last.z ?? 0, width: last.width || 8.5, dist: targetD - startD };
    };

    const pts: PitStopZonePoint[] = [sampleAtDist(startD)];
    for (let i = 0; i < N; i++) {
      if (cumDist[i] > startD + 0.05 && cumDist[i] < endD - 0.05) {
        const n = dense[i];
        pts.push({
          x: n.x,
          y: n.y,
          z: n.z ?? 0,
          width: n.width || 8.5,
          dist: cumDist[i] - startD,
        });
      }
    }
    pts.push(sampleAtDist(endD));

    const midPt = sampleAtDist(mid);
    zones.push({
      id,
      pts,
      length: zoneLen,
      centerX: midPt.x,
      centerZ: midPt.y,
      centerY: midPt.z,
    });
  }

  return zones;
}

export interface ElectricTrackZone {
  id: string;
  kind: 'attack' | 'charge';
  isAuto: boolean;
  pts: PitStopZonePoint[];
  length: number;
  centerX: number;
  centerZ: number;
  centerY: number;
}

/**
 * Builds Formula E Attack Mode (outer-line activation) and Charge Zone (induction) strips
 * from marked control points, falling back to automatic placements when none are marked.
 */
export function computeElectricTrackZones(
  controlPoints: SplineNode[],
  spline: SplineNode[],
  isClosed: boolean,
  includeAutoFallback: boolean
): ElectricTrackZone[] {
  if (!spline || spline.length < 2) return [];
  const sampler = buildSplineArcSampler(spline, isClosed);
  const totalLen = sampler.totalLen;
  if (totalLen < 60) return [];

  const buildZoneFromArcRange = (
    rawStartS: number,
    rawEndS: number,
    id: string,
    kind: 'attack' | 'charge',
    isAuto: boolean,
    lateralOffsetFrac: number,
    widthFrac: number
  ): ElectricTrackZone | null => {
    let startS = rawStartS;
    let endS = rawEndS;
    if (!isClosed) {
      startS = Math.max(0, Math.min(totalLen, startS));
      endS = Math.max(0, Math.min(totalLen, endS));
    }
    const span = endS - startS;
    if (!Number.isFinite(span) || span < 4) return null;

    const numSteps = Math.max(6, Math.ceil(span / 3.5));
    const pts: PitStopZonePoint[] = [];
    for (let k = 0; k <= numSteps; k++) {
      const dist = (k / numSteps) * span;
      const sp = sampler.sampleAt(startS + dist);
      const roadW = sp.width || 18;
      const lat = -roadW * lateralOffsetFrac;
      pts.push({
        x: sp.x + sp.lx * lat,
        y: sp.z + sp.lz * lat,
        z: sp.y + Math.abs(sp.bankSin) * (roadW * 0.5) - lat * sp.bankSin,
        width: Math.max(3.2, roadW * widthFrac),
        dist,
      });
    }

    const midPt = pts[Math.floor(pts.length / 2)];
    return {
      id,
      kind,
      isAuto,
      pts,
      length: span,
      centerX: midPt.x,
      centerZ: midPt.y,
      centerY: midPt.z,
    };
  };

  const zones: ElectricTrackZone[] = [];

  const collectGroups = (flag: 'isAttackZone' | 'isChargeZone', kind: 'attack' | 'charge') => {
    if (!controlPoints || controlPoints.length < 2) return;
    const groups: number[][] = [];
    let current: number[] = [];
    for (let i = 0; i < controlPoints.length; i++) {
      if (controlPoints[i]?.[flag]) {
        current.push(i);
      } else if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length > 0) groups.push(current);

    if (
      isClosed &&
      groups.length > 1 &&
      groups[0][0] === 0 &&
      groups[groups.length - 1][groups[groups.length - 1].length - 1] === controlPoints.length - 1
    ) {
      const lastGrp = groups.pop()!;
      groups[0] = [...lastGrp, ...groups[0]];
    }

    const lateralFrac = kind === 'attack' ? 0.22 : 0;
    const widthFrac = kind === 'attack' ? 0.38 : 0.52;

    groups.forEach((grp, gIdx) => {
      const firstPt = controlPoints[grp[0]];
      const lastPt = controlPoints[grp[grp.length - 1]];
      const sStart = sampler.nearestS(firstPt.x, firstPt.y);
      const sEnd = sampler.nearestS(lastPt.x, lastPt.y);

      let zone: ElectricTrackZone | null = null;
      if (grp.length === 1) {
        const halfLen = flag === 'isAttackZone' ? 22 : 25;
        zone = buildZoneFromArcRange(
          sStart - halfLen,
          sStart + halfLen,
          `${kind}_manual_${gIdx}`,
          kind,
          false,
          lateralFrac,
          widthFrac
        );
      } else {
        const delta = isClosed
          ? (sEnd - sStart + totalLen) % totalLen
          : Math.max(0, sEnd - sStart);
        const span = Math.max(36, Math.min(totalLen * 0.35, delta + 20));
        zone = buildZoneFromArcRange(
          sStart - 10,
          sStart - 10 + span,
          `${kind}_manual_${gIdx}`,
          kind,
          false,
          lateralFrac,
          widthFrac
        );
      }
      if (zone) zones.push(zone);
    });
  };

  collectGroups('isAttackZone', 'attack');
  collectGroups('isChargeZone', 'charge');

  if (includeAutoFallback && totalLen >= 160) {
    const hasManualAttack = zones.some((z) => z.kind === 'attack');
    const hasManualCharge = zones.some((z) => z.kind === 'charge');
    if (!hasManualAttack) {
      const cAttack = totalLen * 0.34;
      const autoAttack = buildZoneFromArcRange(
        cAttack - 22,
        cAttack + 22,
        'attack_auto_0',
        'attack',
        true,
        0.22,
        0.38
      );
      if (autoAttack) zones.push(autoAttack);
    }
    if (!hasManualCharge) {
      const cCharge = totalLen * 0.72;
      const autoCharge = buildZoneFromArcRange(
        cCharge - 26,
        cCharge + 26,
        'charge_auto_0',
        'charge',
        true,
        0,
        0.52
      );
      if (autoCharge) zones.push(autoCharge);
    }
  }

  return zones;
}

export interface SplineArcSample {
  x: number;
  y: number;
  z: number;
  width: number;
  bankSin: number;
  tx: number;
  tz: number;
  lx: number;
  lz: number;
}

export function buildSplineArcSampler(pts: SplineNode[], closed: boolean) {
  const M = pts?.length ?? 0;
  if (M < 2) {
    return {
      totalLen: 0,
      sampleAt: (_s: number): SplineArcSample => ({
        x: pts?.[0]?.x ?? 0,
        y: pts?.[0]?.z ?? 0,
        z: pts?.[0]?.y ?? 0,
        width: pts?.[0]?.width ?? 18,
        bankSin: 0,
        tx: 0,
        tz: 1,
        lx: 1,
        lz: 0,
      }),
      nearestS: (_px: number, _pz: number) => 0,
    };
  }

  const segCount = closed ? M : M - 1;
  const cum = new Float64Array(segCount + 1);
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % M];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const totalLen = cum[segCount];

  const nodeTx = new Float64Array(M);
  const nodeTz = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const prev = closed ? pts[(i - 1 + M) % M] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % M] : pts[Math.min(M - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.y - prev.y;
    const len = Math.hypot(dx, dz) || 1;
    nodeTx[i] = dx / len;
    nodeTz[i] = dz / len;
  }

  const sampleAt = (rawS: number): SplineArcSample => {
    if (totalLen < 1e-4) {
      const p0 = pts[0];
      return {
        x: p0.x,
        y: p0.z ?? 0,
        z: p0.y,
        width: p0.width || 18,
        bankSin: 0,
        tx: nodeTx[0],
        tz: nodeTz[0],
        lx: nodeTz[0],
        lz: -nodeTx[0],
      };
    }
    const s = closed ? ((rawS % totalLen) + totalLen) % totalLen : Math.max(0, Math.min(totalLen, rawS));
    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const idxA = lo;
    const idxB = (lo + 1) % M;
    const segLen = cum[lo + 1] - cum[lo];
    const u = segLen > 1e-6 ? Math.max(0, Math.min(1, (s - cum[lo]) / segLen)) : 0;

    const a = pts[idxA];
    const b = pts[idxB];
    let tx = nodeTx[idxA] + u * (nodeTx[idxB] - nodeTx[idxA]);
    let tz = nodeTz[idxA] + u * (nodeTz[idxB] - nodeTz[idxA]);
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;

    const bankDeg = (a.banking || 0) + u * ((b.banking || 0) - (a.banking || 0));
    const bankSin = -Math.sin((bankDeg * Math.PI) / 180);

    return {
      x: a.x + u * (b.x - a.x),
      y: (a.z ?? 0) + u * ((b.z ?? 0) - (a.z ?? 0)),
      z: a.y + u * (b.y - a.y),
      width: (a.width || 18) + u * ((b.width || 18) - (a.width || 18)),
      bankSin,
      tx,
      tz,
      // Driver's Left in Three.js Y-up: up(0,1,0) x forward(tx,0,tz) = (tz, 0, -tx)
      lx: tz,
      lz: -tx,
    };
  };

  const nearestS = (px: number, pz: number): number => {
    let bestSq = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < M; i++) {
      const dx = pts[i].x - px;
      const dz = pts[i].y - pz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        bestIdx = i;
      }
    }
    return cum[Math.min(bestIdx, segCount)];
  };

  return { totalLen, sampleAt, nearestS };
}

export interface GridSlotPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sCar: number;
  latOffset: number;
}

export function computeGridSlotPose(
  spline: SplineNode[],
  isClosed: boolean,
  slotIndex = 0
): GridSlotPose {
  if (!spline || spline.length < 2) {
    return { x: 0, y: 0, z: 0, yaw: 0, sCar: 0, latOffset: 0 };
  }
  const sampler = buildSplineArcSampler(spline, isClosed);
  if (sampler.totalLen < 60) {
    const sp = sampler.sampleAt(0);
    return { x: sp.x, y: sp.y, z: sp.z, yaw: Math.atan2(sp.tx, sp.tz), sCar: 0, latOffset: 0 };
  }

  const slotSpacing = 8.0;
  const maxSlots = isClosed
    ? Math.min(12, Math.floor((sampler.totalLen * 0.45) / slotSpacing))
    : Math.min(8, Math.floor((sampler.totalLen - 25) / slotSpacing));

  if (maxSlots <= 0) {
    const sp = sampler.sampleAt(0);
    return { x: sp.x, y: sp.y, z: sp.z, yaw: Math.atan2(sp.tx, sp.tz), sCar: 0, latOffset: 0 };
  }

  const k = Math.max(0, Math.min(slotIndex, maxSlots - 1));
  const sFront = isClosed ? -(4.5 + k * slotSpacing) : 12.0 + (maxSlots - 1 - k) * slotSpacing;
  const sCar = sFront - 2.4;
  const sp = sampler.sampleAt(sCar);
  const roadW = sp.width || 18;
  const latOffset = (k % 2 === 0 ? 1 : -1) * Math.min(4.2, roadW * 0.23);

  return {
    x: sp.x + sp.lx * latOffset,
    y: sp.y + Math.abs(sp.bankSin) * (roadW * 0.5) - latOffset * sp.bankSin,
    z: sp.z + sp.lz * latOffset,
    yaw: Math.atan2(sp.tx, sp.tz),
    sCar,
    latOffset,
  };
}
