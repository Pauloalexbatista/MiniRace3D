import type { CarClass } from './components/Car3D';
import type { SurfaceType } from './physics';

export const SOLFEGGIO_HZ = {
  F174: 174,
  F285: 285,
  F396: 396,
  F417: 417,
  F528: 528,
  F639: 639,
  F741: 741,
  F852: 852,
  F963: 963,
} as const;

export interface CarAudioProfile {
  numGears: number;
  idleRpm: number;
  redlineRpm: number;
  baseHzAtIdle: number;
  baseHzAtRedline: number;
  harmonics: [number, number, number];
  harmonicGains: [number, number, number];
  formantMinHz: number;
  formantMaxHz: number;
  formantQ: number;
  gearWhineGain: number;
  gearWhineBaseHz: number;
  turboGain: number;
  bovEnabled: boolean;
  exhaustPopStyle: 'crisp' | 'bark' | 'antilag' | 'snap';
  driveAmount: number;
  engineGain: number;
}

export const CAR_AUDIO_PROFILES: Record<CarClass, CarAudioProfile> = {
  f1: {
    numGears: 8,
    idleRpm: 4200,
    redlineRpm: 15000,
    baseHzAtIdle: 132, // 528 / 4
    baseHzAtRedline: 319.5, // 639 / 2
    harmonics: [1.0, 1.5, 2.0],
    harmonicGains: [0.46, 0.30, 0.20],
    formantMinHz: SOLFEGGIO_HZ.F396,
    formantMaxHz: SOLFEGGIO_HZ.F741,
    formantQ: 1.1,
    gearWhineGain: 0.05,
    gearWhineBaseHz: SOLFEGGIO_HZ.F528,
    turboGain: 0.02,
    bovEnabled: false,
    exhaustPopStyle: 'crisp',
    driveAmount: 0.16,
    engineGain: 0.22,
  },
  fe: {
    numGears: 1,
    idleRpm: 1000,
    redlineRpm: 18000,
    baseHzAtIdle: SOLFEGGIO_HZ.F174,
    baseHzAtRedline: SOLFEGGIO_HZ.F396,
    harmonics: [1.0, 1.5, 2.0],
    harmonicGains: [0.44, 0.32, 0.22],
    formantMinHz: SOLFEGGIO_HZ.F396,
    formantMaxHz: SOLFEGGIO_HZ.F639,
    formantQ: 0.9,
    gearWhineGain: 0.075,
    gearWhineBaseHz: SOLFEGGIO_HZ.F396,
    turboGain: 0.045,
    bovEnabled: false,
    exhaustPopStyle: 'crisp',
    driveAmount: 0.04,
    engineGain: 0.21,
  },
  gt: {
    numGears: 6,
    idleRpm: 1300,
    redlineRpm: 8600,
    baseHzAtIdle: 87, // 174 / 2
    baseHzAtRedline: 264, // 528 / 2
    harmonics: [0.5, 1.0, 1.5],
    harmonicGains: [0.44, 0.38, 0.22],
    formantMinHz: SOLFEGGIO_HZ.F285,
    formantMaxHz: SOLFEGGIO_HZ.F528,
    formantQ: 1.0,
    gearWhineGain: 0.03,
    gearWhineBaseHz: SOLFEGGIO_HZ.F396,
    turboGain: 0.02,
    bovEnabled: false,
    exhaustPopStyle: 'bark',
    driveAmount: 0.20,
    engineGain: 0.24,
  },
  rally: {
    numGears: 6,
    idleRpm: 1150,
    redlineRpm: 7800,
    baseHzAtIdle: 99, // 396 / 4
    baseHzAtRedline: 208.5, // 417 / 2
    harmonics: [0.5, 1.0, 1.5],
    harmonicGains: [0.44, 0.36, 0.24],
    formantMinHz: SOLFEGGIO_HZ.F285,
    formantMaxHz: SOLFEGGIO_HZ.F639,
    formantQ: 1.0,
    gearWhineGain: 0.04,
    gearWhineBaseHz: SOLFEGGIO_HZ.F417,
    turboGain: 0.05,
    bovEnabled: true,
    exhaustPopStyle: 'antilag',
    driveAmount: 0.22,
    engineGain: 0.24,
  },
  drift: {
    numGears: 6,
    idleRpm: 1100,
    redlineRpm: 8200,
    baseHzAtIdle: 104.25, // 417 / 4
    baseHzAtRedline: SOLFEGGIO_HZ.F285,
    harmonics: [1.0, 1.5, 2.0],
    harmonicGains: [0.45, 0.30, 0.20],
    formantMinHz: SOLFEGGIO_HZ.F396,
    formantMaxHz: SOLFEGGIO_HZ.F639,
    formantQ: 1.05,
    gearWhineGain: 0.03,
    gearWhineBaseHz: SOLFEGGIO_HZ.F417,
    turboGain: 0.06,
    bovEnabled: true,
    exhaustPopStyle: 'snap',
    driveAmount: 0.20,
    engineGain: 0.23,
  },
};

export interface EngineAcousticInput {
  carClass: CarClass;
  speedKmh: number;
  forwardSpeed: number;
  maxSpeedKmh: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  isHeldOnGrid: boolean;
  engineHealth: number;
  dt: number;
}

export interface EngineAcousticMemory {
  gear: number;
  rpm: number;
  rpmNorm: number;
  prevThrottle: number;
  boostLevel: number;
  limiterPhase: number;
  shiftCooldownSec: number;
}

