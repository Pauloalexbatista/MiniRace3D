import * as THREE from 'three';
import { SplineNode, RoadBranch, computeSpline } from './tracks';
import { computeCorridor, bermaWidth, getZone } from './trackCorridor';

export const TUNNEL_BACK = 6.5;
export const TUNNEL_HEIGHT = 2.65;
export const TUNNEL_APPROACH_DIST = 26;

export interface TunnelFrame {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  sz: number;
  ux: number;
  uy: number;
  uz: number;
  wL: number;
  wR: number;
  s: number;
}

export interface TunnelRun {
  id: string;
  frames: TunnelFrame[];
  totalLen: number;
  isFullLoop: boolean;
}

export interface TunnelIndex {
  runs: TunnelRun[];
}

export interface CarTunnelState {
  status: 'inside' | 'approaching';
  run: TunnelRun;
  sCar: number;
  carLat: number;
  carRelUp: number;
  dirSign: 1 | -1;
  blend: number;
}

/**
 * Matches the cross-section ceiling profile of Track3D's 5-point tunnel arch.
 */
export function tunnelArchCeilingHeight(lat: number, wL: number, wR: number): number {
  const frac =
    lat >= 0
      ? Math.min(1, lat / Math.max(1, wL * 0.92))
      : Math.min(1, (-lat) / Math.max(1, wR * 0.92));
  return 9.8 - 2.0 * frac;
}

function makeEmptyFrame(): TunnelFrame {
  return {
    px: 0,
    py: 0,
    pz: 0,
    tx: 0,
    ty: 0,
    tz: 1,
    sx: 1,
    sy: 0,
    sz: 0,
    ux: 0,
    uy: 1,
    uz: 0,
    wL: 10,
    wR: 10,
    s: 0,
  };
}

function copyFrame(src: TunnelFrame, out: TunnelFrame): TunnelFrame {
  out.px = src.px;
  out.py = src.py;
  out.pz = src.pz;
  out.tx = src.tx;
  out.ty = src.ty;
  out.tz = src.tz;
  out.sx = src.sx;
  out.sy = src.sy;
  out.sz = src.sz;
  out.ux = src.ux;
  out.uy = src.uy;
  out.uz = src.uz;
  out.wL = src.wL;
  out.wR = src.wR;
  out.s = src.s;
  return out;
}

function finalizeRunFrames(id: string, rawFrames: TunnelFrame[], isFullLoop: boolean): TunnelRun {
  let accS = 0;
  for (let i = 0; i < rawFrames.length; i++) {
    if (i > 0) {
      const a = rawFrames[i - 1];
      const b = rawFrames[i];
      accS += Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
    }
    rawFrames[i].s = accS;
  }
  return {
    id,
    frames: rawFrames,
    totalLen: accS,
    isFullLoop,
  };
}

function extractRunsFromFrames(
  idPrefix: string,
  srcFrames: TunnelFrame[],
  tunnelMask: boolean[],
  closed: boolean,
  outRuns: TunnelRun[]
): void {
  const len = srcFrames.length;
  if (len < 2 || !tunnelMask.some(Boolean)) return;

  const maxSeg = closed ? len : len - 1;
  const segActive = new Array<boolean>(maxSeg);
  let activeCount = 0;
  for (let i = 0; i < maxSeg; i++) {
    const nextIdx = (i + 1) % len;
    const active = Boolean(tunnelMask[i] && tunnelMask[nextIdx]);
    segActive[i] = active;
    if (active) activeCount++;
  }
  if (activeCount === 0) return;

  if (closed && activeCount === maxSeg) {
    const loopFrames = srcFrames.map((f) => copyFrame(f, makeEmptyFrame()));
    loopFrames.push(copyFrame(srcFrames[0], makeEmptyFrame()));
    outRuns.push(finalizeRunFrames(`${idPrefix}_loop`, loopFrames, true));
    return;
  }

  let startSeg = 0;
  if (closed && segActive[0] && segActive[maxSeg - 1]) {
    for (let i = 1; i < maxSeg; i++) {
      if (segActive[i] && !segActive[i - 1]) {
        startSeg = i;
        break;
      }
    }
  }

  let currentFrames: TunnelFrame[] | null = null;
  let runCounter = 0;
  for (let step = 0; step < maxSeg; step++) {
    const segIdx = closed ? (startSeg + step) % maxSeg : step;
    if (segActive[segIdx]) {
      const nextIdx = (segIdx + 1) % len;
      if (!currentFrames) {
        currentFrames = [copyFrame(srcFrames[segIdx], makeEmptyFrame())];
      }
      currentFrames.push(copyFrame(srcFrames[nextIdx], makeEmptyFrame()));
    } else if (currentFrames) {
      outRuns.push(finalizeRunFrames(`${idPrefix}_${runCounter++}`, currentFrames, false));
      currentFrames = null;
    }
  }
  if (currentFrames) {
    outRuns.push(finalizeRunFrames(`${idPrefix}_${runCounter++}`, currentFrames, false));
  }
}

