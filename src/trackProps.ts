import * as THREE from 'three';
import { SplineNode, RoadBranch, buildSplineArcSampler, computeSpline } from './tracks';
import { bermaWidth, getZone } from './trackCorridor';
import type { TrackFrame3D } from './trackProfile';

export interface CorridorWallData {
  scaleL: number[];
  scaleR: number[];
  wallL: number[];
  wallR: number[];
  wallTL: number[];
  wallTR: number[];
}

export interface TrackPropsData {
  metalPostsGeo: THREE.BufferGeometry | null;
  lightHeadsGeo: THREE.BufferGeometry | null;
  boards50Geo: THREE.BufferGeometry | null;
  boards100Geo: THREE.BufferGeometry | null;
  boards150Geo: THREE.BufferGeometry | null;
  chevronsGeo: THREE.BufferGeometry | null;
  gantryBannerGeo: THREE.BufferGeometry | null;
}

interface GeoBuffers {
  verts: number[];
  norms: number[];
  uvs: number[];
  indices: number[];
}

function createBuffers(): GeoBuffers {
  return { verts: [], norms: [], uvs: [], indices: [] };
}

function appendGeo(
  src: THREE.BufferGeometry,
  mat: THREE.Matrix4,
  dst: GeoBuffers,
  flipU = false
) {
  const pos = src.getAttribute('position');
  const norm = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const idx = src.getIndex();
  if (!pos || !idx) return;

  const base = dst.verts.length / 3;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nMat = new THREE.Matrix3().getNormalMatrix(mat);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mat);
    dst.verts.push(v.x, v.y, v.z);
    if (norm) {
      n.fromBufferAttribute(norm, i).applyMatrix3(nMat).normalize();
      dst.norms.push(n.x, n.y, n.z);
    } else {
      dst.norms.push(0, 1, 0);
    }
    if (uv) {
      const u = uv.getX(i);
      dst.uvs.push(flipU ? 1 - u : u, uv.getY(i));
    } else {
      dst.uvs.push(0, 0);
    }
  }
  for (let i = 0; i < idx.count; i++) {
    dst.indices.push(base + idx.getX(i));
  }
}

function finalizeGeo(buf: GeoBuffers, includeUvs: boolean): THREE.BufferGeometry | null {
  if (buf.indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.norms, 3));
  if (includeUvs) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  }
  g.setIndex(buf.indices);
  return g;
}

interface RoadSeg {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  outerRadius: number;
  sMid: number;
  isMain: boolean;
}

/**
 * Automatically generates braking distance boards (150/100/50m), corner chevrons,
 * long-straight overhead GP gantries, circuit light masts, and barrier fence stanchions
 * while respecting tunnels, bridges, hairpins, pit lanes, and branch junctions.
 */