export interface EngineAcousticState {
  gear: number;
  rpm: number;
  rpmNorm: number;
  fundamentalHz: number;
  shiftEvent: 'up' | 'down' | null;
  boostLevel: number;
  triggerBov: boolean;
  triggerLiftPop: boolean;
  memory: EngineAcousticMemory;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const clampRange = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;

function gearUpperSpeedFrac(gear: number, numGears: number): number {
  if (gear <= 0) return 0;
  if (gear >= numGears) return 1.05;
  return Math.pow(gear / numGears, 1.08);
}

function gearLowerSpeedFrac(gear: number, numGears: number): number {
  if (gear <= 1) return 0;
  return gearUpperSpeedFrac(gear - 1, numGears) * 0.72;
}

export function createEngineMemory(carClass: CarClass = 'f1'): EngineAcousticMemory {
  const prof = CAR_AUDIO_PROFILES[carClass] ?? CAR_AUDIO_PROFILES.f1;
  return {
    gear: 0,
    rpm: prof.idleRpm,
    rpmNorm: 0,
    prevThrottle: 0,
    boostLevel: 0,
    limiterPhase: 0,
    shiftCooldownSec: 0,
  };
}

/**
 * Pure acoustic transmission, RPM, rev-limiter, boost & lift-off state machine.
 */
export function computeEngineAcoustics(
  input: EngineAcousticInput,
  prevMem?: EngineAcousticMemory
): EngineAcousticState {
  const prof = CAR_AUDIO_PROFILES[input.carClass] ?? CAR_AUDIO_PROFILES.f1;
  const mem = prevMem ?? createEngineMemory(input.carClass);
  const isElectric = input.carClass === 'fe';

  const dt = clampRange(input.dt, 0.001, 0.08);
  const maxSpd = Math.max(120, Number.isFinite(input.maxSpeedKmh) ? input.maxSpeedKmh : 260);
  const speedKmh = clampRange(input.speedKmh, 0, maxSpd * 1.35);
  const forwardSpeed = Number.isFinite(input.forwardSpeed) ? input.forwardSpeed : 0;
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const engineHealthNorm = clamp01((Number.isFinite(input.engineHealth) ? input.engineHealth : 100) / 100);

  let nextGear = mem.gear;
  let shiftEvent: 'up' | 'down' | null = null;
  let shiftCooldown = Math.max(0, mem.shiftCooldownSec - dt);

  if (input.isHeldOnGrid) {
    nextGear = 0;
  } else if (forwardSpeed < -0.6 && speedKmh > 1.2) {
    nextGear = -1;
  } else if (speedKmh < 4 && throttle < 0.08 && mem.gear <= 0) {
    nextGear = 0;
  } else {
    const speedFrac = clampRange(speedKmh / maxSpd, 0, 1.05);
    if (mem.gear <= 0) {
      let chosen = 1;
      for (let g = 1; g < prof.numGears; g++) {
        if (speedFrac >= gearUpperSpeedFrac(g, prof.numGears)) chosen = g + 1;
      }
      nextGear = chosen;
    } else if (!isElectric && shiftCooldown <= 0) {
      const upThresh = gearUpperSpeedFrac(mem.gear, prof.numGears) * 1.015;
      const downThresh = mem.gear > 1 ? gearUpperSpeedFrac(mem.gear - 1, prof.numGears) * 0.90 : -1;

      if (mem.gear < prof.numGears && speedFrac > upThresh) {
        let targetG = mem.gear + 1;
        while (targetG < prof.numGears && speedFrac > gearUpperSpeedFrac(targetG, prof.numGears) * 1.015) {
          targetG++;
        }
        nextGear = targetG;
        shiftEvent = 'up';
        shiftCooldown = 0.14;
      } else if (mem.gear > 1 && speedFrac < downThresh) {
        let targetG = mem.gear - 1;
        while (targetG > 1 && speedFrac < gearUpperSpeedFrac(targetG - 1, prof.numGears) * 0.90) {
          targetG--;
        }
        nextGear = targetG;
        shiftEvent = 'down';
        shiftCooldown = 0.14;
      }
    }
  }

  let targetRpmNorm = 0.05;
  if (nextGear === 0) {
    // Grid / Neutral free revving (FE stays quiet on grid)
    targetRpmNorm = isElectric
      ? throttle > 0.05
        ? 0.08 + throttle * 0.22
        : 0.03
      : throttle > 0.02
      ? 0.14 + Math.pow(throttle, 0.85) * 0.86
      : 0.05;
  } else if (nextGear === -1) {
    targetRpmNorm = clamp01(0.14 + (speedKmh / 65) * 0.68 + throttle * 0.12);
  } else {
    const lo = gearLowerSpeedFrac(nextGear, prof.numGears) * maxSpd;
    const hi = Math.max(lo + 12, gearUpperSpeedFrac(nextGear, prof.numGears) * maxSpd);
    const inGearFrac = clamp01((speedKmh - lo) / (hi - lo));
    const launchSlip = !isElectric && nextGear === 1 && speedKmh < 35 ? throttle * (1 - speedKmh / 35) * 0.34 : 0;
    const wheelspinBoost = !isElectric && input.handbrake && speedKmh > 12 ? throttle * 0.22 : 0;
    const minDrivingNorm = isElectric ? 0.04 : nextGear === 1 ? 0.12 : 0.20;
    targetRpmNorm = clamp01(
      minDrivingNorm + inGearFrac * (1 - minDrivingNorm) + throttle * 0.05 + launchSlip + wheelspinBoost
    );
  }

  // Smooth engine inertia (faster spin-up than coast-down, snap on gear shift)
  const rpmRate =
    shiftEvent !== null
      ? 24
      : nextGear === 0
      ? throttle > mem.rpmNorm
        ? 9.5
        : 5.5
      : targetRpmNorm > mem.rpmNorm
      ? 14
      : 9.5;
  let rpmNorm = mem.rpmNorm + (targetRpmNorm - mem.rpmNorm) * Math.min(1, dt * rpmRate);

  // Authentic ~16 Hz ignition cut bounce at redline limiter (combustion classes only)
  let nextLimiterPhase = mem.limiterPhase;
  if (!isElectric && rpmNorm > 0.96 && throttle > 0.7) {
    nextLimiterPhase = (mem.limiterPhase + dt * 16.0) % 1;
    const cutWave = nextLimiterPhase < 0.45 ? 0.0 : -0.055;
    rpmNorm = clamp01(rpmNorm + cutWave);
  } else {
    nextLimiterPhase = 0;
  }

  // Gentle damaged-engine flutter below 40% health (combustion only)
  if (!isElectric && engineHealthNorm < 0.4 && throttle > 0.3) {
    const damageFlutter = Math.sin((mem.limiterPhase + dt * 23) * Math.PI * 2) * (0.4 - engineHealthNorm) * 0.05;
    rpmNorm = clamp01(rpmNorm + damageFlutter);
  }

  const rpm = prof.idleRpm + (prof.redlineRpm - prof.idleRpm) * rpmNorm;
  const fundamentalHz = clampRange(
    prof.baseHzAtIdle + (prof.baseHzAtRedline - prof.baseHzAtIdle) * Math.pow(rpmNorm, 0.96),
    38,
    528
  );

  // Turbo boost build & Blow-off / Lift-off exhaust pops
  const hasBoostSource = !isElectric && (prof.bovEnabled || prof.turboGain > 0.08);
  const targetBoost =
    hasBoostSource && nextGear !== 0 && throttle > 0.45 && rpmNorm > 0.35
      ? clamp01(((rpmNorm - 0.30) / 0.65) * throttle)
      : hasBoostSource && input.isHeldOnGrid && throttle > 0.6 && rpmNorm > 0.55
      ? clamp01((rpmNorm - 0.5) * 0.9)
      : 0;
  const boostRate = targetBoost > mem.boostLevel ? 2.4 : 3.6;
  const boostLevel = clamp01(mem.boostLevel + (targetBoost - mem.boostLevel) * Math.min(1, dt * boostRate));

  const sharpLift = mem.prevThrottle > 0.45 && throttle < 0.25;
  const triggerBov = Boolean(!isElectric && prof.bovEnabled && mem.boostLevel > 0.45 && sharpLift);
  const triggerLiftPop = Boolean(
    !isElectric &&
      ((shiftEvent === 'down' && mem.rpmNorm > 0.42) ||
        ((prof.exhaustPopStyle === 'antilag' || prof.exhaustPopStyle === 'snap') &&
          mem.prevThrottle > 0.55 &&
          throttle < 0.18 &&
          mem.rpmNorm > 0.50) ||
        (prof.exhaustPopStyle === 'bark' &&
          brake > 0.55 &&
          mem.prevThrottle > 0.4 &&
          throttle < 0.15 &&
          mem.rpmNorm > 0.6))
  );

  const memory: EngineAcousticMemory = {
    gear: nextGear,
    rpm,
    rpmNorm,
    prevThrottle: throttle,
    boostLevel,
    limiterPhase: nextLimiterPhase,
    shiftCooldownSec: shiftCooldown,
  };

  return {
    gear: nextGear,
    rpm,
    rpmNorm,
    fundamentalHz,
    shiftEvent,
    boostLevel,
    triggerBov,
    triggerLiftPop,
    memory,
  };
}

export interface AudioMixInput {
  carClass: CarClass;
  speedKmh: number;
  lateralSpeed: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  grounded: boolean;
  surface: SurfaceType;
  tireHealth: number;
  engineHealth: number;
  tunnelBlend: number;
  cameraMode: 'chase' | 'cockpit' | 'orbit';
  rpmNorm: number;
  fundamentalHz: number;
  boostLevel: number;
  isRegenerating?: boolean;
  attackModeActive?: boolean;
  cruiseRelax?: number;
}

export interface AudioMixLevels {
  engineGain: number;
  engineFilterHz: number;
  formantHz: number;
  turboGain: number;
  turboHz: number;
  gearWhineGain: number;
  gearWhineHz: number;
  tireSquealGain: number;
  tireSquealHz: number;
  windGain: number;
  windHz: number;
  curbGain: number;
  curbModHz: number;
  offroadGain: number;
  offroadHz: number;
  tunnelWetGain: number;
}

/**
 * Pure acoustic level & filter calculator tuned around Solfeggio harmonics with anti-fatigue cruise ducking.
 */
export function computeAudioMixLevels(input: AudioMixInput): AudioMixLevels {
  const prof = CAR_AUDIO_PROFILES[input.carClass] ?? CAR_AUDIO_PROFILES.f1;
  const speedKmh = clampRange(input.speedKmh, 0, 520);
  const absLat = clampRange(Math.abs(input.lateralSpeed), 0, 80);
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const tireHealth = clampRange(input.tireHealth, 0, 100);
  const engineHealth = clampRange(input.engineHealth, 0, 100);
  const tunnelBlend = clamp01(input.tunnelBlend);
  const rpmNorm = clamp01(input.rpmNorm);
  const boostLevel = clamp01(input.boostLevel);
  const cruiseRelax = clamp01(input.cruiseRelax ?? 0);

  const relaxGain = 1 - 0.34 * cruiseRelax;
  const relaxFilter = 1 - 0.35 * cruiseRelax;
  const relaxWhine = 1 - 0.42 * cruiseRelax;

  const isCockpit = input.cameraMode === 'cockpit';
  const cockpitWarmth = isCockpit ? 0.86 : 1.0;
  const cockpitBodyGain = isCockpit ? 0.88 : 1.0;

  const isPaved =
    input.surface === 'TRACK' ||
    input.surface === 'CURB' ||
    input.surface === 'CURB_WIDE' ||
    input.surface === 'CURB_APEX';
  const isCurb =
    input.surface === 'CURB' ||
    input.surface === 'CURB_WIDE' ||
    input.surface === 'CURB_APEX';
  const isOffroad =
    input.surface === 'GRASS' ||
    input.surface === 'SAND' ||
    input.surface === 'GRAVEL';

  const loadFactor =
    input.carClass === 'fe'
      ? 0.36 + 0.42 * throttle + 0.24 * rpmNorm
      : 0.48 + 0.44 * throttle + 0.16 * rpmNorm;
  const healthFactor = engineHealth < 45 ? 0.90 : 1.0;
  const engineGain = clampRange(
    prof.engineGain * loadFactor * healthFactor * cockpitBodyGain * relaxGain,
    0,
    0.34
  );

  const engineFilterHz = clampRange(
    (220 + 1350 * Math.pow(rpmNorm, 1.05) + throttle * 320) * cockpitWarmth * relaxFilter,
    SOLFEGGIO_HZ.F174,
    1900
  );
  const formantHz = clampRange(
    (prof.formantMinHz + (prof.formantMaxHz - prof.formantMinHz) * rpmNorm) * cockpitWarmth,
    SOLFEGGIO_HZ.F174,
    SOLFEGGIO_HZ.F963
  );

  let turboGain = clampRange(
    prof.turboGain * boostLevel * (0.35 + 0.65 * rpmNorm) * (isCockpit ? 0.82 : 1.0) * relaxWhine,
    0,
    0.12
  );
  let turboHz = clampRange(
    SOLFEGGIO_HZ.F528 + boostLevel * (SOLFEGGIO_HZ.F963 - SOLFEGGIO_HZ.F528) * 0.75 + rpmNorm * 108,
    SOLFEGGIO_HZ.F528,
    SOLFEGGIO_HZ.F963
  );

  const speedNorm300 = clamp01(speedKmh / 300);
  let gearWhineGain = clampRange(
    prof.gearWhineGain * speedNorm300 * (0.35 + 0.65 * throttle) * (isCockpit ? 1.08 : 0.85) * relaxWhine,
    0,
    0.10
  );
  let gearWhineHz = clampRange(
    prof.gearWhineBaseHz + (speedKmh / 350) * (SOLFEGGIO_HZ.F963 - prof.gearWhineBaseHz) * 0.78 + rpmNorm * 85,
    SOLFEGGIO_HZ.F396,
    SOLFEGGIO_HZ.F963
  );

  if (input.carClass === 'fe') {
    if (input.attackModeActive) {
      turboHz = SOLFEGGIO_HZ.F963;
      turboGain = Math.max(turboGain, 0.055);
    }
    if (input.isRegenerating) {
      gearWhineHz = SOLFEGGIO_HZ.F741;
      gearWhineGain = Math.max(gearWhineGain, 0.065);
    }
  }

  // Softer tire squeal centered around warm 639–852 Hz range
  let tireSquealGain = 0;
  let tireSquealHz: number = SOLFEGGIO_HZ.F639;
  if (input.grounded && isPaved && speedKmh > 6) {
    const latSlip = absLat > 3.5 ? clamp01((absLat - 3.5) / 11.5) : 0;
    const handbrakeSlip = input.handbrake && speedKmh > 12 ? clamp01(0.45 + speedKmh / 140) : 0;
    const brakeLockSlip = brake > 0.6 && speedKmh > 35 ? clamp01((brake - 0.55) * 1.4 * Math.min(1, speedKmh / 110)) : 0;
    const baldSpinSlip = tireHealth < 40 && throttle > 0.65 && speedKmh > 15 ? 0.42 : 0;

    const slipCombined = clamp01(Math.max(latSlip, handbrakeSlip, brakeLockSlip, baldSpinSlip));
    if (slipCombined > 0.02) {
      tireSquealGain = clampRange(slipCombined * 0.10 * (isCockpit ? 0.72 : 1.0), 0, 0.11);
      tireSquealHz = clampRange(
        SOLFEGGIO_HZ.F639 + slipCombined * 170 + Math.min(43, speedKmh * 0.15),
        SOLFEGGIO_HZ.F639,
        SOLFEGGIO_HZ.F852
      );
    }
  }

  // Aerodynamic wind noise (> 85 km/h), relaxed during steady cruise
  let windGain = 0;
  let windHz: number = SOLFEGGIO_HZ.F396;
  if (speedKmh > 85) {
    const wNorm = clamp01((speedKmh - 85) / 280);
    const tunnelWindDuck = 1 - tunnelBlend * 0.35;
    windGain = clampRange(
      Math.pow(wNorm, 1.35) * 0.15 * tunnelWindDuck * (isCockpit ? 0.75 : 1.0) * relaxWhine,
      0,
      0.18
    );
    windHz = clampRange(285 + wNorm * 456 * cockpitWarmth, SOLFEGGIO_HZ.F285, SOLFEGGIO_HZ.F852);
  }

  // Curb rumble stripes
  let curbGain = 0;
  let curbModHz = 28;
  if (input.grounded && isCurb && speedKmh > 6) {
    const curbSeverity = input.surface === 'CURB_APEX' ? 1.0 : input.surface === 'CURB_WIDE' ? 0.85 : 0.68;
    const spdScale = clamp01((speedKmh - 6) / 140);
    curbGain = clampRange(0.18 * curbSeverity * (0.28 + 0.72 * spdScale), 0, 0.22);
    curbModHz = clampRange(18 + speedKmh * 0.32, 16, 110);
  }

  // Off-road gravel/sand/grass roar
  let offroadGain = 0;
  let offroadHz: number = SOLFEGGIO_HZ.F528;
  if (input.grounded && isOffroad && speedKmh > 4) {
    const spdScale = clamp01((speedKmh - 4) / 130);
    const surfGain = input.surface === 'GRAVEL' ? 0.20 : input.surface === 'SAND' ? 0.16 : 0.12;
    offroadGain = clampRange(surfGain * (0.2 + 0.8 * spdScale), 0, 0.22);
    offroadHz = clampRange(
      (input.surface === 'GRAVEL'
        ? SOLFEGGIO_HZ.F639
        : input.surface === 'SAND'
        ? SOLFEGGIO_HZ.F528
        : SOLFEGGIO_HZ.F396) +
        speedKmh * 1.4,
      SOLFEGGIO_HZ.F285,
      SOLFEGGIO_HZ.F963
    );
  }

  const tunnelWetGain = clampRange(tunnelBlend * 0.38, 0, 0.42);

  return {
    engineGain,
    engineFilterHz,
    formantHz,
    turboGain,
    turboHz,
    gearWhineGain,
    gearWhineHz,
    tireSquealGain,
    tireSquealHz,
    windGain,
    windHz,
    curbGain,
    curbModHz,
    offroadGain,
    offroadHz,
    tunnelWetGain,
  };
}

// ============================================================
// Persisted User Audio Preferences Store
// ============================================================

const AUDIO_STORAGE_KEY = 'minirace3d_audio_v2';
const DEFAULT_AUDIO_VOLUME = 0.38;

export interface AudioSettings {
  muted: boolean;
  volume: number; // 0..1
}

function loadAudioSettings(): AudioSettings {
  const defaults: AudioSettings = { muted: false, volume: DEFAULT_AUDIO_VOLUME };
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: Boolean(parsed.muted),
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? clamp01(parsed.volume)
          : DEFAULT_AUDIO_VOLUME,
    };
  } catch {
    return defaults;
  }
}