/**
 * Builds an index of all active tunnel runs across the main spline and road branches.
 */
export function buildTunnelIndex(
  spline: SplineNode[],
  isClosed: boolean,
  branches?: RoadBranch[]
): TunnelIndex {
  const hasMainTunnel = Boolean(spline && spline.length >= 2 && spline.some((s) => Boolean(s.isTunnel)));
  const hasBranchTunnel = Boolean(
    branches && branches.some((b) => b.points && b.points.length >= 2 && b.points.some((p) => Boolean(p.isTunnel)))
  );
  if (!hasMainTunnel && !hasBranchTunnel) {
    return { runs: [] };
  }

  const runs: TunnelRun[] = [];
  const vCurr = new THREE.Vector3();
  const vPrev = new THREE.Vector3();
  const vNext = new THREE.Vector3();
  const vTan = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vSide = new THREE.Vector3();

  if (hasMainTunnel) {
    const N = spline.length;
    const corridor = computeCorridor(spline, isClosed);
    const mainFrames: TunnelFrame[] = new Array(N);
    const mainMask: boolean[] = new Array(N);

    for (let i = 0; i < N; i++) {
      const curr = spline[i];
      const prev = isClosed ? spline[(i - 1 + N) % N] : spline[Math.max(0, i - 1)];
      const next = isClosed ? spline[(i + 1) % N] : spline[Math.min(N - 1, i + 1)];

      vCurr.set(curr.x, curr.z ?? 0, curr.y);
      vPrev.set(prev.x, prev.z ?? 0, prev.y);
      vNext.set(next.x, next.z ?? 0, next.y);

      vTan.subVectors(vNext, vPrev).normalize();
      if (vTan.lengthSq() === 0) vTan.set(1, 0, 0);

      vUp.set(0, 1, 0);
      vSide.crossVectors(vTan, vUp).normalize();
      if (vSide.lengthSq() === 0) vSide.set(0, 0, 1);
      vUp.crossVectors(vSide, vTan).normalize();

      const hw = (curr.width || 18) / 2;
      const bL = bermaWidth(curr, 'L');
      const bR = bermaWidth(curr, 'R');
      const wTL = getZone(curr, 'wallThickness', 'L');
      const wTR = getZone(curr, 'wallThickness', 'R');

      if (curr.banking) {
        const bankingRad = (curr.banking * Math.PI) / 180;
        vSide.applyAxisAngle(vTan, bankingRad);
        vUp.applyAxisAngle(vTan, bankingRad);
        const maxHalfW = hw + Math.max(bL, bR) + Math.max(wTL, wTR);
        vCurr.y += Math.sin(Math.abs(bankingRad)) * maxHalfW;
      }

      mainFrames[i] = {
        px: vCurr.x,
        py: vCurr.y,
        pz: vCurr.z,
        tx: vTan.x,
        ty: vTan.y,
        tz: vTan.z,
        sx: vSide.x,
        sy: vSide.y,
        sz: vSide.z,
        ux: vUp.x,
        uy: vUp.y,
        uz: vUp.z,
        wL: Math.max(hw + 0.5, hw + bL * corridor.scaleL[i]),
        wR: Math.max(hw + 0.5, hw + bR * corridor.scaleR[i]),
        s: 0,
      };
      mainMask[i] = Boolean(curr.isTunnel);
    }

    extractRunsFromFrames('main', mainFrames, mainMask, isClosed, runs);
  }

  if (hasBranchTunnel && branches) {
    for (let bIdx = 0; bIdx < branches.length; bIdx++) {
      const b = branches[bIdx];
      if (!b.points || b.points.length < 2 || !b.points.some((p) => Boolean(p.isTunnel))) continue;
      const dense = computeSpline(b.points, false);
      const M = dense.length;
      if (M < 2) continue;

      const bFrames: TunnelFrame[] = new Array(M);
      const bMask: boolean[] = new Array(M);

      for (let i = 0; i < M; i++) {
        const curr = dense[i];
        const prev = dense[Math.max(0, i - 1)];
        const next = dense[Math.min(M - 1, i + 1)];

        vCurr.set(curr.x, curr.z ?? 0, curr.y);
        vPrev.set(prev.x, prev.z ?? 0, prev.y);
        vNext.set(next.x, next.z ?? 0, next.y);

        vTan.subVectors(vNext, vPrev).normalize();
        if (vTan.lengthSq() === 0) vTan.set(1, 0, 0);

        vUp.set(0, 1, 0);
        vSide.crossVectors(vTan, vUp).normalize();
        if (vSide.lengthSq() === 0) vSide.set(0, 0, 1);
        vUp.crossVectors(vSide, vTan).normalize();

        const hw = (curr.width || 18) / 2;
        if (curr.banking) {
          const bankingRad = (curr.banking * Math.PI) / 180;
          vSide.applyAxisAngle(vTan, bankingRad);
          vUp.applyAxisAngle(vTan, bankingRad);
          vCurr.y += Math.abs(Math.sin(bankingRad)) * hw;
        }

        bFrames[i] = {
          px: vCurr.x,
          py: vCurr.y,
          pz: vCurr.z,
          tx: vTan.x,
          ty: vTan.y,
          tz: vTan.z,
          sx: vSide.x,
          sy: vSide.y,
          sz: vSide.z,
          ux: vUp.x,
          uy: vUp.y,
          uz: vUp.z,
          wL: Math.max(hw + 0.5, hw + bermaWidth(curr, 'L')),
          wR: Math.max(hw + 0.5, hw + bermaWidth(curr, 'R')),
          s: 0,
        };
        bMask[i] = Boolean(curr.isTunnel);
      }

      extractRunsFromFrames(`branch_${b.id || bIdx}`, bFrames, bMask, false, runs);
    }
  }

  return { runs };
}