export function buildTrackPropsData(
  spline: SplineNode[],
  isClosed: boolean,
  branches: RoadBranch[] | undefined,
  pitSpline: SplineNode[] | undefined,
  corridor: CorridorWallData,
  _frames?: TrackFrame3D[]
): TrackPropsData {
  const empty: TrackPropsData = {
    metalPostsGeo: null,
    lightHeadsGeo: null,
    boards50Geo: null,
    boards100Geo: null,
    boards150Geo: null,
    chevronsGeo: null,
    gantryBannerGeo: null,
  };
  const N = spline?.length ?? 0;
  if (N < 4) return empty;

  const arcSampler = buildSplineArcSampler(spline, isClosed);
  const L = arcSampler.totalLen;
  if (L < 60) return empty;

  // Build cumulative arc lengths matching spline node indices
  const segCountMain = isClosed ? N : N - 1;
  const nodeCumS = new Float64Array(N);
  for (let i = 1; i < N; i++) {
    nodeCumS[i] = nodeCumS[i - 1] + Math.hypot(spline[i].x - spline[i - 1].x, spline[i].y - spline[i - 1].y);
  }

  const getMainInfoAtS = (rawS: number) => {
    const s = isClosed ? ((rawS % L) + L) % L : Math.max(0, Math.min(L, rawS));
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodeCumS[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const nextIdx = isClosed ? (lo + 1) % N : Math.min(N - 1, lo + 1);
    const sA = nodeCumS[lo];
    const sB = lo === N - 1 && isClosed ? L : nodeCumS[nextIdx];
    const span = Math.max(1e-4, sB - sA);
    const t = Math.max(0, Math.min(1, (s - sA) / span));
    const nA = spline[lo];
    const nB = spline[nextIdx];

    const wL = (corridor.wallL[lo] + corridor.wallTL[lo]) * (1 - t) + (corridor.wallL[nextIdx] + corridor.wallTL[nextIdx]) * t;
    const wR = (corridor.wallR[lo] + corridor.wallTR[lo]) * (1 - t) + (corridor.wallR[nextIdx] + corridor.wallTR[nextIdx]) * t;
    const scaleL = corridor.scaleL[lo] * (1 - t) + corridor.scaleL[nextIdx] * t;
    const scaleR = corridor.scaleR[lo] * (1 - t) + corridor.scaleR[nextIdx] * t;
    const isTunnel = Boolean(nA.isTunnel || nB.isTunnel);

    return { s, wL, wR, scaleL, scaleR, isTunnel };
  };

  // Spatial hash of all road/branch/pit segments for overlap protection
  const roadSegs: RoadSeg[] = [];
  const junctionAnchors: Array<{ x: number; z: number }> = [];

  const pushNodeList = (pts: SplineNode[], closed: boolean, isMain: boolean) => {
    const M = pts.length;
    if (M < 2) return;
    const count = closed ? M : M - 1;
    let runS = 0;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % M];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const outA = (a.width || 18) * 0.5 + Math.max(bermaWidth(a, 'L') + getZone(a, 'wallThickness', 'L'), bermaWidth(a, 'R') + getZone(a, 'wallThickness', 'R'));
      const outB = (b.width || 18) * 0.5 + Math.max(bermaWidth(b, 'L') + getZone(b, 'wallThickness', 'L'), bermaWidth(b, 'R') + getZone(b, 'wallThickness', 'R'));
      roadSegs.push({
        ax: a.x,
        az: a.y,
        ay: a.z ?? 0,
        bx: b.x,
        bz: b.y,
        by: b.z ?? 0,
        outerRadius: Math.max(outA, outB),
        sMid: runS + segLen * 0.5,
        isMain,
      });
      runS += segLen;
    }
  };

  pushNodeList(spline, isClosed, true);
  if (branches) {
    for (const br of branches) {
      if (br.points && br.points.length >= 2) {
        const dense = br.points.length < 16 ? computeSpline(br.points, false) : br.points;
        pushNodeList(dense, false, false);
        junctionAnchors.push({ x: dense[0].x, z: dense[0].y });
        junctionAnchors.push({ x: dense[dense.length - 1].x, z: dense[dense.length - 1].y });
      }
    }
  }
  if (pitSpline && pitSpline.length >= 2) {
    pushNodeList(pitSpline, false, false);
    junctionAnchors.push({ x: pitSpline[0].x, z: pitSpline[0].y });
    junctionAnchors.push({ x: pitSpline[pitSpline.length - 1].x, z: pitSpline[pitSpline.length - 1].y });
  }

  const CELL = 40;
  const cellKey = (gx: number, gz: number) => (gx + 100000) * 200001 + (gz + 100000);
  const segGrid = new Map<number, number[]>();
  for (let i = 0; i < roadSegs.length; i++) {
    const g = roadSegs[i];
    const pad = g.outerRadius + 10;
    const x0 = Math.floor((Math.min(g.ax, g.bx) - pad) / CELL);
    const x1 = Math.floor((Math.max(g.ax, g.bx) + pad) / CELL);
    const z0 = Math.floor((Math.min(g.az, g.bz) - pad) / CELL);
    const z1 = Math.floor((Math.max(g.az, g.bz) + pad) / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = cellKey(gx, gz);
        let arr = segGrid.get(k);
        if (!arr) {
          arr = [];
          segGrid.set(k, arr);
        }
        arr.push(i);
      }
    }
  }

  const isPropClear = (px: number, py: number, pz: number, sMain: number, minPad = 0.65): boolean => {
    for (let j = 0; j < junctionAnchors.length; j++) {
      const ja = junctionAnchors[j];
      if (Math.hypot(px - ja.x, pz - ja.z) < 22) return false;
    }
    const cands = segGrid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL)));
    if (!cands) return true;
    for (let k = 0; k < cands.length; k++) {
      const g = roadSegs[cands[k]];
      if (g.isMain) {
        let arcDiff = Math.abs(g.sMid - sMain);
        if (isClosed) arcDiff = Math.min(arcDiff, L - arcDiff);
        if (arcDiff < 28) continue;
      }
      const dx = g.bx - g.ax;
      const dz = g.bz - g.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - g.ax) * dx + (pz - g.az) * dz) / l2));
      const segY = g.ay + t * (g.by - g.ay);
      if (Math.abs(py - segY) > 3.5) continue;
      const dist = Math.hypot(px - (g.ax + t * dx), pz - (g.az + t * dz));
      if (dist < g.outerRadius + minPad) return false;
    }
    return true;
  };

  const isNearTunnelOrStart = (sVal: number): boolean => {
    const s = isClosed ? ((sVal % L) + L) % L : sVal;
    const startDist = isClosed ? Math.min(s, L - s) : s;
    if (startDist < 28) return true;
    if (getMainInfoAtS(s).isTunnel) return true;
    if (getMainInfoAtS(s - 6).isTunnel || getMainInfoAtS(s + 6).isTunnel) return true;
    return false;
  };

  // Sample curvature every 5m along main spline
  const STEP = 5;
  const nSamp = Math.max(8, Math.floor(L / STEP));
  const rawKappa = new Float64Array(nSamp);
  for (let i = 0; i < nSamp; i++) {
    const s = i * STEP;
    const sA = isClosed ? ((s - STEP) % L + L) % L : Math.max(0, s - STEP);
    const sB = isClosed ? (s + STEP) % L : Math.min(L, s + STEP);
    const span = isClosed ? 2 * STEP : Math.max(1, sB - sA);
    const a = arcSampler.sampleAt(sA);
    const b = arcSampler.sampleAt(sB);
    const cross = b.tx * a.lx + b.tz * a.lz; // >0 = turning Driver Left, <0 = turning Driver Right
    const dot = Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz));
    const angle = Math.acos(dot);
    rawKappa[i] = ((cross >= 0 ? 1 : -1) * angle) / span;
  }

  // Smooth curvature slightly to ignore micro spline noise
  const signedKappa = new Float64Array(nSamp);
  for (let i = 0; i < nSamp; i++) {
    const iPrev = isClosed ? (i - 1 + nSamp) % nSamp : Math.max(0, i - 1);
    const iNext = isClosed ? (i + 1) % nSamp : Math.min(nSamp - 1, i + 1);
    signedKappa[i] = rawKappa[iPrev] * 0.25 + rawKappa[i] * 0.5 + rawKappa[iNext] * 0.25;
  }

  // Prepare merged buffers & unit primitives
  const metalBuf = createBuffers();
  const lightBuf = createBuffers();
  const b50Buf = createBuffers();
  const b100Buf = createBuffers();
  const b150Buf = createBuffers();
  const chevronBuf = createBuffers();
  const bannerBuf = createBuffers();

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const boardPlane = new THREE.PlaneGeometry(2.3, 1.55);
  const chevronPlane = new THREE.PlaneGeometry(3.2, 1.45);
  const bannerPlane = new THREE.PlaneGeometry(1, 1.65);

  const m4 = new THREE.Matrix4();
  const qRot = new THREE.Quaternion();
  const pVec = new THREE.Vector3();
  const sVec = new THREE.Vector3();
  const basisMat = new THREE.Matrix4();

  const makeOrientedMatrix = (
    px: number,
    py: number,
    pz: number,
    rightX: number,
    rightY: number,
    rightZ: number,
    upX: number,
    upY: number,
    upZ: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number,
    sx = 1,
    sy = 1,
    sz = 1
  ) => {
    basisMat.set(
      rightX * sx, upX * sy, fwdX * sz, px,
      rightY * sx, upY * sy, fwdY * sz, py,
      rightZ * sx, upZ * sy, fwdZ * sz, pz,
      0, 0, 0, 1
    );
    return basisMat;
  };

  // Helper to place a board facing oncoming drivers (-tangent)
  const placeSignBoard = (
    sPos: number,
    sideSign: 1 | -1, // +1 = Left, -1 = Right
    dst: GeoBuffers,
    boardW: number,
    boardH: number,
    planeGeo: THREE.BufferGeometry,
    flipU = false,
    centerH = 1.65,
    extraInwardYaw = 0.14
  ) => {
    if (isNearTunnelOrStart(sPos)) return;
    if (!isClosed && (sPos < 10 || sPos > L - 10)) return;
    const info = getMainInfoAtS(sPos);
    const scale = sideSign === 1 ? info.scaleL : info.scaleR;
    if (scale < 0.4) return;
    const wallDist = sideSign === 1 ? info.wL : info.wR;
    const sp = arcSampler.sampleAt(sPos);
    const lat = wallDist + 0.65;
    const bx = sp.x + sp.lx * (sideSign * lat);
    const bz = sp.z + sp.lz * (sideSign * lat);
    const roadY = sp.y + Math.abs(sp.bankSin) * ((sp.width || 18) * 0.5) - sideSign * lat * sp.bankSin;
    const by = Math.max(sp.y, roadY);

    if (!isPropClear(bx, by, bz, info.s, 0.45)) return;

    // Board +Z faces oncoming traffic (-tx, 0, -tz), tilted slightly inward toward road center
    const yaw = Math.atan2(-sp.tx, -sp.tz) + sideSign * extraInwardYaw;
    qRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // Backing plate
    pVec.set(bx, by + centerH, bz);
    sVec.set(boardW + 0.08, boardH + 0.08, 0.08);
    m4.compose(pVec, qRot, sVec);
    appendGeo(unitBox, m4, metalBuf);

    // Front face offset slightly along local +Z
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    pVec.set(bx + fwdX * 0.048, by + centerH, bz + fwdZ * 0.048);
    sVec.set(1, 1, 1);
    m4.compose(pVec, qRot, sVec);
    appendGeo(planeGeo, m4, dst, flipU);

    // Twin steel legs down into ground
    const legH = centerH - boardH * 0.5 + 0.45;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (const lxOff of [-boardW * 0.34, boardW * 0.34]) {
      pVec.set(bx + rx * lxOff, by + legH * 0.5 - 0.35, bz + rz * lxOff);
      sVec.set(0.09, legH, 0.09);
      m4.compose(pVec, qRot, sVec);
      appendGeo(unitBox, m4, metalBuf);
    }
  };

  // 1. Detect corners & place 150m / 100m / 50m braking boards + outside chevrons
  const cornerEntries: Array<{ sEntry: number; sPeak: number; sExit: number; dirSign: 1 | -1; maxKappa: number }> = [];
  const CURVE_THRESH = 0.011;
  let inCurve = false;
  let cStartIdx = 0;
  let cMaxAbs = 0;
  let cPeakIdx = 0;
  let cDir: 1 | -1 = 1;

  for (let i = 0; i < nSamp; i++) {
    const k = signedKappa[i];
    const absK = Math.abs(k);
    if (!inCurve) {
      if (absK >= CURVE_THRESH) {
        inCurve = true;
        cStartIdx = i;
        cMaxAbs = absK;
        cPeakIdx = i;
        cDir = k >= 0 ? 1 : -1;
      }
    } else {
      const sameDir = (k >= 0 ? 1 : -1) === cDir;
      if (absK >= CURVE_THRESH * 0.65 && sameDir) {
        if (absK > cMaxAbs) {
          cMaxAbs = absK;
          cPeakIdx = i;
        }
      } else {
        const sEntry = cStartIdx * STEP;
        const sExit = i * STEP;
        const last = cornerEntries[cornerEntries.length - 1];
        if (!last || sEntry - last.sEntry >= 85) {
          cornerEntries.push({ sEntry, sPeak: cPeakIdx * STEP, sExit, dirSign: cDir, maxKappa: cMaxAbs });
        }
        inCurve = false;
        if (absK >= CURVE_THRESH) {
          inCurve = true;
          cStartIdx = i;
          cMaxAbs = absK;
          cPeakIdx = i;
          cDir = k >= 0 ? 1 : -1;
        }
      }
    }
  }
  if (inCurve) {
    const sEntry = cStartIdx * STEP;
    const last = cornerEntries[cornerEntries.length - 1];
    if (!last || sEntry - last.sEntry >= 85) {
      cornerEntries.push({ sEntry, sPeak: cPeakIdx * STEP, sExit: nSamp * STEP, dirSign: cDir, maxKappa: cMaxAbs });
    }
  }

  for (let c = 0; c < cornerEntries.length; c++) {
    const corner = cornerEntries[c];
    const prevCorner = c > 0 ? cornerEntries[c - 1] : isClosed && cornerEntries.length > 1 ? cornerEntries[cornerEntries.length - 1] : null;
    const distFromPrevExit = prevCorner
      ? isClosed
        ? ((corner.sEntry - prevCorner.sExit + L) % L)
        : corner.sEntry - prevCorner.sExit
      : 999;

    const boardSpecs: Array<{ dist: number; buf: GeoBuffers }> = [
      { dist: 150, buf: b150Buf },
      { dist: 100, buf: b100Buf },
      { dist: 50, buf: b50Buf },
    ];

    for (const bs of boardSpecs) {
      if (distFromPrevExit < bs.dist + 22) continue;
      const sBoard = corner.sEntry - bs.dist;
      if (!isClosed && sBoard < 15) continue;
      const idxB = Math.floor((((sBoard % L) + L) % L) / STEP) % nSamp;
      if (Math.abs(signedKappa[idxB]) >= 0.011) continue; // Only place braking boards on straight/gentle approach

      placeSignBoard(sBoard, 1, bs.buf, 2.3, 1.55, boardPlane, false);
      placeSignBoard(sBoard, -1, bs.buf, 2.3, 1.55, boardPlane, false);
    }

    // Outside corner chevrons for sharp/medium turns
    if (corner.maxKappa >= 0.016) {
      const outsideSide: 1 | -1 = corner.dirSign === 1 ? -1 : 1;
      const flipArrows = corner.dirSign === 1; // Left turn -> arrows point left (<<<)
      const curveLen = Math.max(20, corner.sExit - corner.sEntry);
      const chevs = curveLen >= 55 ? [0.18, 0.5, 0.82] : [0.28, 0.72];
      for (const frac of chevs) {
        const sChev = corner.sEntry + curveLen * frac;
        placeSignBoard(sChev, outsideSide, chevronBuf, 3.2, 1.45, chevronPlane, flipArrows, 1.7, 0.06);
      }
    }
  }

  // 2. Overhead GP Gantries on long straight spans (>= 160m)
  const STRAIGHT_THRESH = 0.0055;
  const straightRuns: Array<{ sStart: number; len: number }> = [];
  let stStart = -1;
  for (let i = 0; i < nSamp; i++) {
    if (Math.abs(signedKappa[i]) < STRAIGHT_THRESH) {
      if (stStart < 0) stStart = i;
    } else if (stStart >= 0) {
      const len = (i - stStart) * STEP;
      if (len >= 160) straightRuns.push({ sStart: stStart * STEP, len });
      stStart = -1;
    }
  }
  if (stStart >= 0) {
    const len = (nSamp - stStart) * STEP;
    if (len >= 160) straightRuns.push({ sStart: stStart * STEP, len });
  }

  const gantrySList: number[] = [];
  for (const sr of straightRuns) {
    const spots = sr.len >= 440 ? [0.33, 0.67] : [0.5];
    for (const frac of spots) {
      const sg = sr.sStart + sr.len * frac;
      const startDist = isClosed ? Math.min(sg % L, L - (sg % L)) : sg;
      if (startDist < 90) continue; // Keep clear of Start/Finish gantry
      if (isNearTunnelOrStart(sg)) continue;

      const info = getMainInfoAtS(sg);
      if (info.scaleL < 0.45 || info.scaleR < 0.45) continue;
      const sp = arcSampler.sampleAt(sg);
      const offL = info.wL + 0.85;
      const offR = info.wR + 0.85;
      const pL = new THREE.Vector3(sp.x + sp.lx * offL, sp.y, sp.z + sp.lz * offL);
      const pR = new THREE.Vector3(sp.x - sp.lx * offR, sp.y, sp.z - sp.lz * offR);
      if (!isPropClear(pL.x, pL.y, pL.z, info.s, 0.5) || !isPropClear(pR.x, pR.y, pR.z, info.s, 0.5)) continue;

      const spanW = pL.distanceTo(pR);
      const deckClearH = 11.4; // Well above 5.2m chase camera!
      const beamY = sp.y + deckClearH + 0.85;
      const midX = (pL.x + pR.x) * 0.5;
      const midZ = (pL.z + pR.z) * 0.5;
      const yaw = Math.atan2(sp.tx, sp.tz);
      qRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

      // Left & Right support towers
      for (const leg of [pL, pR]) {
        pVec.set(leg.x, sp.y + (deckClearH + 1.6) * 0.5 - 0.3, leg.z);
        sVec.set(0.45, deckClearH + 1.9, 0.55);
        m4.compose(pVec, qRot, sVec);
        appendGeo(unitBox, m4, metalBuf);
      }

      // Upper & Lower truss chords spanning across road
      for (const dy of [-0.65, 0.65]) {
        pVec.set(midX, beamY + dy, midZ);
        sVec.set(spanW + 0.5, 0.24, 0.65);
        m4.compose(pVec, qRot, sVec);
        appendGeo(unitBox, m4, metalBuf);
      }

      // Vertical truss struts along span
      const nStruts = Math.max(4, Math.floor(spanW / 4.5));
      for (let k = 0; k <= nStruts; k++) {
        const u = k / nStruts - 0.5;
        pVec.set(midX + sp.lx * (u * spanW), beamY, midZ + sp.lz * (u * spanW));
        sVec.set(0.18, 1.3, 0.45);
        m4.compose(pVec, qRot, sVec);
        appendGeo(unitBox, m4, metalBuf);
      }

      // Front & Back GP overhead banners
      const bannerW = Math.max(8, spanW - 2.2);
      for (const faceSign of [-1, 1]) {
        const faceYaw = faceSign === -1 ? Math.atan2(-sp.tx, -sp.tz) : yaw;
        const fq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceYaw);
        pVec.set(midX + sp.tx * (faceSign * 0.36), beamY, midZ + sp.tz * (faceSign * 0.36));
        sVec.set(bannerW, 1, 1);
        m4.compose(pVec, fq, sVec);
        appendGeo(bannerPlane, m4, bannerBuf);
      }

      gantrySList.push(sg);
    }
  }

  // 3. Periodic Circuit Light Masts (every 48m) & Barrier Fence Stanchions (every 16m)
  const MAST_STEP = 48;
  for (let s = 24; s < L - 16; s += MAST_STEP) {
    if (isNearTunnelOrStart(s)) continue;
    if (gantrySList.some((gs) => Math.abs(gs - s) < 22)) continue;
    const info = getMainInfoAtS(s);
    const sp = arcSampler.sampleAt(s);
    const idxK = Math.floor((s % L) / STEP) % nSamp;
    const kVal = signedKappa[idxK];
    // Place on outer side of curves, or alternate sides on straights
    const sideSign: 1 | -1 = Math.abs(kVal) > 0.006 ? (kVal >= 0 ? -1 : 1) : (Math.floor(s / MAST_STEP) % 2 === 0 ? 1 : -1);
    const scale = sideSign === 1 ? info.scaleL : info.scaleR;
    if (scale < 0.45) continue;

    const wallDist = sideSign === 1 ? info.wL : info.wR;
    const lat = wallDist + 0.45;
    const mx = sp.x + sp.lx * (sideSign * lat);
    const mz = sp.z + sp.lz * (sideSign * lat);
    const my = sp.y;
    if (!isPropClear(mx, my, mz, info.s, 0.35)) continue;

    const inX = -sp.lx * sideSign;
    const inZ = -sp.lz * sideSign;
    const mastYaw = Math.atan2(sp.tx, sp.tz);
    qRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), mastYaw);

    // Tall vertical mast
    const mastH = 11.2;
    pVec.set(mx, my + mastH * 0.5 - 0.3, mz);
    sVec.set(0.22, mastH, 0.22);
    m4.compose(pVec, qRot, sVec);
    appendGeo(unitBox, m4, metalBuf);

    // Angled overhang arm pointing inward over road edge
    const armLen = 3.2;
    pVec.set(mx + inX * (armLen * 0.45), my + mastH - 0.15, mz + inZ * (armLen * 0.45));
    const armQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(inX, inZ));
    sVec.set(0.16, 0.16, armLen);
    m4.compose(pVec, armQ, sVec);
    appendGeo(unitBox, m4, metalBuf);

    // LED floodlight head
    pVec.set(mx + inX * (armLen * 0.86), my + mastH - 0.28, mz + inZ * (armLen * 0.86));
    sVec.set(0.85, 0.14, 0.48);
    m4.compose(pVec, armQ, sVec);
    appendGeo(unitBox, m4, lightBuf);
  }

  // Slender FIA barrier fence stanchions along both sides every 16m
  const POST_STEP = 16;
  for (let s = 10; s < L - 10; s += POST_STEP) {
    if (isNearTunnelOrStart(s)) continue;
    const info = getMainInfoAtS(s);
    const sp = arcSampler.sampleAt(s);
    for (const sideSign of [1, -1] as const) {
      const scale = sideSign === 1 ? info.scaleL : info.scaleR;
      if (scale < 0.45) continue;
      const wallDist = sideSign === 1 ? info.wL : info.wR;
      const px = sp.x + sp.lx * (sideSign * (wallDist - 0.15));
      const pz = sp.z + sp.lz * (sideSign * (wallDist - 0.15));
      if (!isPropClear(px, sp.y, pz, info.s, 0.2)) continue;
      makeOrientedMatrix(px, sp.y + 1.45, pz, sp.lx, 0, sp.lz, 0, 1, 0, sp.tx, 0, sp.tz, 0.08, 1.5, 0.08);
      appendGeo(unitBox, basisMat, metalBuf);
    }
  }

  unitBox.dispose();
  boardPlane.dispose();
  chevronPlane.dispose();
  bannerPlane.dispose();
  void segCountMain;

  return {
    metalPostsGeo: finalizeGeo(metalBuf, false),
    lightHeadsGeo: finalizeGeo(lightBuf, false),
    boards50Geo: finalizeGeo(b50Buf, true),
    boards100Geo: finalizeGeo(b100Buf, true),
    boards150Geo: finalizeGeo(b150Buf, true),
    chevronsGeo: finalizeGeo(chevronBuf, true),
    gantryBannerGeo: finalizeGeo(bannerBuf, true),
  };
}