function persistAudioSettings(next: AudioSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage failures in private browsing / SSR
  }
}

let currentAudioSettings: AudioSettings = loadAudioSettings();
const audioSettingsListeners = new Set<() => void>();
const onSettingsChangedHooks: Array<(s: AudioSettings) => void> = [];

function notifyAudioSettings(): void {
  onSettingsChangedHooks.forEach((fn) => fn(currentAudioSettings));
  audioSettingsListeners.forEach((l) => l());
}

export function getAudioSettings(): AudioSettings {
  return currentAudioSettings;
}

export function subscribeAudioSettings(listener: () => void): () => void {
  audioSettingsListeners.add(listener);
  return () => {
    audioSettingsListeners.delete(listener);
  };
}

export function setAudioMuted(muted: boolean): void {
  const nextMuted = Boolean(muted);
  if (currentAudioSettings.muted === nextMuted) return;
  currentAudioSettings = { ...currentAudioSettings, muted: nextMuted };
  persistAudioSettings(currentAudioSettings);
  notifyAudioSettings();
}

export function toggleAudioMuted(): void {
  setAudioMuted(!currentAudioSettings.muted);
}

export function setAudioVolume(volume: number): void {
  const nextVol = clamp01(volume);
  if (Math.abs(currentAudioSettings.volume - nextVol) < 0.002) return;
  currentAudioSettings = {
    muted: nextVol > 0.005 ? false : currentAudioSettings.muted,
    volume: nextVol,
  };
  persistAudioSettings(currentAudioSettings);
  notifyAudioSettings();
}

