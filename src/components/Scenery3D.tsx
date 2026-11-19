import React, { useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { SplineNode, RoadBranch, SceneryPatch, SprayCanType, computeSpline } from '../tracks';
import { getZone } from '../trackCorridor';

function appendTransformedGeo(
  src: THREE.BufferGeometry,
  mat: THREE.Matrix4,
  colorHex: string,
  verts: number[],
  normals: number[],
  colors: number[],
  indices: number[]
) {
  const pos = src.getAttribute('position');
  const norm = src.getAttribute('normal');
  const idx = src.getIndex();
  if (!pos || !idx) return;

  const base = verts.length / 3;
  const col = new THREE.Color(colorHex);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nMat = new THREE.Matrix3().getNormalMatrix(mat);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mat);
    verts.push(v.x, v.y, v.z);
    if (norm) {
      n.fromBufferAttribute(norm, i).applyMatrix3(nMat).normalize();
      normals.push(n.x, n.y, n.z);
    } else {
      normals.push(0, 1, 0);
    }
    colors.push(col.r, col.g, col.b);
  }
  for (let i = 0; i < idx.count; i++) {
    indices.push(base + idx.getX(i));
  }
}

function finalizeMergedGeo(
  verts: number[],
  normals: number[],
  colors: number[],
  indices: number[]
): THREE.BufferGeometry | null {
  if (indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}

function buildInstancedPineCanopyGeo(): THREE.BufferGeometry {
  const verts: number[] = [];
  const norms: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const m = new THREE.Matrix4();
  const c1 = new THREE.ConeGeometry(2.4, 4.6, 7);
  const c2 = new THREE.ConeGeometry(1.85, 3.8, 7);
  const c3 = new THREE.ConeGeometry(1.2, 2.8, 6);

  m.makeTranslation(0, 4.2, 0);
  appendTransformedGeo(c1, m, '#ffffff', verts, norms, cols, idx);
  m.makeTranslation(0, 6.6, 0);
  appendTransformedGeo(c2, m, '#ffffff', verts, norms, cols, idx);
  m.makeTranslation(0, 8.6, 0);
  appendTransformedGeo(c3, m, '#ffffff', verts, norms, cols, idx);

  c1.dispose();
  c2.dispose();
  c3.dispose();

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setIndex(idx);
  return g;
}

interface Scenery3DProps {
  patches: SceneryPatch[];
  spline: SplineNode[];
  isClosed: boolean;
  branches?: RoadBranch[];
  pitSpline?: SplineNode[];
  groundY: number;
  cursorPos?: [number, number] | null;
  activeSpray?: SprayCanType | null;
  sprayRadius?: number;
}

export interface RoadSegmentGuard {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  outerRadius: number;
}

interface TerrainMeshGrid {
  patch: SceneryPatch;
  rings: number;
  segs: number;
  heights: Float32Array;
  triValid: Uint8Array;
}

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  color: string;
}

function seededRandom(seed: number) {
  let s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return () => {
    s = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
}

function nodeOuterRadius(node: SplineNode): number {
  const hw = (node.width || 18) * 0.5;
  const sideMax = (k: Parameters<typeof getZone>[1]) =>
    Math.max(getZone(node, k, 'L'), getZone(node, k, 'R'));
  const berma =
    sideMax('whiteLineWidth') +
    sideMax('curbYellowWidth') +
    sideMax('curbRedWidth') +
    sideMax('grassWidth') +
    sideMax('sandWidth') +
    sideMax('gravelWidth') +
    (node.wallThickness || 1.0);
  return hw + berma;
}

export function buildRoadGuards(
  spline: SplineNode[],
  isClosed: boolean,
  branches?: RoadBranch[],
  pitSpline?: SplineNode[]
): RoadSegmentGuard[] {
  const guards: RoadSegmentGuard[] = [];
  const addNodes = (nodes: SplineNode[], closed: boolean) => {
    const N = nodes.length;
    if (N < 2) return;
    const count = closed ? N : N - 1;
    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % N];
      guards.push({
        ax: a.x,
        az: a.y,
        ay: a.z ?? 0,
        bx: b.x,
        bz: b.y,
        by: b.z ?? 0,
        outerRadius: Math.max(nodeOuterRadius(a), nodeOuterRadius(b)),
      });
    }
  };

  if (spline && spline.length >= 2) addNodes(spline, isClosed);
  if (branches) {
    for (const br of branches) {
      if (br.points && br.points.length >= 2) {
        addNodes(computeSpline(br.points, false), false);
      }
    }
  }
  if (pitSpline && pitSpline.length >= 2) addNodes(pitSpline, false);
  return guards;
}

export function evalRawMountainY(p: SceneryPatch, frac: number, ang: number, groundY: number): number {
  const u = 1 - frac;
  const ridge =
    1 +
    0.18 * Math.sin(ang * 3 + p.seed) * frac +
    0.12 * Math.cos(ang * 5 - p.seed * 1.7) * frac;
  const intensity = p.intensity || 1.2;
  const peakH = (p.type === 'mountain' ? p.radius * 0.46 : p.radius * 0.16) * intensity;
  return groundY - 0.15 + peakH * (u * u * (3 - 2 * u)) * ridge;
}