// ==================== PROCEDURAL TEXTURE FACTORIES (BROWSER ONLY) ====================

export function makeAsphaltGrainTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  // Deterministic fine aggregate grain (high-luminance 216..255 so custom asphalt colors stay accurate)
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coarse = Math.sin(x * 0.196 + y * 0.147) * 5 + Math.cos(x * 0.098 - y * 0.245) * 4;
      const grain = (nextRand() - 0.5) * 30;
      const lum = Math.max(205, Math.min(255, Math.round(236 + coarse + grain)));
      const idx = (y * size + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum;
      data[idx + 2] = Math.min(255, lum + 2);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeCurbStripeTexture(): THREE.DataTexture {
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const halfA = y < h / 2;
    const isJoint = y === 0 || y === h / 2 || y === h - 1 || y === h / 2 - 1;
    for (let x = 0; x < w; x++) {
      let lum = halfA ? 255 : 102;
      if (isJoint) lum = 68;
      else if (x < 3 || x >= w - 3) lum = Math.round(lum * 0.85);
      const idx = (y * w + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum;
      data[idx + 2] = lum;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeWallPanelTexture(): THREE.DataTexture {
  const w = 256;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  let seed = 4242;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    const vFrac = y / h;
    const isTopStripe = vFrac >= 0.72 && vFrac <= 0.86;
    const isBaseShadow = vFrac < 0.14;
    for (let x = 0; x < w; x++) {
      const isJoint = x <= 2 || x >= w - 3 || (x >= w / 2 - 1 && x <= w / 2 + 1);
      let lum = 232 + Math.round((nextRand() - 0.5) * 18);
      if (isTopStripe) lum = 255;
      if (isBaseShadow) lum = Math.round(lum * 0.78);
      if (isJoint) lum = 135;
      const idx = (y * w + x) * 4;
      data[idx] = lum;
      data[idx + 1] = lum;
      data[idx + 2] = lum;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function makeBrakingBoardTexture(label: '50' | '100' | '150'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 192);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 182);

    ctx.fillStyle = label === '50' ? '#dc2626' : label === '100' ? '#ea580c' : '#0284c7';
    ctx.fillRect(10, 150, 236, 32);

    ctx.fillStyle = '#0f172a';
    ctx.font = '900 108px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 86);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function makeChevronBoardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 122);

    // Three vivid >>> chevrons pointing right (u=0 -> u=1)
    ctx.fillStyle = '#facc15';
    for (const cx of [38, 114, 190]) {
      ctx.beginPath();
      ctx.moveTo(cx - 18, 20);
      ctx.lineTo(cx + 12, 20);
      ctx.lineTo(cx + 42, 64);
      ctx.lineTo(cx + 12, 108);
      ctx.lineTo(cx - 18, 108);
      ctx.lineTo(cx + 12, 64);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function makeGantryBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, 512, 18);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 110, 512, 18);

    // Chequered side accents
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#f8fafc' : '#1e293b';
        ctx.fillRect(14 + col * 18, 28 + row * 18, 18, 18);
        ctx.fillRect(444 + col * 18, 28 + row * 18, 18, 18);
      }
    }

    ctx.fillStyle = '#f8fafc';
    ctx.font = '900 46px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MINIRACE GP', 256, 66);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