// ============================================================
// Procedural Web Audio Synthesizer Singleton
// ============================================================

export interface SoundUpdateInput {
  active: boolean;
  carClass: CarClass;
  speedKmh: number;
  forwardSpeed: number;
  lateralSpeed: number;
  maxSpeedKmh: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  grounded: boolean;
  surface: SurfaceType;
  tireHealth: number;
  engineHealth: number;
  isHeldOnGrid: boolean;
  tunnelBlend: number;
  cameraMode: 'chase' | 'cockpit' | 'orbit';
  dt: number;
  isRegenerating?: boolean;
  attackModeActive?: boolean;
}

function makeDistortionCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  const k = Math.max(0.25, amount * 24);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function createNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const length = Math.max(1024, Math.floor(sampleRate * seconds));
  const buf = ctx.createBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Smooth pink-ish tilt for pleasant organic surface texture
    last = last * 0.45 + white * 0.55;
    data[i] = Math.max(-1, Math.min(1, last * 1.1));
  }
  return buf;
}

export interface ListenerAudioPose {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface NearbyCarAudioSample {
  id: string;
  carClass: CarClass;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speedKmh: number;
}

interface OpponentVoiceNode {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  gainA: GainNode;
  gainB: GainNode;
  lp: BiquadFilterNode;
  panner: StereoPannerNode | null;
  outGain: GainNode;
}

const OPPONENT_VOICE_COUNT = 4;
const OPPONENT_MAX_DIST_M = 95;
const OPPONENT_MAX_DIST_SQ = OPPONENT_MAX_DIST_M * OPPONENT_MAX_DIST_M;

function hashDetune(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const frac = (h >>> 0) / 0xffffffff;
  return 0.97 + frac * 0.06;
}

class CarSoundEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private tunnelSendGain: GainNode | null = null;
  private tunnelOutGain: GainNode | null = null;

  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscC: OscillatorNode | null = null;
  private oscGainA: GainNode | null = null;
  private oscGainB: GainNode | null = null;
  private oscGainC: GainNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private engineLowpass: BiquadFilterNode | null = null;
  private engineFormant: BiquadFilterNode | null = null;
  private engineFormantGain: GainNode | null = null;
  private engineOutGain: GainNode | null = null;

  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private tireBand1: BiquadFilterNode | null = null;
  private tireBand2: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;

  private windBand: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private curbLfo: OscillatorNode | null = null;
  private curbLfoGain: GainNode | null = null;
  private curbAmpNode: GainNode | null = null;
  private curbOutGain: GainNode | null = null;

  private offroadBand: BiquadFilterNode | null = null;
  private offroadGain: GainNode | null = null;

  private opponentVoices: OpponentVoiceNode[] = [];