function normalizeFrameBasis(f: TunnelFrame): void {
  const tLen = Math.hypot(f.tx, f.ty, f.tz) || 1;
  f.tx /= tLen;
  f.ty /= tLen;
  f.tz /= tLen;

  // Orthonormalize side against tangent via Gram-Schmidt, then up = side x tangent
  const st = f.sx * f.tx + f.sy * f.ty + f.sz * f.tz;
  f.sx -= f.tx * st;
  f.sy -= f.ty * st;
  f.sz -= f.tz * st;
  const sLen = Math.hypot(f.sx, f.sy, f.sz) || 1;
  f.sx /= sLen;
  f.sy /= sLen;
  f.sz /= sLen;

  f.ux = f.sy * f.tz - f.sz * f.ty;
  f.uy = f.sz * f.tx - f.sx * f.tz;
  f.uz = f.sx * f.ty - f.sy * f.tx;
}

/**
 * Samples or linearly extrapolates a TunnelFrame along a TunnelRun at 3D arc coordinate s.
 */
export function sampleTunnelRunAt(run: TunnelRun, s: number, out: TunnelFrame): TunnelFrame {
  const frames = run.frames;
  const n = frames.length;
  if (n === 0) return copyFrame(makeEmptyFrame(), out);
  if (n === 1 || run.totalLen <= 1e-6) {
    copyFrame(frames[0], out);
    out.px += out.tx * s;
    out.py += out.ty * s;
    out.pz += out.tz * s;
    out.s = s;
    return out;
  }

  let qS = s;
  if (run.isFullLoop) {
    qS = ((qS % run.totalLen) + run.totalLen) % run.totalLen;
  } else if (qS < 0) {
    const f0 = frames[0];
    copyFrame(f0, out);
    out.px = f0.px + f0.tx * qS;
    out.py = f0.py + f0.ty * qS;
    out.pz = f0.pz + f0.tz * qS;
    out.s = qS;
    return out;
  } else if (qS > run.totalLen) {
    const fEnd = frames[n - 1];
    const extra = qS - run.totalLen;
    copyFrame(fEnd, out);
    out.px = fEnd.px + fEnd.tx * extra;
    out.py = fEnd.py + fEnd.ty * extra;
    out.pz = fEnd.pz + fEnd.tz * extra;
    out.s = qS;
    return out;
  }

  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].s <= qS) lo = mid;
    else hi = mid - 1;
  }

  const fA = frames[lo];
  const fB = frames[lo + 1];
  const span = Math.max(1e-6, fB.s - fA.s);
  const t = Math.max(0, Math.min(1, (qS - fA.s) / span));

  out.px = fA.px + (fB.px - fA.px) * t;
  out.py = fA.py + (fB.py - fA.py) * t;
  out.pz = fA.pz + (fB.pz - fA.pz) * t;
  out.tx = fA.tx + (fB.tx - fA.tx) * t;
  out.ty = fA.ty + (fB.ty - fA.ty) * t;
  out.tz = fA.tz + (fB.tz - fA.tz) * t;
  out.sx = fA.sx + (fB.sx - fA.sx) * t;
  out.sy = fA.sy + (fB.sy - fA.sy) * t;
  out.sz = fA.sz + (fB.sz - fA.sz) * t;
  out.ux = fA.ux + (fB.ux - fA.ux) * t;
  out.uy = fA.uy + (fB.uy - fA.uy) * t;
  out.uz = fA.uz + (fB.uz - fA.uz) * t;
  out.wL = fA.wL + (fB.wL - fA.wL) * t;
  out.wR = fA.wR + (fB.wR - fA.wR) * t;
  out.s = qS;
  normalizeFrameBasis(out);
  return out;
}

