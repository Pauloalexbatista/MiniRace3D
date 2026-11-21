import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, useRapier, useBeforePhysicsStep, RapierRigidBody, CollisionEnterPayload } from '@react-three/rapier';
import { SplineNode, RoadBranch, computePitStopZones, buildSplineArcSampler, computeGridSlotPose } from '../tracks';
import { bermaWidth } from '../trackCorridor';
import { SurfaceType, SpeedPreset } from '../physics';
import { Car3D, CarClass } from './Car3D';
import { publishTelemetry, TelemetryData, PitStopStatus, RaceStartPhase, registerStartCountdownHandler } from '../telemetryStore';
import type { LocalCarNetSample } from '../multiplayer/types';

const ZERO_VEC3: [number, number, number] = [0, 0, 0];
const CAR_RIGIDBODY_USER_DATA = { surface: 'CAR' };
const CHASSIS_COLLIDER_ARGS: [number, number, number] = [0.92, 0.24, 1.90];
const CHASSIS_COLLIDER_POS: [number, number, number] = [0, 0.96, 0.05];
const VISUAL_GROUP_POS: [number, number, number] = [0, 0.02, 0];

const SURFACE_TIER: Record<SurfaceType, number> = {
  TRACK: 0,
  CURB: 1,
  CURB_WIDE: 2,
  CURB_APEX: 3,
  GRASS: 4,
  SAND: 5,
  GRAVEL: 6,
};

const ENGINE_WEAR_PER_SEC: Record<SurfaceType, number> = {
  TRACK: 0,
  CURB: 0, // White line causes 0 engine damage
  CURB_WIDE: 0.4,
  CURB_APEX: 0.9,
  GRASS: 1.8,
  SAND: 3.2,
  GRAVEL: 4.8,
};

const TIRE_SURFACE_WEAR_PER_SEC: Record<SurfaceType, number> = {
  TRACK: 0,
  CURB: 0.16,
  CURB_WIDE: 0.35,
  CURB_APEX: 0.65,
  GRASS: 0.80,
  SAND: 1.25,
  GRAVEL: 1.80,
};

const SKID_MAX_QUADS = 2400;
const SKID_LIFETIME_SEC = 150.0; // 2.5 minutes visible before disappearing
const SKID_FADE_SEC = 25.0;

const wheelRayFilter = (col: any): boolean => {
  const surf = (col?.parent()?.userData as { surface?: unknown } | undefined)?.surface;
  return surf !== 'WALL' && surf !== 'CAR';
};

function isSurfaceType(val: unknown): val is SurfaceType {
  return typeof val === 'string' && Object.prototype.hasOwnProperty.call(SURFACE_TIER, val);
}

export interface CarTuning {
  maxSpeedKmh: number;
  accelForce: number;
  lateralGrip: number;
  steerRate: number;
  brakeForce: number;
  suspensionStiffness: number;
  suspensionDamper: number;
  suspensionTravel: number;
  primaryColor: string;
  secondaryColor: string;
}

export const CAR_CLASS_DEFAULTS: Record<CarClass, CarTuning & { label: string; color: string; desc: string }> = {
  f1: {
    label: '🏎️ Fórmula 1',
    maxSpeedKmh: 420,
    accelForce: 56,
    lateralGrip: 14.5,
    steerRate: 2.35,
    brakeForce: 2.15,
    suspensionStiffness: 56,
    suspensionDamper: 14.5,
    suspensionTravel: 1.02,
    primaryColor: '#e11d48',
    secondaryColor: '#f8fafc',
    color: '#e11d48',
    desc: 'Fórmula 1 real: alta carga aerodinâmica, travagem forte e curva sobre carris',
  },
  gt: {
    label: '🏁 GT Racing',
    maxSpeedKmh: 310,
    accelForce: 39,
    lateralGrip: 8.8,
    steerRate: 2.15,
    brakeForce: 1.60,
    suspensionStiffness: 46,
    suspensionDamper: 12.0,
    suspensionTravel: 1.10,
    primaryColor: '#2563eb',
    secondaryColor: '#f8fafc',
    color: '#2563eb',
    desc: 'Equilibrado, transferência de peso realista e deslize ligeiro no limite',
  },
  rally: {
    label: '🌲 Rally WRC',
    maxSpeedKmh: 255,
    accelForce: 45,
    lateralGrip: 5.2,
    steerRate: 2.55,
    brakeForce: 1.35,
    suspensionStiffness: 32,
    suspensionDamper: 8.8,
    suspensionTravel: 1.32,
    primaryColor: '#f59e0b',
    secondaryColor: '#0f172a',
    color: '#f59e0b',
    desc: 'Suspensão longa, tração em terra/bermas e deriva controlada em curva',
  },
  drift: {
    label: '🔥 Drift Pro',
    maxSpeedKmh: 270,
    accelForce: 42,
    lateralGrip: 2.8,
    steerRate: 2.95,
    brakeForce: 1.25,
    suspensionStiffness: 42,
    suspensionDamper: 10.5,
    suspensionTravel: 1.10,
    primaryColor: '#8b5cf6',
    secondaryColor: '#fbbf24',
    color: '#8b5cf6',
    desc: 'Traseira solta, direção rápida e derrapagens longas em contra-brecagem',
  },
};

const CLASS_HANDLING: Record<CarClass, {
  baseMaxLatAccel: number;
  aeroLatAccelAt300: number;
  yawGripHeadroom: number;
  offTrackGripDrop: number;
  scrubDrag: number;
}> = {
  f1:    { baseMaxLatAccel: 30, aeroLatAccelAt300: 22, yawGripHeadroom: 1.04, offTrackGripDrop: 0.12, scrubDrag: 0.45 },
  gt:    { baseMaxLatAccel: 22, aeroLatAccelAt300: 8,  yawGripHeadroom: 1.18, offTrackGripDrop: 0.09, scrubDrag: 0.35 },
  rally: { baseMaxLatAccel: 19, aeroLatAccelAt300: 3,  yawGripHeadroom: 1.58, offTrackGripDrop: 0.04, scrubDrag: 0.22 },
  drift: { baseMaxLatAccel: 16, aeroLatAccelAt300: 2,  yawGripHeadroom: 2.15, offTrackGripDrop: 0.07, scrubDrag: 0.16 },
};

interface RapierCarControllerProps {
  spline: SplineNode[];
  isClosed?: boolean;
  isRaceActive?: boolean;
  branches?: RoadBranch[];
  pitSpline?: SplineNode[];
  groundY: number;
  cameraMode: 'chase' | 'cockpit' | 'orbit';
  speedPreset?: SpeedPreset;
  carClass?: CarClass;
  carTuning?: CarTuning;
  headlightsOn?: boolean;
  onToggleHeadlights?: () => void;
  environmentTheme?: 'day' | 'sunset' | 'night';
  onTelemetry?: (data: TelemetryData) => void;
  resetTrigger?: number;
  raceStartTrigger?: number;
  recoverTrigger?: number;
  gridSlotIndex?: number;
  totalLaps?: number;
  externalRaceControl?: boolean;
  externalPhase?: 'loading' | 'ready' | 'lights' | 'green' | 'racing' | 'finished';
  externalLightsLit?: number;
  onSceneReady?: () => void;
  onLocalCarSample?: (sample: LocalCarNetSample) => void;
}

const WHEEL_RAY_ORIGIN_Y = 1.25;
const WHEEL_RAY_LIFT = 0.55; // 1.25 - 0.70 (keeps rays safely above asphalt even at full bottom-out)

const WHEEL_MOUNTS: [number, number, number][] = [
  [-1.1, WHEEL_RAY_ORIGIN_Y, 1.45],  // Front Left
  [1.1, WHEEL_RAY_ORIGIN_Y, 1.45],   // Front Right
  [-1.15, WHEEL_RAY_ORIGIN_Y, -1.25], // Rear Left
  [1.15, WHEEL_RAY_ORIGIN_Y, -1.25],  // Rear Right
];

