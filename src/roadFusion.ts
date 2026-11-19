import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { SplineNode, RoadBranch, computeSpline } from './tracks';
import { untanglePolyline3D, roundTightWallCorners3D } from './wallGeometry';
import { getZone } from './trackCorridor';

export interface UnifiedRoadOptions {
  asphaltColor?: string;
  whiteLineColor?: string;
  curbYellowColor?: string;
  curbRedColor?: string;
  grassColor?: string;
  sandColor?: string;
  gravelColor?: string;
  wallColor?: string;
  wallWidth?: number;
  wallHeight?: number;
  groundY?: number;
  overpassMask?: boolean[];
  mainHalfWidths?: number[];
}

export interface MergedRoadBoundary {
  outerRings: THREE.Vector3[][];
  holeRings: THREE.Vector3[][];
  ribbonGeo: THREE.BufferGeometry;
  fusedAsphaltGeo: THREE.BufferGeometry;
  whiteLineGeo: THREE.BufferGeometry;
  yellowCurbsGeo: THREE.BufferGeometry;
  redCurbsGeo: THREE.BufferGeometry;
  grassShoulderGeo: THREE.BufferGeometry;
  sandGeo: THREE.BufferGeometry;
  gravelGeo: THREE.BufferGeometry;
  embankmentGeo: THREE.BufferGeometry;
  shoulderGeo: THREE.BufferGeometry;
  wallGeo: THREE.BufferGeometry;
  outlineGeo: THREE.BufferGeometry;
}

interface ZoneSample {
  wWhite: number;
  wYellow: number;
  wRed: number;
  wGrass: number;
  wSand: number;
  wGravel: number;
  cAsphalt: [number, number, number];
  cWhite: [number, number, number];
  cYellow: [number, number, number];
  cRed: [number, number, number];
  cGrass: [number, number, number];
  cSand: [number, number, number];
  cGravel: [number, number, number];
  cWall: [number, number, number];
}

interface GroundSeg {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  hwA: number;
  hwB: number;
  isMain?: boolean;
  outerRadiusA: number;
  outerRadiusB: number;
  bankSinA: number;
  bankSinB: number;
  zAL: ZoneSample;
  zAR: ZoneSample;
  zBL: ZoneSample;
  zBR: ZoneSample;
}

function parseHexRGB(hex: string | undefined, fallback: string): [number, number, number] {
  const c = new THREE.Color(hex || fallback);
  return [c.r, c.g, c.b];
}

function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

function zoneOuterRadius(hw: number, z: ZoneSample, wallW: number): number {
  return hw + z.wWhite + z.wYellow + z.wRed + z.wGrass + z.wSand + z.wGravel + wallW;
}

function extractZoneSample(
  node: SplineNode,
  defaults: {
    asphaltColor: string;
    whiteLineColor: string;
    curbYellowColor: string;
    curbRedColor: string;
    grassColor: string;
    sandColor: string;
    gravelColor: string;
    wallColor: string;
  },
  side: 'L' | 'R' = 'L'
): ZoneSample {
  const z = (k: Parameters<typeof getZone>[1]) => getZone(node, k, side);
  return {
    wWhite: z('whiteLineWidth'),
    wYellow: z('curbYellowWidth'),
    wRed: z('curbRedWidth'),
    wGrass: z('grassWidth'),
    wSand: z('sandWidth'),
    wGravel: z('gravelWidth'),
    cAsphalt: parseHexRGB(node.asphaltColor, defaults.asphaltColor),
    cWhite: parseHexRGB(node.whiteLineColor, defaults.whiteLineColor),
    cYellow: parseHexRGB(node.curbYellowColor, defaults.curbYellowColor),
    cRed: parseHexRGB(node.curbRedColor, defaults.curbRedColor),
    cGrass: parseHexRGB(node.grassColor, defaults.grassColor),
    cSand: parseHexRGB(node.sandColor, defaults.sandColor),
    cGravel: parseHexRGB(node.gravelColor, defaults.gravelColor),
    cWall: parseHexRGB(node.wallColor, defaults.wallColor),
  };
}

function lerpZoneSample(a: ZoneSample, b: ZoneSample, t: number): ZoneSample {
  return {
    wWhite: a.wWhite + t * (b.wWhite - a.wWhite),
    wYellow: a.wYellow + t * (b.wYellow - a.wYellow),
    wRed: a.wRed + t * (b.wRed - a.wRed),
    wGrass: a.wGrass + t * (b.wGrass - a.wGrass),
    wSand: a.wSand + t * (b.wSand - a.wSand),
    wGravel: a.wGravel + t * (b.wGravel - a.wGravel),
    cAsphalt: lerpRGB(a.cAsphalt, b.cAsphalt, t),
    cWhite: lerpRGB(a.cWhite, b.cWhite, t),
    cYellow: lerpRGB(a.cYellow, b.cYellow, t),
    cRed: lerpRGB(a.cRed, b.cRed, t),
    cGrass: lerpRGB(a.cGrass, b.cGrass, t),
    cSand: lerpRGB(a.cSand, b.cSand, t),
    cGravel: lerpRGB(a.cGravel, b.cGravel, t),
    cWall: lerpRGB(a.cWall, b.cWall, t),
  };
}

function ringSignedAreaXZ(ring: [number, number][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    area += (p2[0] - p1[0]) * (p2[1] + p1[1]);
  }
  return area;
}

function cleanRing2D(rawRing: [number, number][], minStep: number = 0.4, maxStep: number = 3.2): [number, number][] {
  if (rawRing.length < 3) return [];
  const open =
    rawRing.length > 3 &&
    Math.hypot(rawRing[0][0] - rawRing[rawRing.length - 1][0], rawRing[0][1] - rawRing[rawRing.length - 1][1]) < 1e-4
      ? rawRing.slice(0, -1)
      : rawRing.slice();

  const deduped: [number, number][] = [];
  for (const pt of open) {
    if (deduped.length === 0) {
      deduped.push([pt[0], pt[1]]);
    } else {
      const prev = deduped[deduped.length - 1];
      if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) >= minStep) {
        deduped.push([pt[0], pt[1]]);
      }
    }
  }
  if (
    deduped.length > 2 &&
    Math.hypot(deduped[0][0] - deduped[deduped.length - 1][0], deduped[0][1] - deduped[deduped.length - 1][1]) < minStep
  ) {
    deduped.pop();
  }
  if (deduped.length < 3) return [];

  const resampled: [number, number][] = [];
  const n = deduped.length;
  for (let i = 0; i < n; i++) {
    const a = deduped[i];
    const b = deduped[(i + 1) % n];
    resampled.push(a);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dist > maxStep) {
      const steps = Math.ceil(dist / maxStep);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        resampled.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return resampled;
}

/**
 * Constrained Delaunay edge flipping on planar 2D triangulation (XZ plane).
 * Converts razor-thin Earcut needle triangles into well-shaped near-equilateral triangles
 * while preserving all ring/hole boundary edges (where twin === -1).
 */