function interpolateSegmentFrame(fA: TunnelFrame, fB: TunnelFrame, t: number, out: TunnelFrame): void {
  out.px = fA.px + (fB.px - fA.px) * t;
  out.py = fA.py + (fB.py - fA.py) * t;
  out.pz = fA.pz + (fB.pz - fA.pz) * t;
  out.tx = fA.tx + (fB.tx - fA.tx) * t;
  out.ty = fA.ty + (fB.ty - fA.ty) * t;
  out.tz = fA.tz + (fB.tz - fA.tz) * t;
  out.sx = fA.sx + (fB.sx - fA.sx) * t;
  out.sy = fA.sy + (fB.sy - fA.sy) * t;
  out.sz = fA.sz + (fB.sz - fA.sz) * t;
  out.ux = fA.ux + (fB.ux - fA.ux) * t;
  out.uy = fA.uy + (fB.uy - fA.uy) * t;
  out.uz = fA.uz + (fB.uz - fA.uz) * t;
  out.wL = fA.wL + (fB.wL - fA.wL) * t;
  out.wR = fA.wR + (fB.wR - fA.wR) * t;
  out.s = fA.s + (fB.s - fA.s) * t;
  normalizeFrameBasis(out);
}

const scratchFrame = makeEmptyFrame();
const scratchClampFrame = makeEmptyFrame();
const scratchOutdoorOffset = new THREE.Vector3();
const scratchOutdoorPos = new THREE.Vector3();
const scratchTunnelPos = new THREE.Vector3();

