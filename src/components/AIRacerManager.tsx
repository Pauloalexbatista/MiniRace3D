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

interface BotRuntime {
  cfg: AiRacerConfig;
  s: number;
  unwrappedDist: number;
  speedMs: number;
  laneOffset: number;
  targetLaneOffset: number;
  steerVisual: number;
  wheelRoll: number;
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

  // Precompute curvature-based speed limit profile along the track (5m intervals)
  const speedProfile = useMemo(() => {
    const STEP = 5;
    const L = arcSampler.totalLen;
    if (L < 30) return { step: STEP, maxCornerSpeeds: new Float32Array([40]) };
    const n = Math.max(4, Math.floor(L / STEP));
    const speeds = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const sPrev = ((i - 1) * STEP + L) % L;
      const sNext = ((i + 1) * STEP) % L;
      const a = arcSampler.sampleAt(sPrev);
      const b = arcSampler.sampleAt(sNext);
      const dot = Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz));
      const angle = Math.acos(dot);
      const kappa = angle / (2 * STEP);
      speeds[i] = Math.min(135, Math.sqrt(26 / Math.max(kappa, 1e-4)));
    }

    // Two backward passes so bots brake smoothly BEFORE sharp corners
    const brakeDecel = 22;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const nextIdx = (i + 1) % n;
        if (!isClosed && i === n - 1) continue;
        const vNext = speeds[nextIdx];
        const maxFromNext = Math.sqrt(vNext * vNext + 2 * brakeDecel * STEP);
        if (speeds[i] > maxFromNext) {
          speeds[i] = maxFromNext;
        }
      }
    }

    return { step: STEP, maxCornerSpeeds: speeds };
  }, [arcSampler, isClosed]);

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
      const existingRemote = remoteCarsRef.current.get(bot.id)?.curr;
      if (existingRemote) {
        const remoteS = L > 0 ? ((existingRemote.trackS % L) + L) % L : 0;
        const sp = arcSampler.sampleAt(remoteS);
        const recoveredLane = (existingRemote.x - sp.x) * sp.lx + (existingRemote.z - sp.z) * sp.lz;
        const clampedLane = Math.max(-(sp.width || 18) * 0.34, Math.min((sp.width || 18) * 0.34, recoveredLane));
        return {
          cfg: bot,
          s: remoteS,
          unwrappedDist: existingRemote.raceProgress,
          speedMs: Math.max(0, (existingRemote.speedKmh || 0) / 3.6),
          laneOffset: clampedLane,
          targetLaneOffset: clampedLane,
          steerVisual: existingRemote.steer || 0,
          wheelRoll: existingRemote.wheelRoll || 0,
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
        laneOffset: pose.latOffset,
        targetLaneOffset: pose.latOffset,
        steerVisual: 0,
        wheelRoll: 0,
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

      if (!heldOnGrid && elapsedSinceGoSec >= bot.reactionDelaySec) {
        if (bot.finished) {
          // Coast smoothly after finishing
          bot.isBraking = bot.speedMs > 1.5;
          bot.speedMs = Math.max(0, bot.speedMs - 18 * dt);
        } else {
          // Look ahead along speedProfile
          const lookMeters = Math.max(12, Math.min(75, bot.speedMs * 1.15));
          const sAhead = isClosed ? (bot.s + lookMeters) % L : Math.min(L, bot.s + lookMeters);
          const idxCurr = Math.floor(bot.s / speedProfile.step) % speedProfile.maxCornerSpeeds.length;
          const idxAhead = Math.floor(sAhead / speedProfile.step) % speedProfile.maxCornerSpeeds.length;
          const cornerLim =
            Math.min(speedProfile.maxCornerSpeeds[idxCurr], speedProfile.maxCornerSpeeds[idxAhead]) *
            classCornerScale *
            bot.cfg.skill;
          let targetSpeed = Math.min(maxCarSpeedMs, cornerLim);

          // Overtake / traffic avoidance check
          let desiredLane = Math.sin(bot.s * 0.008 + i * 1.3) * (roadHalf * 0.18);
          let blockedAhead = false;

          const checkObstacle = (ox: number, oz: number, oProgress?: number) => {
            const dx = ox - bot.x;
            const dz = oz - bot.z;
            const fwdDist = dx * spCurr.tx + dz * spCurr.tz;
            if (fwdDist > 2.2 && fwdDist < 30) {
              const latSep = dx * spCurr.lx + dz * spCurr.lz - bot.laneOffset;
              if (Math.abs(latSep) < 4.2) {
                blockedAhead = true;
                // Choose wider side to overtake cleanly without bumping
                const goRight = bot.laneOffset > 0 ? -1 : 1;
                desiredLane = Math.max(-roadHalf, Math.min(roadHalf, bot.laneOffset + goRight * 4.8));
                if (fwdDist < 12.0) {
                  targetSpeed = Math.min(targetSpeed, Math.max(10, bot.speedMs * 0.65));
                }
              }
            }
            void oProgress;
          };

          if (localSample) {
            checkObstacle(localSample.x, localSample.z, localSample.raceProgress);
          }
          for (let j = 0; j < bots.length; j++) {
            if (i === j) continue;
            checkObstacle(bots[j].x, bots[j].z);
          }
          for (let r = 0; r < remoteEntries.length; r++) {
            const rc = remoteEntries[r].curr;
            if (!rc.isAi) checkObstacle(rc.x, rc.z);
          }

          bot.targetLaneOffset = THREE.MathUtils.lerp(
            bot.targetLaneOffset,
            Math.max(-roadHalf, Math.min(roadHalf, desiredLane)),
            Math.min(1, dt * (blockedAhead ? 4.5 : 1.5))
          );
          bot.laneOffset = THREE.MathUtils.lerp(bot.laneOffset, bot.targetLaneOffset, Math.min(1, dt * 3.5));

          bot.isBraking = bot.speedMs > targetSpeed + 0.8;
          const accel = def.accelForce * 0.88 * bot.cfg.skill;
          const brake = def.accelForce * (def.brakeForce || 1.5) * 0.95;
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

      tmpEuler.set(pitch, yaw, roll, 'YXZ');
      tmpQuat.setFromEuler(tmpEuler);

      const prevYaw = Math.atan2(sp.tx, sp.tz);
      let yawDelta = yaw - prevYaw;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      bot.steerVisual = THREE.MathUtils.lerp(bot.steerVisual, Math.max(-0.42, Math.min(0.42, yawDelta * 1.8)), Math.min(1, dt * 10));

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
              args={[0.92, 0.24, 1.90]}
              position={[0, 0.96, 0.05]}
              friction={0.0}
              restitution={0.12}
            />
            <group position={[0, 0.02, 0]}>
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