function delaunayFlip2D(
  pts: Array<{ x: number; z: number }>,
  rawTris: number[][]
): [number, number, number][] {
  const valid: number[] = [];
  for (let i = 0; i < rawTris.length; i++) {
    const [a, b, c] = rawTris[i];
    const pa = pts[a], pb = pts[b], pc = pts[c];
    if (!pa || !pb || !pc) continue;
    const cross = (pb.x - pa.x) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.x - pa.x);
    if (Math.abs(cross) < 1e-8) continue;
    if (cross > 0) {
      valid.push(a, b, c);
    } else {
      valid.push(a, c, b);
    }
  }

  const T = (valid.length / 3) | 0;
  if (T < 2) {
    const out: [number, number, number][] = [];
    for (let t = 0; t < T; t++) out.push([valid[t * 3], valid[t * 3 + 1], valid[t * 3 + 2]]);
    return out;
  }

  const tri = new Int32Array(valid);
  const twin = new Int32Array(T * 3).fill(-1);
  const stride = pts.length + 1;
  const heMap = new Map<number, number>();

  for (let he = 0; he < T * 3; he++) {
    const tBase = he - (he % 3);
    const next = tBase + ((he - tBase + 1) % 3);
    const u = tri[he];
    const v = tri[next];
    const oppKey = v * stride + u;
    const opp = heMap.get(oppKey);
    if (opp !== undefined) {
      twin[he] = opp;
      twin[opp] = he;
      heMap.delete(oppKey);
    } else {
      heMap.set(u * stride + v, he);
    }
  }

  const stack = new Int32Array(T * 3 + 16);
  const inStack = new Uint8Array(T * 3);
  let sp = 0;
  for (let he = 0; he < T * 3; he++) {
    if (twin[he] > he) {
      stack[sp++] = he;
      inStack[he] = 1;
    }
  }

  let flips = 0;
  const maxFlips = T * 50;
  while (sp > 0 && flips < maxFlips) {
    const he1 = stack[--sp];
    inStack[he1] = 0;
    const he2 = twin[he1];
    if (he2 < 0) continue;

    const t1 = (he1 / 3) | 0;
    const t2 = (he2 / 3) | 0;
    if (t1 === t2) continue;

    const b1 = t1 * 3;
    const e1 = he1 - b1;
    const he1n = b1 + ((e1 + 1) % 3);
    const he1p = b1 + ((e1 + 2) % 3);

    const b2 = t2 * 3;
    const e2 = he2 - b2;
    const he2n = b2 + ((e2 + 1) % 3);
    const he2p = b2 + ((e2 + 2) % 3);

    const u = tri[he1];
    const v = tri[he1n];
    const c = tri[he1p];
    const d = tri[he2p];
    if (tri[he2] !== v || tri[he2n] !== u || c === d) continue;

    const pu = pts[u], pv = pts[v], pc = pts[c], pd = pts[d];
    const cross1 = (pu.x - pc.x) * (pd.z - pc.z) - (pu.z - pc.z) * (pd.x - pc.x);
    const cross2 = (pv.x - pd.x) * (pc.z - pd.z) - (pv.z - pd.z) * (pc.x - pd.x);
    if (cross1 <= 1e-6 || cross2 <= 1e-6) continue;

    const adx = pu.x - pd.x, adz = pu.z - pd.z;
    const bdx = pv.x - pd.x, bdz = pv.z - pd.z;
    const cdx = pc.x - pd.x, cdz = pc.z - pd.z;
    const det =
      (adx * adx + adz * adz) * (bdx * cdz - bdz * cdx) -
      (bdx * bdx + bdz * bdz) * (adx * cdz - adz * cdx) +
      (cdx * cdx + cdz * cdz) * (adx * bdz - adz * bdx);
    if (det <= 1e-4) continue;

    const o_vc = twin[he1n];
    const o_cu = twin[he1p];
    const o_ud = twin[he2n];
    const o_dv = twin[he2p];

    tri[b1] = c;
    tri[b1 + 1] = u;
    tri[b1 + 2] = d;
    twin[b1] = o_cu;
    if (o_cu >= 0) twin[o_cu] = b1;
    twin[b1 + 1] = o_ud;
    if (o_ud >= 0) twin[o_ud] = b1 + 1;
    twin[b1 + 2] = b2 + 2;

    tri[b2] = d;
    tri[b2 + 1] = v;
    tri[b2 + 2] = c;
    twin[b2] = o_dv;
    if (o_dv >= 0) twin[o_dv] = b2;
    twin[b2 + 1] = o_vc;
    if (o_vc >= 0) twin[o_vc] = b2 + 1;
    twin[b2 + 2] = b1 + 2;

    flips++;
    const candidates = [b1, b1 + 1, b2, b2 + 1];
    for (let ci = 0; ci < 4; ci++) {
      const nh = candidates[ci];
      const nt = twin[nh];
      if (nt >= 0) {
        const canon = nh < nt ? nh : nt;
        if (!inStack[canon]) {
          inStack[canon] = 1;
          stack[sp++] = canon;
        }
      }
    }
  }

  const out: [number, number, number][] = new Array(T);
  for (let t = 0; t < T; t++) {
    out[t] = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
  }
  return out;
}

function computeRingOutwardNormals(ring: THREE.Vector3[], isHole: boolean): THREE.Vector2[] {
  const N = ring.length;
  const normals: THREE.Vector2[] = [];
  if (N < 3) return normals;

  let area = 0;
  for (let i = 0; i < N; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % N];
    area += (p2.x - p1.x) * (p2.z + p1.z);
  }

  for (let i = 0; i < N; i++) {
    const prev = ring[(i - 1 + N) % N];
    const curr = ring[i];
    const next = ring[(i + 1) % N];

    const t1 = new THREE.Vector2(curr.x - prev.x, curr.z - prev.z);
    if (t1.lengthSq() > 1e-8) t1.normalize();
    const t2 = new THREE.Vector2(next.x - curr.x, next.z - curr.z);
    if (t2.lengthSq() > 1e-8) t2.normalize();

    const t = t1.clone().add(t2);
    if (t.lengthSq() < 1e-6) t.copy(t1.lengthSq() > 0 ? t1 : new THREE.Vector2(1, 0));
    else t.normalize();

    const norm = new THREE.Vector2(-t.y, t.x);
    if (area < 0) norm.negate();
    if (isHole) norm.negate();

    const n1 = new THREE.Vector2(-t1.y, t1.x);
    if (area < 0) n1.negate();
    if (isHole) n1.negate();
    const cosHalf = Math.max(0.4, norm.dot(n1));
    norm.multiplyScalar(Math.min(2.2, 1 / cosHalf));

    normals.push(norm);
  }
  return normals;
}

function computeRingMaxReach(ring: THREE.Vector3[], normals: THREE.Vector2[]): number[] {
  const N = ring.length;
  const maxReach = new Array<number>(N).fill(Infinity);
  if (N < 8) return maxReach;

  const uNorms = normals.map((n) => {
    const len = n.length() || 1;
    return { x: n.x / len, y: n.y / len };
  });

  const maxWindow = Math.min(90, Math.floor(N / 2));
  for (let i = 0; i < N; i++) {
    const p = ring[i];
    const ni = uNorms[i];
    for (let off = -maxWindow; off <= maxWindow; off++) {
      if (Math.abs(off) < 4) continue;
      const j = (i + off + N) % N;
      const nj = uNorms[j];
      // Opposite-facing sides of a V-tip or tight curve
      if (ni.x * nj.x + ni.y * nj.y > -0.2) continue;

      const dx = ring[j].x - p.x;
      const dz = ring[j].z - p.z;
      const proj = dx * ni.x + dz * ni.y;
      if (proj <= 0.1) continue; // j must be ahead in the outward normal direction

      const dist = Math.hypot(dx, dz);
      // Stop slightly before midpoint so the two sides meet cleanly without crossing
      const safeHalf = Math.max(0, dist * 0.48);
      if (safeHalf < maxReach[i]) {
        maxReach[i] = safeHalf;
      }
    }
  }
  return maxReach;
}