export function computeSceneryData(
  patches: SceneryPatch[],
  roadGuards: RoadSegmentGuard[],
  groundY: number
) {
  // 1. Build Spatial Hash Grid over roadGuards for O(1) clearance checks
  const CELL = 50;
  const cellKey = (gx: number, gz: number) => (gx + 100000) * 200001 + (gz + 100000);
  const guardGrid = new Map<number, number[]>();
  for (let i = 0; i < roadGuards.length; i++) {
    const g = roadGuards[i];
    const pad = g.outerRadius + 28;
    const minX = Math.min(g.ax, g.bx) - pad;
    const maxX = Math.max(g.ax, g.bx) + pad;
    const minZ = Math.min(g.az, g.bz) - pad;
    const maxZ = Math.max(g.az, g.bz) + pad;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = cellKey(gx, gz);
        let arr = guardGrid.get(key);
        if (!arr) {
          arr = [];
          guardGrid.set(key, arr);
        }
        arr.push(i);
      }
    }
  }

  const queryRoadClearance = (px: number, pz: number, needNearestAngle = false) => {
    let minMargin = 999;
    let nearestRoadY = groundY;
    let nearestAngle = 0;
    let nearestX = px;
    let nearestZ = pz;
    let nearestTanX = 1;
    let nearestTanZ = 0;
    let nearestOuterRadius = 18;
    let maxAllowedMountainY = Infinity;

    const evalGuard = (g: RoadSegmentGuard) => {
      const dx = g.bx - g.ax;
      const dz = g.bz - g.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - g.ax) * dx + (pz - g.az) * dz) / l2));
      const cx = g.ax + t * dx;
      const cz = g.az + t * dz;
      const dist = Math.hypot(px - cx, pz - cz);
      const margin = dist - g.outerRadius;
      const segY = g.ay + t * (g.by - g.ay);

      if (margin < minMargin) {
        const segLen = Math.sqrt(l2) || 1;
        minMargin = margin;
        nearestRoadY = segY;
        nearestAngle = Math.atan2(dx, dz);
        nearestX = cx;
        nearestZ = cz;
        nearestTanX = dx / segLen;
        nearestTanZ = dz / segLen;
        nearestOuterRadius = g.outerRadius;
      }

      if (margin < 24.5) {
        const blend = Math.max(0, Math.min(1, (margin - 4.5) / 20.0));
        const smooth = blend * blend * (3 - 2 * blend);
        const capUnderRoad = segY > groundY + 2.2 ? segY - 1.2 : groundY - 0.5;
        const limitY = capUnderRoad + smooth * 140 * blend;
        if (limitY < maxAllowedMountainY) {
          maxAllowedMountainY = limitY;
        }
      }
    };

    const cands = guardGrid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL)));
    if (cands && cands.length > 0) {
      for (let k = 0; k < cands.length; k++) {
        evalGuard(roadGuards[cands[k]]);
      }
    } else if (needNearestAngle && roadGuards.length > 0) {
      for (let k = 0; k < roadGuards.length; k++) {
        evalGuard(roadGuards[k]);
      }
    }

    return {
      minMargin,
      nearestRoadY,
      nearestAngle,
      nearestX,
      nearestZ,
      nearestTanX,
      nearestTanZ,
      nearestOuterRadius,
      maxAllowedMountainY,
    };
  };

  const mountainMeshes: THREE.BufferGeometry[] = [];
  const terrainGrids: TerrainMeshGrid[] = [];
  const pineTrees: TreeInstance[] = [];
  const leafTrees: TreeInstance[] = [];
  const buildings: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    rotY: number;
    color: string;
    accent: string;
  }[] = [];
  const grandstands: { x: number; y: number; z: number; rotY: number; width: number; color: string }[] = [];
  const pitBoxes: { x: number; y: number; z: number; rotY: number; width: number; seed: number }[] = [];
  const occupiedRoadside: Array<{
    x: number;
    z: number;
    width: number;
    kind: 'grandstand' | 'pitbox';
    anchorX: number;
    anchorZ: number;
    tanX: number;
    tanZ: number;
    outX: number;
    outZ: number;
  }> = [];
  const desertRocks: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rotY: number; isCactus: boolean }[] = [];

  const cFoothill = new THREE.Color('#15803d');
  const cRock = new THREE.Color('#57534e');
  const cSnow = new THREE.Color('#f8fafc');
  const cSandDune = new THREE.Color('#d97706');
  const cRedMesa = new THREE.Color('#9a3412');

  // 2. Build all Mountain & Desert Dune meshes FIRST, capturing their exact polar vertex heights and active triangles
  for (const p of patches) {
    if (p.type !== 'mountain' && p.type !== 'desert') continue;

    const rings = 24;
    const segs = 48;
    const stride = segs + 1;
    const verts: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const heights = new Float32Array((rings + 1) * stride);
    const triValid = new Uint8Array(rings * segs * 2);

    for (let r = 0; r <= rings; r++) {
      const frac = r / rings;
      const rad = frac * p.radius;
      for (let s = 0; s <= segs; s++) {
        const ang = (s / segs) * Math.PI * 2;
        const vx = p.x + Math.cos(ang) * rad;
        const vz = p.z + Math.sin(ang) * rad;
        const rawY = evalRawMountainY(p, frac, ang, groundY);
        const { maxAllowedMountainY } = queryRoadClearance(vx, vz);
        const vy = Math.min(rawY, maxAllowedMountainY);

        verts.push(vx, vy, vz);
        heights[r * stride + s] = vy;

        const hAbove = Math.max(0, vy - groundY);
        const col = new THREE.Color();
        if (p.type === 'desert') {
          const tRock = Math.min(1, hAbove / 14);
          col.lerpColors(cSandDune, cRedMesa, tRock);
        } else {
          if (hAbove < 10) {
            col.lerpColors(cFoothill, cRock, hAbove / 10);
          } else if (hAbove < 22) {
            col.lerpColors(cRock, cSnow, (hAbove - 10) / 12);
          } else {
            col.copy(cSnow);
          }
        }
        colors.push(col.r, col.g, col.b);
      }
    }

    const shouldSkipTri = (i0: number, i1: number, i2: number): boolean => {
      const y0 = verts[i0 * 3 + 1];
      const y1 = verts[i1 * 3 + 1];
      const y2 = verts[i2 * 3 + 1];
      if (y0 <= groundY - 0.12 && y1 <= groundY - 0.12 && y2 <= groundY - 0.12) {
        return true;
      }
      const x0 = verts[i0 * 3], z0 = verts[i0 * 3 + 2];
      const x1 = verts[i1 * 3], z1 = verts[i1 * 3 + 2];
      const x2 = verts[i2 * 3], z2 = verts[i2 * 3 + 2];
      const samples: [number, number, number][] = [
        [(x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3, (z0 + z1 + z2) / 3],
        [(x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5],
        [(x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5],
        [(x2 + x0) * 0.5, (y2 + y0) * 0.5, (z2 + z0) * 0.5],
      ];
      for (const [sx, sy, sz] of samples) {
        const { minMargin, nearestRoadY, maxAllowedMountainY } = queryRoadClearance(sx, sz);
        if (minMargin < 1.0 && nearestRoadY <= groundY + 2.2) {
          return true;
        }
        if (minMargin < 0 && sy > maxAllowedMountainY + 0.1) {
          return true;
        }
      }
      return false;
    };

    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * stride + s;
        const b = (r + 1) * stride + s;
        const c = (r + 1) * stride + (s + 1);
        const d = r * stride + (s + 1);
        const cellIdx = (r * segs + s) * 2;
        if (!shouldSkipTri(a, b, d)) {
          indices.push(a, b, d);
          triValid[cellIdx] = 1;
        }
        if (!shouldSkipTri(b, c, d)) {
          indices.push(b, c, d);
          triValid[cellIdx + 1] = 1;
        }
      }
    }

    if (indices.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      mountainMeshes.push(geo);
      terrainGrids.push({ patch: p, rings, segs, heights, triValid });
    }
  }

  // Exact barycentric height on the rendered mountain/desert mesh triangles (never hovers or sinks!)
  const getTerrainSurfaceAt = (px: number, pz: number): { y: number; onMountain: boolean } => {
    let maxH = groundY;
    let onMountain = false;

    for (const tg of terrainGrids) {
      const { patch: p, rings, segs, heights, triValid } = tg;
      const dx = px - p.x;
      const dz = pz - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= p.radius) continue;

      let ang = Math.atan2(dz, dx);
      if (ang < 0) ang += Math.PI * 2;

      const rf = (dist / p.radius) * rings;
      const sf = (ang / (Math.PI * 2)) * segs;
      const r = Math.min(rings - 1, Math.floor(rf));
      const s = Math.min(segs - 1, Math.floor(sf));
      const u = rf - r;
      const v = sf - s;

      const triSub = u + v <= 1 ? 0 : 1;
      if (triValid[(r * segs + s) * 2 + triSub] === 0) continue;

      const stride = segs + 1;
      const hA = heights[r * stride + s];
      const hB = heights[(r + 1) * stride + s];
      const hC = heights[(r + 1) * stride + (s + 1)];
      const hD = heights[r * stride + (s + 1)];

      const y =
        triSub === 0
          ? hA * (1 - u - v) + hB * u + hD * v
          : hC * (u + v - 1) + hB * (1 - v) + hD * (1 - u);

      if (y > maxH) {
        maxH = y;
        onMountain = true;
      }
    }

    return { y: maxH, onMountain };
  };

  // 3. Place Forests, Cities, Grandstands, and Desert Props on top of the exact terrain surface
  const treeOccupied = new Set<number>();

  for (const p of patches) {
    const rand = seededRandom(p.seed || 1);
    const intensity = p.intensity || 1.2;

    if (p.type === 'forest') {
      const count = Math.round((p.radius / 11) * (p.radius / 11) * 0.45 * intensity);
      const treeColors = ['#14532d', '#166534', '#15803d', '#065f46', '#3f6212'];
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt(rand()) * (p.radius - 4);
        const ang = rand() * Math.PI * 2;
        const tx = p.x + Math.cos(ang) * r;
        const tz = p.z + Math.sin(ang) * r;

        const occKey = (Math.floor(tx / 4.5) + 100000) * 200001 + (Math.floor(tz / 4.5) + 100000);
        if (treeOccupied.has(occKey)) continue;

        const { minMargin } = queryRoadClearance(tx, tz);
        if (minMargin < 5.0) continue; // Strictly outside track walls!

        treeOccupied.add(occKey);
        const { y: ty, onMountain } = getTerrainSurfaceAt(tx, tz);
        const scale = (0.75 + rand() * 0.75) * Math.min(1.6, 0.7 + intensity * 0.35);
        const isPine = rand() > 0.3;
        const color = treeColors[Math.floor(rand() * treeColors.length)];
        // Embed tree root slightly on steep slopes so trunk base never hovers over terrain triangles
        const baseY = onMountain ? ty - 0.55 * scale : ty;

        const item: TreeInstance = { x: tx, y: baseY, z: tz, scale, color };
        if (isPine) pineTrees.push(item);
        else leafTrees.push(item);
      }
    }

    if (p.type === 'city') {
      const count = Math.max(4, Math.round((p.radius / 22) * (p.radius / 22) * 0.9 * intensity));
      const bColors = ['#cbd5e1', '#94a3b8', '#64748b', '#475569', '#e2e8f0'];
      const accents = ['#38bdf8', '#f59e0b', '#e11d48', '#818cf8'];
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt(rand()) * (p.radius - 10);
        const ang = rand() * Math.PI * 2;
        const bx = p.x + Math.cos(ang) * r;
        const bz = p.z + Math.sin(ang) * r;
        const bw = 9 + rand() * 11;
        const bd = 9 + rand() * 11;
        const bh = (12 + rand() * 34) * intensity;
        const { minMargin, nearestAngle } = queryRoadClearance(bx, bz, true);
        if (minMargin < Math.hypot(bw, bd) * 0.55 + 4.5) continue;
        if (buildings.some((other) => Math.hypot(other.x - bx, other.z - bz) < (other.w + bw) * 0.55)) {
          continue;
        }
        buildings.push({
          x: bx,
          y: groundY,
          z: bz,
          w: bw,
          h: bh,
          d: bd,
          rotY: nearestAngle,
          color: bColors[Math.floor(rand() * bColors.length)],
          accent: accents[Math.floor(rand() * accents.length)],
        });
      }
    }

    if ((p.type === 'grandstand' || p.type === 'pitbox') && roadGuards.length > 0) {
      const kind = p.type;
      const isPit = kind === 'pitbox';
      const itemWidth = 30;
      const slotStep = isPit ? 30.0 : 34.0;
      const frontOffsetFromWall = isPit ? 5.5 : 6.0;
      const depthBehindFront = isPit ? 9.5 : 8.0;
      const roofColors = ['#e11d48', '#0284c7', '#16a34a', '#f59e0b'];

      const centerInfo = queryRoadClearance(p.x, p.z, true);
      let t0x = centerInfo.nearestTanX;
      let t0z = centerInfo.nearestTanZ;
      const l0x = -t0z;
      const l0z = t0x;
      const sideSign = (p.x - centerInfo.nearestX) * l0x + (p.z - centerInfo.nearestZ) * l0z >= 0 ? 1 : -1;
      const refOutX = l0x * sideSign;
      const refOutZ = l0z * sideSign;

      let anchorX = centerInfo.nearestX;
      let anchorZ = centerInfo.nearestZ;
      for (const o of occupiedRoadside) {
        if (o.kind !== kind) continue;
        if (Math.hypot(centerInfo.nearestX - o.anchorX, centerInfo.nearestZ - o.anchorZ) > p.radius * 2 + 120) continue;
        if (Math.abs(o.tanX * t0x + o.tanZ * t0z) <= 0.9) continue;
        if (o.outX * refOutX + o.outZ * refOutZ <= 0.75) continue;
        const perp = Math.abs((centerInfo.nearestX - o.anchorX) * -o.tanZ + (centerInfo.nearestZ - o.anchorZ) * o.tanX);
        if (perp > 18) continue;

        const proj = (centerInfo.nearestX - o.anchorX) * o.tanX + (centerInfo.nearestZ - o.anchorZ) * o.tanZ;
        const snappedDist = Math.round(proj / slotStep) * slotStep;
        anchorX = o.anchorX + o.tanX * snappedDist;
        anchorZ = o.anchorZ + o.tanZ * snappedDist;
        t0x = o.tanX;
        t0z = o.tanZ;
        break;
      }

      const halfSpan = Math.max(0, p.radius * 0.85);
      const halfSlots = Math.floor(halfSpan / slotStep);

      for (let s = -halfSlots; s <= halfSlots; s++) {
        const rawX = anchorX + t0x * (s * slotStep);
        const rawZ = anchorZ + t0z * (s * slotStep);
        if (halfSlots > 0 && Math.hypot(rawX - p.x, rawZ - p.z) > p.radius * 1.15) continue;

        const info = queryRoadClearance(rawX, rawZ, true);
        let outX = -info.nearestTanZ;
        let outZ = info.nearestTanX;
        if (outX * refOutX + outZ * refOutZ < 0) {
          outX = -outX;
          outZ = -outZ;
        }
        let tanX = info.nearestTanX;
        let tanZ = info.nearestTanZ;
        if (tanX * t0x + tanZ * t0z < 0) {
          tanX = -tanX;
          tanZ = -tanZ;
        }

        const bx = info.nearestX + outX * (info.nearestOuterRadius + frontOffsetFromWall);
        const bz = info.nearestZ + outZ * (info.nearestOuterRadius + frontOffsetFromWall);
        // Local +Z points toward (-outX, -outZ), i.e., always facing the road on BOTH sides!
        const rotY = Math.atan2(-outX, -outZ);

        // Ensure entire footprint stays cleanly outside all roads & pit lanes
        const halfW = itemWidth * 0.45;
        const frontMargin = queryRoadClearance(bx, bz).minMargin;
        const backMargin = queryRoadClearance(bx + outX * depthBehindFront, bz + outZ * depthBehindFront).minMargin;
        const leftMargin = queryRoadClearance(bx - tanX * halfW, bz - tanZ * halfW).minMargin;
        const rightMargin = queryRoadClearance(bx + tanX * halfW, bz + tanZ * halfW).minMargin;
        if (Math.min(frontMargin, backMargin, leftMargin, rightMargin) < 1.8) continue;

        // Enforce single straight row without overlapping or double-row stacking
        if (occupiedRoadside.some((o) => Math.hypot(o.x - bx, o.z - bz) < (o.width + itemWidth) * 0.47)) {
          continue;
        }

        const baseY = Math.max(groundY, info.nearestRoadY - 0.15);
        occupiedRoadside.push({
          x: bx,
          z: bz,
          width: itemWidth,
          kind,
          anchorX,
          anchorZ,
          tanX,
          tanZ,
          outX,
          outZ,
        });

        if (isPit) {
          pitBoxes.push({
            x: bx,
            y: baseY,
            z: bz,
            rotY,
            width: itemWidth,
            seed: (p.seed || 1) + Math.abs(s * 7),
          });
        } else {
          grandstands.push({
            x: bx,
            y: baseY,
            z: bz,
            rotY,
            width: itemWidth,
            color: roofColors[Math.abs((p.seed || 0) + s) % roofColors.length],
          });
        }
      }
    }

    if (p.type === 'desert') {
      const count = Math.round((p.radius / 14) * (p.radius / 14) * 0.45 * intensity);
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt(rand()) * (p.radius - 5);
        const ang = rand() * Math.PI * 2;
        const rx = p.x + Math.cos(ang) * r;
        const rz = p.z + Math.sin(ang) * r;
        const { minMargin } = queryRoadClearance(rx, rz);
        if (minMargin < 6.5) continue;
        const { y: ry, onMountain } = getTerrainSurfaceAt(rx, rz);
        const isCactus = rand() > 0.42;
        desertRocks.push({
          x: rx,
          y: onMountain ? ry - 0.35 : ry,
          z: rz,
          sx: isCactus ? 0.8 + rand() * 0.6 : 2.5 + rand() * 4.5,
          sy: isCactus ? 2.2 + rand() * 2.0 : (1.8 + rand() * 4.2) * intensity,
          sz: isCactus ? 0.8 + rand() * 0.6 : 2.5 + rand() * 4.5,
          rotY: rand() * Math.PI * 2,
          isCactus,
        });
      }
    }
  }

  // Merge buildings, grandstands, and desert rocks into single draw-call BufferGeometries
  const m4 = new THREE.Matrix4();
  const qRot = new THREE.Quaternion();
  const sVec = new THREE.Vector3();
  const pVec = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const boxBase = new THREE.BoxGeometry(1, 1, 1);

  const bldgVerts: number[] = [], bldgNorms: number[] = [], bldgCols: number[] = [], bldgIdx: number[] = [];
  const accVerts: number[] = [], accNorms: number[] = [], accCols: number[] = [], accIdx: number[] = [];
  for (const b of buildings) {
    qRot.setFromAxisAngle(yAxis, b.rotY);
    pVec.set(b.x, b.y + b.h * 0.5, b.z);
    sVec.set(b.w, b.h, b.d);
    m4.compose(pVec, qRot, sVec);
    appendTransformedGeo(boxBase, m4, b.color, bldgVerts, bldgNorms, bldgCols, bldgIdx);
    for (const f of [0.25, 0.5, 0.75]) {
      pVec.set(b.x, b.y + b.h * f, b.z);
      sVec.set(b.w + 0.15, b.h * 0.12, b.d + 0.15);
      m4.compose(pVec, qRot, sVec);
      appendTransformedGeo(boxBase, m4, '#0f172a', bldgVerts, bldgNorms, bldgCols, bldgIdx);
    }
    pVec.set(b.x, b.y + b.h + 0.6, b.z);
    sVec.set(b.w * 0.65, 1.2, b.d * 0.65);
    m4.compose(pVec, qRot, sVec);
    appendTransformedGeo(boxBase, m4, '#1e293b', bldgVerts, bldgNorms, bldgCols, bldgIdx);
    pVec.set(b.x, b.y + b.h + 1.35, b.z);
    sVec.set(b.w * 0.5, 0.25, b.d * 0.5);
    m4.compose(pVec, qRot, sVec);
    appendTransformedGeo(boxBase, m4, b.accent, accVerts, accNorms, accCols, accIdx);
  }
  const buildingsGeo = finalizeMergedGeo(bldgVerts, bldgNorms, bldgCols, bldgIdx);
  const buildingAccentsGeo = finalizeMergedGeo(accVerts, accNorms, accCols, accIdx);

  // Merge all Grandstands into 1 single draw call
  const gsVerts: number[] = [], gsNorms: number[] = [], gsCols: number[] = [], gsIdx: number[] = [];
  const parentMat = new THREE.Matrix4();
  const localMat = new THREE.Matrix4();
  const localQ = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  for (const g of grandstands) {
    parentMat.compose(pVec.set(g.x, g.y, g.z), qRot.setFromAxisAngle(yAxis, g.rotY), unitScale);
    if (g.y > groundY + 0.05) {
      const plinthH = g.y - groundY + 0.5;
      localQ.identity();
      localMat.compose(pVec.set(0, -plinthH * 0.5, -3.2), localQ, sVec.set(g.width, plinthH, 8.2));
      m4.multiplyMatrices(parentMat, localMat);
      appendTransformedGeo(boxBase, m4, '#475569', gsVerts, gsNorms, gsCols, gsIdx);
    }
    for (let step = 0; step < 4; step++) {
      localQ.identity();
      localMat.compose(pVec.set(0, 1.1 + step * 1.4, -step * 1.8), localQ, sVec.set(g.width, 1.4, 2.2));
      m4.multiplyMatrices(parentMat, localMat);
      appendTransformedGeo(boxBase, m4, step % 2 === 0 ? '#334155' : g.color, gsVerts, gsNorms, gsCols, gsIdx);
    }
    localQ.identity();
    localMat.compose(pVec.set(0, 4.8, -6.8), localQ, sVec.set(g.width, 9.6, 0.8));
    m4.multiplyMatrices(parentMat, localMat);
    appendTransformedGeo(boxBase, m4, '#1e293b', gsVerts, gsNorms, gsCols, gsIdx);

    localQ.setFromAxisAngle(xAxis, 0.18);
    localMat.compose(pVec.set(0, 9.8, -3.2), localQ, sVec.set(g.width + 1.2, 0.45, 9.5));
    m4.multiplyMatrices(parentMat, localMat);
    appendTransformedGeo(boxBase, m4, '#f8fafc', gsVerts, gsNorms, gsCols, gsIdx);

    localQ.identity();
    localMat.compose(pVec.set(0, 10.1, 1.4), localQ, sVec.set(g.width + 1.25, 0.35, 0.4));
    m4.multiplyMatrices(parentMat, localMat);
    appendTransformedGeo(boxBase, m4, g.color, gsVerts, gsNorms, gsCols, gsIdx);
  }
  const grandstandsGeo = finalizeMergedGeo(gsVerts, gsNorms, gsCols, gsIdx);

  // Merge all Modular 3-Bay F1 Pit Garages into 2 draw calls (structure + LED bay lights)
  const pbVerts: number[] = [], pbNorms: number[] = [], pbCols: number[] = [], pbIdx: number[] = [];
  const pbLVerts: number[] = [], pbLNorms: number[] = [], pbLCols: number[] = [], pbLIdx: number[] = [];
  const teamPalettes = [
    { fascia: '#dc2626', accent: '#f8fafc', equip: '#b91c1c' }, // Ferrari-style
    { fascia: '#0284c7', accent: '#fbbf24', equip: '#1e3a8a' }, // RedBull/Williams-style
    { fascia: '#0d9488', accent: '#cbd5e1', equip: '#0f172a' }, // Mercedes-style
    { fascia: '#ea580c', accent: '#0f172a', equip: '#1e293b' }, // McLaren-style
    { fascia: '#15803d', accent: '#fde047', equip: '#064e3b' }, // Aston-style
    { fascia: '#db2777', accent: '#38bdf8', equip: '#1e293b' }, // Alpine-style
  ];
  const appendBox = (
    lx: number, ly: number, lz: number,
    sx: number, sy: number, sz: number,
    col: string,
    targetVerts = pbVerts, targetNorms = pbNorms, targetCols = pbCols, targetIdx = pbIdx
  ) => {
    localQ.identity();
    localMat.compose(pVec.set(lx, ly, lz), localQ, sVec.set(sx, sy, sz));
    m4.multiplyMatrices(parentMat, localMat);
    appendTransformedGeo(boxBase, m4, col, targetVerts, targetNorms, targetCols, targetIdx);
  };
  for (const pb of pitBoxes) {
    parentMat.compose(pVec.set(pb.x, pb.y, pb.z), qRot.setFromAxisAngle(yAxis, pb.rotY), unitScale);
    if (pb.y > groundY + 0.05) {
      const plinthH = pb.y - groundY + 0.5;
      appendBox(0, -plinthH * 0.5, -4.5, 30.0, plinthH, 9.2, '#475569');
    }
    // Floor slab, front pit apron, back wall, and 4 bay dividers
    appendBox(0, 0.14, -4.5, 30.0, 0.28, 9.2, '#334155');
    appendBox(0, 0.07, 1.3, 30.0, 0.14, 2.6, '#475569');
    appendBox(0, 2.6, -8.85, 30.0, 5.2, 0.5, '#1e293b');
    for (const wx of [-14.8, -5.0, 5.0, 14.8]) {
      appendBox(wx, 2.6, -4.5, 0.4, 5.2, 9.0, '#e2e8f0');
    }
    // Roof slab + upper Paddock Club glass deck
    appendBox(0, 5.35, -3.6, 30.0, 0.42, 11.4, '#f1f5f9');
    appendBox(0, 6.55, -5.6, 29.8, 2.0, 6.4, '#0f172a');
    appendBox(0, 7.7, -5.6, 30.0, 0.3, 6.8, '#cbd5e1');

    // 3 distinct adjacent garages (localX = -10, 0, +10)
    for (let bay = 0; bay < 3; bay++) {
      const bx = (bay - 1) * 10;
      const pal = teamPalettes[(pb.seed + bay) % teamPalettes.length];
      // Half-open overhead shutter, team fascia banner, accent stripe, and team number plaque
      appendBox(bx, 3.3, -0.15, 9.2, 0.85, 0.25, '#94a3b8');
      appendBox(bx, 4.35, 0.05, 9.8, 0.95, 0.35, pal.fascia);
      appendBox(bx, 3.78, 0.06, 9.8, 0.22, 0.38, pal.accent);
      appendBox(bx, 4.35, 0.08, 2.4, 0.55, 0.4, '#f8fafc');

      // 3 distinct interior equipment layouts per bay
      if (bay === 0) {
        appendBox(bx - 2.6, 1.15, -7.4, 2.8, 1.7, 1.2, pal.equip);
        appendBox(bx + 2.8, 0.85, -7.2, 1.3, 1.1, 1.3, '#111827');
        appendBox(bx + 2.8, 1.45, -7.2, 1.35, 0.22, 1.35, pal.accent);
        appendBox(bx + 1.2, 0.85, -7.2, 1.3, 1.1, 1.3, '#111827');
      } else if (bay === 1) {
        appendBox(bx, 1.0, -7.3, 4.6, 1.4, 1.2, '#0f172a');
        appendBox(bx - 1.5, 2.25, -7.4, 1.2, 1.1, 0.8, '#38bdf8');
        appendBox(bx + 1.5, 2.25, -7.4, 1.2, 1.1, 0.8, pal.fascia);
        appendBox(bx, 4.15, -3.5, 8.8, 0.28, 0.32, pal.equip);
      } else {
        appendBox(bx - 2.5, 1.25, -7.2, 3.2, 1.9, 1.2, pal.fascia);
        appendBox(bx + 2.2, 0.85, -7.2, 2.6, 1.1, 1.4, '#e2e8f0');
        appendBox(bx, 0.9, 1.5, 3.2, 1.2, 0.9, pal.equip);
        appendBox(bx, 1.85, 1.5, 2.8, 0.45, 0.35, '#0f172a');
      }

      // Emissive LED ceiling strips inside each garage bay
      appendBox(bx, 4.95, -2.2, 7.2, 0.12, 0.35, '#f8fafc', pbLVerts, pbLNorms, pbLCols, pbLIdx);
      appendBox(bx, 4.95, -5.8, 7.2, 0.12, 0.35, '#f8fafc', pbLVerts, pbLNorms, pbLCols, pbLIdx);
    }
  }
  boxBase.dispose();
  const pitBoxesGeo = finalizeMergedGeo(pbVerts, pbNorms, pbCols, pbIdx);
  const pitBoxLightsGeo = finalizeMergedGeo(pbLVerts, pbLNorms, pbLCols, pbLIdx);

  const rockVerts: number[] = [], rockNorms: number[] = [], rockCols: number[] = [], rockIdx: number[] = [];
  const rockBase = new THREE.DodecahedronGeometry(1.0, 0);
  const cacBase = new THREE.CylinderGeometry(0.38, 0.45, 4.4, 7);
  for (const r of desertRocks) {
    qRot.setFromAxisAngle(yAxis, r.rotY);
    if (r.isCactus) {
      pVec.set(r.x, r.y + r.sy * 0.45 * 2.2, r.z);
      sVec.set(r.sx, r.sy * 0.45, r.sz);
      m4.compose(pVec, qRot, sVec);
      appendTransformedGeo(cacBase, m4, '#15803d', rockVerts, rockNorms, rockCols, rockIdx);
    } else {
      pVec.set(r.x, r.y + r.sy * 0.35, r.z);
      sVec.set(r.sx, r.sy, r.sz);
      m4.compose(pVec, qRot, sVec);
      appendTransformedGeo(rockBase, m4, '#b45309', rockVerts, rockNorms, rockCols, rockIdx);
    }
  }
  rockBase.dispose();
  cacBase.dispose();
  const rocksGeo = finalizeMergedGeo(rockVerts, rockNorms, rockCols, rockIdx);

  return {
    mountainMeshes,
    terrainGrids,
    pineTrees,
    leafTrees,
    grandstands,
    pitBoxes,
    buildingsGeo,
    buildingAccentsGeo,
    grandstandsGeo,
    pitBoxesGeo,
    pitBoxLightsGeo,
    rocksGeo,
  };
}