function smoothstep01(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/**
 * Detects whether the car is currently inside any tunnel run or approaching a tunnel portal.
 */
export function detectCarTunnelState(
  index: TunnelIndex,
  carPos: THREE.Vector3,
  carForward: THREE.Vector3
): CarTunnelState | null {
  const runs = index.runs;
  if (runs.length === 0) return null;

  let bestInsideScore = Infinity;
  let bestInside: CarTunnelState | null = null;

  // Pass 1: inside check across all runs and segments
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const frames = run.frames;
    const m = frames.length;
    for (let k = 0; k < m - 1; k++) {
      const fA = frames[k];
      const fB = frames[k + 1];
      const vx = fB.px - fA.px;
      const vy = fB.py - fA.py;
      const vz = fB.pz - fA.pz;
      const lenSq = vx * vx + vy * vy + vz * vz;
      if (lenSq < 1e-8) continue;

      const t = Math.max(
        0,
        Math.min(1, ((carPos.x - fA.px) * vx + (carPos.y - fA.py) * vy + (carPos.z - fA.pz) * vz) / lenSq)
      );
      interpolateSegmentFrame(fA, fB, t, scratchFrame);

      const rx = carPos.x - scratchFrame.px;
      const ry = carPos.y - scratchFrame.py;
      const rz = carPos.z - scratchFrame.pz;

      const along = rx * scratchFrame.tx + ry * scratchFrame.ty + rz * scratchFrame.tz;
      if (Math.abs(along) > 1.0) continue;

      const lat = rx * scratchFrame.sx + ry * scratchFrame.sy + rz * scratchFrame.sz;
      if (lat < -(scratchFrame.wR + 1.5) || lat > scratchFrame.wL + 1.5) continue;

      const relUp = rx * scratchFrame.ux + ry * scratchFrame.uy + rz * scratchFrame.uz;
      if (relUp < -1.8 || relUp > 10.5) continue;

      const score = lat * lat + relUp * relUp;
      if (score < bestInsideScore) {
        bestInsideScore = score;
        const dotFwd =
          carForward.x * scratchFrame.tx + carForward.y * scratchFrame.ty + carForward.z * scratchFrame.tz;
        const dirSign: 1 | -1 = dotFwd >= 0 ? 1 : -1;
        bestInside = {
          status: 'inside',
          run,
          sCar: scratchFrame.s,
          carLat: lat,
          carRelUp: relUp,
          dirSign,
          blend: 1,
        };
      }
    }
  }

  if (bestInside) return bestInside;

  // Pass 2: approaching check near portals of non-loop runs
  let bestApproach: CarTunnelState | null = null;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.isFullLoop || run.frames.length < 2) continue;

    // Entry portal
    const f0 = run.frames[0];
    const r0x = carPos.x - f0.px;
    const r0y = carPos.y - f0.py;
    const r0z = carPos.z - f0.pz;
    const along0 = r0x * f0.tx + r0y * f0.ty + r0z * f0.tz;
    const heading0 = carForward.x * f0.tx + carForward.y * f0.ty + carForward.z * f0.tz;
    if (along0 >= -TUNNEL_APPROACH_DIST && along0 < -0.2 && heading0 > 0.35) {
      const lat0 = r0x * f0.sx + r0y * f0.sy + r0z * f0.sz;
      const up0 = r0x * f0.ux + r0y * f0.uy + r0z * f0.uz;
      if (lat0 >= -(f0.wR + 6) && lat0 <= f0.wL + 6 && up0 >= -2.0 && up0 <= 10.0) {
        const blend = smoothstep01(1 - -along0 / TUNNEL_APPROACH_DIST);
        if (!bestApproach || blend > bestApproach.blend) {
          bestApproach = {
            status: 'approaching',
            run,
            sCar: along0,
            carLat: lat0,
            carRelUp: up0,
            dirSign: 1,
            blend,
          };
        }
      }
    }

    // Exit portal approached in reverse direction
    const fEnd = run.frames[run.frames.length - 1];
    const rex = carPos.x - fEnd.px;
    const rey = carPos.y - fEnd.py;
    const rez = carPos.z - fEnd.pz;
    const alongEnd = rex * fEnd.tx + rey * fEnd.ty + rez * fEnd.tz;
    const headingEnd = carForward.x * fEnd.tx + carForward.y * fEnd.ty + carForward.z * fEnd.tz;
    if (alongEnd > 0.2 && alongEnd <= TUNNEL_APPROACH_DIST && headingEnd < -0.35) {
      const latEnd = rex * fEnd.sx + rey * fEnd.sy + rez * fEnd.sz;
      const upEnd = rex * fEnd.ux + rey * fEnd.uy + rez * fEnd.uz;
      if (latEnd >= -(fEnd.wR + 6) && latEnd <= fEnd.wL + 6 && upEnd >= -2.0 && upEnd <= 10.0) {
        const blend = smoothstep01(1 - alongEnd / TUNNEL_APPROACH_DIST);
        if (!bestApproach || blend > bestApproach.blend) {
          bestApproach = {
            status: 'approaching',
            run,
            sCar: run.totalLen + alongEnd,
            carLat: latEnd,
            carRelUp: upEnd,
            dirSign: -1,
            blend,
          };
        }
      }
    }
  }

  return bestApproach;
}

/**
 * Computes the desired tunnel-aware chase camera position (following tunnel curvature).
 */