function buildBandBetweenPolylines(
  innerPts: THREE.Vector3[],
  outerPts: THREE.Vector3[],
  yOffset: number,
  colorsPerVertex: [number, number, number][],
  verts: number[],
  colors: number[],
  indices: number[],
  skipEdge?: boolean[]
) {
  const N = innerPts.length;
  if (N < 3) return;
  const baseIdx = verts.length / 3;

  for (let i = 0; i < N; i++) {
    const pIn = innerPts[i];
    const pOut = outerPts[i];
    const col = colorsPerVertex[i];
    verts.push(pIn.x, pIn.y + yOffset, pIn.z);
    verts.push(pOut.x, pOut.y + yOffset, pOut.z);
    colors.push(...col, ...col);
  }

  for (let i = 0; i < N; i++) {
    if (skipEdge && skipEdge[i]) continue;
    const nextIdx = (i + 1) % N;
    const hasWidth =
      innerPts[i].distanceToSquared(outerPts[i]) > 1e-4 ||
      innerPts[nextIdx].distanceToSquared(outerPts[nextIdx]) > 1e-4;
    if (!hasWidth) continue;
    const b0 = baseIdx + i * 2;
    const bn0 = baseIdx + nextIdx * 2;
    indices.push(b0, bn0, b0 + 1);
    indices.push(b0 + 1, bn0, bn0 + 1);
  }
}

function buildVariableOffsetBandForRing(
  ring: THREE.Vector3[],
  normals: THREE.Vector2[],
  innerOffsets: number[],
  outerOffsets: number[],
  yOffset: number,
  colorsPerVertex: [number, number, number][],
  verts: number[],
  colors: number[],
  indices: number[],
  skipEdge?: boolean[]
) {
  const N = ring.length;
  if (N < 3) return;
  const baseIdx = verts.length / 3;

  for (let i = 0; i < N; i++) {
    const p = ring[i];
    const n = normals[i];
    const dIn = innerOffsets[i];
    const dOut = outerOffsets[i];
    const col = colorsPerVertex[i];

    verts.push(p.x + n.x * dIn, p.y + yOffset, p.z + n.y * dIn);
    verts.push(p.x + n.x * dOut, p.y + yOffset, p.z + n.y * dOut);
    colors.push(...col, ...col);
  }

  for (let i = 0; i < N; i++) {
    const nextIdx = (i + 1) % N;
    const hasWidth =
      outerOffsets[i] - innerOffsets[i] > 0.01 || outerOffsets[nextIdx] - innerOffsets[nextIdx] > 0.01;
    if (!hasWidth) continue;
    const b0 = baseIdx + i * 2;
    const bn0 = baseIdx + nextIdx * 2;
    indices.push(b0, bn0, b0 + 1);
    indices.push(b0 + 1, bn0, bn0 + 1);
  }
}

function buildClosedWallForRing(
  wallInnerPts: THREE.Vector3[],
  isHole: boolean,
  wallWidth: number,
  wallHeight: number,
  colorRGB: [number, number, number],
  verts: number[],
  colors: number[],
  indices: number[],
  skipEdge?: boolean[]
) {
  const N = wallInnerPts.length;
  if (N < 3) return;

  let area = 0;
  for (let i = 0; i < N; i++) {
    const p1 = wallInnerPts[i];
    const p2 = wallInnerPts[(i + 1) % N];
    area += (p2.x - p1.x) * (p2.z + p1.z);
  }

  const baseIdx = verts.length / 3;
  for (let i = 0; i < N; i++) {
    const prev = wallInnerPts[(i - 1 + N) % N];
    const curr = wallInnerPts[i];
    const next = wallInnerPts[(i + 1) % N];

    const t1 = new THREE.Vector2(curr.x - prev.x, curr.z - prev.z);
    if (t1.lengthSq() > 1e-8) t1.normalize();
    const t2 = new THREE.Vector2(next.x - curr.x, next.z - curr.z);
    if (t2.lengthSq() > 1e-8) t2.normalize();

    const t = t1.clone().add(t2);
    if (t.lengthSq() < 1e-6) t.copy(t1.lengthSq() > 0 ? t1 : new THREE.Vector2(1, 0));
    else t.normalize();

    const norm = new THREE.Vector2(-t.y, t.x);
    if (area < 0) norm.negate();
    if (isHole) norm.negate();

    const yBot = curr.y - 0.5;
    const yTop = curr.y + wallHeight;

    verts.push(curr.x, yBot, curr.z);
    verts.push(curr.x, yTop, curr.z);
    verts.push(curr.x + norm.x * wallWidth, yTop, curr.z + norm.y * wallWidth);
    verts.push(curr.x + norm.x * wallWidth, yBot, curr.z + norm.y * wallWidth);

    colors.push(...colorRGB, ...colorRGB, ...colorRGB, ...colorRGB);
  }

  for (let i = 0; i < N; i++) {
    if (skipEdge && skipEdge[i]) continue;
    const nextIdx = (i + 1) % N;
    const b0 = baseIdx + i * 4;
    const bn0 = baseIdx + nextIdx * 4;

    const pCurr = wallInnerPts[i];
    const pNext = wallInnerPts[nextIdx];
    const tx = pNext.x - pCurr.x;
    const tz = pNext.z - pCurr.z;
    if (tx * tx + tz * tz < 0.01) continue;

    // Ensure inner face normal points TOWARD the road (opposite to outward wall thickness)
    const ax = verts[b0 * 3 + 6] - pCurr.x; // outer-top x - inner x
    const az = verts[b0 * 3 + 8] - pCurr.z; // outer-top z - inner z
    const innerFacesRoad = tz * ax - tx * az < 0;

    if (innerFacesRoad) {
      indices.push(b0, b0 + 1, bn0);
      indices.push(b0 + 1, bn0 + 1, bn0);
      indices.push(b0 + 1, b0 + 2, bn0 + 1);
      indices.push(b0 + 2, bn0 + 2, bn0 + 1);
      indices.push(b0 + 2, b0 + 3, bn0 + 2);
      indices.push(b0 + 3, bn0 + 3, bn0 + 2);
    } else {
      indices.push(b0, bn0, b0 + 1);
      indices.push(b0 + 1, bn0, bn0 + 1);
      indices.push(b0 + 1, bn0 + 1, b0 + 2);
      indices.push(b0 + 2, bn0 + 1, bn0 + 2);
      indices.push(b0 + 2, bn0 + 2, b0 + 3);
      indices.push(b0 + 3, bn0 + 2, bn0 + 3);
    }
  }
}