export const Scenery3D: React.FC<Scenery3DProps> = React.memo(({
  patches,
  spline,
  isClosed,
  branches,
  pitSpline,
  groundY,
  cursorPos,
  activeSpray,
  sprayRadius = 75,
}) => {
  // 1. Collect all road corridor segments so NOTHING ever invades the track or walls
  const roadGuards = useMemo<RoadSegmentGuard[]>(
    () => buildRoadGuards(spline, isClosed, branches, pitSpline),
    [spline, isClosed, branches, pitSpline]
  );

  // 2. Build Mountain & Desert Dune meshes + Prop placements + Instanced tree lists
  const builtScenery = useMemo(
    () => computeSceneryData(patches, roadGuards, groundY),
    [patches, roadGuards, groundY]
  );

  useEffect(() => {
    return () => {
      builtScenery.mountainMeshes.forEach((g) => g.dispose());
      builtScenery.buildingsGeo?.dispose();
      builtScenery.buildingAccentsGeo?.dispose();
      builtScenery.grandstandsGeo?.dispose();
      builtScenery.pitBoxesGeo?.dispose();
      builtScenery.pitBoxLightsGeo?.dispose();
      builtScenery.rocksGeo?.dispose();
    };
  }, [builtScenery]);

  // Shared unit geometries for InstancedMesh trees (disposed on unmount)
  const treeBaseGeos = useMemo(() => {
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.48, 3.2, 6);
    trunkGeo.translate(0, 1.2, 0); // Bottom at -0.4, top at +2.8
    const pineCanopyGeo = buildInstancedPineCanopyGeo();
    const leafCanopyGeo = new THREE.DodecahedronGeometry(2.8, 0);
    leafCanopyGeo.translate(0, 5.2, 0);
    return { trunkGeo, pineCanopyGeo, leafCanopyGeo };
  }, []);

  useEffect(() => {
    return () => {
      treeBaseGeos.trunkGeo.dispose();
      treeBaseGeos.pineCanopyGeo.dispose();
      treeBaseGeos.leafCanopyGeo.dispose();
    };
  }, [treeBaseGeos]);

  const trunksRef = useRef<THREE.InstancedMesh>(null);
  const pinesRef = useRef<THREE.InstancedMesh>(null);
  const leavesRef = useRef<THREE.InstancedMesh>(null);

  const totalTreesCount = builtScenery.pineTrees.length + builtScenery.leafTrees.length;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const tmpCol = new THREE.Color();

    const trunkMesh = trunksRef.current;
    if (trunkMesh && totalTreesCount > 0) {
      let idx = 0;
      for (const t of builtScenery.pineTrees) {
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(idx++, dummy.matrix);
      }
      for (const t of builtScenery.leafTrees) {
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(idx++, dummy.matrix);
      }
      trunkMesh.instanceMatrix.needsUpdate = true;
    }

    const pineMesh = pinesRef.current;
    if (pineMesh && builtScenery.pineTrees.length > 0) {
      for (let i = 0; i < builtScenery.pineTrees.length; i++) {
        const t = builtScenery.pineTrees[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        pineMesh.setMatrixAt(i, dummy.matrix);
        pineMesh.setColorAt(i, tmpCol.set(t.color));
      }
      pineMesh.instanceMatrix.needsUpdate = true;
      if (pineMesh.instanceColor) pineMesh.instanceColor.needsUpdate = true;
    }

    const leafMesh = leavesRef.current;
    if (leafMesh && builtScenery.leafTrees.length > 0) {
      for (let i = 0; i < builtScenery.leafTrees.length; i++) {
        const t = builtScenery.leafTrees[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        leafMesh.setMatrixAt(i, dummy.matrix);
        leafMesh.setColorAt(i, tmpCol.set(t.color));
      }
      leafMesh.instanceMatrix.needsUpdate = true;
      if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
    }
  }, [builtScenery, totalTreesCount]);

  const cursorColor =
    activeSpray === 'mountain'
      ? '#a8a29e'
      : activeSpray === 'forest'
      ? '#22c55e'
      : activeSpray === 'city'
      ? '#38bdf8'
      : activeSpray === 'grandstand'
      ? '#f43f5e'
      : activeSpray === 'pitbox'
      ? '#06b6d4'
      : activeSpray === 'desert'
      ? '#f59e0b'
      : '#ef4444';

  return (
    <group>
      {/* 1. 3D Mountains & Sand Dunes */}
      {builtScenery.mountainMeshes.map((geo, idx) => (
        <mesh key={`mtn_${idx}`} geometry={geo} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.92} metalness={0.04} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* 2. 3D Forests (GPU InstancedMesh - minimal RAM/VRAM and 3 draw calls total) */}
      {totalTreesCount > 0 && (
        <instancedMesh
          key={`trunks_${totalTreesCount}`}
          ref={trunksRef}
          args={[treeBaseGeos.trunkGeo, undefined, totalTreesCount]}
          frustumCulled={false}
          receiveShadow
        >
          <meshStandardMaterial color="#5c4033" roughness={0.9} />
        </instancedMesh>
      )}
      {builtScenery.pineTrees.length > 0 && (
        <instancedMesh
          key={`pines_${builtScenery.pineTrees.length}`}
          ref={pinesRef}
          args={[treeBaseGeos.pineCanopyGeo, undefined, builtScenery.pineTrees.length]}
          frustumCulled={false}
          receiveShadow
        >
          <meshStandardMaterial color="#ffffff" roughness={0.85} />
        </instancedMesh>
      )}
      {builtScenery.leafTrees.length > 0 && (
        <instancedMesh
          key={`leaves_${builtScenery.leafTrees.length}`}
          ref={leavesRef}
          args={[treeBaseGeos.leafCanopyGeo, undefined, builtScenery.leafTrees.length]}
          frustumCulled={false}
          receiveShadow
        >
          <meshStandardMaterial color="#ffffff" roughness={0.85} />
        </instancedMesh>
      )}

      {/* 3. 3D City Buildings & Towers (Merged into 2 draw calls) */}
      {builtScenery.buildingsGeo && (
        <mesh geometry={builtScenery.buildingsGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.45} metalness={0.25} />
        </mesh>
      )}
      {builtScenery.buildingAccentsGeo && (
        <mesh geometry={builtScenery.buildingAccentsGeo}>
          <meshStandardMaterial vertexColors emissive="#ffffff" emissiveIntensity={0.4} />
        </mesh>
      )}

      {/* 4. 3D GP Grandstands & Modular 3-Bay Pit Garages */}
      {builtScenery.grandstandsGeo && (
        <mesh geometry={builtScenery.grandstandsGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.55} />
        </mesh>
      )}
      {builtScenery.pitBoxesGeo && (
        <mesh geometry={builtScenery.pitBoxesGeo} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.5} metalness={0.18} />
        </mesh>
      )}
      {builtScenery.pitBoxLightsGeo && (
        <mesh geometry={builtScenery.pitBoxLightsGeo}>
          <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.95} />
        </mesh>
      )}

      {/* 5. 3D Desert Rocks & Cacti (Merged into 1 draw call) */}
      {builtScenery.rocksGeo && (
        <mesh geometry={builtScenery.rocksGeo} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.9} />
        </mesh>
      )}

      {/* 6. Live Spray Can 3D Brush Ring on Ground */}
      {activeSpray && cursorPos && (
        <group position={[cursorPos[0], groundY + 0.45, cursorPos[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[Math.max(2, sprayRadius - 2.2), sprayRadius, 48]} />
            <meshBasicMaterial color={cursorColor} transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[sprayRadius, 48]} />
            <meshBasicMaterial color={cursorColor} transparent opacity={0.16} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
    </group>
  );
});