export function computeTunnelChaseDesired(
  carPos: THREE.Vector3,
  carQuat: THREE.Quaternion,
  carTunnel: CarTunnelState,
  tunnelBlend: number,
  outDesired: THREE.Vector3
): THREE.Vector3 {
  scratchOutdoorOffset.set(0, 5.2, -13.0).applyQuaternion(carQuat);
  scratchOutdoorPos.copy(carPos).add(scratchOutdoorOffset);

  const sCam = carTunnel.sCar - carTunnel.dirSign * TUNNEL_BACK;
  const f = sampleTunnelRunAt(carTunnel.run, sCam, scratchFrame);

  const maxL = f.wL > 1.8 ? f.wL - 1.5 : f.wL * 0.55;
  const maxR = f.wR > 1.8 ? f.wR - 1.5 : f.wR * 0.55;
  const camLat = Math.max(-maxR, Math.min(maxL, carTunnel.carLat * 0.65));
  const maxH = Math.max(1.5, tunnelArchCeilingHeight(camLat, f.wL, f.wR) - 1.85);
  const camH = Math.min(TUNNEL_HEIGHT, maxH);

  scratchTunnelPos.set(
    f.px + f.sx * camLat + f.ux * camH,
    f.py + f.sy * camLat + f.uy * camH,
    f.pz + f.sz * camLat + f.uz * camH
  );

  if (carTunnel.status === 'inside') {
    outDesired.copy(scratchTunnelPos);
  } else {
    outDesired.copy(scratchOutdoorPos).lerp(scratchTunnelPos, Math.max(0, Math.min(1, tunnelBlend)));
  }
  return outDesired;
}

function clampPointToFrame(camPos: THREE.Vector3, frame: TunnelFrame, preserveAlong: boolean): boolean {
  const dx = camPos.x - frame.px;
  const dy = camPos.y - frame.py;
  const dz = camPos.z - frame.pz;

  const lat = dx * frame.sx + dy * frame.sy + dz * frame.sz;
  const relUp = dx * frame.ux + dy * frame.uy + dz * frame.uz;
  const rawAlong = dx * frame.tx + dy * frame.ty + dz * frame.tz;
  const finalAlong = preserveAlong ? rawAlong : 0;

  const maxL = frame.wL > 1.8 ? frame.wL - 1.45 : frame.wL * 0.55;
  const maxR = frame.wR > 1.8 ? frame.wR - 1.45 : frame.wR * 0.55;
  const clampedLat = Math.max(-maxR, Math.min(maxL, lat));

  const maxH = Math.max(1.6, tunnelArchCeilingHeight(clampedLat, frame.wL, frame.wR) - 1.7);
  const clampedUp = Math.max(1.25, Math.min(maxH, relUp));

  if (
    Math.abs(clampedLat - lat) <= 1e-5 &&
    Math.abs(clampedUp - relUp) <= 1e-5 &&
    (preserveAlong || Math.abs(rawAlong) <= 1e-5)
  ) {
    return false;
  }

  camPos.set(
    frame.px + frame.sx * clampedLat + frame.ux * clampedUp + frame.tx * finalAlong,
    frame.py + frame.sy * clampedLat + frame.uy * clampedUp + frame.ty * finalAlong,
    frame.pz + frame.sz * clampedLat + frame.uz * clampedUp + frame.tz * finalAlong
  );
  return true;
}

/**
 * Enforces a hard geometric envelope after smoothing so the camera never exits a tunnel
 * through walls, ceiling arch, crests, curves, or portal edges.
 */
