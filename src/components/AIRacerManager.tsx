import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { SplineNode, buildSplineArcSampler, computeGridSlotPose } from '../tracks';
import { Car3D } from './Car3D';
import { DriverNameplateSprite } from './DriverNameplate';
import { CAR_CLASS_DEFAULTS } from './RapierCarController';
import type {
  AiRacerConfig,
  LocalCarNetSample,
  NetCarState,
  RemoteCarBufferEntry,
  SpeedPreset,
} from '../multiplayer/types';

const ZERO_VEC3: [number, number, number] = [0, 0, 0];
const BOT_COLLIDER_ARGS: [number, number, number] = [0.92, 0.24, 1.90];
const BOT_COLLIDER_POS: [number, number, number] = [0, 0.96, 0.05];
const BOT_VISUAL_POS: [number, number, number] = [0, 0.02, 0];

interface BotRuntime {
  cfg: AiRacerConfig;
  s: number;
  unwrappedDist: number;
  speedMs: number;
  prevSpeedMs: number;
  laneOffset: number;
  targetLaneOffset: number;
  bumpLaneVel: number;
  steerVisual: number;
  wheelRoll: number;
  bodyRoll: number;
  bodyPitch: number;
  isBraking: boolean;
  lapNumber: number;
  completedLaps: number;
  lapStartMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  passedHalf: boolean;
  finished: boolean;
  finishTimeMs: number | null;
  reactionDelaySec: number;
  aggression: number;
  lineAdherence: number;
  pacePhase: number;
  mistakeTimerSec: number;
  nextMistakeSec: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface AiTrackProfile {
  step: number;
  maxCornerSpeeds: Float32Array;
  signedKappa: Float32Array;
  idealLaneFrac: Float32Array;
}

/**
 * Precomputes curvature, banking- & slope-aware speed limits, and a smooth
 * out-in-out racing line along the spline at 5 m intervals.
 */
export function computeAiTrackProfile(
  arcSampler: ReturnType<typeof buildSplineArcSampler>,
  isClosed: boolean
): AiTrackProfile {
  const STEP = 5;
  const L = arcSampler.totalLen;
  if (L < 30) {
    return {
      step: STEP,
      maxCornerSpeeds: new Float32Array([40]),
      signedKappa: new Float32Array([0]),
      idealLaneFrac: new Float32Array([0]),
    };
  }

  const n = Math.max(4, Math.floor(L / STEP));
  const speeds = new Float32Array(n);
  const signedKappa = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const sCenter = i * STEP;
    const sPrev = isClosed ? ((i - 1) * STEP + L) % L : Math.max(0, (i - 1) * STEP);
    const sNext = isClosed ? ((i + 1) * STEP) % L : Math.min(L, (i + 1) * STEP);
    const dsSpan = Math.max(STEP, isClosed ? 2 * STEP : sNext - sPrev);

    const a = arcSampler.sampleAt(sPrev);
    const b = arcSampler.sampleAt(sNext);
    const mid = arcSampler.sampleAt(sCenter);

    const dot = Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz));
    const angle = Math.acos(dot);
    const kappa = angle / dsSpan;
    const cross = b.tx * a.lx + b.tz * a.lz;
    const sk = (cross >= 0 ? 1 : -1) * kappa;
    signedKappa[i] = sk;

    // Positive when track banks inward into the turn; slope compresses/unloads grip slightly
    const bankAlignment = Math.sign(sk) * mid.bankSin;
    const bankBoost = 1 + Math.max(-0.22, Math.min(0.45, bankAlignment * 1.2));
    const slopeSin = Math.max(-0.35, Math.min(0.35, (b.y - a.y) / dsSpan));
    const slopeGrip = 1 + Math.max(-0.08, Math.min(0.06, slopeSin * 0.22));

    const latG = 28 * bankBoost * slopeGrip;
    speeds[i] = Math.min(140, Math.sqrt(latG / Math.max(kappa, 1e-4)));
  }

  // Build raw apex-hugging line with subtle entry/exit setup away from apex
  const rawApex = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rawApex[i] = Math.tanh(signedKappa[i] * 55) * 0.80;
  }

  let ideal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let bestAhead = 0;
    let bestBehind = 0;
    for (let k = 4; k <= 10; k++) {
      if (isClosed || i + k < n) {
        const va = rawApex[(i + k) % n];
        if (Math.abs(va) > Math.abs(bestAhead)) bestAhead = va;
      }
      if (isClosed || i - k >= 0) {
        const vb = rawApex[(i - k + n) % n];
        if (Math.abs(vb) > Math.abs(bestBehind)) bestBehind = vb;
      }
    }
    const localAbs = Math.abs(rawApex[i]);
    const remote = Math.abs(bestAhead) >= Math.abs(bestBehind) ? bestAhead : bestBehind;
    const remoteExcess = Math.max(0, Math.abs(remote) - localAbs * 1.15);
    const setupShift = remoteExcess > 0.08 ? -Math.sign(remote) * Math.min(0.55, remoteExcess * 0.72) : 0;
    ideal[i] = Math.max(-0.82, Math.min(0.82, rawApex[i] + setupShift));
  }

  // 6 smoothing passes so the racing line transitions smoothly through S-curves and braking zones
  let scratch = new Float32Array(n);
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      const iPrev = isClosed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const iNext = isClosed ? (i + 1) % n : Math.min(n - 1, i + 1);
      scratch[i] = ideal[iPrev] * 0.25 + ideal[i] * 0.5 + ideal[iNext] * 0.25;
    }
    const tmp = ideal;
    ideal = scratch;
    scratch = tmp;
  }

  // 3 backward passes so bots brake smoothly BEFORE corners (slope-adjusted decel)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      if (!isClosed && i === n - 1) continue;
      const nextIdx = (i + 1) % n;
      const spI = arcSampler.sampleAt(i * STEP);
      const spN = arcSampler.sampleAt(nextIdx * STEP);
      const slopeSin = Math.max(-0.35, Math.min(0.35, (spN.y - spI.y) / STEP));
      const brakeDecel = Math.max(12, 23 + 9.81 * slopeSin);
      const vNext = speeds[nextIdx];
      const maxFromNext = Math.sqrt(vNext * vNext + 2 * brakeDecel * STEP);
      if (speeds[i] > maxFromNext) {
        speeds[i] = maxFromNext;
      }
    }
  }

  return {
    step: STEP,
    maxCornerSpeeds: speeds,
    signedKappa,
    idealLaneFrac: ideal,
  };
}