  private mem: EngineAcousticMemory = createEngineMemory('f1');
  private lastClass: CarClass = 'f1';
  private waveIsElectric = false;
  private shiftDipUntil = 0;
  private lastImpactMs = 0;
  private lastPopMs = 0;
  private lastBovMs = 0;
  private lastChargePulseMs = 0;
  private currentDrive = -1;
  private cruiseSteadySec = 0;
  private prevSpeedKmh = 0;
  private prevRpmNorm = 0;
  private isInitialized = false;
  private tabHidden = false;

  constructor() {
    onSettingsChangedHooks.push(() => {
      this.syncMasterGain();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.tabHidden = document.visibilityState === 'hidden';
        if (this.tabHidden) {
          this.silence();
        }
        this.syncMasterGain();
      });
    }
  }

  private safeSetTarget(param: AudioParam | null | undefined, val: number, now: number, tau: number): void {
    if (!param || !Number.isFinite(val)) return;
    try {
      param.setTargetAtTime(val, now, Math.max(0.005, tau));
    } catch {
      // Ignore AudioParam edge errors
    }
  }

  private syncMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    const s = getAudioSettings();
    const target = s.muted || this.tabHidden ? 0 : s.volume * 0.55;
    this.safeSetTarget(this.masterGain.gain, target, this.ctx.currentTime, 0.035);
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.buildGraph(this.ctx);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx
          .resume()
          .then(() => {
            this.syncMasterGain();
          })
          .catch(() => {});
      } else {
        this.syncMasterGain();
      }
    } catch {
      // Autoplay / Web Audio unavailable
    }
  }

  private buildGraph(ctx: AudioContext): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.16;

    const master = ctx.createGain();
    const initSettings = getAudioSettings();
    master.gain.value = initSettings.muted || this.tabHidden ? 0 : initSettings.volume * 0.55;

    comp.connect(master);
    master.connect(ctx.destination);
    this.compressor = comp;
    this.masterGain = master;

    const dryBus = ctx.createGain();
    dryBus.gain.value = 1.0;
    dryBus.connect(comp);
    this.dryBus = dryBus;

    // Warm tunnel echo bus
    const tunnelSend = ctx.createGain();
    tunnelSend.gain.value = 1.0;
    const delayA = ctx.createDelay(0.5);
    delayA.delayTime.value = 0.052;
    const delayB = ctx.createDelay(0.5);
    delayB.delayTime.value = 0.089;
    const fbGain = ctx.createGain();
    fbGain.gain.value = 0.34;
    const dampLp = ctx.createBiquadFilter();
    dampLp.type = 'lowpass';
    dampLp.frequency.value = 1800;
    const tunnelOut = ctx.createGain();
    tunnelOut.gain.value = 0;

    tunnelSend.connect(delayA);
    delayA.connect(delayB);
    delayB.connect(dampLp);
    dampLp.connect(fbGain);
    fbGain.connect(delayA);
    delayA.connect(tunnelOut);
    dampLp.connect(tunnelOut);
    tunnelOut.connect(comp);

    this.tunnelSendGain = tunnelSend;
    this.tunnelOutGain = tunnelOut;

    // Smooth harmonic oscillator triad (triangle/sine) -> gentle warmth shaper -> lowpass + formant -> engineOutGain
    const oscA = ctx.createOscillator();
    oscA.type = 'triangle';
    oscA.frequency.value = 132;
    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 198;
    const oscC = ctx.createOscillator();
    oscC.type = 'sine';
    oscC.frequency.value = 264;

    const gA = ctx.createGain();
    const gB = ctx.createGain();
    const gC = ctx.createGain();
    gA.gain.value = 0.45;
    gB.gain.value = 0.32;
    gC.gain.value = 0.22;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(0.16);
    shaper.oversample = '2x';

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 640;
    lp.Q.value = 0.9;

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = SOLFEGGIO_HZ.F528;
    formant.Q.value = 1.0;

    const formantGain = ctx.createGain();
    formantGain.gain.value = 0.26;

    const engOut = ctx.createGain();
    engOut.gain.value = 0;

    oscA.connect(gA);
    oscB.connect(gB);
    oscC.connect(gC);
    gA.connect(shaper);
    gB.connect(shaper);
    gC.connect(shaper);
    shaper.connect(lp);
    shaper.connect(formant);
    lp.connect(engOut);
    formant.connect(formantGain);
    formantGain.connect(engOut);
    engOut.connect(dryBus);
    engOut.connect(tunnelSend);

    oscA.start();
    oscB.start();
    oscC.start();

    this.oscA = oscA;
    this.oscB = oscB;
    this.oscC = oscC;
    this.oscGainA = gA;
    this.oscGainB = gB;
    this.oscGainC = gC;
    this.shaper = shaper;
    this.engineLowpass = lp;
    this.engineFormant = formant;
    this.engineFormantGain = formantGain;
    this.engineOutGain = engOut;

    // Harmonic boost / Attack Mode shimmer voice (528–963 Hz)
    const turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = SOLFEGGIO_HZ.F528;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboGain);
    turboGain.connect(dryBus);
    turboGain.connect(tunnelSend);
    turboOsc.start();
    this.turboOsc = turboOsc;
    this.turboGain = turboGain;

    // Solfeggio transmission / electric inverter harmonic (396–963 Hz)
    const whineOsc = ctx.createOscillator();
    whineOsc.type = 'sine';
    whineOsc.frequency.value = SOLFEGGIO_HZ.F396;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whineOsc.connect(whineGain);
    whineGain.connect(dryBus);
    whineOsc.start();
    this.whineOsc = whineOsc;
    this.whineGain = whineGain;

    // Shared noise buffer for tires, wind, curbs, and off-road gravel
    const noiseBuf = createNoiseBuffer(ctx, 2);
    this.noiseBuffer = noiseBuf;

    const makeLoopNoise = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      return src;
    };

    // Tire squeal: softer dual bandpass filters around 639–852 Hz
    const tireSrc = makeLoopNoise();
    const tireBp1 = ctx.createBiquadFilter();
    tireBp1.type = 'bandpass';
    tireBp1.frequency.value = SOLFEGGIO_HZ.F639;
    tireBp1.Q.value = 3.6;
    const tireBp2 = ctx.createBiquadFilter();
    tireBp2.type = 'bandpass';
    tireBp2.frequency.value = SOLFEGGIO_HZ.F852;
    tireBp2.Q.value = 3.2;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0;
    tireSrc.connect(tireBp1);
    tireSrc.connect(tireBp2);
    tireBp1.connect(tireGain);
    tireBp2.connect(tireGain);
    tireGain.connect(dryBus);
    tireGain.connect(tunnelSend);
    tireSrc.start();
    this.tireBand1 = tireBp1;
    this.tireBand2 = tireBp2;
    this.tireGain = tireGain;

    // Aerodynamic wind rush
    const windSrc = makeLoopNoise();
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = SOLFEGGIO_HZ.F396;
    windBp.Q.value = 0.75;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(dryBus);
    windSrc.start();
    this.windBand = windBp;
    this.windGain = windGain;

    // Curb rumble strips modulated by LFO
    const curbSrc = makeLoopNoise();
    const curbLp = ctx.createBiquadFilter();
    curbLp.type = 'lowpass';
    curbLp.frequency.value = 220;
    curbLp.Q.value = 1.6;
    const curbAmp = ctx.createGain();
    curbAmp.gain.value = 0.55;
    const curbOut = ctx.createGain();
    curbOut.gain.value = 0;
    const curbLfo = ctx.createOscillator();
    curbLfo.type = 'sine';
    curbLfo.frequency.value = 28;
    const curbLfoGain = ctx.createGain();
    curbLfoGain.gain.value = 0.45;
    curbLfo.connect(curbLfoGain);
    curbLfoGain.connect(curbAmp.gain);
    curbSrc.connect(curbLp);
    curbLp.connect(curbAmp);
    curbAmp.connect(curbOut);
    curbOut.connect(dryBus);
    curbOut.connect(tunnelSend);
    curbSrc.start();
    curbLfo.start();
    this.curbLfo = curbLfo;
    this.curbLfoGain = curbLfoGain;
    this.curbAmpNode = curbAmp;
    this.curbOutGain = curbOut;

    // Off-road gravel/grass crunch
    const offSrc = makeLoopNoise();
    const offBp = ctx.createBiquadFilter();
    offBp.type = 'bandpass';
    offBp.frequency.value = SOLFEGGIO_HZ.F528;
    offBp.Q.value = 1.0;
    const offGain = ctx.createGain();
    offGain.gain.value = 0;
    offSrc.connect(offBp);
    offBp.connect(offGain);
    offGain.connect(dryBus);
    offSrc.start();
    this.offroadBand = offBp;
    this.offroadGain = offGain;

    // Fixed pool of 4 warm spatialized opponent voices
    this.opponentVoices = [];
    for (let i = 0; i < OPPONENT_VOICE_COUNT; i++) {
      const oppOscA = ctx.createOscillator();
      oppOscA.type = 'triangle';
      oppOscA.frequency.value = 132;
      const oppOscB = ctx.createOscillator();
      oppOscB.type = 'sine';
      oppOscB.frequency.value = 198;

      const oppGainA = ctx.createGain();
      oppGainA.gain.value = 0.48;
      const oppGainB = ctx.createGain();
      oppGainB.gain.value = 0.34;

      const oppLp = ctx.createBiquadFilter();
      oppLp.type = 'lowpass';
      oppLp.frequency.value = 900;
      oppLp.Q.value = 0.9;

      const oppPanner =
        typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
      if (oppPanner) oppPanner.pan.value = 0;

      const oppOut = ctx.createGain();
      oppOut.gain.value = 0;

      oppOscA.connect(oppGainA);
      oppOscB.connect(oppGainB);
      oppGainA.connect(oppLp);
      oppGainB.connect(oppLp);
      if (oppPanner) {
        oppLp.connect(oppPanner);
        oppPanner.connect(oppOut);
      } else {
        oppLp.connect(oppOut);
      }
      oppOut.connect(dryBus);
      oppOut.connect(tunnelSend);

      oppOscA.start();
      oppOscB.start();

      this.opponentVoices.push({
        oscA: oppOscA,
        oscB: oppOscB,
        gainA: oppGainA,
        gainB: oppGainB,
        lp: oppLp,
        panner: oppPanner,
        outGain: oppOut,
      });
    }
  }

  private canEmitOneShot(): boolean {
    if (!this.ctx || !this.compressor || this.ctx.state !== 'running') return false;
    const s = getAudioSettings();
    return !s.muted && !this.tabHidden && s.volume > 0.005;
  }

  public triggerGearShift(dir: 'up' | 'down', carClass: CarClass): void {
    if (carClass === 'fe') return;
    if (!this.ctx || !this.engineOutGain || !this.canEmitOneShot()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (dir === 'up') {
      this.shiftDipUntil = performance.now() + 50;
      try {
        this.engineOutGain.gain.cancelScheduledValues(now);
        this.engineOutGain.gain.setTargetAtTime(0.05, now, 0.008);
      } catch {
        // Ignore ramp conflicts
      }
      if (this.noiseBuffer && this.dryBus) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = carClass === 'f1' ? SOLFEGGIO_HZ.F396 : SOLFEGGIO_HZ.F285;
        bp.Q.value = 2.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.065, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.dryBus);
        src.start(now);
        src.stop(now + 0.06);
      }
    } else {
      this.triggerExhaustPop(carClass === 'f1' ? 0.45 : 0.60, carClass);
    }
  }

  public triggerExhaustPop(intensity: number, carClass: CarClass): void {
    if (carClass === 'fe') return;
    if (!this.ctx || !this.dryBus || !this.canEmitOneShot()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastPopMs < 110) return;
    this.lastPopMs = nowMs;

    const ctx = this.ctx;
    const baseNow = ctx.currentTime;
    const count = carClass === 'rally' ? 2 : 1;
    const int01 = clampRange(intensity, 0.2, 1.0);

    for (let p = 0; p < count; p++) {
      const t = baseNow + p * 0.072;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(carClass === 'f1' ? SOLFEGGIO_HZ.F285 : SOLFEGGIO_HZ.F174, t);
      osc.frequency.exponentialRampToValueAtTime(65, t + 0.085);
      g.gain.setValueAtTime(0.11 * int01, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
      osc.connect(g);
      g.connect(this.dryBus);
      if (this.tunnelSendGain) g.connect(this.tunnelSendGain);
      osc.start(t);
      osc.stop(t + 0.11);

      if (this.noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = carClass === 'rally' ? SOLFEGGIO_HZ.F528 : SOLFEGGIO_HZ.F639;
        bp.Q.value = 1.4;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.08 * int01, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        src.connect(bp);
        bp.connect(ng);
        ng.connect(this.dryBus);
        if (this.tunnelSendGain) ng.connect(this.tunnelSendGain);
        src.start(t);
        src.stop(t + 0.09);
      }
    }
  }

  public triggerTurboBlowOff(boostLevel: number): void {
    if (!this.ctx || !this.noiseBuffer || !this.dryBus || !this.canEmitOneShot()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastBovMs < 260) return;
    this.lastBovMs = nowMs;

    const ctx = this.ctx;
    const baseNow = ctx.currentTime;
    const strength = clampRange(boostLevel, 0.35, 1.0);

    const offsets = [0, 0.068, 0.132];
    const amps = [0.10, 0.065, 0.035];
    const freqs = [SOLFEGGIO_HZ.F639, SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F396];

    for (let k = 0; k < offsets.length; k++) {
      const t = baseNow + offsets[k];
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freqs[k], t);
      bp.Q.value = 2.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amps[k] * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.dryBus);
      if (this.tunnelSendGain) g.connect(this.tunnelSendGain);
      src.start(t);
      src.stop(t + 0.075);
    }
  }

  public playImpact(intensity01: number, kind: 'wall' | 'car'): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.dryBus) return;
    const nowMs = performance.now();
    if (nowMs - this.lastImpactMs < 130) return;
    this.lastImpactMs = nowMs;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amt = clampRange(intensity01, 0.12, 1.0);

    // Warm Solfeggio sub thud (174 -> 87 Hz)
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(SOLFEGGIO_HZ.F174, now);
    thudOsc.frequency.exponentialRampToValueAtTime(87, now + 0.16);
    thudGain.gain.setValueAtTime(0.26 * amt, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thudOsc.connect(thudGain);
    thudGain.connect(this.dryBus);
    if (this.tunnelSendGain) thudGain.connect(this.tunnelSendGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.2);

    // Soft crunch noise burst centered at 396 Hz
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'car' ? SOLFEGGIO_HZ.F528 : SOLFEGGIO_HZ.F396;
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.16 * amt, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(this.dryBus);
      if (this.tunnelSendGain) ng.connect(this.tunnelSendGain);
      src.start(now);
      src.stop(now + 0.16);
    }
  }

  public playStartLightBeep(isGreen: boolean): void {
    this.unlock();
    if (!this.ctx || !this.compressor) return;
    const s = getAudioSettings();
    if (s.muted || this.tabHidden || s.volume <= 0.005) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const playTone = (freq: number, durSec: number, peak: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(peak, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + durSec);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(now);
      osc.stop(now + durSec + 0.02);
    };

    if (isGreen) {
      playTone(SOLFEGGIO_HZ.F528, 0.30, 0.09);
      playTone(SOLFEGGIO_HZ.F639, 0.28, 0.07);
      playTone(SOLFEGGIO_HZ.F963, 0.24, 0.05);
    } else {
      playTone(SOLFEGGIO_HZ.F396, 0.14, 0.09);
    }
  }

  public playLapChime(isBestLap: boolean, isFinish: boolean): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.compressor) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = isFinish
      ? [SOLFEGGIO_HZ.F396, SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F639, SOLFEGGIO_HZ.F963]
      : isBestLap
      ? [SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F639, SOLFEGGIO_HZ.F852]
      : [SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F639];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.075, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(t);
      osc.stop(t + 0.21);
    });
  }

  public playPitWheelGun(): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.dryBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(SOLFEGGIO_HZ.F396, now);
    osc.frequency.linearRampToValueAtTime(SOLFEGGIO_HZ.F528, now + 0.08);
    osc.frequency.setValueAtTime(SOLFEGGIO_HZ.F417, now + 0.13);
    g.gain.setValueAtTime(0.065, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(g);
    g.connect(this.dryBus);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  public playPitComplete(): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.compressor) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F852].forEach((freq, idx) => {
      const t = now + idx * 0.095;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.085, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playAttackModeActivate(): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.compressor) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [SOLFEGGIO_HZ.F528, SOLFEGGIO_HZ.F639, SOLFEGGIO_HZ.F963].forEach((freq, idx) => {
      const t = now + idx * 0.06;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playChargePulse(): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.compressor) return;
    const nowMs = performance.now();
    if (nowMs - this.lastChargePulseMs < 650) return;
    this.lastChargePulseMs = nowMs;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    [SOLFEGGIO_HZ.F396, SOLFEGGIO_HZ.F528].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(idx === 0 ? 0.05 : 0.04, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  public update(input: SoundUpdateInput): EngineAcousticState {
    if (input.carClass !== this.lastClass) {
      this.lastClass = input.carClass;
      this.mem = createEngineMemory(input.carClass);
      this.cruiseSteadySec = 0;
    }

    const acoustic = computeEngineAcoustics(input, this.mem);
    this.mem = acoustic.memory;

    const dt = clampRange(input.dt, 0.001, 0.08);
    if (
      input.speedKmh > 25 &&
      Math.abs(input.speedKmh - this.prevSpeedKmh) < 3.5 &&
      Math.abs(acoustic.rpmNorm - this.prevRpmNorm) < 0.035 &&
      !input.attackModeActive &&
      input.brake < 0.05
    ) {
      this.cruiseSteadySec = Math.min(10, this.cruiseSteadySec + dt);
    } else {
      this.cruiseSteadySec = Math.max(0, this.cruiseSteadySec - dt * 4.5);
    }
    this.prevSpeedKmh = input.speedKmh;
    this.prevRpmNorm = acoustic.rpmNorm;
    const cruiseRelax = clamp01((this.cruiseSteadySec - 1.5) / 2.5);

    if (!this.ctx || !this.isInitialized) return acoustic;
    const now = this.ctx.currentTime;

    if (!input.active || this.tabHidden || getAudioSettings().muted) {
      this.silence();
      return acoustic;
    }

    const wantElectricWave = input.carClass === 'fe';
    if (wantElectricWave !== this.waveIsElectric) {
      this.waveIsElectric = wantElectricWave;
      if (this.oscA) this.oscA.type = wantElectricWave ? 'sine' : 'triangle';
      if (this.oscB) this.oscB.type = wantElectricWave ? 'sine' : 'triangle';
      if (this.oscC) this.oscC.type = wantElectricWave ? 'triangle' : 'sine';
    }

    const prof = CAR_AUDIO_PROFILES[input.carClass] ?? CAR_AUDIO_PROFILES.f1;
    if (this.shaper && Math.abs(this.currentDrive - prof.driveAmount) > 0.01) {
      this.shaper.curve = makeDistortionCurve(prof.driveAmount);
      this.currentDrive = prof.driveAmount;
    }

    const mix = computeAudioMixLevels({
      carClass: input.carClass,
      speedKmh: input.speedKmh,
      lateralSpeed: input.lateralSpeed,
      throttle: input.throttle,
      brake: input.brake,
      handbrake: input.handbrake,
      grounded: input.grounded,
      surface: input.surface,
      tireHealth: input.tireHealth,
      engineHealth: input.engineHealth,
      tunnelBlend: input.tunnelBlend,
      cameraMode: input.cameraMode,
      rpmNorm: acoustic.rpmNorm,
      fundamentalHz: acoustic.fundamentalHz,
      boostLevel: acoustic.boostLevel,
      isRegenerating: input.isRegenerating,
      attackModeActive: input.attackModeActive,
      cruiseRelax,
    });

    // Apply Solfeggio-anchored class harmonics & frequencies smoothly
    this.safeSetTarget(this.oscA?.frequency, acoustic.fundamentalHz * prof.harmonics[0], now, 0.018);
    this.safeSetTarget(this.oscB?.frequency, acoustic.fundamentalHz * prof.harmonics[1], now, 0.018);
    this.safeSetTarget(this.oscC?.frequency, acoustic.fundamentalHz * prof.harmonics[2], now, 0.018);
    this.safeSetTarget(this.oscGainA?.gain, prof.harmonicGains[0], now, 0.04);
    this.safeSetTarget(this.oscGainB?.gain, prof.harmonicGains[1], now, 0.04);
    this.safeSetTarget(this.oscGainC?.gain, prof.harmonicGains[2], now, 0.04);

    this.safeSetTarget(this.engineLowpass?.frequency, mix.engineFilterHz, now, 0.03);
    this.safeSetTarget(this.engineFormant?.frequency, mix.formantHz, now, 0.03);
    this.safeSetTarget(this.engineFormant?.Q, prof.formantQ, now, 0.04);

    const inShiftDip = performance.now() < this.shiftDipUntil;
    this.safeSetTarget(this.engineOutGain?.gain, inShiftDip ? 0.05 : mix.engineGain, now, 0.025);

    this.safeSetTarget(this.turboOsc?.frequency, mix.turboHz, now, 0.03);
    this.safeSetTarget(this.turboGain?.gain, mix.turboGain, now, 0.03);

    this.safeSetTarget(this.whineOsc?.frequency, mix.gearWhineHz, now, 0.03);
    this.safeSetTarget(this.whineGain?.gain, mix.gearWhineGain, now, 0.035);

    this.safeSetTarget(this.tireBand1?.frequency, mix.tireSquealHz, now, 0.03);
    this.safeSetTarget(this.tireBand2?.frequency, mix.tireSquealHz * 1.33, now, 0.03);
    this.safeSetTarget(this.tireGain?.gain, mix.tireSquealGain, now, 0.035);

    this.safeSetTarget(this.windBand?.frequency, mix.windHz, now, 0.045);
    this.safeSetTarget(this.windGain?.gain, mix.windGain, now, 0.05);

    this.safeSetTarget(this.curbLfo?.frequency, mix.curbModHz, now, 0.02);
    this.safeSetTarget(this.curbLfoGain?.gain, 0.45, now, 0.02);
    this.safeSetTarget(this.curbAmpNode?.gain, 0.55, now, 0.02);
    this.safeSetTarget(this.curbOutGain?.gain, mix.curbGain, now, 0.03);

    this.safeSetTarget(this.offroadBand?.frequency, mix.offroadHz, now, 0.035);
    this.safeSetTarget(this.offroadGain?.gain, mix.offroadGain, now, 0.035);

    this.safeSetTarget(this.tunnelOutGain?.gain, mix.tunnelWetGain, now, 0.06);

    // One-shot automatic triggers (skipped for electric cars)
    if (acoustic.shiftEvent) {
      this.triggerGearShift(acoustic.shiftEvent, input.carClass);
    }
    if (acoustic.triggerBov) {
      this.triggerTurboBlowOff(acoustic.boostLevel);
    } else if (acoustic.triggerLiftPop) {
      this.triggerExhaustPop(input.carClass === 'rally' ? 0.72 : 0.52, input.carClass);
    }

    return acoustic;
  }

  public silenceNearbyCars(): void {
    if (!this.ctx || !this.isInitialized) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.opponentVoices.length; i++) {
      this.safeSetTarget(this.opponentVoices[i].outGain.gain, 0, now, 0.04);
    }
  }

  public updateNearbyCars(
    active: boolean,
    listener: ListenerAudioPose | null,
    opponents: NearbyCarAudioSample[]
  ): void {
    if (
      !active ||
      !listener ||
      !this.ctx ||
      !this.isInitialized ||
      this.tabHidden ||
      getAudioSettings().muted
    ) {
      this.silenceNearbyCars();
      return;
    }

    const now = this.ctx.currentTime;

    const qLen = Math.hypot(listener.qx, listener.qy, listener.qz, listener.qw) || 1;
    const qx = listener.qx / qLen;
    const qy = listener.qy / qLen;
    const qz = listener.qz / qLen;
    const qw = listener.qw / qLen;
    const screenRightX = -(1 - 2 * (qy * qy + qz * qz));
    const screenRightY = -2 * (qx * qy + qw * qz);
    const screenRightZ = -2 * (qx * qz - qw * qy);

    const candidates: Array<{ sample: NearbyCarAudioSample; dx: number; dy: number; dz: number; distSq: number }> = [];
    for (let i = 0; i < opponents.length; i++) {
      const car = opponents[i];
      const dx = car.x - listener.x;
      const dy = car.y - listener.y;
      const dz = car.z - listener.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (Number.isFinite(distSq) && distSq < OPPONENT_MAX_DIST_SQ) {
        candidates.push({ sample: car, dx, dy, dz, distSq });
      }
    }

    if (candidates.length > 1) {
      candidates.sort((a, b) => a.distSq - b.distSq);
    }

    for (let slot = 0; slot < this.opponentVoices.length; slot++) {
      const voice = this.opponentVoices[slot];
      const cand = candidates[slot];
      if (!cand) {
        this.safeSetTarget(voice.outGain.gain, 0, now, 0.045);
        continue;
      }

      const { sample: car, dx, dy, dz, distSq } = cand;
      const dist = Math.sqrt(distSq);
      const distFade = Math.max(0, 1 - dist / OPPONENT_MAX_DIST_M);
      const attenuation = (1 / (1 + (dist / 8) * (dist / 8) * 0.42)) * distFade;
      const speedKmh = Math.max(0, Number.isFinite(car.speedKmh) ? car.speedKmh : 0);
      const speedGain = 0.28 + 0.72 * Math.min(1, speedKmh / 150);
      const targetGain = Math.min(0.16, attenuation * speedGain * 0.20);

      const relVx = (car.vx || 0) - (listener.vx || 0);
      const relVy = (car.vy || 0) - (listener.vy || 0);
      const relVz = (car.vz || 0) - (listener.vz || 0);
      const vApproach = -(relVx * dx + relVy * dy + relVz * dz) / Math.max(1.5, dist);
      const doppler = clampRange(1 + vApproach / 343, 0.82, 1.22);

      const prof = CAR_AUDIO_PROFILES[car.carClass] ?? CAR_AUDIO_PROFILES.f1;
      const speedNorm = clamp01(speedKmh / 240);
      let rpmNorm = 0.06;
      if (speedKmh > 3) {
        let gear = 1;
        for (let g = 1; g < prof.numGears; g++) {
          if (speedNorm >= gearUpperSpeedFrac(g, prof.numGears)) gear = g + 1;
        }
        const lo = gearLowerSpeedFrac(gear, prof.numGears);
        const hi = Math.max(lo + 0.06, gearUpperSpeedFrac(gear, prof.numGears));
        const inGearFrac = clamp01((speedNorm - lo) / (hi - lo));
        rpmNorm = clampRange(0.20 + inGearFrac * 0.76, 0.18, 0.96);
      }

      const baseHz =
        (prof.baseHzAtIdle + rpmNorm * (prof.baseHzAtRedline - prof.baseHzAtIdle)) *
        doppler *
        hashDetune(car.id);

      const lpHz = 360 + (1 - Math.min(1, dist / 90)) * 840;
      const pan = clampRange(
        ((dx * screenRightX + dy * screenRightY + dz * screenRightZ) / Math.max(2.0, dist)) * 0.9,
        -0.9,
        0.9
      );

      this.safeSetTarget(voice.oscA.frequency, baseHz * prof.harmonics[0], now, 0.045);
      this.safeSetTarget(voice.oscB.frequency, baseHz * prof.harmonics[1], now, 0.045);
      this.safeSetTarget(voice.gainA.gain, prof.harmonicGains[0], now, 0.05);
      this.safeSetTarget(voice.gainB.gain, prof.harmonicGains[1], now, 0.05);
      this.safeSetTarget(voice.lp.frequency, lpHz, now, 0.05);
      if (voice.panner) {
        this.safeSetTarget(voice.panner.pan, pan, now, 0.045);
      }
      this.safeSetTarget(voice.outGain.gain, targetGain, now, 0.045);
    }
  }

  public silence(): void {
    if (!this.ctx || !this.isInitialized) return;
    const now = this.ctx.currentTime;
    this.safeSetTarget(this.engineOutGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.turboGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.whineGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.tireGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.windGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.curbOutGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.offroadGain?.gain, 0, now, 0.03);
    this.safeSetTarget(this.tunnelOutGain?.gain, 0, now, 0.04);
    this.silenceNearbyCars();
  }
}

export const carSoundEngine = new CarSoundEngine();