export function clampCameraInsideTunnels(
  index: TunnelIndex,
  camPos: THREE.Vector3,
  carPos: THREE.Vector3,
  carTunnel: CarTunnelState | null
): boolean {
  if (index.runs.length === 0) return false;
  let clamped = false;

  // Rule A: Car is actively inside a tunnel run
  if (carTunnel && carTunnel.status === 'inside') {
    const run = carTunnel.run;
    const frames = run.frames;
    const m = frames.length;
    let bestDistSq = Infinity;
    let bestK = 0;
    let bestT = 0;

    for (let k = 0; k < m - 1; k++) {
      const fA = frames[k];
      const fB = frames[k + 1];
      const vx = fB.px - fA.px;
      const vy = fB.py - fA.py;
      const vz = fB.pz - fA.pz;
      const lenSq = vx * vx + vy * vy + vz * vz;
      if (lenSq < 1e-8) continue;

      const t = Math.max(
        0,
        Math.min(1, ((camPos.x - fA.px) * vx + (camPos.y - fA.py) * vy + (camPos.z - fA.pz) * vz) / lenSq)
      );
      const px = fA.px + vx * t;
      const py = fA.py + vy * t;
      const pz = fA.pz + vz * t;
      const dSq = (camPos.x - px) ** 2 + (camPos.y - py) ** 2 + (camPos.z - pz) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestK = k;
        bestT = t;
      }
    }

    const fA = frames[bestK];
    const fB = frames[Math.min(m - 1, bestK + 1)];
    interpolateSegmentFrame(fA, fB, bestT, scratchClampFrame);

    if (!run.isFullLoop) {
      let sProj = scratchClampFrame.s;
      let pulled = false;

      if (bestK === 0 && bestT === 0) {
        const f0 = frames[0];
        const along0 =
          (camPos.x - f0.px) * f0.tx + (camPos.y - f0.py) * f0.ty + (camPos.z - f0.pz) * f0.tz;
        if (along0 < 0) sProj = along0;
      } else if (bestK === m - 2 && bestT === 1) {
        const fEnd = frames[m - 1];
        const alongEnd =
          (camPos.x - fEnd.px) * fEnd.tx + (camPos.y - fEnd.py) * fEnd.ty + (camPos.z - fEnd.pz) * fEnd.tz;
        if (alongEnd > 0) sProj = run.totalLen + alongEnd;
      }

      if (carTunnel.dirSign === 1) {
        const minS = Math.min(0, carTunnel.sCar - (TUNNEL_BACK + 1.0));
        if (sProj < minS) {
          sProj = minS;
          pulled = true;
        }
      } else {
        const maxS = Math.max(run.totalLen, carTunnel.sCar + (TUNNEL_BACK + 1.0));
        if (sProj > maxS) {
          sProj = maxS;
          pulled = true;
        }
      }

      if (pulled || sProj < 0 || sProj > run.totalLen) {
        sampleTunnelRunAt(run, sProj, scratchClampFrame);
        if (clampPointToFrame(camPos, scratchClampFrame, false)) clamped = true;
        return clamped || pulled;
      }
    }

    if (clampPointToFrame(camPos, scratchClampFrame, true)) clamped = true;
    return clamped;
  }

  // Rule B: Car has exited, but trailing camera is still inside a tunnel run
  let bestDistSq = Infinity;
  let foundSeg = false;
  let foundK = 0;
  let foundT = 0;
  let foundRun: TunnelRun | null = null;

  for (let r = 0; r < index.runs.length; r++) {
    const run = index.runs[r];
    const frames = run.frames;
    const m = frames.length;
    for (let k = 0; k < m - 1; k++) {
      const fA = frames[k];
      const fB = frames[k + 1];
      const vx = fB.px - fA.px;
      const vy = fB.py - fA.py;
      const vz = fB.pz - fA.pz;
      const lenSq = vx * vx + vy * vy + vz * vz;
      if (lenSq < 1e-8) continue;

      const tRaw =
        ((camPos.x - fA.px) * vx + (camPos.y - fA.py) * vy + (camPos.z - fA.pz) * vz) / lenSq;
      const minTRaw = k > 0 ? -0.05 : 0;
      const maxTRaw = k < m - 2 ? 1.05 : 1;
      if (tRaw < minTRaw || tRaw > maxTRaw) continue;

      const t = Math.max(0, Math.min(1, tRaw));
      const px = fA.px + vx * t;
      const py = fA.py + vy * t;
      const pz = fA.pz + vz * t;

      // Ignore tunnels at completely different elevations (overpasses above tunnels)
      if (Math.abs(carPos.y - py) >= 6.5) continue;

      const maxReach = Math.max(fA.wL, fA.wR, fB.wL, fB.wR) + 12;
      const horizSq = (camPos.x - px) ** 2 + (camPos.z - pz) ** 2;
      if (horizSq >= maxReach * maxReach) continue;
      if (camPos.y - py > 14.0) continue;

      const dSq = horizSq + (camPos.y - py) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        foundRun = run;
        foundK = k;
        foundT = t;
        foundSeg = true;
      }
    }
  }

  if (foundSeg && foundRun) {
    interpolateSegmentFrame(foundRun.frames[foundK], foundRun.frames[foundK + 1], foundT, scratchClampFrame);
    if (clampPointToFrame(camPos, scratchClampFrame, true)) clamped = true;
  }

  return clamped;
}