export const RapierCarController: React.FC<RapierCarControllerProps> = React.memo(({
  spline,
  isClosed = true,
  isRaceActive = true,
  branches,
  pitSpline,
  groundY,
  cameraMode,
  speedPreset = 'sport',
  carClass = 'f1',
  carTuning,
  headlightsOn = true,
  onToggleHeadlights,
  environmentTheme = 'day',
  onTelemetry,
  resetTrigger = 0,
  raceStartTrigger = 0,
  recoverTrigger = 0,
  gridSlotIndex = 0,
  totalLaps,
  externalRaceControl = false,
  externalPhase = 'loading',
  externalLightsLit = 0,
  onSceneReady,
  onLocalCarSample,
}) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const visualGroupRef = useRef<THREE.Group>(null);
  const { rapier, world } = useRapier();

  const isRaceActiveRef = useRef(isRaceActive);
  isRaceActiveRef.current = isRaceActive;
  const isClosedRef = useRef(isClosed);
  isClosedRef.current = isClosed;
  const externalRaceControlRef = useRef(externalRaceControl);
  externalRaceControlRef.current = externalRaceControl;
  const externalPhaseRef = useRef(externalPhase);
  externalPhaseRef.current = externalPhase;
  const externalLightsLitRef = useRef(externalLightsLit);
  externalLightsLitRef.current = externalLightsLit;
  const totalLapsRef = useRef(totalLaps);
  totalLapsRef.current = totalLaps;
  const onSceneReadyRef = useRef(onSceneReady);
  onSceneReadyRef.current = onSceneReady;
  const onLocalCarSampleRef = useRef(onLocalCarSample);
  onLocalCarSampleRef.current = onLocalCarSample;
  const headlightsOnRef = useRef(headlightsOn);
  headlightsOnRef.current = headlightsOn;
  const onToggleHeadlightsRef = useRef(onToggleHeadlights);
  onToggleHeadlightsRef.current = onToggleHeadlights;

  const keys = useRef<{ [key: string]: boolean }>({});
  const steerRef = useRef(0);
  const visualSteerRef = useRef(0);
  const wheelRollRef = useRef(0);
  const brakeLightRef = useRef(0);
  const camPosRef = useRef(new THREE.Vector3());
  const camLookRef = useRef(new THREE.Vector3());
  const telemetryAccRef = useRef(0);
  const netEmitAccRef = useRef(0);
  const wasIdleOrbitRef = useRef(false);
  const lastSplineIdxRef = useRef(0);
  const lapStartRef = useRef(performance.now());
  const lapNumberRef = useRef(1);
  const completedLapsRef = useRef(0);
  const bestLapRef = useRef<number | null>(null);
  const lastLapRef = useRef<number | null>(null);
  const passedMidRef = useRef(false);
  const passedCp1Ref = useRef(false);
  const passedCp2Ref = useRef(false);
  const wasAtStartRef = useRef(true);
  const unwrappedDistRef = useRef(0);
  const prevTrackSRef = useRef(0);
  const raceGoTimestampRef = useRef(performance.now());
  const finishedRef = useRef(false);
  const finishTimeMsRef = useRef<number | null>(null);
  const sceneReadyEmittedRef = useRef(false);
  const prevExtPhaseRef = useRef<string | undefined>(undefined);
  const prevExtLightsRef = useRef(0);

  const raceStartPhaseRef = useRef<RaceStartPhase>('ready');
  const startSeqTimerRef = useRef(0);
  const startLightsLitRef = useRef(0);
  const recoveryNoticeUntilRef = useRef(0);
  const flippedSecRef = useRef(0);
  const lastPublishedPhaseRef = useRef<RaceStartPhase>('ready');
  const lastPublishedLightsRef = useRef(0);
  const lastPublishedHeadlightsRef = useRef(headlightsOn);
  const lastPublishedBrakingRef = useRef(false);
  const gpRecoverCooldownRef = useRef(0);
  const gpLightsCooldownRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const engineHealthRef = useRef(100);
  const tireHealthRef = useRef(100);
  const excursionEntrySpeedMsRef = useRef(0);
  const excursionMaxTierRef = useRef(0);
  const lastCollisionTimeRef = useRef(0);
  const lastCarCollisionTimeRef = useRef(0);
  const lastWallCollisionTimeRef = useRef(0);
  const prevSpeedKmhRef = useRef(0);
  const pitStopTimerRef = useRef(0);
  const pitStopDoneUntilRef = useRef(0);

  // Bridge refs between fixed-timestep useBeforePhysicsStep and render-frame useFrame
  const lastGroundedWheelsRef = useRef(0);
  const lastSumHitToiRef = useRef(0);
  const lastForwardSpeedRef = useRef(0);
  const lastLateralSpeedRef = useRef(0);
  const lastSpeedKmhRef = useRef(0);
  const lastCurrentSurfaceRef = useRef<SurfaceType>('TRACK');
  const lastCurrentTierRef = useRef(0);
  const lastThrottleRef = useRef(0);
  const lastBrakeRef = useRef(0);
  const lastHandbrakeRef = useRef(false);
  const lastInPitBoxZoneRef = useRef(false);
  const lastPitStopStatusRef = useRef<PitStopStatus>('none');
  const lastIsFlippedRef = useRef(false);
  const lastIsHeldOnGridRef = useRef(true);
  const forceNetEmitRef = useRef(false);
  const physicsSteppedRef = useRef(false);

  // Pooled GPU-fading skid mark ring buffer (1 draw call, zero per-frame allocations)
  const skidClockRef = useRef(0);
  const skidHeadRef = useRef(0);
  const prevWheelPosRef = useMemo(
    () => WHEEL_MOUNTS.map(() => ({ valid: false, x: 0, y: 0, z: 0 })),
    []
  );
  const wheelHitData = useMemo(
    () => WHEEL_MOUNTS.map(() => ({ grounded: false, hx: 0, hy: 0, hz: 0 })),
    []
  );

  const skidResources = useMemo(() => {
    const positions = new Float32Array(SKID_MAX_QUADS * 4 * 3);
    const birthTimes = new Float32Array(SKID_MAX_QUADS * 4).fill(-9999);
    const alphas = new Float32Array(SKID_MAX_QUADS * 4);
    const indices = new Uint16Array(SKID_MAX_QUADS * 6);
    for (let q = 0; q < SKID_MAX_QUADS; q++) {
      const v = q * 4;
      const i = q * 6;
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v + 2;
      indices[i + 4] = v + 1;
      indices[i + 5] = v + 3;
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const birthAttr = new THREE.BufferAttribute(birthTimes, 1);
    birthAttr.setUsage(THREE.DynamicDrawUsage);
    const alphaAttr = new THREE.BufferAttribute(alphas, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', posAttr);
    geo.setAttribute('aBirthTime', birthAttr);
    geo.setAttribute('aAlpha', alphaAttr);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLifetime: { value: SKID_LIFETIME_SEC },
        uFadeDuration: { value: SKID_FADE_SEC },
      },
      vertexShader: `
        attribute float aBirthTime;
        attribute float aAlpha;
        varying float vBirthTime;
        varying float vAlpha;
        void main() {
          vBirthTime = aBirthTime;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uLifetime;
        uniform float uFadeDuration;
        varying float vBirthTime;
        varying float vAlpha;
        void main() {
          float age = uTime - vBirthTime;
          if (age < 0.0 || age > uLifetime || vAlpha <= 0.005) discard;
          float fade = 1.0 - smoothstep(uLifetime - uFadeDuration, uLifetime, age);
          float alpha = vAlpha * fade;
          if (alpha <= 0.005) discard;
          gl_FragColor = vec4(0.05, 0.05, 0.06, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      side: THREE.DoubleSide,
    });

    return { geo, mat, positions, birthTimes, alphas, posAttr, birthAttr, alphaAttr };
  }, []);

  useEffect(() => {
    return () => {
      skidResources.geo.dispose();
      skidResources.mat.dispose();
    };
  }, [skidResources]);

  const clearSkidMarks = () => {
    skidResources.alphas.fill(0);
    skidResources.birthTimes.fill(-9999);
    skidHeadRef.current = 0;
    for (let i = 0; i < prevWheelPosRef.length; i++) {
      prevWheelPosRef[i].valid = false;
    }
    skidResources.alphaAttr.needsUpdate = true;
    skidResources.birthAttr.needsUpdate = true;
  };

  const pitStopZones = useMemo(
    () => computePitStopZones(branches, pitSpline),
    [branches, pitSpline]
  );

  const mainArcSampler = useMemo(
    () => buildSplineArcSampler(spline, isClosed),
    [spline, isClosed]
  );

  const playStartBeep = (freq: number, durationMs: number, gainVal = 0.08) => {
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
    } catch {
      // Ignore Web Audio blocks when autoplay/audio policy restricts context
    }
  };

  useEffect(() => {
    return () => {
      try {
        audioCtxRef.current?.close();
      } catch {
        // Ignore close errors
      }
      audioCtxRef.current = null;
    };
  }, []);

  const beginStartCountdown = () => {
    if (externalRaceControlRef.current) return;
    if (raceStartPhaseRef.current !== 'ready') return;
    raceStartPhaseRef.current = 'lights';
    startSeqTimerRef.current = 0;
    startLightsLitRef.current = 1;
    playStartBeep(440, 110, 0.08);
  };

  useEffect(() => {
    registerStartCountdownHandler(() => beginStartCountdown());
    return () => registerStartCountdownHandler(null);
  }, []);

  const presetConfig = useMemo(() => {
    const def = CAR_CLASS_DEFAULTS[carClass];
    const base = carTuning || def;
    const speedScale = speedPreset === 'calm' ? 0.65 : speedPreset === 'extreme' ? 1.05 : 0.85;
    return {
      maxSpeedKmh: Math.max(180, Math.round(base.maxSpeedKmh * speedScale)),
      accelForce: base.accelForce,
      reverseForce: Math.round(base.accelForce * 0.55),
      lateralGrip: base.lateralGrip,
      steerRate: base.steerRate,
      brakeForce: base.brakeForce ?? def.brakeForce,
      suspensionStiffness: base.suspensionStiffness ?? def.suspensionStiffness,
      suspensionDamper: base.suspensionDamper ?? def.suspensionDamper,
      suspensionTravel: base.suspensionTravel ?? def.suspensionTravel,
      primaryColor: base.primaryColor || def.primaryColor,
      secondaryColor: base.secondaryColor || def.secondaryColor,
    };
  }, [speedPreset, carClass, carTuning]);

  const spawnPose = useMemo(() => {
    if (!spline || spline.length < 2) {
      return { pos: [0, groundY + 2, 0] as [number, number, number], yaw: 0, sCar: 0 };
    }
    const slotPose = computeGridSlotPose(spline, isClosed, gridSlotIndex);
    return {
      pos: [slotPose.x, slotPose.y + 0.30, slotPose.z] as [number, number, number],
      yaw: slotPose.yaw,
      sCar: slotPose.sCar,
    };
  }, [spline, isClosed, groundY, gridSlotIndex]);

  const minSplineY = useMemo(() => {
    if (!spline || spline.length === 0) return 0;
    let m = Infinity;
    for (const n of spline) {
      const z = n.z ?? 0;
      if (z < m) m = z;
    }
    return Number.isFinite(m) ? m : 0;
  }, [spline]);

  const localFloorCheckRadiusSq = useMemo(() => {
    let maxR = 30;
    if (spline && spline.length > 0) {
      for (const n of spline) {
        const hw = (n.width || 18) * 0.5;
        const reach = hw + Math.max(bermaWidth(n, 'L'), bermaWidth(n, 'R')) + 8;
        if (reach > maxR) maxR = reach;
      }
    }
    return maxR * maxR;
  }, [spline]);

  const resetToGridStart = (resetStats = true) => {
    const rb = rbRef.current;
    if (!rb) return;
    const eqComp = 24 / (4 * Math.max(10, presetConfig.suspensionStiffness));
    const eqRideY = Math.max(0.18, presetConfig.suspensionTravel - eqComp - 0.70);
    let targetY = spawnPose.pos[1] - 0.30 + eqRideY + 0.04;
    try {
      const originY = spawnPose.pos[1] + 50;
      const ray = new rapier.Ray(
        { x: spawnPose.pos[0], y: originY, z: spawnPose.pos[2] },
        { x: 0, y: -1, z: 0 }
      );
      const hit = world.castRay(ray, 120, true, undefined, undefined, undefined, rb, wheelRayFilter);
      const hitToi = hit ? ((hit as any).timeOfImpact ?? (hit as any).toi) : undefined;
      if (typeof hitToi === 'number' && hitToi >= 0) {
        const hitY = originY - hitToi;
        targetY = Math.max(spawnPose.pos[1] - 1.2, hitY + eqRideY + 0.04);
      }
    } catch {
      // Fallback to spawnPose.pos[1] if Rapier world is not ready
    }
    rb.setTranslation({ x: spawnPose.pos[0], y: targetY, z: spawnPose.pos[2] }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawnPose.yaw);
    rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const bodyObj = visualGroupRef.current?.parent;
    if (bodyObj) {
      bodyObj.position.set(spawnPose.pos[0], targetY, spawnPose.pos[2]);
      bodyObj.quaternion.copy(q);
    }
    if (visualGroupRef.current) {
      const tireBottom = carClass === 'f1' ? -0.06 : -0.02;
      visualGroupRef.current.position.y = -eqRideY - tireBottom + 0.005;
    }
    camPosRef.current.set(0, 0, 0);
    camLookRef.current.set(0, 0, 0);
    for (let i = 0; i < prevWheelPosRef.length; i++) {
      prevWheelPosRef[i].valid = false;
    }
    if (resetStats) {
      engineHealthRef.current = 100;
      tireHealthRef.current = 100;
      excursionEntrySpeedMsRef.current = 0;
      excursionMaxTierRef.current = 0;
      pitStopTimerRef.current = 0;
      pitStopDoneUntilRef.current = 0;
      prevSpeedKmhRef.current = 0;
      flippedSecRef.current = 0;
      recoveryNoticeUntilRef.current = 0;
      wasIdleOrbitRef.current = false;
      lapNumberRef.current = 1;
      completedLapsRef.current = 0;
      lapStartRef.current = performance.now();
      raceGoTimestampRef.current = performance.now();
      passedMidRef.current = false;
      passedCp1Ref.current = false;
      passedCp2Ref.current = false;
      wasAtStartRef.current = true;
      unwrappedDistRef.current = spawnPose.sCar;
      const L = mainArcSampler.totalLen;
      prevTrackSRef.current = L > 0 ? ((spawnPose.sCar % L) + L) % L : 0;
      finishedRef.current = false;
      finishTimeMsRef.current = null;
      prevExtPhaseRef.current = undefined;
      prevExtLightsRef.current = 0;
      raceStartPhaseRef.current = 'ready';
      startLightsLitRef.current = 0;
      startSeqTimerRef.current = 0;
      clearSkidMarks();
    }
  };

  const recoverCarOnTrack = (penaltyMeters = 35) => {
    const rb = rbRef.current;
    if (!rb) return;
    if (raceStartPhaseRef.current === 'ready' || raceStartPhaseRef.current === 'lights') {
      resetToGridStart(false);
      return;
    }
    const t = rb.translation();
    const sCrash = mainArcSampler.nearestS(t.x, t.z);
    const sRecover = isClosedRef.current ? sCrash - penaltyMeters : Math.max(0, sCrash - penaltyMeters);
    const sp = mainArcSampler.sampleAt(sRecover);
    const surfaceBaseY = sp.y + Math.abs(sp.bankSin) * ((sp.width || 18) * 0.5);
    let targetY = surfaceBaseY + 0.9;
    try {
      const originY = surfaceBaseY + 45;
      const ray = new rapier.Ray(
        { x: sp.x, y: originY, z: sp.z },
        { x: 0, y: -1, z: 0 }
      );
      const hit = world.castRay(ray, 110, true, undefined, undefined, undefined, rb, wheelRayFilter);
      const hitToi = hit ? ((hit as any).timeOfImpact ?? (hit as any).toi) : undefined;
      if (typeof hitToi === 'number' && hitToi >= 0) {
        const hitY = originY - hitToi;
        targetY = Math.max(surfaceBaseY - 1.5, hitY + 0.75);
      }
    } catch {
      // Fallback to surfaceBaseY if Rapier world is not ready
    }
    const yaw = Math.atan2(sp.tx, sp.tz);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    rb.setTranslation({ x: sp.x, y: targetY, z: sp.z }, true);
    rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const bodyObj = visualGroupRef.current?.parent;
    if (bodyObj) {
      bodyObj.position.set(sp.x, targetY, sp.z);
      bodyObj.quaternion.copy(q);
    }

    if (mainArcSampler.totalLen > 20) {
      const L = mainArcSampler.totalLen;
      prevTrackSRef.current = ((sRecover % L) + L) % L;
      unwrappedDistRef.current -= penaltyMeters;
    }

    excursionEntrySpeedMsRef.current = 0;
    excursionMaxTierRef.current = 0;
    pitStopTimerRef.current = 0;
    prevSpeedKmhRef.current = 0;
    flippedSecRef.current = 0;
    camPosRef.current.set(0, 0, 0);
    camLookRef.current.set(0, 0, 0);
    for (let i = 0; i < prevWheelPosRef.length; i++) {
      prevWheelPosRef[i].valid = false;
    }
    recoveryNoticeUntilRef.current = performance.now() + 2600;
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      resetToGridStart(true);
      if (!sceneReadyEmittedRef.current && spline && spline.length > 2) {
        sceneReadyEmittedRef.current = true;
        onSceneReadyRef.current?.();
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [spawnPose.pos[0], spawnPose.pos[1], spawnPose.pos[2]]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const k = e.key.toLowerCase();
      keys.current[k] = true;

      if (!externalRaceControlRef.current && isRaceActiveRef.current && raceStartPhaseRef.current === 'ready') {
        if (e.repeat) return;
        const isModifier =
          k === 'shift' || k === 'control' || k === 'alt' || k === 'meta' ||
          k === 'tab' || k === 'escape' || k === 'capslock' ||
          k === 'l' || k === 'c' || /^f\d+$/.test(k);
        if (isModifier) return;
        if (k === 'r' && e.shiftKey) {
          resetToGridStart(true);
        } else {
          beginStartCountdown();
        }
        return;
      }

      if (k === 'r' && !e.repeat) {
        if (e.shiftKey && !externalRaceControlRef.current) resetToGridStart(true);
        else recoverCarOnTrack(35);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [spawnPose, mainArcSampler]);

  useEffect(() => {
    if (resetTrigger > 0) resetToGridStart(true);
  }, [resetTrigger]);

  useEffect(() => {
    if (raceStartTrigger > 0) resetToGridStart(true);
  }, [raceStartTrigger]);

  useEffect(() => {
    if (recoverTrigger > 0) recoverCarOnTrack(35);
  }, [recoverTrigger]);

  // Temp vectors and rays to avoid per-frame allocations in useFrame
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpVel = useMemo(() => new THREE.Vector3(), []);
  const tmpForward = useMemo(() => new THREE.Vector3(), []);
  const tmpRight = useMemo(() => new THREE.Vector3(), []);
  const tmpUp = useMemo(() => new THREE.Vector3(), []);
  const tmpDown = useMemo(() => new THREE.Vector3(), []);
  const tmpRayOrigin = useMemo(() => new THREE.Vector3(), []);
  const tmpPointVel = useMemo(() => new THREE.Vector3(), []);
  const tmpAngVel = useMemo(() => new THREE.Vector3(), []);
  const tmpAvgNormal = useMemo(() => new THREE.Vector3(), []);
  const tmpRoadForward = useMemo(() => new THREE.Vector3(), []);
  const tmpRollError = useMemo(() => new THREE.Vector3(), []);
  const tmpNextAngVel = useMemo(() => new THREE.Vector3(), []);
  const tmpUprightError = useMemo(() => new THREE.Vector3(), []);
  const tmpWorldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tmpCamOffset = useMemo(() => new THREE.Vector3(), []);
  const tmpDesiredCam = useMemo(() => new THREE.Vector3(), []);
  const tmpLookTarget = useMemo(() => new THREE.Vector3(), []);
  const tmpLookUpOffset = useMemo(() => new THREE.Vector3(0, 1.5, 0), []);
  const tmpCamCarPos = useMemo(() => new THREE.Vector3(), []);
  const tmpCamCarQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpCamForward = useMemo(() => new THREE.Vector3(), []);
  const tmpWheelRays = useMemo(
    () => WHEEL_MOUNTS.map(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })),
    [rapier]
  );

  useEffect(() => {
    lastSplineIdxRef.current = 0;
    clearSkidMarks();
  }, [spline]);

  const handleCollisionEnter = useCallback((payload: CollisionEnterPayload) => {
    const otherUserData = payload.other.rigidBody?.userData as
      | { surface?: string; vel?: { x: number; y: number; z: number } }
      | undefined;
    const otherSurface = otherUserData?.surface;
    if (otherSurface !== 'WALL' && otherSurface !== 'CAR') return;

    const rb = rbRef.current;
    if (!rb) return;
    const now = performance.now();
    const lv = rb.linvel();

    if (otherSurface === 'CAR') {
      if (now - lastCarCollisionTimeRef.current < 1100) return;
      const otherVel = otherUserData?.vel ?? payload.other.rigidBody?.linvel?.() ?? { x: 0, y: 0, z: 0 };
      const relSpeedKmh =
        Math.hypot(lv.x - (otherVel.x || 0), lv.y - (otherVel.y || 0), lv.z - (otherVel.z || 0)) * 3.6;
      if (relSpeedKmh < 18) return;
      const dmg =
        relSpeedKmh < 35
          ? (relSpeedKmh - 15) * 0.08
          : Math.min(7, 1.8 + (relSpeedKmh - 35) * 0.06);
      engineHealthRef.current = Math.max(20, engineHealthRef.current - dmg);
      lastCarCollisionTimeRef.current = now;
      lastCollisionTimeRef.current = now;
      return;
    }

    if (now - lastWallCollisionTimeRef.current < 850) return;
    const currentSpeed = Math.hypot(lv.x, lv.y, lv.z) * 3.6;
    const impactSpeed = Math.max(prevSpeedKmhRef.current, currentSpeed);
    if (impactSpeed >= 25) {
      const dmg = Math.min(12, Math.max(1.5, (impactSpeed - 20) * 0.065));
      engineHealthRef.current = Math.max(20, engineHealthRef.current - dmg);
      lastWallCollisionTimeRef.current = now;
      lastCollisionTimeRef.current = now;
    }
  }, []);

  useBeforePhysicsStep(() => {
    const rb = rbRef.current;
    if (!rb) return;

    const dt = 1 / 60;
    const t = rb.translation();
    const r = rb.rotation();
    const lv = rb.linvel();
    const av = rb.angvel();

    tmpPos.set(t.x, t.y, t.z);
    tmpQuat.set(r.x, r.y, r.z, r.w);
    tmpVel.set(lv.x, lv.y, lv.z);
    tmpAngVel.set(av.x, av.y, av.z);

    // Advance F1 race start lights sequence (Red 1 -> 2 -> 3 -> Green GO)
    const nowMs = performance.now();
    if (externalRaceControlRef.current) {
      const extPhase = externalPhaseRef.current || 'loading';
      const extLights = externalLightsLitRef.current || 0;
      const wasHeldPhase =
        prevExtPhaseRef.current === undefined ||
        prevExtPhaseRef.current === 'loading' ||
        prevExtPhaseRef.current === 'ready' ||
        prevExtPhaseRef.current === 'lights';

      if (extPhase === 'loading' || extPhase === 'ready') {
        raceStartPhaseRef.current = 'ready';
        startLightsLitRef.current = 0;
      } else if (extPhase === 'lights') {
        raceStartPhaseRef.current = 'lights';
        startLightsLitRef.current = extLights;
        if (extLights > prevExtLightsRef.current && extLights >= 1 && extLights <= 3) {
          playStartBeep(440, 110, 0.08);
        }
      } else if (extPhase === 'green' || extPhase === 'racing' || extPhase === 'finished') {
        raceStartPhaseRef.current = extPhase === 'green' ? 'green' : 'racing';
        startLightsLitRef.current = 0;
        if (wasHeldPhase) {
          raceGoTimestampRef.current = nowMs;
          lapStartRef.current = nowMs;
          lapNumberRef.current = 1;
          completedLapsRef.current = 0;
          passedMidRef.current = false;
          passedCp1Ref.current = false;
          passedCp2Ref.current = false;
          wasAtStartRef.current = true;
          playStartBeep(880, 240, 0.10);
        }
      }
      prevExtPhaseRef.current = extPhase;
      prevExtLightsRef.current = extLights;
    } else if (raceStartPhaseRef.current === 'lights') {
      startSeqTimerRef.current += dt;
      const tSeq = startSeqTimerRef.current;
      if (tSeq >= 2.7) {
        raceStartPhaseRef.current = 'green';
        startLightsLitRef.current = 0;
        startSeqTimerRef.current = 0;
        raceGoTimestampRef.current = nowMs;
        lapStartRef.current = nowMs;
        lapNumberRef.current = 1;
        completedLapsRef.current = 0;
        passedMidRef.current = false;
        passedCp1Ref.current = false;
        passedCp2Ref.current = false;
        wasAtStartRef.current = true;
        playStartBeep(880, 240, 0.10);
      } else if (tSeq >= 1.8 && startLightsLitRef.current < 3) {
        startLightsLitRef.current = 3;
        playStartBeep(440, 110, 0.08);
      } else if (tSeq >= 0.9 && startLightsLitRef.current < 2) {
        startLightsLitRef.current = 2;
        playStartBeep(440, 110, 0.08);
      }
    } else if (raceStartPhaseRef.current === 'green') {
      startSeqTimerRef.current += dt;
      if (startSeqTimerRef.current >= 1.8) {
        raceStartPhaseRef.current = 'racing';
      }
    }

    const isHeldOnGrid =
      raceStartPhaseRef.current === 'ready' || raceStartPhaseRef.current === 'lights';

    // Recover onto track if fallen far below world
    if (tmpPos.y < groundY - 30) {
      recoverCarOnTrack(35);
      return;
    }

    tmpForward.set(0, 0, 1).applyQuaternion(tmpQuat).normalize();
    tmpRight.set(1, 0, 0).applyQuaternion(tmpQuat).normalize();
    tmpUp.set(0, 1, 0).applyQuaternion(tmpQuat).normalize();
    tmpDown.copy(tmpUp).negate();

    // Inputs (Keyboard + Gamepad)
    let gpThrottle = 0;
    let gpBrake = 0;
    let gpSteer = 0;
    let gpHandbrake = false;

    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      let gp: Gamepad | null = null;
      if (gamepads) {
        for (let gi = 0; gi < gamepads.length; gi++) {
          const cand = gamepads[gi];
          if (cand && cand.connected) {
            gp = cand;
            break;
          }
        }
      }
      if (gp) {
        const stickX = gp.axes[0] || 0;
        if (Math.abs(stickX) > 0.08) {
          // Progressive non-linear curve for precise high-speed analog steering
          const norm = (Math.abs(stickX) - 0.08) / 0.92;
          gpSteer = -Math.sign(stickX) * Math.pow(Math.min(1, norm), 1.45);
        }
        const btnRT = gp.buttons[7]?.value ?? (gp.buttons[7]?.pressed ? 1 : 0);
        const btnA = gp.buttons[0]?.pressed ? 1 : 0;
        const dpadUp = gp.buttons[12]?.pressed ? 1 : 0;
        gpThrottle = Math.max(btnRT, btnA, dpadUp);

        const btnLT = gp.buttons[6]?.value ?? (gp.buttons[6]?.pressed ? 1 : 0);
        const btnB = gp.buttons[1]?.pressed ? 1 : 0;
        const dpadDown = gp.buttons[13]?.pressed ? 1 : 0;
        gpBrake = Math.max(btnLT, btnB, dpadDown);

        gpHandbrake = Boolean(gp.buttons[2]?.pressed || gp.buttons[5]?.pressed);

        if (gp.buttons[4]?.pressed && nowMs > gpLightsCooldownRef.current) {
          gpLightsCooldownRef.current = nowMs + 350;
          onToggleHeadlightsRef.current?.();
        }

        if (!externalRaceControlRef.current && isRaceActiveRef.current && raceStartPhaseRef.current === 'ready') {
          if (gpThrottle > 0.25 || gp.buttons[0]?.pressed || gp.buttons[9]?.pressed) {
            beginStartCountdown();
          }
        } else if ((gp.buttons[8]?.pressed || gp.buttons[3]?.pressed) && nowMs > gpRecoverCooldownRef.current) {
          gpRecoverCooldownRef.current = nowMs + 500;
          recoverCarOnTrack(35);
          return;
        }
      }
    }

    const kbThrottle = (keys.current['w'] || keys.current['arrowup']) ? 1 : 0;
    const kbBrake = (keys.current['s'] || keys.current['arrowdown']) ? 1 : 0;
    const kbLeft = (keys.current['a'] || keys.current['arrowleft']) ? 1 : 0;
    const kbRight = (keys.current['d'] || keys.current['arrowright']) ? 1 : 0;
    const kbHandbrake = Boolean(keys.current[' ']);

    const preFwdSpeed = tmpVel.dot(tmpForward);
    const isAutoCoastStop = finishedRef.current;
    const throttle = isHeldOnGrid || isAutoCoastStop ? 0 : Math.max(kbThrottle, gpThrottle);
    const brake = isHeldOnGrid
      ? 0
      : isAutoCoastStop
      ? preFwdSpeed > 1.0
        ? 0.55
        : 0
      : Math.max(kbBrake, gpBrake);
    const handbrake = isHeldOnGrid || isAutoCoastStop ? false : (kbHandbrake || gpHandbrake);
    const brakeLightVal = Math.max(
      kbBrake,
      gpBrake,
      kbHandbrake || gpHandbrake ? 1 : 0,
      isAutoCoastStop && brake > 0.05 ? brake : 0
    );
    brakeLightRef.current = brakeLightVal;
    const rawSteer = isHeldOnGrid || isAutoCoastStop ? 0 : (Math.abs(gpSteer) > 0.01 ? gpSteer : (kbLeft - kbRight));
    steerRef.current = THREE.MathUtils.lerp(steerRef.current, rawSteer, Math.min(1, dt * 10));
    visualSteerRef.current = steerRef.current * 0.42;

    // Safety net: check local window around cached spline index first, falling back to full scan only if needed
    let localRoadMinY = Infinity;
    const nSpline = spline ? spline.length : 0;
    if (nSpline > 0) {
      let bestSq = Infinity;
      let bestIdx = lastSplineIdxRef.current % nSpline;
      const win = Math.min(30, Math.floor(nSpline / 2));
      for (let off = -win; off <= win; off++) {
        const idx = (lastSplineIdxRef.current + off + nSpline) % nSpline;
        const sn = spline[idx];
        const dSq = (t.x - sn.x) ** 2 + (t.z - sn.y) ** 2;
        if (dSq < bestSq) {
          bestSq = dSq;
          bestIdx = idx;
        }
        if (dSq < localFloorCheckRadiusSq) {
          const sy = sn.z ?? 0;
          if (sy < localRoadMinY) localRoadMinY = sy;
        }
      }
      if (!Number.isFinite(localRoadMinY)) {
        for (let i = 0; i < nSpline; i += 2) {
          const sn = spline[i];
          const dSq = (t.x - sn.x) ** 2 + (t.z - sn.y) ** 2;
          if (dSq < bestSq) {
            bestSq = dSq;
            bestIdx = i;
          }
          if (dSq < localFloorCheckRadiusSq) {
            const sy = sn.z ?? 0;
            if (sy < localRoadMinY) localRoadMinY = sy;
          }
        }
      }
      lastSplineIdxRef.current = bestIdx;
    }
    const floorLimit = Number.isFinite(localRoadMinY) ? localRoadMinY - 2.2 : minSplineY - 2.5;
    if (t.y < floorLimit || t.y < minSplineY - 3.5) {
      recoverCarOnTrack(35);
      return;
    }

    // 4-Wheel Raycast Suspension (tuned per car class for realistic pitch/roll & -24 m/s^2 gravity)
    const mass = rb.mass();
    const restLength = presetConfig.suspensionTravel;
    const rayMaxLen = restLength + WHEEL_RAY_LIFT;
    const springStiffness = presetConfig.suspensionStiffness * mass;
    const springDamper = presetConfig.suspensionDamper * mass;
    let groundedWheels = 0;
    let validNormalCount = 0;
    let sumHitToi = 0;
    let detectedSurface: SurfaceType = 'TRACK';
    let worstTier = -1;
    tmpAvgNormal.set(0, 0, 0);

    for (let i = 0; i < WHEEL_MOUNTS.length; i++) {
      wheelHitData[i].grounded = false;
      const [mx, my, mz] = WHEEL_MOUNTS[i];
      tmpRayOrigin.set(mx, my, mz).applyQuaternion(tmpQuat).add(tmpPos);

      const ray = tmpWheelRays[i];
      ray.origin.x = tmpRayOrigin.x;
      ray.origin.y = tmpRayOrigin.y;
      ray.origin.z = tmpRayOrigin.z;
      ray.dir.x = tmpDown.x;
      ray.dir.y = tmpDown.y;
      ray.dir.z = tmpDown.z;

      // Exclude self rigid body and walls/cars from downward suspension raycast
      const hit = world.castRayAndGetNormal(
        ray,
        rayMaxLen,
        true,
        undefined,
        undefined,
        undefined,
        rb,
        wheelRayFilter
      );

      const hitToi = hit ? ((hit as any).timeOfImpact ?? (hit as any).toi) : undefined;
      if (typeof hitToi === 'number' && hitToi <= rayMaxLen) {
        const parentRb = hit.collider?.parent();
        const rawSurf = (parentRb?.userData as { surface?: unknown } | undefined)?.surface;
        if (rawSurf === 'WALL' || rawSurf === 'CAR') continue;

        groundedWheels++;
        sumHitToi += hitToi;
        const wh = wheelHitData[i];
        wh.grounded = true;
        wh.hx = tmpRayOrigin.x + tmpDown.x * hitToi;
        wh.hy = tmpRayOrigin.y + tmpDown.y * hitToi;
        wh.hz = tmpRayOrigin.z + tmpDown.z * hitToi;

        if (isSurfaceType(rawSurf)) {
          const tier = SURFACE_TIER[rawSurf];
          if (tier > worstTier) {
            worstTier = tier;
            detectedSurface = rawSurf;
          }
        }

        const compression = Math.max(0, rayMaxLen - hitToi);

        // Point velocity at wheel mount
        const rx = tmpRayOrigin.x - tmpPos.x;
        const ry = tmpRayOrigin.y - tmpPos.y;
        const rz = tmpRayOrigin.z - tmpPos.z;
        tmpPointVel.set(
          tmpVel.x + (tmpAngVel.y * rz - tmpAngVel.z * ry),
          tmpVel.y + (tmpAngVel.z * rx - tmpAngVel.x * rz),
          tmpVel.z + (tmpAngVel.x * ry - tmpAngVel.y * rx)
        );

        const velAlongUp = tmpPointVel.dot(tmpUp);
        const bumpStopForce = hitToi < 0.85 ? (0.85 - hitToi) * springStiffness * 3.5 : 0;
        const rawSpring = compression * springStiffness + bumpStopForce;
        const maxDampMag = (Math.abs(velAlongUp) / dt) * (mass * 0.25);
        const dampForce = Math.max(-maxDampMag, Math.min(maxDampMag, velAlongUp * springDamper));
        const springForce = Math.max(0, Math.min(mass * 160, rawSpring - dampForce));

        const impulseScale = springForce * dt;
        rb.applyImpulseAtPoint(
          {
            x: tmpUp.x * impulseScale,
            y: tmpUp.y * impulseScale,
            z: tmpUp.z * impulseScale,
          },
          { x: tmpRayOrigin.x, y: tmpRayOrigin.y, z: tmpRayOrigin.z },
          true
        );

        if (hit.normal) {
          let nx = hit.normal.x;
          let ny = hit.normal.y;
          let nz = hit.normal.z;
          const nLen = Math.hypot(nx, ny, nz) || 1;
          nx /= nLen;
          ny /= nLen;
          nz /= nLen;
          if (nx * tmpUp.x + ny * tmpUp.y + nz * tmpUp.z < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          // Ignore bogus near-vertical sliver normals (> ~41° tilt)
          if (ny >= 0.75) {
            tmpAvgNormal.x += nx;
            tmpAvgNormal.y += ny;
            tmpAvgNormal.z += nz;
            validNormalCount++;
          }
        }
      }
    }

    const currentSurface: SurfaceType =
      worstTier >= 0 ? detectedSurface : groundedWheels > 0 ? 'GRASS' : 'TRACK';
    const currentTier = SURFACE_TIER[currentSurface];

    const forwardSpeed = tmpVel.dot(tmpForward);
    const lateralSpeed = tmpVel.dot(tmpRight);
    const speedKmh = Math.abs(forwardSpeed) * 3.6;
    const absLat = Math.abs(lateralSpeed);

    // Backup sudden-deceleration impact check (e.g. heavy wall scrape without CollisionEnter)
    const speedDrop = prevSpeedKmhRef.current - speedKmh;
    if (!isHeldOnGrid && speedDrop > 45 && brake === 0 && !handbrake && nowMs - lastCollisionTimeRef.current >= 900) {
      const dmg = Math.min(8, (speedDrop - 38) * 0.07);
      engineHealthRef.current = Math.max(20, engineHealthRef.current - dmg);
      lastCollisionTimeRef.current = nowMs;
    }

    if (isHeldOnGrid) {
      // Lock horizontal movement & rotation on grid while keeping post-impulse suspension vertical velocity
      const postSpringLv = rb.linvel();
      rb.setLinvel({ x: 0, y: Math.max(-4, Math.min(4, postSpringLv.y)), z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else if (groundedWheels > 0) {
      if (validNormalCount > 0) {
        tmpAvgNormal.normalize();
        if (tmpAvgNormal.y < 0.82) {
          tmpAvgNormal.lerp(tmpWorldUp, 0.7).normalize();
        }
      } else {
        tmpAvgNormal.copy(tmpWorldUp);
      }

      // Project forward along road plane so car climbs steep hills cleanly!
      tmpRoadForward.copy(tmpForward).addScaledVector(tmpAvgNormal, -tmpForward.dot(tmpAvgNormal)).normalize();

      // Mechanical wear updates (engine + tires, clamped at 20% minimum)
      if (speedKmh > 3) {
        const speedNorm = Math.min(1.2, speedKmh / 50);
        const engineWear = ENGINE_WEAR_PER_SEC[currentSurface] * speedNorm;
        if (engineWear > 0) {
          engineHealthRef.current = Math.max(20, engineHealthRef.current - engineWear * dt);
        }

        const isDriftOrRally = carClass === 'rally' || carClass === 'drift';
        const offTrackTireScale = carClass === 'rally' ? 0.60 : 1.0;
        const slipTireScale = isDriftOrRally ? 0.55 : 1.0;

        let tireWear = currentSurface === 'TRACK'
          ? 0.05 * Math.min(1.5, speedKmh / 200)
          : TIRE_SURFACE_WEAR_PER_SEC[currentSurface] * speedNorm * offTrackTireScale;
        if (brake > 0.15 && forwardSpeed > 5) {
          tireWear += 0.55 * brake * Math.min(1.5, speedKmh / 140);
        }
        if (absLat > 5.5) {
          tireWear += 0.90 * Math.min(1.8, (absLat - 5.5) / 10) * slipTireScale;
        }
        if (handbrake && speedKmh > 15) {
          tireWear += 0.70 * slipTireScale;
        }
        tireHealthRef.current = Math.max(20, tireHealthRef.current - tireWear * dt);
      }

      const engineSpeedMult = 0.25 + 0.75 * (engineHealthRef.current / 100);
      const engineAccelMult = 0.45 + 0.55 * (engineHealthRef.current / 100);
      const tireGripMult = 0.40 + 0.60 * (tireHealthRef.current / 100);
      const tireBrakeMult = 0.55 + 0.45 * (tireHealthRef.current / 100);
      const tireWornT = tireHealthRef.current < 45 ? Math.min(1, (45 - tireHealthRef.current) / 25) : 0;
      const tireTopSpeedMult = 1.0 - 0.30 * tireWornT; // At 20% tires, wheelspin caps top speed to 70%
      const tireAccelMult = 1.0 - 0.28 * tireWornT;
      const effectiveMaxSpeedKmh = presetConfig.maxSpeedKmh * engineSpeedMult * tireTopSpeedMult;
      const effectiveMaxSpeedMs = effectiveMaxSpeedKmh / 3.6;

      // Off-track speed penalty: -10% per layer from White (-10%) through Gravel (-60%)
      let activeCapMs = effectiveMaxSpeedMs;
      if (currentTier === 0) {
        excursionMaxTierRef.current = 0;
        excursionEntrySpeedMsRef.current = 0;
      } else {
        if (excursionMaxTierRef.current === 0) {
          excursionEntrySpeedMsRef.current = Math.abs(forwardSpeed);
        }
        if (currentTier > excursionMaxTierRef.current) {
          excursionMaxTierRef.current = currentTier;
        }
        const penaltyFactor = 1.0 - 0.10 * currentTier;
        const surfaceMaxMs = effectiveMaxSpeedMs * penaltyFactor;
        const entryTargetMs = excursionEntrySpeedMsRef.current * (1.0 - 0.10 * excursionMaxTierRef.current);
        activeCapMs = excursionEntrySpeedMsRef.current > 8 ? Math.min(surfaceMaxMs, entryTargetMs) : surfaceMaxMs;
      }

      // Acceleration / Braking / Reverse + Off-track speed cap
      let driveAccel = 0;
      const absFwd = Math.abs(forwardSpeed);
      if (currentTier > 0 && absFwd > activeCapMs + 0.15) {
        const excess = absFwd - activeCapMs;
        const capDecel = Math.min(excess / Math.max(dt, 0.001), 18 + excess * 4.5);
        driveAccel = -Math.sign(forwardSpeed || 1) * capDecel;
        if (brake > 0 && forwardSpeed > 1.5) {
          const manualBrake = -brake * presetConfig.accelForce * presetConfig.brakeForce * tireBrakeMult;
          if (manualBrake < driveAccel) driveAccel = manualBrake;
        }
      } else {
        if (throttle > 0) {
          const maxDriveAccel = throttle * presetConfig.accelForce * engineAccelMult * tireAccelMult;
          if (forwardSpeed < activeCapMs) {
            const capAccel = Math.max(0, (activeCapMs - forwardSpeed) * 6.0 + Math.max(0, forwardSpeed) * 0.25);
            driveAccel = Math.min(maxDriveAccel, capAccel);
          } else {
            driveAccel = Math.max(-18, (activeCapMs - forwardSpeed) * 3.0);
          }
        } else if (brake > 0) {
          if (forwardSpeed > 1.5) {
            driveAccel = -brake * presetConfig.accelForce * presetConfig.brakeForce * tireBrakeMult;
          } else if (speedKmh < 70) {
            driveAccel = -brake * presetConfig.reverseForce * engineAccelMult * tireAccelMult;
          }
        }
        if (handbrake && forwardSpeed > 1.5) {
          driveAccel -= presetConfig.accelForce * 0.65 * tireBrakeMult;
        }
        if (currentTier === 0 && throttle === 0 && speedKmh > effectiveMaxSpeedKmh + 1) {
          driveAccel -= (speedKmh - effectiveMaxSpeedKmh) * 0.35;
        }
        // Rolling resistance & aerodynamic drag when coasting
        if (throttle === 0 && brake === 0) {
          driveAccel -= forwardSpeed * 0.45;
        }
      }

      const handling = CLASS_HANDLING[carClass];
      const aeroSpeedRatio = Math.min(1.4, speedKmh / 300);
      const surfaceGripMult = Math.max(0.35, 1.0 - handling.offTrackGripDrop * currentTier);
      const maxLatAccel =
        (handling.baseMaxLatAccel + handling.aeroLatAccelAt300 * aeroSpeedRatio * aeroSpeedRatio) *
        tireGripMult *
        surfaceGripMult *
        (handbrake ? 0.50 : 1.0);

      // Induced scrub drag when sliding laterally
      if (Math.abs(lateralSpeed) > 1.5 && forwardSpeed > 2) {
        driveAccel -= Math.abs(lateralSpeed) * handling.scrubDrag;
      }

      // Lateral tire grip capped by class mechanical + aerodynamic friction limit
      const baseGrip = (handbrake ? presetConfig.lateralGrip * 0.35 : presetConfig.lateralGrip) * tireGripMult;
      const activeGrip = baseGrip * surfaceGripMult;
      const rawLatAccel = -lateralSpeed * activeGrip;
      const clampedLatAccel = Math.max(-maxLatAccel, Math.min(maxLatAccel, rawLatAccel));
      const gravitySide = -24.0 * tmpRight.y;
      const lateralAccel = clampedLatAccel - gravitySide;

      const fx = (tmpRoadForward.x * driveAccel + tmpRight.x * lateralAccel) * mass * dt;
      const fy = (tmpRoadForward.y * driveAccel + tmpRight.y * lateralAccel) * mass * dt;
      const fz = (tmpRoadForward.z * driveAccel + tmpRight.z * lateralAccel) * mass * dt;

      rb.applyImpulse({ x: fx, y: fy, z: fz }, true);

      // Physics-bound speed-sensitive steering (prevents F1 from flicking sideways at 340+ km/h)
      const speedFactor = Math.min(1.0, Math.abs(forwardSpeed) / 4.0);
      const highSpeedDamp = 1.0 - Math.min(0.45, (speedKmh / 420) * 0.45);
      const reverseDir = forwardSpeed < -0.5 ? -1 : 1;
      const rawYaw = steerRef.current * presetConfig.steerRate * highSpeedDamp * speedFactor * reverseDir;
      const physMaxYaw = (maxLatAccel * handling.yawGripHeadroom) / Math.max(8.0, Math.abs(forwardSpeed));
      const maxAllowedYaw = physMaxYaw * (handbrake ? 1.55 : 1.0);
      const targetYawRate = Math.max(-maxAllowedYaw, Math.min(maxAllowedYaw, rawYaw));

      tmpRollError.crossVectors(tmpUp, tmpAvgNormal);
      tmpNextAngVel
        .set(0, 0, 0)
        .addScaledVector(tmpUp, targetYawRate)
        .addScaledVector(tmpRollError, 6.5);

      rb.setAngvel({ x: tmpNextAngVel.x, y: tmpNextAngVel.y, z: tmpNextAngVel.z }, true);
    } else {
      // Airborne gentle upright stabilization
      tmpUprightError.crossVectors(tmpUp, tmpWorldUp);
      rb.applyTorqueImpulse(
        {
          x: tmpUprightError.x * 2.5 * mass * dt,
          y: tmpUprightError.y * 2.5 * mass * dt,
          z: tmpUprightError.z * 2.5 * mass * dt,
        },
        true
      );
    }

    // Lap timing & unwrapped distance progress (counts main straight AND Pit-Box lane crossings!)
    if (!isHeldOnGrid && spline && spline.length >= 6) {
      const L = mainArcSampler.totalLen;
      let crossedStartByS = false;
      if (L > 20) {
        const prevS = prevTrackSRef.current;
        const currS = mainArcSampler.nearestS(t.x, t.z);
        let ds = currS - prevS;
        if (isClosedRef.current) {
          if (ds < -L * 0.5) ds += L;
          else if (ds > L * 0.5) ds -= L;
        }
        unwrappedDistRef.current += ds;
        prevTrackSRef.current = currS;

        if (currS >= L * 0.20 && currS <= L * 0.60) {
          passedCp1Ref.current = true;
        }
        if (passedCp1Ref.current && currS >= L * 0.55 && currS <= L * 0.92) {
          passedCp2Ref.current = true;
        }
        crossedStartByS = isClosedRef.current && prevS > L * 0.75 && currS < L * 0.25;
      }

      const startPt = spline[0];
      const midPt = spline[Math.floor(spline.length / 2)];
      const startHalfW = (startPt.width || 18) * 0.75;
      const dStart = Math.hypot(t.x - startPt.x, t.z - startPt.y);
      const dMid = Math.hypot(t.x - midPt.x, t.z - midPt.y);

      if (dMid < Math.max(18, (midPt.width || 18) * 1.1)) {
        passedMidRef.current = true;
      }
      const nearStart = dStart < Math.max(14, startHalfW);
      const crossedStart =
        isClosedRef.current && L > 50 ? crossedStartByS : nearStart && !wasAtStartRef.current;
      if (crossedStart && (passedCp2Ref.current || passedMidRef.current) && !finishedRef.current) {
        const now = performance.now();
        const elapsed = now - lapStartRef.current;
        if (elapsed > 3000) {
          lastLapRef.current = elapsed;
          if (bestLapRef.current === null || elapsed < bestLapRef.current) {
            bestLapRef.current = elapsed;
          }
          completedLapsRef.current += 1;
          passedMidRef.current = false;
          passedCp1Ref.current = false;
          passedCp2Ref.current = false;
          const lapLimit = totalLapsRef.current;
          if (lapLimit && completedLapsRef.current >= lapLimit) {
            finishedRef.current = true;
            finishTimeMsRef.current = Math.max(1000, now - raceGoTimestampRef.current);
            lapNumberRef.current = lapLimit;
          } else {
            lapNumberRef.current += 1;
            lapStartRef.current = now;
          }
          forceNetEmitRef.current = true;
        }
      }
      wasAtStartRef.current = nearStart;
    }

    // Pit-Stop 50m Yellow Box Detection & 3-second Repair Countdown
    let inPitBoxZone = false;
    for (let zi = 0; zi < pitStopZones.length && !inPitBoxZone; zi++) {
      const zPts = pitStopZones[zi].pts;
      for (let pi = 0; pi < zPts.length - 1; pi++) {
        const a = zPts[pi];
        const b = zPts[pi + 1];
        const dx = b.x - a.x;
        const dz = b.y - a.y;
        const l2 = dx * dx + dz * dz;
        const proj = l2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((t.x - a.x) * dx + (t.z - a.y) * dz) / l2));
        const cx = a.x + proj * dx;
        const cz = a.y + proj * dz;
        const cy = a.z + proj * (b.z - a.z);
        const hw = (a.width + proj * (b.width - a.width)) * 0.5;
        if (Math.hypot(t.x - cx, t.z - cz) <= hw + 1.5 && Math.abs(t.y - cy) < 3.5) {
          inPitBoxZone = true;
          break;
        }
      }
    }

    let pitStopStatus: PitStopStatus = 'none';
    if (nowMs < pitStopDoneUntilRef.current) {
      pitStopStatus = 'done';
    } else if (inPitBoxZone) {
      if (engineHealthRef.current >= 99.9 && tireHealthRef.current >= 99.9) {
        pitStopTimerRef.current = 0;
        pitStopStatus = 'full';
      } else if (speedKmh < 4.5) {
        pitStopTimerRef.current += dt;
        pitStopStatus = 'repairing';
        if (pitStopTimerRef.current >= 3.0) {
          engineHealthRef.current = 100;
          tireHealthRef.current = 100;
          pitStopTimerRef.current = 0;
          pitStopDoneUntilRef.current = nowMs + 2500;
          pitStopStatus = 'done';
        }
      } else {
        pitStopTimerRef.current = 0;
        pitStopStatus = 'slow_down';
      }
    } else {
      pitStopTimerRef.current = 0;
    }

    if (!isHeldOnGrid && tmpUp.y < 0.25 && speedKmh < 20) {
      flippedSecRef.current += dt;
    } else {
      flippedSecRef.current = 0;
    }
    const isFlippedNow = flippedSecRef.current >= 0.45;
    prevSpeedKmhRef.current = speedKmh;

    lastGroundedWheelsRef.current = groundedWheels;
    lastSumHitToiRef.current = sumHitToi;
    lastForwardSpeedRef.current = forwardSpeed;
    lastLateralSpeedRef.current = lateralSpeed;
    lastSpeedKmhRef.current = speedKmh;
    lastCurrentSurfaceRef.current = currentSurface;
    lastCurrentTierRef.current = currentTier;
    lastThrottleRef.current = throttle;
    lastBrakeRef.current = brake;
    lastHandbrakeRef.current = handbrake;
    lastInPitBoxZoneRef.current = inPitBoxZone;
    lastPitStopStatusRef.current = pitStopStatus;
    lastIsFlippedRef.current = isFlippedNow;
    lastIsHeldOnGridRef.current = isHeldOnGrid;
    physicsSteppedRef.current = true;
  });

  useFrame((state, delta) => {
    const rb = rbRef.current;
    if (!rb) return;

    const visDt = Math.min(delta, 0.05);
    const nowMs = performance.now();

    const groundedWheels = lastGroundedWheelsRef.current;
    const sumHitToi = lastSumHitToiRef.current;
    const forwardSpeed = lastForwardSpeedRef.current;
    const lateralSpeed = lastLateralSpeedRef.current;
    const speedKmh = lastSpeedKmhRef.current;
    const currentSurface = lastCurrentSurfaceRef.current;
    const currentTier = lastCurrentTierRef.current;
    const throttle = lastThrottleRef.current;
    const brake = lastBrakeRef.current;
    const handbrake = lastHandbrakeRef.current;
    const inPitBoxZone = lastInPitBoxZoneRef.current;
    const pitStopStatus = lastPitStopStatusRef.current;
    const isFlippedNow = lastIsFlippedRef.current;
    const isHeldOnGrid = lastIsHeldOnGridRef.current;
    const recoveryNoticeActive = nowMs < recoveryNoticeUntilRef.current;

    // Visual wheel spin + lock tire bottom flush with detected road surface
    wheelRollRef.current += forwardSpeed * visDt * 1.5;
    if (visualGroupRef.current) {
      const tireBottom = carClass === 'f1' ? -0.06 : -0.02;
      if (groundedWheels > 0) {
        const avgToi = sumHitToi / groundedWheels;
        const groundLocalY = WHEEL_RAY_ORIGIN_Y - avgToi;
        const targetVisY = groundLocalY - tireBottom + 0.005;
        visualGroupRef.current.position.y = THREE.MathUtils.lerp(visualGroupRef.current.position.y, targetVisY, 0.65);
      } else {
        visualGroupRef.current.position.y = THREE.MathUtils.lerp(visualGroupRef.current.position.y, 0.05, 0.15);
      }
    }

    // Advance GPU skid-mark shader clock & emit marks when physics stepped
    skidClockRef.current += visDt;
    const skidNow = skidClockRef.current;
    skidResources.mat.uniforms.uTime.value = skidNow;

    if (physicsSteppedRef.current) {
      physicsSteppedRef.current = false;
      let skidDirty = false;
      const skidHalfW = carClass === 'f1' ? 0.24 : 0.165;
      const absLat = Math.abs(lateralSpeed);
      const isBaldSpin = !isHeldOnGrid && tireHealthRef.current < 38 && throttle > 0.65 && speedKmh > 20;
      const isHeavyBrake = !isHeldOnGrid && brake > 0.65 && forwardSpeed > 12;

      for (let i = 0; i < WHEEL_MOUNTS.length; i++) {
        const wh = wheelHitData[i];
        const prev = prevWheelPosRef[i];
        if (isHeldOnGrid || !wh.grounded || speedKmh <= 10) {
          prev.valid = false;
          continue;
        }

        const isRear = i >= 2;
        let rawAlpha = 0;
        if (isRear) {
          if (absLat > 4.0) rawAlpha = Math.max(rawAlpha, Math.min(0.68, (absLat - 4.0) * 0.10 + 0.18));
          if (handbrake && speedKmh > 12) rawAlpha = Math.max(rawAlpha, 0.62);
          if (isHeavyBrake) rawAlpha = Math.max(rawAlpha, 0.45 * brake);
          if (isBaldSpin) rawAlpha = Math.max(rawAlpha, 0.36);
        } else {
          if (isHeavyBrake && speedKmh > 55) rawAlpha = Math.max(rawAlpha, 0.38 * brake);
          if (absLat > 7.5) rawAlpha = Math.max(rawAlpha, Math.min(0.50, (absLat - 7.5) * 0.08 + 0.15));
        }

        if (currentTier >= 4) rawAlpha = Math.min(rawAlpha, 0.42);
        if (rawAlpha <= 0.05) {
          prev.valid = false;
          continue;
        }

        const hx = wh.hx;
        const hy = wh.hy + 0.05;
        const hz = wh.hz;
        if (!prev.valid) {
          prev.valid = true;
          prev.x = hx;
          prev.y = hy;
          prev.z = hz;
          continue;
        }

        const dx = hx - prev.x;
        const dz = hz - prev.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 5.5) {
          prev.x = hx;
          prev.y = hy;
          prev.z = hz;
        } else if (dist >= 0.75) {
          const px = (-dz / dist) * skidHalfW;
          const pz = (dx / dist) * skidHalfW;
          const slot = skidHeadRef.current;
          const vBase = slot * 4;
          const pBase = vBase * 3;
          const posArr = skidResources.positions;

          posArr[pBase] = prev.x - px;
          posArr[pBase + 1] = prev.y;
          posArr[pBase + 2] = prev.z - pz;

          posArr[pBase + 3] = prev.x + px;
          posArr[pBase + 4] = prev.y;
          posArr[pBase + 5] = prev.z + pz;

          posArr[pBase + 6] = hx - px;
          posArr[pBase + 7] = hy;
          posArr[pBase + 8] = hz - pz;

          posArr[pBase + 9] = hx + px;
          posArr[pBase + 10] = hy;
          posArr[pBase + 11] = hz + pz;

          skidResources.birthTimes[vBase] = skidNow;
          skidResources.birthTimes[vBase + 1] = skidNow;
          skidResources.birthTimes[vBase + 2] = skidNow;
          skidResources.birthTimes[vBase + 3] = skidNow;

          skidResources.alphas[vBase] = rawAlpha;
          skidResources.alphas[vBase + 1] = rawAlpha;
          skidResources.alphas[vBase + 2] = rawAlpha;
          skidResources.alphas[vBase + 3] = rawAlpha;

          skidHeadRef.current = (slot + 1) % SKID_MAX_QUADS;
          prev.x = hx;
          prev.y = hy;
          prev.z = hz;
          skidDirty = true;
        }
      }

      if (skidDirty) {
        skidResources.posAttr.needsUpdate = true;
        skidResources.birthAttr.needsUpdate = true;
        skidResources.alphaAttr.needsUpdate = true;
      }
    }

    // Silky-smooth interpolated Camera tracking (reads Rapier-interpolated transform!)
    if (cameraMode === 'chase' || cameraMode === 'cockpit') {
      const bodyObj = visualGroupRef.current?.parent;
      if (bodyObj) {
        bodyObj.updateWorldMatrix(true, false);
        bodyObj.getWorldPosition(tmpCamCarPos);
        bodyObj.getWorldQuaternion(tmpCamCarQuat);
      } else {
        const t = rb.translation();
        const r = rb.rotation();
        tmpCamCarPos.set(t.x, t.y, t.z);
        tmpCamCarQuat.set(r.x, r.y, r.z, r.w);
      }
      tmpCamForward.set(0, 0, 1).applyQuaternion(tmpCamCarQuat).normalize();

      if (cameraMode === 'chase') {
        tmpCamOffset.set(0, 5.2, -13.0).applyQuaternion(tmpCamCarQuat);
        tmpDesiredCam.copy(tmpCamCarPos).add(tmpCamOffset);
        if (camPosRef.current.lengthSq() === 0) camPosRef.current.copy(tmpDesiredCam);
        const camAlpha = 1 - Math.exp(-9 * visDt);
        camPosRef.current.lerp(tmpDesiredCam, camAlpha);

        tmpLookTarget.copy(tmpCamCarPos).addScaledVector(tmpCamForward, 8).add(tmpLookUpOffset);
        if (camLookRef.current.lengthSq() === 0) camLookRef.current.copy(tmpLookTarget);
        const lookAlpha = 1 - Math.exp(-12 * visDt);
        camLookRef.current.lerp(tmpLookTarget, lookAlpha);

        state.camera.position.copy(camPosRef.current);
        state.camera.lookAt(camLookRef.current);
      } else {
        tmpCamOffset.set(0, 1.55, 0.35).applyQuaternion(tmpCamCarQuat);
        tmpDesiredCam.copy(tmpCamCarPos).add(tmpCamOffset);
        tmpCamOffset.set(0, 1.35, 18).applyQuaternion(tmpCamCarQuat);
        tmpLookTarget.copy(tmpCamCarPos).add(tmpCamOffset);
        state.camera.position.copy(tmpDesiredCam);
        state.camera.lookAt(tmpLookTarget);
      }
    }

    const isBrakingNow = brakeLightRef.current > 0.05;
    const lightsOrBrakeChanged =
      headlightsOnRef.current !== lastPublishedHeadlightsRef.current ||
      isBrakingNow !== lastPublishedBrakingRef.current;

    // 20 Hz Network State Emission for Multiplayer & Solo Standings/Minimap
    netEmitAccRef.current += visDt;
    if (onLocalCarSampleRef.current && (forceNetEmitRef.current || lightsOrBrakeChanged || netEmitAccRef.current >= 0.05)) {
      forceNetEmitRef.current = false;
      netEmitAccRef.current = 0;
      const t = rb.translation();
      const r = rb.rotation();
      const lv = rb.linvel();
      const visualOffsetY = visualGroupRef.current ? visualGroupRef.current.position.y - 0.02 : 0;
      onLocalCarSampleRef.current({
        x: t.x,
        y: t.y + visualOffsetY,
        z: t.z,
        qx: r.x,
        qy: r.y,
        qz: r.z,
        qw: r.w,
        vx: lv.x,
        vy: lv.y,
        vz: lv.z,
        steer: visualSteerRef.current,
        speedKmh: isHeldOnGrid ? 0 : Math.round(speedKmh),
        wheelRoll: wheelRollRef.current,
        braking: isBrakingNow,
        headlights: headlightsOnRef.current,
        lapNumber: lapNumberRef.current,
        completedLaps: completedLapsRef.current,
        trackS: prevTrackSRef.current,
        raceProgress: unwrappedDistRef.current,
        surface: currentSurface,
        engineHealth: engineHealthRef.current,
        tireHealth: tireHealthRef.current,
        inPit: inPitBoxZone,
        bestLapMs: bestLapRef.current,
        lastLapMs: lastLapRef.current,
        finished: finishedRef.current,
        finishTimeMs: finishTimeMsRef.current,
      });
    }

    // Telemetry ~15Hz (or immediately when start lights, headlights, or brake state change)
    telemetryAccRef.current += visDt;
    const phaseChanged =
      raceStartPhaseRef.current !== lastPublishedPhaseRef.current ||
      startLightsLitRef.current !== lastPublishedLightsRef.current ||
      lightsOrBrakeChanged;

    if (phaseChanged || telemetryAccRef.current >= 0.066) {
      telemetryAccRef.current = 0;
      const isIdleOrbit =
        cameraMode === 'orbit' &&
        speedKmh < 0.5 &&
        throttle === 0 &&
        brake === 0 &&
        Math.abs(steerRef.current) < 0.01 &&
        !inPitBoxZone &&
        pitStopStatus === 'none' &&
        !recoveryNoticeActive &&
        !isFlippedNow;
      if (phaseChanged || !isIdleOrbit || !wasIdleOrbitRef.current) {
        wasIdleOrbitRef.current = isIdleOrbit;
        lastPublishedPhaseRef.current = raceStartPhaseRef.current;
        lastPublishedLightsRef.current = startLightsLitRef.current;
        lastPublishedHeadlightsRef.current = headlightsOnRef.current;
        lastPublishedBrakingRef.current = isBrakingNow;
        const payload: TelemetryData = {
          speedKmh: isHeldOnGrid ? 0 : Math.round(speedKmh),
          throttle,
          brake,
          steer: steerRef.current,
          headlightsOn: headlightsOnRef.current,
          isBraking: isBrakingNow,
          surface: currentSurface,
          surfacePenaltyPct: currentTier * 10,
          engineHealth: engineHealthRef.current,
          tireHealth: tireHealthRef.current,
          inPitLane: inPitBoxZone,
          inPitBoxZone,
          pitStopProgress: Math.min(1, pitStopTimerRef.current / 3.0),
          pitStopRemainingSec: Math.max(0, 3.0 - pitStopTimerRef.current),
          pitStopStatus,
          raceStartPhase: raceStartPhaseRef.current,
          startLightsLit: startLightsLitRef.current,
          recoveryNotice: recoveryNoticeActive,
          isFlipped: isFlippedNow,
          lapNumber: lapNumberRef.current,
          lapTimeMs: isHeldOnGrid ? 0 : Math.max(0, nowMs - lapStartRef.current),
          bestLapMs: bestLapRef.current,
          lastLapMs: lastLapRef.current,
        };
        publishTelemetry(payload);
        if (onTelemetry) onTelemetry(payload);
      }
    }
  });

  const initialQuat = useMemo(() => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawnPose.yaw);
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z] as [number, number, number];
  }, [spawnPose.yaw]);

  return (
    <>
      <RigidBody
        ref={rbRef}
        position={spawnPose.pos}
        rotation={initialQuat}
        colliders={false}
        mass={1.0}
        linearDamping={0.25}
        angularDamping={1.0}
        ccd={true}
        userData={CAR_RIGIDBODY_USER_DATA}
        onCollisionEnter={handleCollisionEnter}
      >
        {/* Full-body chassis collider (raised and frictionless so it never snags on trimesh seams) */}
        <CuboidCollider
          args={CHASSIS_COLLIDER_ARGS}
          position={CHASSIS_COLLIDER_POS}
          friction={0.0}
          restitution={0.05}
        />
        <group ref={visualGroupRef} position={VISUAL_GROUP_POS}>
          <Car3D
            position={ZERO_VEC3}
            rotation={ZERO_VEC3}
            steerAngleRef={visualSteerRef}
            wheelRotationRef={wheelRollRef}
            brakeIntensityRef={brakeLightRef}
            headlightsOn={headlightsOn}
            enableRealLights={true}
            environmentTheme={environmentTheme}
            color={presetConfig.primaryColor}
            secondaryColor={presetConfig.secondaryColor}
            carClass={carClass}
          />
        </group>
      </RigidBody>
      <mesh geometry={skidResources.geo} material={skidResources.mat} frustumCulled={false} renderOrder={2} />
    </>
  );
});