export interface AIRacerManagerProps {
  aiRacers: AiRacerConfig[];
  spline: SplineNode[];
  isClosed: boolean;
  totalLaps: number;
  speedPreset: SpeedPreset;
  racePhase: 'loading' | 'ready' | 'lights' | 'green' | 'racing' | 'finished';
  raceGoTimestampMs: number;
  localCarPosRef: React.MutableRefObject<LocalCarNetSample | null>;
  remoteCarsRef: React.MutableRefObject<Map<string, RemoteCarBufferEntry>>;
  standingsMap?: Record<string, number>;
  environmentTheme?: 'day' | 'sunset' | 'night';
  onAiStatesUpdate: (states: NetCarState[]) => void;
}

export const AIRacerManager: React.FC<AIRacerManagerProps> = React.memo(({
  aiRacers,
  spline,
  isClosed,
  totalLaps,
  speedPreset,
  racePhase,
  raceGoTimestampMs,
  localCarPosRef,
  remoteCarsRef,
  standingsMap,
  environmentTheme = 'day',
  onAiStatesUpdate,
}) => {
  const rbRefs = useRef<(RapierRigidBody | null)[]>([]);
  const steerRefs = useRef<React.MutableRefObject<number>[]>([]);
  const rollRefs = useRef<React.MutableRefObject<number>[]>([]);
  const brakeRefs = useRef<React.MutableRefObject<number>[]>([]);
  const emitAccRef = useRef(0);
  const raceStartPerfRef = useRef<number>(raceGoTimestampMs || performance.now());
  const prevPhaseRef = useRef<string>(racePhase);
  const onUpdateRef = useRef(onAiStatesUpdate);
  onUpdateRef.current = onAiStatesUpdate;

  const arcSampler = useMemo(
    () => buildSplineArcSampler(spline, isClosed),
    [spline, isClosed]
  );

  // Precompute curvature-based speed limit + out-in-out racing line profile along the track
  const speedProfile = useMemo(
    () => computeAiTrackProfile(arcSampler, isClosed),
    [arcSampler, isClosed]
  );

  // Ensure per-bot refs match current aiRacers length
  const velRefs = useRef<Array<{ x: number; y: number; z: number }>>([]);
  if (steerRefs.current.length !== aiRacers.length) {
    steerRefs.current = aiRacers.map(() => ({ current: 0 }));
    rollRefs.current = aiRacers.map(() => ({ current: 0 }));
    brakeRefs.current = aiRacers.map(() => ({ current: 0 }));
  }
  if (velRefs.current.length !== aiRacers.length) {
    velRefs.current = aiRacers.map(() => ({ x: 0, y: 0, z: 0 }));
  }

  const bodyUserDatas = useMemo(
    () =>
      aiRacers.map((bot, idx) => ({
        surface: 'CAR',
        driverId: bot.id,
        vel: velRefs.current[idx] || { x: 0, y: 0, z: 0 },
      })),
    [aiRacers]
  );

  const initialSlots = useMemo(() => {
    return aiRacers.map((bot) => {
      const pose = computeGridSlotPose(spline, isClosed, bot.gridSlot);
      const rideLift = bot.carClass === 'f1' ? 0.04 : 0.01;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
      const e = new THREE.Euler().setFromQuaternion(q);
      return {
        pose,
        pos: [pose.x, pose.y + rideLift, pose.z] as [number, number, number],
        euler: [e.x, e.y, e.z] as [number, number, number],
        quat: q,
      };
    });
  }, [aiRacers, spline, isClosed]);

  const botsRef = useRef<BotRuntime[]>([]);

  useEffect(() => {
    const L = arcSampler.totalLen;
    botsRef.current = aiRacers.map((bot, idx) => {
      const aggression = Math.max(0.25, Math.min(0.95, 0.38 + ((idx * 53 + 17) % 10) * 0.055 + (bot.skill - 0.8) * 0.25));
      const lineAdherence = Math.max(0.55, Math.min(0.98, 0.62 + (bot.skill - 0.75) * 0.9 + ((idx * 29) % 5) * 0.02));
      const pacePhase = (idx * 2.17) % (Math.PI * 2);
      const nextMistakeSec = (18 + ((idx * 19 + 7) % 15)) * (0.75 + bot.skill * 0.8);
      const existingRemote = remoteCarsRef.current.get(bot.id)?.curr;
      if (existingRemote) {
        const remoteS = L > 0 ? ((existingRemote.trackS % L) + L) % L : 0;
        const sp = arcSampler.sampleAt(remoteS);
        const recoveredLane = (existingRemote.x - sp.x) * sp.lx + (existingRemote.z - sp.z) * sp.lz;
        const clampedLane = Math.max(-(sp.width || 18) * 0.34, Math.min((sp.width || 18) * 0.34, recoveredLane));
        const initSpeedMs = Math.max(0, (existingRemote.speedKmh || 0) / 3.6);
        return {
          cfg: bot,
          s: remoteS,
          unwrappedDist: existingRemote.raceProgress,
          speedMs: initSpeedMs,
          prevSpeedMs: initSpeedMs,
          laneOffset: clampedLane,
          targetLaneOffset: clampedLane,
          bumpLaneVel: 0,
          steerVisual: existingRemote.steer || 0,
          wheelRoll: existingRemote.wheelRoll || 0,
          bodyRoll: 0,
          bodyPitch: 0,
          isBraking: Boolean(existingRemote.braking),
          lapNumber: existingRemote.lapNumber || 1,
          completedLaps: existingRemote.completedLaps || 0,
          lapStartMs: performance.now(),
          bestLapMs: existingRemote.bestLapMs ?? null,
          lastLapMs: existingRemote.lastLapMs ?? null,
          passedHalf: remoteS >= L * 0.42,
          finished: Boolean(existingRemote.finished),
          finishTimeMs: existingRemote.finishTimeMs ?? null,
          reactionDelaySec: 0,
          aggression,
          lineAdherence,
          pacePhase,
          mistakeTimerSec: 0,
          nextMistakeSec,
          x: existingRemote.x,
          y: existingRemote.y,
          z: existingRemote.z,
          qx: existingRemote.qx,
          qy: existingRemote.qy,
          qz: existingRemote.qz,
          qw: existingRemote.qw,
          vx: existingRemote.vx,
          vy: existingRemote.vy,
          vz: existingRemote.vz,
        };
      }

      const { pose, quat } = initialSlots[idx];
      const wrappedS = L > 0 ? ((pose.sCar % L) + L) % L : 0;
      const rideLift = bot.carClass === 'f1' ? 0.04 : 0.01;
      return {
        cfg: bot,
        s: wrappedS,
        unwrappedDist: pose.sCar,
        speedMs: 0,
        prevSpeedMs: 0,
        laneOffset: pose.latOffset,
        targetLaneOffset: pose.latOffset,
        bumpLaneVel: 0,
        steerVisual: 0,
        wheelRoll: 0,
        bodyRoll: 0,
        bodyPitch: 0,
        isBraking: false,
        lapNumber: 1,
        completedLaps: 0,
        lapStartMs: performance.now(),
        bestLapMs: null,
        lastLapMs: null,
        passedHalf: false,
        finished: false,
        finishTimeMs: null,
        reactionDelaySec: 0.06 + ((idx * 37) % 10) * 0.024,
        aggression,
        lineAdherence,
        pacePhase,
        mistakeTimerSec: 0,
        nextMistakeSec,
        x: pose.x,
        y: pose.y + rideLift,
        z: pose.z,
        qx: quat.x,
        qy: quat.y,
        qz: quat.z,
        qw: quat.w,
        vx: 0,
        vy: 0,
        vz: 0,
      };
    });
    emitAccRef.current = 0;
  }, [aiRacers, initialSlots, arcSampler]);

  const tmpEuler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((_, delta) => {
    const bots = botsRef.current;
    if (!bots.length || arcSampler.totalLen < 30) return;

    const dt = Math.min(delta, 0.033);
    const nowPerf = performance.now();
    const L = arcSampler.totalLen;
    const speedScale = speedPreset === 'calm' ? 0.65 : speedPreset === 'extreme' ? 1.05 : 0.85;

    // Detect transition into green / racing
    const wasHeld =
      prevPhaseRef.current === 'loading' ||
      prevPhaseRef.current === 'ready' ||
      prevPhaseRef.current === 'lights';
    const isGoPhase = racePhase === 'green' || racePhase === 'racing' || racePhase === 'finished';
    if (wasHeld && isGoPhase) {
      raceStartPerfRef.current = raceGoTimestampMs || nowPerf;
      for (let i = 0; i < bots.length; i++) {
        bots[i].lapStartMs = raceStartPerfRef.current;
      }
    }
    prevPhaseRef.current = racePhase;

    const heldOnGrid = racePhase === 'loading' || racePhase === 'ready' || racePhase === 'lights';
    const elapsedSinceGoSec = heldOnGrid ? 0 : Math.max(0, (nowPerf - raceStartPerfRef.current) / 1000);

    // Collect obstacle positions once per frame (local player + remote humans + bots)
    const localSample = localCarPosRef.current;
    const remoteEntries = Array.from(remoteCarsRef.current.values());

    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      const def = CAR_CLASS_DEFAULTS[bot.cfg.carClass];
      const maxCarSpeedMs = (Math.max(180, def.maxSpeedKmh * speedScale) / 3.6) * bot.cfg.skill;
      const classCornerScale =
        bot.cfg.carClass === 'f1'
          ? 1.15
          : bot.cfg.carClass === 'gt'
          ? 0.94
          : bot.cfg.carClass === 'rally'
          ? 0.84
          : 0.80;

      const spCurr = arcSampler.sampleAt(bot.s);
      const roadHalf = Math.max(4, (spCurr.width || 18) * 0.34);
      const nProf = speedProfile.maxCornerSpeeds.length;
      const idxCurr = Math.floor(bot.s / speedProfile.step) % nProf;
      bot.prevSpeedMs = bot.speedMs;
      const prevLaneForSteer = bot.laneOffset;

      if (!heldOnGrid && elapsedSinceGoSec >= bot.reactionDelaySec) {
        if (bot.finished) {
          // Coast smoothly after finishing
          bot.isBraking = bot.speedMs > 1.5;
          bot.speedMs = Math.max(0, bot.speedMs - 18 * dt);
          bot.bumpLaneVel *= Math.exp(-8.5 * dt);
        } else {
          // Look ahead along speedProfile + out-in-out racing line
          const lookMeters = Math.max(12, Math.min(78, bot.speedMs * 1.15));
          const sMid = isClosed ? (bot.s + lookMeters * 0.48) % L : Math.min(L, bot.s + lookMeters * 0.48);
          const sAhead = isClosed ? (bot.s + lookMeters) % L : Math.min(L, bot.s + lookMeters);
          const idxMid = Math.floor(sMid / speedProfile.step) % nProf;
          const idxAhead = Math.floor(sAhead / speedProfile.step) % nProf;

          const paceMod = 1 + 0.015 * Math.sin(nowPerf * 0.00018 + bot.pacePhase);
          const cornerLim =
            Math.min(speedProfile.maxCornerSpeeds[idxCurr], speedProfile.maxCornerSpeeds[idxAhead]) *
            classCornerScale *
            bot.cfg.skill *
            (0.98 + bot.aggression * 0.05) *
            paceMod;
          let targetSpeed = Math.min(maxCarSpeedMs * paceMod, cornerLim);

          // Rare organic mistake on corner entry/mid-corner
          const upcomingKappa = speedProfile.signedKappa[idxAhead] || 0;
          let mistakeDrift = 0;
          if (bot.mistakeTimerSec > 0) {
            bot.mistakeTimerSec = Math.max(0, bot.mistakeTimerSec - dt);
            targetSpeed *= 0.91;
            const turnDir = Math.sign(speedProfile.signedKappa[idxCurr] || upcomingKappa || 1);
            mistakeDrift = -turnDir * Math.min(1.6, roadHalf * 0.2);
          } else {
            bot.nextMistakeSec -= dt;
            if (bot.nextMistakeSec <= 0 && Math.abs(upcomingKappa) > 0.012 && bot.speedMs > 22) {
              bot.mistakeTimerSec = 0.6 + (1 - bot.cfg.skill) * 0.45;
              bot.nextMistakeSec = (22 + ((i * 19 + 7) % 16)) * (0.7 + bot.cfg.skill);
            }
          }

          // Out-in-out racing line target blended with personal style
          const lineFrac = THREE.MathUtils.lerp(
            speedProfile.idealLaneFrac[idxCurr] || 0,
            speedProfile.idealLaneFrac[idxMid] || 0,
            0.55
          );
          let desiredLane =
            lineFrac * (roadHalf * 0.85) * bot.lineAdherence +
            Math.sin(bot.s * 0.011 + i * 1.7) * (roadHalf * 0.08 * (1 - bot.lineAdherence * 0.5)) +
            mistakeDrift;

          let slipstreamBoost = 1.0;
          let blockedAhead = false;
          let closestAheadDist = Infinity;
          let closestAheadSpeed = Infinity;
          let closestObsLane = 0;
          let courtesyOffset = 0;

          const countCongestionInLane = (candLane: number): number => {
            let penalty = 0;
            const checkLane = (ox: number, oz: number) => {
              const odx = ox - bot.x;
              const odz = oz - bot.z;
              const ofwd = odx * spCurr.tx + odz * spCurr.tz;
              if (ofwd < -2 || ofwd > 26) return;
              const olat = bot.laneOffset + (odx * spCurr.lx + odz * spCurr.lz);
              const gap = Math.abs(olat - candLane);
              if (gap < 2.8) penalty += (2.8 - gap) * 14;
            };
            if (localSample) checkLane(localSample.x, localSample.z);
            for (let j = 0; j < bots.length; j++) {
              if (i !== j) checkLane(bots[j].x, bots[j].z);
            }
            for (let r = 0; r < remoteEntries.length; r++) {
              const rc = remoteEntries[r].curr;
              if (!rc.isAi) checkLane(rc.x, rc.z);
            }
            return penalty;
          };

          const checkObstacle = (ox: number, oz: number, ovx: number, ovz: number) => {
            const dx = ox - bot.x;
            const dz = oz - bot.z;
            const fwdDist = dx * spCurr.tx + dz * spCurr.tz;
            const latDiff = dx * spCurr.lx + dz * spCurr.lz;
            const obsLane = bot.laneOffset + latDiff;
            const obsFwdSpeed = ovx * spCurr.tx + ovz * spCurr.tz;

            // Slipstream tow when tucking behind a leading car on straights/sweepers
            if (fwdDist > 5.5 && fwdDist < 34.0 && Math.abs(latDiff) < 2.25) {
              const tow = 1 + 0.085 * (1 - (fwdDist - 5.5) / 28.5);
              if (tow > slipstreamBoost) slipstreamBoost = tow;
            }

            // Wheel-to-wheel courtesy & physical bump impulse
            if (Math.abs(fwdDist) <= 3.6 && Math.abs(latDiff) < 2.85) {
              const awaySign = latDiff >= 0 ? -1 : 1;
              courtesyOffset += awaySign * (2.85 - Math.abs(latDiff)) * 0.7;
              if (Math.abs(fwdDist) < 2.95 && Math.abs(latDiff) < 1.95) {
                const overlap = 1.95 - Math.abs(latDiff);
                bot.bumpLaneVel += awaySign * overlap * 6.5;
                bot.speedMs = Math.max(4, bot.speedMs * 0.994);
              }
            }

            // Forward traffic / overtaking detection
            if (fwdDist > 1.8 && fwdDist < 32.0 && Math.abs(latDiff) < 3.4) {
              if (obsFwdSpeed < targetSpeed * (1.02 + bot.aggression * 0.04) || fwdDist < 14.0) {
                blockedAhead = true;
                if (fwdDist < closestAheadDist) {
                  closestAheadDist = fwdDist;
                  closestAheadSpeed = obsFwdSpeed;
                  closestObsLane = obsLane;
                }
              }
            }
          };

          if (localSample) {
            checkObstacle(localSample.x, localSample.z, localSample.vx, localSample.vz);
          }
          for (let j = 0; j < bots.length; j++) {
            if (i === j) continue;
            checkObstacle(bots[j].x, bots[j].z, bots[j].vx, bots[j].vz);
          }
          for (let r = 0; r < remoteEntries.length; r++) {
            const rc = remoteEntries[r].curr;
            if (!rc.isAi) checkObstacle(rc.x, rc.z, rc.vx, rc.vz);
          }

          if (slipstreamBoost > 1.0 && cornerLim >= maxCarSpeedMs * 0.92) {
            targetSpeed = Math.min(cornerLim, maxCarSpeedMs * slipstreamBoost * paceMod);
          }

          if (blockedAhead) {
            const passLeft = closestObsLane + 3.55;
            const passRight = closestObsLane - 3.55;
            const nextSign = Math.sign(upcomingKappa);
            const scoreSide = (cand: number): number => {
              if (Math.abs(cand) > roadHalf * 0.98) return -1000;
              const edgeMargin = roadHalf - Math.abs(cand);
              const apexBias = nextSign * cand * 0.35;
              const switchCost = Math.abs(cand - bot.laneOffset) * 0.45;
              return edgeMargin * 1.4 + apexBias - switchCost - countCongestionInLane(cand);
            };
            const bestPassLane = scoreSide(passLeft) >= scoreSide(passRight) ? passLeft : passRight;
            desiredLane = Math.max(-roadHalf, Math.min(roadHalf, bestPassLane));

            if (closestAheadDist < 10.5 && Math.abs(desiredLane - bot.laneOffset) > 1.2) {
              targetSpeed = Math.min(
                targetSpeed,
                Math.max(8, closestAheadSpeed + (closestAheadDist - 6.0) * (1.0 + bot.aggression * 0.4))
              );
            }
          }

          desiredLane = Math.max(-roadHalf, Math.min(roadHalf, desiredLane + courtesyOffset));

          bot.targetLaneOffset = THREE.MathUtils.lerp(
            bot.targetLaneOffset,
            desiredLane,
            Math.min(1, dt * (blockedAhead ? 4.8 + bot.aggression * 1.2 : 2.6))
          );

          bot.bumpLaneVel *= Math.exp(-8.5 * dt);
          bot.laneOffset =
            THREE.MathUtils.lerp(bot.laneOffset, bot.targetLaneOffset, Math.min(1, dt * 3.8)) +
            bot.bumpLaneVel * dt;
          bot.laneOffset = Math.max(-roadHalf * 1.05, Math.min(roadHalf * 1.05, bot.laneOffset));

          bot.isBraking = bot.speedMs > targetSpeed + 0.8;
          const accel = def.accelForce * 0.90 * bot.cfg.skill * (slipstreamBoost > 1.0 ? 1.06 : 1.0);
          const brake = def.accelForce * (def.brakeForce || 1.5) * 0.98;
          if (bot.speedMs < targetSpeed) {
            bot.speedMs = Math.min(targetSpeed, bot.speedMs + accel * dt);
          } else {
            bot.speedMs = Math.max(targetSpeed, bot.speedMs - brake * dt);
          }
        }

        const ds = bot.speedMs * dt;
        const prevS = bot.s;
        let nextS = prevS + ds;
        if (isClosed) {
          nextS = ((nextS % L) + L) % L;
        } else {
          nextS = Math.min(L, nextS);
        }
        bot.s = nextS;
        bot.unwrappedDist += ds;
        bot.wheelRoll += bot.speedMs * dt * 1.5;

        if (bot.s >= L * 0.42 && bot.s <= L * 0.75) {
          bot.passedHalf = true;
        }

        // Start-line lap wrap detection (only after passing half-way checkpoint)
        if (!bot.finished && isClosed && prevS > L * 0.75 && bot.s < L * 0.25 && bot.passedHalf) {
          const lapMs = Math.max(3000, nowPerf - bot.lapStartMs);
          bot.lastLapMs = lapMs;
          if (bot.bestLapMs === null || lapMs < bot.bestLapMs) {
            bot.bestLapMs = lapMs;
          }
          bot.completedLaps += 1;
          bot.passedHalf = false;
          if (bot.completedLaps >= totalLaps) {
            bot.finished = true;
            bot.finishTimeMs = Math.max(1000, nowPerf - raceStartPerfRef.current);
            bot.lapNumber = totalLaps;
          } else {
            bot.lapNumber += 1;
            bot.lapStartMs = nowPerf;
          }
        }
      } else {
        bot.isBraking = false;
      }

      // Compute 3D road pose with slope pitch + banking roll
      const sp = arcSampler.sampleAt(bot.s);
      const spNext = arcSampler.sampleAt(bot.s + 6);
      const roadW = sp.width || 18;
      const surfaceY = sp.y + Math.abs(sp.bankSin) * (roadW * 0.5) - bot.laneOffset * sp.bankSin;
      const rideLift = bot.cfg.carClass === 'f1' ? 0.04 : 0.01;

      const wx = sp.x + sp.lx * bot.laneOffset;
      const wz = sp.z + sp.lz * bot.laneOffset;
      const wy = surfaceY + rideLift;

      const nx = spNext.x + spNext.lx * bot.laneOffset;
      const nz = spNext.z + spNext.lz * bot.laneOffset;
      const yaw = Math.atan2(nx - wx, nz - wz);

      const spBack = arcSampler.sampleAt(bot.s - 3);
      const spFwd = arcSampler.sampleAt(bot.s + 3);
      const pitch = -Math.atan2(spFwd.y - spBack.y, 6.0);
      const roll = -Math.asin(Math.max(-0.5, Math.min(0.5, sp.bankSin)));

      const longAccel = THREE.MathUtils.clamp((bot.speedMs - bot.prevSpeedMs) / Math.max(dt, 0.001), -26, 22);
      const targetPitchDyn = THREE.MathUtils.clamp(-longAccel * 0.0022, -0.048, 0.038);
      const kappaCurr = speedProfile.signedKappa[idxCurr] || 0;
      const latAccel = THREE.MathUtils.clamp(bot.speedMs * bot.speedMs * kappaCurr, -24, 24);
      const targetRollDyn = THREE.MathUtils.clamp(latAccel * 0.0024, -0.055, 0.055);
      bot.bodyPitch = THREE.MathUtils.lerp(bot.bodyPitch, targetPitchDyn, Math.min(1, dt * 10));
      bot.bodyRoll = THREE.MathUtils.lerp(bot.bodyRoll, targetRollDyn, Math.min(1, dt * 9));

      tmpEuler.set(pitch + bot.bodyPitch, yaw, roll + bot.bodyRoll, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);

      const prevYaw = Math.atan2(sp.tx, sp.tz);
      let yawDelta = yaw - prevYaw;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      const laneVel = (bot.laneOffset - prevLaneForSteer) / Math.max(dt, 0.001);
      const targetSteer = Math.max(
        -0.46,
        Math.min(0.46, yawDelta * 1.85 + Math.atan2(laneVel, Math.max(8, bot.speedMs)) * 0.45)
      );
      bot.steerVisual = THREE.MathUtils.lerp(bot.steerVisual, targetSteer, Math.min(1, dt * 11));

      bot.x = wx;
      bot.y = wy;
      bot.z = wz;
      bot.qx = tmpQuat.x;
      bot.qy = tmpQuat.y;
      bot.qz = tmpQuat.z;
      bot.qw = tmpQuat.w;
      bot.vx = sp.tx * bot.speedMs;
      bot.vy = 0;
      bot.vz = sp.tz * bot.speedMs;

      if (velRefs.current[i]) {
        velRefs.current[i].x = bot.vx;
        velRefs.current[i].y = bot.vy;
        velRefs.current[i].z = bot.vz;
      }

      if (steerRefs.current[i]) steerRefs.current[i].current = bot.steerVisual;
      if (rollRefs.current[i]) rollRefs.current[i].current = bot.wheelRoll;
      if (brakeRefs.current[i]) {
        brakeRefs.current[i].current = THREE.MathUtils.lerp(
          brakeRefs.current[i].current,
          bot.isBraking ? 1 : 0,
          Math.min(1, dt * 16)
        );
      }

      const rb = rbRefs.current[i];
      if (rb) {
        rb.setNextKinematicTranslation({ x: wx, y: wy, z: wz });
        rb.setNextKinematicRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w });
      }
    }

    // Stream AI states at ~18 Hz to host callback
    emitAccRef.current += dt;
    if (emitAccRef.current >= 0.055) {
      emitAccRef.current = 0;
      const out: NetCarState[] = bots.map((b) => ({
        id: b.cfg.id,
        x: b.x,
        y: b.y,
        z: b.z,
        qx: b.qx,
        qy: b.qy,
        qz: b.qz,
        qw: b.qw,
        vx: b.vx,
        vy: b.vy,
        vz: b.vz,
        steer: b.steerVisual,
        speedKmh: Math.round(b.speedMs * 3.6),
        wheelRoll: b.wheelRoll,
        braking: b.isBraking,
        headlights: true,
        lapNumber: b.lapNumber,
        completedLaps: b.completedLaps,
        trackS: b.s,
        raceProgress: b.unwrappedDist,
        surface: 'TRACK',
        engineHealth: 100,
        tireHealth: 100,
        inPit: false,
        bestLapMs: b.bestLapMs,
        lastLapMs: b.lastLapMs,
        finished: b.finished,
        finishTimeMs: b.finishTimeMs,
        isAi: true,
      }));
      onUpdateRef.current(out);
    }
  });

  return (
    <>
      {aiRacers.map((bot, idx) => {
        const init = initialSlots[idx];
        return (
          <RigidBody
            key={bot.id}
            ref={(el) => {
              rbRefs.current[idx] = el;
            }}
            type="kinematicPosition"
            position={init.pos}
            rotation={init.euler}
            colliders={false}
            userData={bodyUserDatas[idx]}
          >
            <CuboidCollider
              args={BOT_COLLIDER_ARGS}
              position={BOT_COLLIDER_POS}
              friction={0.0}
              restitution={0.12}
            />
            <group position={BOT_VISUAL_POS}>
              <Car3D
                position={ZERO_VEC3}
                rotation={ZERO_VEC3}
                steerAngleRef={steerRefs.current[idx]}
                wheelRotationRef={rollRefs.current[idx]}
                brakeIntensityRef={brakeRefs.current[idx]}
                headlightsOn={true}
                enableRealLights={false}
                environmentTheme={environmentTheme}
                color={bot.primaryColor}
                secondaryColor={bot.secondaryColor}
                carClass={bot.carClass}
              />
            </group>
            <DriverNameplateSprite
              name={bot.name}
              primaryColor={bot.primaryColor}
              positionRank={standingsMap?.[bot.id]}
              isAi={true}
            />
          </RigidBody>
        );
      })}
    </>
  );
});