function makeBufferGeo(verts: number[], indices: number[], colors?: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  if (colors && colors.length > 0) {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Unifies Main Track + Pit Lane (BOX) + Branches into a single continuous asphalt mesh
 * with punched-out island holes ("tecido único onde abrimos um buraco"), plus all
 * multi-layer bermas (white line, yellow curb, red curb, grass, sand, gravel) and walls.
 */
export function buildUnifiedRoadNetwork(
  mainSpline: SplineNode[],
  isClosed: boolean,
  branches?: RoadBranch[],
  ribbonWidth: number = 1.8,
  pitSpline?: SplineNode[],
  options: UnifiedRoadOptions = {}
): MergedRoadBoundary | null {
  if (!mainSpline || mainSpline.length < 2) return null;

  const defaults = {
    asphaltColor: options.asphaltColor || '#64748b',
    whiteLineColor: options.whiteLineColor || '#ffffff',
    curbYellowColor: options.curbYellowColor || '#facc15',
    curbRedColor: options.curbRedColor || '#dc2626',
    grassColor: options.grassColor || '#22773b',
    sandColor: options.sandColor || '#d97706',
    gravelColor: options.gravelColor || '#78716c',
    wallColor: options.wallColor || '#e2e8f0',
  };
  const wallWidth = options.wallWidth ?? 0.8;
  const wallHeight = options.wallHeight ?? 1.25;
  const groundY = options.groundY ?? -0.12;
  const overpassMask = options.overpassMask;
  const mainHalfWidths = options.mainHalfWidths;

  type Ring2D = [number, number][];
  type Poly2D = Ring2D[];
  type MultiPoly2D = Poly2D[];

  interface TrackSample {
    pos: THREE.Vector3;
    tangent: THREE.Vector3;
    side: THREE.Vector3;
    halfWidth: number;
    bankSin: number;
    isOverpass: boolean;
    zoneL: ZoneSample;
    zoneR: ZoneSample;
  }

  const allMainSamples: TrackSample[] = [];
  const N = mainSpline.length;

  for (let i = 0; i < N; i++) {
    const nextIdx = (i + 1) % N;
    const prevIdx = (i - 1 + N) % N;
    const pCurr = mainSpline[i];
    const pNext = mainSpline[nextIdx];
    const prevNode = mainSpline[prevIdx];

    const pos = new THREE.Vector3(pCurr.x, pCurr.z ?? 0, pCurr.y);
    const t2d = new THREE.Vector2(pNext.x - prevNode.x, pNext.y - prevNode.y);
    if (t2d.lengthSq() > 1e-8) t2d.normalize();
    else t2d.set(1, 0);

    const tangent = new THREE.Vector3(t2d.x, 0, t2d.y);
    const side = new THREE.Vector3(-t2d.y, 0, t2d.x);
    const isOverpass = overpassMask ? Boolean(overpassMask[i]) : false;
    const hw = mainHalfWidths && mainHalfWidths[i] > 0 ? mainHalfWidths[i] : (pCurr.width || 18) / 2;
    const bankSin = -Math.sin(((pCurr.banking || 0) * Math.PI) / 180);
    pos.y += Math.abs(bankSin) * hw;

    allMainSamples.push({
      pos,
      tangent,
      side,
      halfWidth: hw,
      bankSin,
      isOverpass,
      zoneL: extractZoneSample(pCurr, defaults, 'L'),
      zoneR: extractZoneSample(pCurr, defaults, 'R'),
    });
  }

  const groundSegs: GroundSeg[] = [];
  const groundPolygons: MultiPoly2D[] = [];
  const bridgeCutLines: { lx: number; lz: number; rx: number; rz: number }[] = [];

  // 1. Main Track ground-level quads + track bridge cut cross-sections
  for (let i = 0; i < N - (isClosed ? 0 : 1); i++) {
    const nextIdx = (i + 1) % N;
    const fCurr = allMainSamples[i];
    const fNext = allMainSamples[nextIdx];

    if (fCurr.isOverpass !== fNext.isOverpass) {
      const fCut = fCurr.isOverpass ? fNext : fCurr;
      const extW = fCut.halfWidth + 1.5;
      bridgeCutLines.push({
        lx: fCut.pos.x + fCut.side.x * extW,
        lz: fCut.pos.z + fCut.side.z * extW,
        rx: fCut.pos.x - fCut.side.x * extW,
        rz: fCut.pos.z - fCut.side.z * extW,
      });
    }

    if (!fCurr.isOverpass && !fNext.isOverpass) {
      const p1L: [number, number] = [fCurr.pos.x + fCurr.side.x * fCurr.halfWidth, fCurr.pos.z + fCurr.side.z * fCurr.halfWidth];
      const p1R: [number, number] = [fCurr.pos.x - fCurr.side.x * fCurr.halfWidth, fCurr.pos.z - fCurr.side.z * fCurr.halfWidth];
      const p2L: [number, number] = [fNext.pos.x + fNext.side.x * fNext.halfWidth, fNext.pos.z + fNext.side.z * fNext.halfWidth];
      const p2R: [number, number] = [fNext.pos.x - fNext.side.x * fNext.halfWidth, fNext.pos.z - fNext.side.z * fNext.halfWidth];

      groundPolygons.push([[[p1L, p2L, p2R, p1R, p1L]]]);
      groundSegs.push({
        ax: fCurr.pos.x,
        az: fCurr.pos.z,
        ay: fCurr.pos.y,
        bx: fNext.pos.x,
        bz: fNext.pos.z,
        by: fNext.pos.y,
        hwA: fCurr.halfWidth,
        hwB: fNext.halfWidth,
        isMain: true,
        outerRadiusA: Math.max(zoneOuterRadius(fCurr.halfWidth, fCurr.zoneL, wallWidth), zoneOuterRadius(fCurr.halfWidth, fCurr.zoneR, wallWidth)),
        outerRadiusB: Math.max(zoneOuterRadius(fNext.halfWidth, fNext.zoneL, wallWidth), zoneOuterRadius(fNext.halfWidth, fNext.zoneR, wallWidth)),
        bankSinA: fCurr.bankSin,
        bankSinB: fNext.bankSin,
        zAL: fCurr.zoneL,
        zAR: fCurr.zoneR,
        zBL: fNext.zoneL,
        zBR: fNext.zoneR,
      });
    }
  }

  // 2. Branch roads (Ramais) quads
  if (branches && branches.length > 0) {
    for (const branch of branches) {
      if (!branch.points || branch.points.length < 2) continue;
      const dense = computeSpline(branch.points, false);
      const M = dense.length;
      if (M < 2) continue;

      for (let i = 0; i < M - 1; i++) {
        const pCurr = dense[i];
        const pNext = dense[i + 1];
        const prev = dense[Math.max(0, i - 1)];
        const after = dense[Math.min(M - 1, i + 2)];

        const t1 = new THREE.Vector2(pNext.x - prev.x, pNext.y - prev.y).normalize();
        const t2 = new THREE.Vector2(after.x - pCurr.x, after.y - pCurr.y).normalize();
        const n1 = new THREE.Vector2(-t1.y, t1.x);
        const n2 = new THREE.Vector2(-t2.y, t2.x);

        const hw1 = (pCurr.width || 18) / 2;
        const hw2 = (pNext.width || 18) / 2;

        const p1L: [number, number] = [pCurr.x + n1.x * hw1, pCurr.y + n1.y * hw1];
        const p1R: [number, number] = [pCurr.x - n1.x * hw1, pCurr.y - n1.y * hw1];
        const p2L: [number, number] = [pNext.x + n2.x * hw2, pNext.y + n2.y * hw2];
        const p2R: [number, number] = [pNext.x - n2.x * hw2, pNext.y - n2.y * hw2];

        groundPolygons.push([[[p1L, p2L, p2R, p1R, p1L]]]);
        const bSinA = -Math.sin(((pCurr.banking || 0) * Math.PI) / 180);
        const bSinB = -Math.sin(((pNext.banking || 0) * Math.PI) / 180);
        const zAL = extractZoneSample(pCurr, defaults, 'L');
        const zAR = extractZoneSample(pCurr, defaults, 'R');
        const zBL = extractZoneSample(pNext, defaults, 'L');
        const zBR = extractZoneSample(pNext, defaults, 'R');
        groundSegs.push({
          ax: pCurr.x,
          az: pCurr.y,
          ay: (pCurr.z ?? 0) + Math.abs(bSinA) * hw1,
          bx: pNext.x,
          bz: pNext.y,
          by: (pNext.z ?? 0) + Math.abs(bSinB) * hw2,
          hwA: hw1,
          hwB: hw2,
          outerRadiusA: Math.max(zoneOuterRadius(hw1, zAL, wallWidth), zoneOuterRadius(hw1, zAR, wallWidth)),
          outerRadiusB: Math.max(zoneOuterRadius(hw2, zBL, wallWidth), zoneOuterRadius(hw2, zBR, wallWidth)),
          bankSinA: bSinA,
          bankSinB: bSinB,
          zAL,
          zAR,
          zBL,
          zBR,
        });
      }
    }
  }

  // 3. Pit Lane (BOX) quads
  if (pitSpline && pitSpline.length >= 2) {
    const M = pitSpline.length;
    for (let i = 0; i < M - 1; i++) {
      const pCurr = pitSpline[i];
      const pNext = pitSpline[i + 1];
      const prev = pitSpline[Math.max(0, i - 1)];
      const after = pitSpline[Math.min(M - 1, i + 2)];

      const t1 = new THREE.Vector2(pNext.x - prev.x, pNext.y - prev.y).normalize();
      const t2 = new THREE.Vector2(after.x - pCurr.x, after.y - pCurr.y).normalize();
      const n1 = new THREE.Vector2(-t1.y, t1.x);
      const n2 = new THREE.Vector2(-t2.y, t2.x);

      const hw1 = (pCurr.width || 8.5) / 2;
      const hw2 = (pNext.width || 8.5) / 2;

      const p1L: [number, number] = [pCurr.x + n1.x * hw1, pCurr.y + n1.y * hw1];
      const p1R: [number, number] = [pCurr.x - n1.x * hw1, pCurr.y - n1.y * hw1];
      const p2L: [number, number] = [pNext.x + n2.x * hw2, pNext.y + n2.y * hw2];
      const p2R: [number, number] = [pNext.x - n2.x * hw2, pNext.y - n2.y * hw2];

      groundPolygons.push([[[p1L, p2L, p2R, p1R, p1L]]]);
      const bSinA = -Math.sin(((pCurr.banking || 0) * Math.PI) / 180);
      const bSinB = -Math.sin(((pNext.banking || 0) * Math.PI) / 180);
      const zAL = extractZoneSample(pCurr, defaults, 'L');
      const zAR = extractZoneSample(pCurr, defaults, 'R');
      const zBL = extractZoneSample(pNext, defaults, 'L');
      const zBR = extractZoneSample(pNext, defaults, 'R');
      groundSegs.push({
        ax: pCurr.x,
        az: pCurr.y,
        ay: (pCurr.z ?? 0) + Math.abs(bSinA) * hw1,
        bx: pNext.x,
        bz: pNext.y,
        by: (pNext.z ?? 0) + Math.abs(bSinB) * hw2,
        hwA: hw1,
        hwB: hw2,
        outerRadiusA: Math.max(zoneOuterRadius(hw1, zAL, wallWidth), zoneOuterRadius(hw1, zAR, wallWidth)),
        outerRadiusB: Math.max(zoneOuterRadius(hw2, zBL, wallWidth), zoneOuterRadius(hw2, zBR, wallWidth)),
        bankSinA: bSinA,
        bankSinB: bSinB,
        zAL,
        zAR,
        zBL,
        zBR,
      });
    }
  }

  const fallbackZone = extractZoneSample({ x: 0, y: 0, z: 0, width: 18 }, defaults);

  // 2D Spatial Hash Grids for O(1) segment lookup in sampleGroundAt and hitsOtherRoad
  const GRID_CELL = 36;
  const cellKey = (gx: number, gz: number) => (gx + 100000) * 200001 + (gz + 100000);
  const roadGrid = new Map<number, number[]>();
  const outerGrid = new Map<number, number[]>();
  const insertSegIntoGrid = (grid: Map<number, number[]>, sIdx: number, minX: number, maxX: number, minZ: number, maxZ: number, pad: number) => {
    const x0 = Math.floor((minX - pad) / GRID_CELL);
    const x1 = Math.floor((maxX + pad) / GRID_CELL);
    const z0 = Math.floor((minZ - pad) / GRID_CELL);
    const z1 = Math.floor((maxZ + pad) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = cellKey(gx, gz);
        let arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(sIdx);
      }
    }
  };
  for (let sIdx = 0; sIdx < groundSegs.length; sIdx++) {
    const s = groundSegs[sIdx];
    const minX = Math.min(s.ax, s.bx);
    const maxX = Math.max(s.ax, s.bx);
    const minZ = Math.min(s.az, s.bz);
    const maxZ = Math.max(s.az, s.bz);
    const roadPad = Math.max(s.hwA, s.hwB) + 14;
    const outerPad = Math.max(s.outerRadiusA, s.outerRadiusB) + 6;
    insertSegIntoGrid(roadGrid, sIdx, minX, maxX, minZ, maxZ, roadPad);
    insertSegIntoGrid(outerGrid, sIdx, minX, maxX, minZ, maxZ, outerPad);
  }

  const sampleGroundAt = (x: number, z: number): { y: number; zone: ZoneSample } => {
    if (groundSegs.length === 0) return { y: 0, zone: fallbackZone };
    let bestScore = Infinity;
    let bestY = 0;
    let bestSeg: GroundSeg | null = null;
    let bestT = 0;
    let bestLatDist = 0;

    const evalSeg = (s: GroundSeg) => {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / lenSq));
      const px = s.ax + t * dx;
      const pz = s.az + t * dz;
      const ex = x - px;
      const ez = z - pz;
      const d = Math.sqrt(ex * ex + ez * ez);
      const hw = s.hwA + t * (s.hwB - s.hwA);
      // Measure distance outside the road edge (so a narrow branch inside a wide main road never steals the main road's outer edge!)
      const edgeDist = d > hw ? d - hw : 0;
      const score = edgeDist + d * 0.02 - (s.isMain ? 0.25 : 0);
      if (score < bestScore) {
        bestScore = score;
        const len = Math.sqrt(lenSq) || 1;
        // Side vector (-dz/len, dx/len) in XZ
        const latDist = ex * (-dz / len) + ez * (dx / len);
        const bankSin = s.bankSinA + t * (s.bankSinB - s.bankSinA);
        bestY = s.ay + t * (s.by - s.ay) + latDist * bankSin;
        bestSeg = s;
        bestT = t;
        bestLatDist = latDist;
      }
    };

    const ck = cellKey(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
    const cands = roadGrid.get(ck) ?? outerGrid.get(ck);
    if (cands && cands.length > 0) {
      for (let k = 0; k < cands.length; k++) {
        evalSeg(groundSegs[cands[k]]);
      }
    } else {
      for (let k = 0; k < groundSegs.length; k++) {
        evalSeg(groundSegs[k]);
      }
    }

    const bestZone = bestSeg
      ? (bestLatDist >= 0
          ? lerpZoneSample((bestSeg as GroundSeg).zAR, (bestSeg as GroundSeg).zBR, bestT)
          : lerpZoneSample((bestSeg as GroundSeg).zAL, (bestSeg as GroundSeg).zBL, bestT))
      : fallbackZone;
    return { y: bestY, zone: bestZone };
  };

  const sampleHeightAt = (x: number, z: number): number => {
    if (groundSegs.length === 0) return 0;
    let bestScore = Infinity;
    let bestY = 0;

    const evalSeg = (s: GroundSeg) => {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / lenSq));
      const px = s.ax + t * dx;
      const pz = s.az + t * dz;
      const ex = x - px;
      const ez = z - pz;
      const d = Math.sqrt(ex * ex + ez * ez);
      const hw = s.hwA + t * (s.hwB - s.hwA);
      const edgeDist = d > hw ? d - hw : 0;
      const score = edgeDist + d * 0.02 - (s.isMain ? 0.25 : 0);
      if (score < bestScore) {
        bestScore = score;
        const bankSin = s.bankSinA + t * (s.bankSinB - s.bankSinA);
        if (bankSin !== 0) {
          const len = Math.sqrt(lenSq) || 1;
          const latDist = ex * (-dz / len) + ez * (dx / len);
          bestY = s.ay + t * (s.by - s.ay) + latDist * bankSin;
        } else {
          bestY = s.ay + t * (s.by - s.ay);
        }
      }
    };

    const ck = cellKey(Math.floor(x / GRID_CELL), Math.floor(z / GRID_CELL));
    const cands = roadGrid.get(ck) ?? outerGrid.get(ck);
    if (cands && cands.length > 0) {
      for (let k = 0; k < cands.length; k++) {
        evalSeg(groundSegs[cands[k]]);
      }
    } else {
      for (let k = 0; k < groundSegs.length; k++) {
        evalSeg(groundSegs[k]);
      }
    }
    return bestY;
  };

  const outerRings: THREE.Vector3[][] = [];
  const holeRings: THREE.Vector3[][] = [];

  const asphaltVerts: number[] = [];
  const asphaltColors: number[] = [];
  const asphaltIndices: number[] = [];

  const whiteVerts: number[] = [];
  const whiteColors: number[] = [];
  const whiteIndices: number[] = [];

  const yellowVerts: number[] = [];
  const yellowColors: number[] = [];
  const yellowIndices: number[] = [];

  const redVerts: number[] = [];
  const redColors: number[] = [];
  const redIndices: number[] = [];

  const grassVerts: number[] = [];
  const grassColors: number[] = [];
  const grassIndices: number[] = [];

  const sandVerts: number[] = [];
  const sandColors: number[] = [];
  const sandIndices: number[] = [];

  const gravelVerts: number[] = [];
  const gravelColors: number[] = [];
  const gravelIndices: number[] = [];

  const wallVerts: number[] = [];
  const wallColors: number[] = [];
  const wallIndices: number[] = [];

  const embankmentVerts: number[] = [];
  const embankmentIndices: number[] = [];

  const outlineVerts: number[] = [];

  const ribbonVerts: number[] = [];
  const ribbonColors: number[] = [];
  const ribbonIndices: number[] = [];

  if (groundPolygons.length > 0) {
    try {
      const unionResult = polygonClipping.union(groundPolygons[0], ...groundPolygons.slice(1));

      for (const poly of unionResult) {
        if (!poly || poly.length === 0) continue;

        const cleanOuter2D = cleanRing2D(poly[0]);
        if (cleanOuter2D.length < 3) continue;

        if (ringSignedAreaXZ(cleanOuter2D) > 0) {
          cleanOuter2D.reverse();
        }

        const cleanHoles2D: [number, number][][] = [];
        for (let h = 1; h < poly.length; h++) {
          const hRing = cleanRing2D(poly[h]);
          if (hRing.length >= 3) {
            if (ringSignedAreaXZ(hRing) < 0) {
              hRing.reverse();
            }
            cleanHoles2D.push(hRing);
          }
        }

        const smoothSampledRing = (ring: { pt: THREE.Vector3; zone: ZoneSample }[]) => {
          const R = ring.length;
          if (R < 5) return ring;
          for (let pass = 0; pass < 6; pass++) {
            const nextY = new Array<number>(R);
            const nextZones: ZoneSample[] = new Array(R);
            for (let i = 0; i < R; i++) {
              const prev = ring[(i - 1 + R) % R];
              const curr = ring[i];
              const next = ring[(i + 1) % R];
              // Only smooth across adjacent vertices that are close in 2D (never across a bridge cut!)
              const dPrev = Math.hypot(curr.pt.x - prev.pt.x, curr.pt.z - prev.pt.z);
              const dNext = Math.hypot(next.pt.x - curr.pt.x, next.pt.z - curr.pt.z);
              const wP = dPrev < 8.0 ? 0.25 : 0;
              const wN = dNext < 8.0 ? 0.25 : 0;
              const wC = 1.0 - wP - wN;
              nextY[i] = prev.pt.y * wP + curr.pt.y * wC + next.pt.y * wN;
              nextZones[i] = {
                ...curr.zone,
                wWhite: prev.zone.wWhite * wP + curr.zone.wWhite * wC + next.zone.wWhite * wN,
                wYellow: prev.zone.wYellow * wP + curr.zone.wYellow * wC + next.zone.wYellow * wN,
                wRed: prev.zone.wRed * wP + curr.zone.wRed * wC + next.zone.wRed * wN,
                wGrass: prev.zone.wGrass * wP + curr.zone.wGrass * wC + next.zone.wGrass * wN,
                wSand: prev.zone.wSand * wP + curr.zone.wSand * wC + next.zone.wSand * wN,
                wGravel: prev.zone.wGravel * wP + curr.zone.wGravel * wC + next.zone.wGravel * wN,
              };
            }
            for (let i = 0; i < R; i++) {
              ring[i].pt.y = nextY[i];
              ring[i].zone = nextZones[i];
            }
          }
          return ring;
        };

        const outerSampled = smoothSampledRing(
          cleanOuter2D.map(([x, z]) => {
            const { y, zone } = sampleGroundAt(x, z);
            return { pt: new THREE.Vector3(x, y, z), zone };
          })
        );
        const outer3D = outerSampled.map((s) => s.pt);
        outerRings.push(outer3D);

        const holesSampled = cleanHoles2D.map((hRing) =>
          smoothSampledRing(
            hRing.map(([x, z]) => {
              const { y, zone } = sampleGroundAt(x, z);
              return { pt: new THREE.Vector3(x, y, z), zone };
            })
          )
        );
        for (const hs of holesSampled) holeRings.push(hs.map((s) => s.pt));

        // 4. Triangulate single unified asphalt mesh + elevation-adaptive conforming refinement
        const contourVec2 = cleanOuter2D.map(([x, z]) => new THREE.Vector2(x, z));
        const holesVec2 = cleanHoles2D.map((hr) => hr.map(([x, z]) => new THREE.Vector2(x, z)));
        const triangles = THREE.ShapeUtils.triangulateShape(contourVec2, holesVec2);

        const allSampled = [...outerSampled, ...holesSampled.flat()];
        const pts: Array<{ x: number; y: number; z: number; col: [number, number, number] }> = allSampled.map((s) => ({
          x: s.pt.x,
          y: s.pt.y,
          z: s.pt.z,
          col: s.zone.cAsphalt,
        }));
        let tris: [number, number, number][] = delaunayFlip2D(pts, triangles);
        const cleanEdges = new Set<number>();
        let totalSplits = 0;

        for (let pass = 0; pass < 8 && pts.length < 35000; pass++) {
          const edgeMid = new Map<number, number>();
          const getMid = (u: number, v: number): number => {
            const a = u < v ? u : v;
            const b = u < v ? v : u;
            const key = a * 4194304 + b;
            const existing = edgeMid.get(key);
            if (existing !== undefined) return existing;
            if (cleanEdges.has(key)) return -1;

            const pa = pts[a];
            const pb = pts[b];
            const dx = pb.x - pa.x;
            const dz = pb.z - pa.z;
            const lenSq = dx * dx + dz * dz;
            if (lenSq <= 64) {
              cleanEdges.add(key);
              return -1;
            }

            const mx = (pa.x + pb.x) * 0.5;
            const mz = (pa.z + pb.z) * 0.5;
            const midY = sampleHeightAt(mx, mz);
            const linY = (pa.y + pb.y) * 0.5;
            let needSplit = Math.abs(midY - linY) > 0.03 || Math.abs(pb.y - pa.y) > 0.7;

            if (!needSplit && lenSq > 32 * 32) {
              const y25 = sampleHeightAt(pa.x + dx * 0.25, pa.z + dz * 0.25);
              const y75 = sampleHeightAt(pa.x + dx * 0.75, pa.z + dz * 0.75);
              if (
                Math.abs(y25 - (pa.y * 0.75 + pb.y * 0.25)) > 0.03 ||
                Math.abs(y75 - (pa.y * 0.25 + pb.y * 0.75)) > 0.03
              ) {
                needSplit = true;
              }
            }
            if (!needSplit && lenSq > 120 * 120) {
              for (const frac of [0.125, 0.375, 0.625, 0.875]) {
                const yf = sampleHeightAt(pa.x + dx * frac, pa.z + dz * frac);
                if (Math.abs(yf - (pa.y * (1 - frac) + pb.y * frac)) > 0.03) {
                  needSplit = true;
                  break;
                }
              }
            }

            if (!needSplit) {
              cleanEdges.add(key);
              return -1;
            }

            const m = pts.length;
            pts.push({ x: mx, y: midY, z: mz, col: lerpRGB(pa.col, pb.col, 0.5) });
            edgeMid.set(key, m);
            return m;
          };

          let anySplit = false;
          const nextTris: [number, number, number][] = [];
          for (let t = 0; t < tris.length; t++) {
            const [a, b, c] = tris[t];
            const mab = getMid(a, b);
            const mbc = getMid(b, c);
            const mca = getMid(c, a);
            const cnt = (mab >= 0 ? 1 : 0) + (mbc >= 0 ? 1 : 0) + (mca >= 0 ? 1 : 0);

            if (cnt === 0) {
              nextTris.push([a, b, c]);
            } else if (cnt === 3) {
              anySplit = true;
              nextTris.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca]);
            } else if (cnt === 1) {
              anySplit = true;
              if (mab >= 0) nextTris.push([a, mab, c], [mab, b, c]);
              else if (mbc >= 0) nextTris.push([b, mbc, a], [mbc, c, a]);
              else nextTris.push([c, mca, b], [mca, a, b]);
            } else {
              anySplit = true;
              let p0 = a, p1 = b, p2 = c, m12 = mbc, m20 = mca;
              if (mbc < 0) { p0 = b; p1 = c; p2 = a; m12 = mca; m20 = mab; }
              else if (mca < 0) { p0 = c; p1 = a; p2 = b; m12 = mab; m20 = mbc; }
              nextTris.push([p2, m20, m12]);
              const d1 = (pts[p0].x - pts[m12].x) ** 2 + (pts[p0].z - pts[m12].z) ** 2;
              const d2 = (pts[p1].x - pts[m20].x) ** 2 + (pts[p1].z - pts[m20].z) ** 2;
              if (d1 <= d2) {
                nextTris.push([p0, p1, m12], [p0, m12, m20]);
              } else {
                nextTris.push([p0, p1, m20], [p1, m12, m20]);
              }
            }
          }
          tris = nextTris;
          if (anySplit) totalSplits++;
          else break;
        }
        if (totalSplits > 0) {
          tris = delaunayFlip2D(pts, tris);
        }

        const vOffset = asphaltVerts.length / 3;
        for (const p of pts) {
          asphaltVerts.push(p.x, p.y + 0.01, p.z);
          asphaltColors.push(...p.col);
        }

        for (const [a, b, c] of tris) {
          const ax = pts[a].x, az = pts[a].z;
          const bx = pts[b].x, bz = pts[b].z;
          const cx = pts[c].x, cz = pts[c].z;
          const crossY = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
          if (Math.abs(crossY) < 1e-7) continue;
          if (crossY < 0) {
            asphaltIndices.push(vOffset + a, vOffset + b, vOffset + c);
          } else {
            asphaltIndices.push(vOffset + a, vOffset + c, vOffset + b);
          }
        }

        // 5. Build all berma layers (white, yellow curb, red curb, grass, sand, gravel) + wall
        const distToSeg2D = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
          const dx = bx - ax, dz = bz - az;
          const l2 = dx * dx + dz * dz;
          if (l2 < 1e-6) return Math.hypot(px - ax, pz - az);
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
          return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
        };

        const processBoundaryRing = (sampled: { pt: THREE.Vector3; zone: ZoneSample }[], isHole: boolean) => {
          const ring3D = sampled.map((s) => s.pt);
          const normals = computeRingOutwardNormals(ring3D, isHole);

          // Skip ONLY edges that run ACROSS the road at a bridge entry/exit cut (never side edges!)
          const skipEdge = ring3D.map((pA, i) => {
            if (bridgeCutLines.length === 0) return false;
            const pB = ring3D[(i + 1) % ring3D.length];
            const ex = pB.x - pA.x;
            const ez = pB.z - pA.z;
            const eLen = Math.hypot(ex, ez);
            if (eLen < 1e-4) return false;
            const mx = (pA.x + pB.x) * 0.5;
            const mz = (pA.z + pB.z) * 0.5;
            for (const c of bridgeCutLines) {
              const cx = c.rx - c.lx;
              const cz = c.rz - c.lz;
              const cLen = Math.hypot(cx, cz) || 1;
              const parallel = Math.abs((ex * cx + ez * cz) / (eLen * cLen));
              if (
                parallel > 0.65 &&
                distToSeg2D(mx, mz, c.lx, c.lz, c.rx, c.rz) < 2.2 &&
                distToSeg2D(pA.x, pA.z, c.lx, c.lz, c.rx, c.rz) < 2.5 &&
                distToSeg2D(pB.x, pB.z, c.lx, c.lz, c.rx, c.rz) < 2.5
              ) {
                return true;
              }
            }
            return false;
          });

          for (let i = 0; i < ring3D.length; i++) {
            if (skipEdge[i]) continue;
            const pA = ring3D[i];
            const pB = ring3D[(i + 1) % ring3D.length];
            outlineVerts.push(pA.x, pA.y + 0.06, pA.z, pB.x, pB.y + 0.06, pB.z);
          }

          const d0: number[] = [];
          const d1: number[] = [];
          const d2: number[] = [];
          const d3: number[] = [];
          const d4: number[] = [];
          const d5: number[] = [];
          const d6: number[] = [];

          for (let i = 0; i < sampled.length; i++) {
            const { zone } = sampled[i];
            const x0 = 0;
            const x1 = x0 + zone.wWhite;
            const x2 = x1 + zone.wYellow;
            const x3 = x2 + zone.wRed;
            const x4 = x3 + zone.wGrass;
            const x5 = x4 + zone.wSand;
            const x6 = x5 + zone.wGravel;

            d0.push(x0);
            d1.push(x1);
            d2.push(x2);
            d3.push(x3);
            d4.push(x4);
            d5.push(x5);
            d6.push(x6);
          }

          const rawWallInner = ring3D.map((p, idx) => {
            const n = normals[idx];
            const dist = d6[idx];
            return new THREE.Vector3(p.x + n.x * dist, p.y, p.z + n.y * dist);
          });
          const cleanWallInner = roundTightWallCorners3D(untanglePolyline3D(rawWallInner, true), true, 8.0);
          // Smooth wall base height along the ring so sloped hairpins never have a vertical step ("degrau")
          const R = ring3D.length;
          for (let pass = 0; pass < 8; pass++) {
            const nextWY = new Array<number>(R);
            for (let i = 0; i < R; i++) {
              const prev = cleanWallInner[(i - 1 + R) % R];
              const curr = cleanWallInner[i];
              const next = cleanWallInner[(i + 1) % R];
              const dP = Math.hypot(curr.x - prev.x, curr.z - prev.z);
              const dN = Math.hypot(next.x - curr.x, next.z - curr.z);
              const wP = dP < 10.0 ? 0.25 : 0;
              const wN = dN < 10.0 ? 0.25 : 0;
              nextWY[i] = prev.y * wP + curr.y * (1 - wP - wN) + next.y * wN;
            }
            for (let i = 0; i < R; i++) cleanWallInner[i].y = nextWY[i];
          }

          const buildOffsetPoly = (dists: number[]) => {
            // Interpolate cleanly between road edge (ring3D) and untangled/rounded wall base (cleanWallInner)
            // so intermediate layers (white, curbs, grass, sand, gravel) never cross, overlap, or stair-step!
            const pts: THREE.Vector3[] = new Array(R);
            for (let i = 0; i < R; i++) {
              const frac = d6[i] > 1e-4 ? Math.min(1, Math.max(0, dists[i] / d6[i])) : 0;
              const pIn = ring3D[i];
              const pOut = cleanWallInner[i];
              pts[i] = new THREE.Vector3(
                pIn.x + (pOut.x - pIn.x) * frac,
                pIn.y + (pOut.y - pIn.y) * frac,
                pIn.z + (pOut.z - pIn.z) * frac
              );
            }
            return pts;
          };

          const p0 = ring3D;
          const p1 = buildOffsetPoly(d1);
          const p2 = buildOffsetPoly(d2);
          const p3 = buildOffsetPoly(d3);
          const p4 = buildOffsetPoly(d4);
          const p5 = buildOffsetPoly(d5);
          const p6 = buildOffsetPoly(d6);

          buildBandBetweenPolylines(
            p0, p1, 0.035,
            sampled.map((s) => s.zone.cWhite),
            whiteVerts, whiteColors, whiteIndices, skipEdge
          );
          buildBandBetweenPolylines(
            p1, p2, 0.03,
            sampled.map((s) => s.zone.cYellow),
            yellowVerts, yellowColors, yellowIndices, skipEdge
          );
          buildBandBetweenPolylines(
            p2, p3, 0.03,
            sampled.map((s) => s.zone.cRed),
            redVerts, redColors, redIndices, skipEdge
          );
          buildBandBetweenPolylines(
            p3, p4, 0.02,
            sampled.map((s) => s.zone.cGrass),
            grassVerts, grassColors, grassIndices, skipEdge
          );
          buildBandBetweenPolylines(
            p4, p5, 0.02,
            sampled.map((s) => s.zone.cSand),
            sandVerts, sandColors, sandIndices, skipEdge
          );
          buildBandBetweenPolylines(
            p5, p6, 0.02,
            sampled.map((s) => s.zone.cGravel),
            gravelVerts, gravelColors, gravelIndices, skipEdge
          );

          buildVariableOffsetBandForRing(
            ring3D, normals, d0, d0.map((v) => v + ribbonWidth), 0.08,
            sampled.map((s) => s.zone.cGrass),
            ribbonVerts, ribbonColors, ribbonIndices
          );

          buildClosedWallForRing(
            cleanWallInner,
            isHole,
            wallWidth,
            wallHeight,
            sampled[0]?.zone.cWall || parseHexRGB(undefined, defaults.wallColor),
            wallVerts,
            wallColors,
            wallIndices,
            skipEdge
          );

          // Safe Embankment Slopes (Abas laterais de relevo até groundY, sem invadir estradas/pontes!)
          const rawWallOuter: THREE.Vector3[] = [];
          const rawFootPts: THREE.Vector3[] = [];
          const hasRelief: boolean[] = [];

          const distSqToSeg2D = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
            const dx = bx - ax;
            const dz = bz - az;
            const l2 = dx * dx + dz * dz;
            if (l2 < 1e-6) {
              const ex = px - ax;
              const ez = pz - az;
              return ex * ex + ez * ez;
            }
            let t = ((px - ax) * dx + (pz - az) * dz) / l2;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const ex = px - (ax + t * dx);
            const ez = pz - (az + t * dz);
            return ex * ex + ez * ez;
          };

          const hitsOtherRoad = (px: number, pz: number, originX: number, originZ: number, refY: number, onlyLower: boolean): boolean => {
            const cands = outerGrid.get(cellKey(Math.floor(px / GRID_CELL), Math.floor(pz / GRID_CELL)));
            if (!cands || cands.length === 0) return false;
            for (let k = 0; k < cands.length; k++) {
              const gs = groundSegs[cands[k]];
              const segAvgY = (gs.ay + gs.by) * 0.5;
              if (onlyLower && segAvgY >= refY - 0.5) continue;
              const maxR = Math.max(gs.outerRadiusA, gs.outerRadiusB) + 3.0;
              const origR = maxR + 1.5;
              // Never treat the road segment that origin (wOut) itself sits on as an obstacle!
              if (!onlyLower && distSqToSeg2D(originX, originZ, gs.ax, gs.az, gs.bx, gs.bz) < origR * origR) {
                continue;
              }
              if (distSqToSeg2D(px, pz, gs.ax, gs.az, gs.bx, gs.bz) < maxR * maxR) {
                return true;
              }
            }
            return false;
          };

          for (let i = 0; i < cleanWallInner.length; i++) {
            const wp = cleanWallInner[i];
            const nLen = normals[i].length() || 1;
            const ux = normals[i].x / nLen;
            const uz = normals[i].y / nLen;
            const hAbove = Math.max(0, wp.y - groundY);

            const wOut = new THREE.Vector3(wp.x + ux * wallWidth, wp.y - 0.15, wp.z + uz * wallWidth);
            rawWallOuter.push(wOut);

            // If the wall outer edge itself is over/near a lower road, suppress embankment completely!
            const overLowerRoad = hAbove > 0.35 && hitsOtherRoad(wOut.x, wOut.z, wOut.x, wOut.z, wp.y, true);
            if (hAbove <= 0.35 || overLowerRoad) {
              hasRelief.push(false);
              rawFootPts.push(new THREE.Vector3(wOut.x, groundY - 0.15, wOut.z));
              continue;
            }

            let safeSlope = Math.min(20, hAbove * 1.45);
            if (safeSlope > 0.5) {
              const steps = 16;
              for (let s = 1; s <= steps; s++) {
                const testD = (safeSlope * s) / steps;
                const tx = wOut.x + ux * testD;
                const tz = wOut.z + uz * testD;
                if (hitsOtherRoad(tx, tz, wOut.x, wOut.z, wp.y, false)) {
                  safeSlope = Math.max(0, (safeSlope * (s - 1)) / steps);
                  break;
                }
              }
            }
            hasRelief.push(safeSlope > 0.3);
            rawFootPts.push(new THREE.Vector3(wOut.x + ux * safeSlope, groundY - 0.15, wOut.z + uz * safeSlope));
          }

          const cleanFootPts = untanglePolyline3D(rawFootPts, true);
          const embBase = embankmentVerts.length / 3;
          for (let i = 0; i < rawWallOuter.length; i++) {
            const topP = rawWallOuter[i];
            const botP = cleanFootPts[i];
            embankmentVerts.push(topP.x, topP.y, topP.z);
            embankmentVerts.push(botP.x, botP.y, botP.z);
          }
          for (let i = 0; i < rawWallOuter.length; i++) {
            if (skipEdge[i]) continue;
            const nextIdx = (i + 1) % rawWallOuter.length;
            if (!hasRelief[i] || !hasRelief[nextIdx]) continue;
            const b0 = embBase + i * 2;
            const bn0 = embBase + nextIdx * 2;
            embankmentIndices.push(b0, bn0, b0 + 1);
            embankmentIndices.push(b0 + 1, bn0, bn0 + 1);
          }
        };

        processBoundaryRing(outerSampled, false);
        for (const hs of holesSampled) {
          processBoundaryRing(hs, true);
        }
      }
    } catch (err) {
      console.warn('Unified road network union error:', err);
    }
  }

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlineVerts, 3));

  const grassShoulderGeo = makeBufferGeo(grassVerts, grassIndices, grassColors);

  return {
    outerRings,
    holeRings,
    fusedAsphaltGeo: makeBufferGeo(asphaltVerts, asphaltIndices, asphaltColors),
    whiteLineGeo: makeBufferGeo(whiteVerts, whiteIndices, whiteColors),
    yellowCurbsGeo: makeBufferGeo(yellowVerts, yellowIndices, yellowColors),
    redCurbsGeo: makeBufferGeo(redVerts, redIndices, redColors),
    grassShoulderGeo,
    sandGeo: makeBufferGeo(sandVerts, sandIndices, sandColors),
    gravelGeo: makeBufferGeo(gravelVerts, gravelIndices, gravelColors),
    embankmentGeo: makeBufferGeo(embankmentVerts, embankmentIndices),
    shoulderGeo: grassShoulderGeo,
    wallGeo: makeBufferGeo(wallVerts, wallIndices, wallColors),
    ribbonGeo: makeBufferGeo(ribbonVerts, ribbonIndices, ribbonColors),
    outlineGeo,
  };
}
