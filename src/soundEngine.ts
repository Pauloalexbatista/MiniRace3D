import type { CarClass } from './components/Car3D';
import type { SurfaceType } from './physics';

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
    baseHzAtIdle: 155,
    baseHzAtRedline: 540,
    harmonics: [1.0, 1.5, 2.0],
    harmonicGains: [0.46, 0.34, 0.24],
    formantMinHz: 1100,
    formantMaxHz: 2400,
    formantQ: 2.2,
    gearWhineGain: 0.16,
    gearWhineBaseHz: 920,
    turboGain: 0.04,
    bovEnabled: false,
    exhaustPopStyle: 'crisp',
    driveAmount: 0.42,
    engineGain: 0.34,
  },
  gt: {
    numGears: 6,
    idleRpm: 1300,
    redlineRpm: 8600,
    baseHzAtIdle: 58,
    baseHzAtRedline: 305,
    harmonics: [0.5, 1.0, 1.498],
    harmonicGains: [0.44, 0.42, 0.25],
    formantMinHz: 340,
    formantMaxHz: 980,
    formantQ: 1.8,
    gearWhineGain: 0.09,
    gearWhineBaseHz: 680,
    turboGain: 0.06,
    bovEnabled: false,
    exhaustPopStyle: 'bark',
    driveAmount: 0.55,
    engineGain: 0.38,
  },
  rally: {
    numGears: 6,
    idleRpm: 1150,
    redlineRpm: 7800,
    baseHzAtIdle: 52,
    baseHzAtRedline: 265,
    harmonics: [0.5, 1.0, 1.33],
    harmonicGains: [0.46, 0.40, 0.28],
    formantMinHz: 280,
    formantMaxHz: 860,
    formantQ: 1.9,
    gearWhineGain: 0.12,
    gearWhineBaseHz: 740,
    turboGain: 0.18,
    bovEnabled: true,
    exhaustPopStyle: 'antilag',
    driveAmount: 0.65,
    engineGain: 0.38,
  },
  drift: {
    numGears: 6,
    idleRpm: 1100,
    redlineRpm: 8200,
    baseHzAtIdle: 56,
    baseHzAtRedline: 315,
    harmonics: [1.0, 1.5, 2.0],
    harmonicGains: [0.48, 0.32, 0.22],
    formantMinHz: 420,
    formantMaxHz: 1150,
    formantQ: 2.0,
    gearWhineGain: 0.07,
    gearWhineBaseHz: 640,
    turboGain: 0.22,
    bovEnabled: true,
    exhaustPopStyle: 'snap',
    driveAmount: 0.60,
    engineGain: 0.37,
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
    } else if (shiftCooldown <= 0) {
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
    // Grid / Neutral free revving
    targetRpmNorm = throttle > 0.02 ? 0.14 + Math.pow(throttle, 0.85) * 0.86 : 0.05;
  } else if (nextGear === -1) {
    targetRpmNorm = clamp01(0.16 + (speedKmh / 65) * 0.70 + throttle * 0.14);
  } else {
    const lo = gearLowerSpeedFrac(nextGear, prof.numGears) * maxSpd;
    const hi = Math.max(lo + 12, gearUpperSpeedFrac(nextGear, prof.numGears) * maxSpd);
    const inGearFrac = clamp01((speedKmh - lo) / (hi - lo));
    const launchSlip = nextGear === 1 && speedKmh < 35 ? throttle * (1 - speedKmh / 35) * 0.34 : 0;
    const wheelspinBoost = input.handbrake && speedKmh > 12 ? throttle * 0.22 : 0;
    const minDrivingNorm = nextGear === 1 ? 0.12 : 0.20;
    targetRpmNorm = clamp01(
      minDrivingNorm + inGearFrac * (1 - minDrivingNorm) + throttle * 0.06 + launchSlip + wheelspinBoost
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
      ? 16
      : 10.5;
  let rpmNorm = mem.rpmNorm + (targetRpmNorm - mem.rpmNorm) * Math.min(1, dt * rpmRate);

  // Authentic ~16 Hz ignition cut bounce at redline limiter
  let nextLimiterPhase = mem.limiterPhase;
  if (rpmNorm > 0.96 && throttle > 0.7) {
    nextLimiterPhase = (mem.limiterPhase + dt * 16.0) % 1;
    const cutWave = nextLimiterPhase < 0.45 ? 0.0 : -0.055;
    rpmNorm = clamp01(rpmNorm + cutWave);
  } else {
    nextLimiterPhase = 0;
  }

  // Slight damaged-engine sputter below 40% health
  if (engineHealthNorm < 0.4 && throttle > 0.3) {
    const damageFlutter = Math.sin((mem.limiterPhase + dt * 23) * Math.PI * 2) * (0.4 - engineHealthNorm) * 0.06;
    rpmNorm = clamp01(rpmNorm + damageFlutter);
  }

  const rpm = prof.idleRpm + (prof.redlineRpm - prof.idleRpm) * rpmNorm;
  const fundamentalHz = clampRange(
    prof.baseHzAtIdle + (prof.baseHzAtRedline - prof.baseHzAtIdle) * Math.pow(rpmNorm, 0.96),
    38,
    850
  );

  // Turbo boost build & Blow-off / Lift-off exhaust pops
  const hasBoostSource = prof.bovEnabled || prof.turboGain > 0.08;
  const targetBoost =
    hasBoostSource && nextGear !== 0 && throttle > 0.45 && rpmNorm > 0.35
      ? clamp01(((rpmNorm - 0.30) / 0.65) * throttle)
      : hasBoostSource && input.isHeldOnGrid && throttle > 0.6 && rpmNorm > 0.55
      ? clamp01((rpmNorm - 0.5) * 0.9)
      : 0;
  const boostRate = targetBoost > mem.boostLevel ? 2.4 : 3.6;
  const boostLevel = clamp01(mem.boostLevel + (targetBoost - mem.boostLevel) * Math.min(1, dt * boostRate));

  const sharpLift = mem.prevThrottle > 0.45 && throttle < 0.25;
  const triggerBov = Boolean(prof.bovEnabled && mem.boostLevel > 0.45 && sharpLift);
  const triggerLiftPop =
    (shiftEvent === 'down' && mem.rpmNorm > 0.42) ||
    ((prof.exhaustPopStyle === 'antilag' || prof.exhaustPopStyle === 'snap') &&
      mem.prevThrottle > 0.55 &&
      throttle < 0.18 &&
      mem.rpmNorm > 0.50) ||
    (prof.exhaustPopStyle === 'bark' && brake > 0.55 && mem.prevThrottle > 0.4 && throttle < 0.15 && mem.rpmNorm > 0.6);

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
 * Pure acoustic level & filter calculator for engine, turbo, gearbox, tires, wind, curbs, gravel, and tunnel echo.
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

  const loadFactor = 0.50 + 0.44 * throttle + 0.16 * rpmNorm;
  const healthFactor = engineHealth < 45 ? 0.88 : 1.0;
  const engineGain = clampRange(prof.engineGain * loadFactor * healthFactor * cockpitBodyGain, 0, 0.55);

  const engineFilterHz = clampRange(
    (260 + 2700 * Math.pow(rpmNorm, 1.1) + throttle * 680) * cockpitWarmth,
    220,
    4800
  );
  const formantHz = clampRange(
    (prof.formantMinHz + (prof.formantMaxHz - prof.formantMinHz) * rpmNorm) * cockpitWarmth,
    220,
    3000
  );

  const turboGain = clampRange(
    prof.turboGain * boostLevel * (0.35 + 0.65 * rpmNorm) * (isCockpit ? 0.82 : 1.0),
    0,
    0.35
  );
  const turboHz = clampRange(2200 + boostLevel * 3800 + rpmNorm * 1400, 1600, 8200);

  const speedNorm300 = clamp01(speedKmh / 300);
  const gearWhineGain = clampRange(
    prof.gearWhineGain * speedNorm300 * (0.35 + 0.65 * throttle) * (isCockpit ? 1.12 : 0.85),
    0,
    0.24
  );
  const gearWhineHz = clampRange(prof.gearWhineBaseHz + speedKmh * 6.8 + rpmNorm * 320, 480, 4200);

  // Tire squeal only on paved asphalt/curbs when sliding, locking brakes, handbraking, or spinning bald tires
  let tireSquealGain = 0;
  let tireSquealHz = 960;
  if (input.grounded && isPaved && speedKmh > 6) {
    const latSlip = absLat > 3.5 ? clamp01((absLat - 3.5) / 11.5) : 0;
    const handbrakeSlip = input.handbrake && speedKmh > 12 ? clamp01(0.45 + speedKmh / 140) : 0;
    const brakeLockSlip = brake > 0.6 && speedKmh > 35 ? clamp01((brake - 0.55) * 1.4 * Math.min(1, speedKmh / 110)) : 0;
    const baldSpinSlip = tireHealth < 40 && throttle > 0.65 && speedKmh > 15 ? 0.42 : 0;

    const slipCombined = clamp01(Math.max(latSlip, handbrakeSlip, brakeLockSlip, baldSpinSlip));
    if (slipCombined > 0.02) {
      tireSquealGain = clampRange(slipCombined * 0.22 * (isCockpit ? 0.72 : 1.0), 0, 0.25);
      tireSquealHz = clampRange(860 + slipCombined * 380 + Math.min(220, speedKmh * 0.7), 820, 1580);
    }
  }

  // Aerodynamic wind noise (> 80 km/h)
  let windGain = 0;
  let windHz = 500;
  if (speedKmh > 80) {
    const wNorm = clamp01((speedKmh - 80) / 280);
    const tunnelWindDuck = 1 - tunnelBlend * 0.35;
    windGain = clampRange(Math.pow(wNorm, 1.35) * 0.22 * tunnelWindDuck * (isCockpit ? 0.75 : 1.0), 0, 0.26);
    windHz = clampRange(340 + wNorm * 980 * cockpitWarmth, 280, 1550);
  }

  // Curb rumble stripes
  let curbGain = 0;
  let curbModHz = 28;
  if (input.grounded && isCurb && speedKmh > 6) {
    const curbSeverity = input.surface === 'CURB_APEX' ? 1.0 : input.surface === 'CURB_WIDE' ? 0.85 : 0.68;
    const spdScale = clamp01((speedKmh - 6) / 140);
    curbGain = clampRange(0.24 * curbSeverity * (0.28 + 0.72 * spdScale), 0, 0.28);
    curbModHz = clampRange(18 + speedKmh * 0.32, 16, 125);
  }

  // Off-road gravel/sand/grass roar
  let offroadGain = 0;
  let offroadHz = 650;
  if (input.grounded && isOffroad && speedKmh > 4) {
    const spdScale = clamp01((speedKmh - 4) / 130);
    const surfGain = input.surface === 'GRAVEL' ? 0.26 : input.surface === 'SAND' ? 0.21 : 0.16;
    offroadGain = clampRange(surfGain * (0.2 + 0.8 * spdScale), 0, 0.28);
    offroadHz = clampRange(
      (input.surface === 'GRAVEL' ? 920 : input.surface === 'SAND' ? 680 : 520) + speedKmh * 3.0,
      360,
      1900
    );
  }

  const tunnelWetGain = clampRange(tunnelBlend * 0.52, 0, 0.55);

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

const AUDIO_STORAGE_KEY = 'minirace3d_audio_v1';

export interface AudioSettings {
  muted: boolean;
  volume: number; // 0..1
}

function loadAudioSettings(): AudioSettings {
  const defaults: AudioSettings = { muted: false, volume: 0.7 };
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: Boolean(parsed.muted),
      volume: typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? clamp01(parsed.volume)
        : 0.7,
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
}

function makeDistortionCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  const k = Math.max(1, amount * 40);
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
    // Slight pink-ish tilt for fuller mechanical & surface texture
    last = last * 0.35 + white * 0.65;
    data[i] = Math.max(-1, Math.min(1, last * 1.15));
  }
  return buf;
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

  private mem: EngineAcousticMemory = createEngineMemory('f1');
  private lastClass: CarClass = 'f1';
  private shiftDipUntil = 0;
  private lastImpactMs = 0;
  private lastPopMs = 0;
  private lastBovMs = 0;
  private currentDrive = -1;
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
    const target = s.muted || this.tabHidden ? 0 : s.volume * 0.9;
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
        void this.ctx.resume().then(() => {
          this.syncMasterGain();
        }).catch(() => {});
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
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.14;

    const master = ctx.createGain();
    const initSettings = getAudioSettings();
    master.gain.value = initSettings.muted || this.tabHidden ? 0 : initSettings.volume * 0.9;

    comp.connect(master);
    master.connect(ctx.destination);
    this.compressor = comp;
    this.masterGain = master;

    const dryBus = ctx.createGain();
    dryBus.gain.value = 1.0;
    dryBus.connect(comp);
    this.dryBus = dryBus;

    // Tunnel echo bus (slapback + damped feedback)
    const tunnelSend = ctx.createGain();
    tunnelSend.gain.value = 1.0;
    const delayA = ctx.createDelay(0.5);
    delayA.delayTime.value = 0.052;
    const delayB = ctx.createDelay(0.5);
    delayB.delayTime.value = 0.089;
    const fbGain = ctx.createGain();
    fbGain.gain.value = 0.38;
    const dampLp = ctx.createBiquadFilter();
    dampLp.type = 'lowpass';
    dampLp.frequency.value = 2600;
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

    // Engine oscillator triad -> exhaust saturation -> lowpass + parallel formant -> engineOutGain
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 120;
    const oscB = ctx.createOscillator();
    oscB.type = 'sawtooth';
    oscB.frequency.value = 180;
    const oscC = ctx.createOscillator();
    oscC.type = 'triangle';
    oscC.frequency.value = 240;

    const gA = ctx.createGain();
    const gB = ctx.createGain();
    const gC = ctx.createGain();
    gA.gain.value = 0.45;
    gB.gain.value = 0.35;
    gC.gain.value = 0.22;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(0.45);
    shaper.oversample = '2x';

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 750;
    lp.Q.value = 1.3;

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 900;
    formant.Q.value = 2.0;

    const formantGain = ctx.createGain();
    formantGain.gain.value = 0.48;

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

    // Turbo spool whine
    const turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = 2800;
    const turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboGain);
    turboGain.connect(dryBus);
    turboGain.connect(tunnelSend);
    turboOsc.start();
    this.turboOsc = turboOsc;
    this.turboGain = turboGain;

    // Straight-cut gearbox whine
    const whineOsc = ctx.createOscillator();
    whineOsc.type = 'sine';
    whineOsc.frequency.value = 900;
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

    // Tire squeal: dual narrow resonant bandpass filters
    const tireSrc = makeLoopNoise();
    const tireBp1 = ctx.createBiquadFilter();
    tireBp1.type = 'bandpass';
    tireBp1.frequency.value = 960;
    tireBp1.Q.value = 7.5;
    const tireBp2 = ctx.createBiquadFilter();
    tireBp2.type = 'bandpass';
    tireBp2.frequency.value = 1480;
    tireBp2.Q.value = 6.5;
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
    windBp.frequency.value = 520;
    windBp.Q.value = 0.85;
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
    curbLp.frequency.value = 240;
    curbLp.Q.value = 2.2;
    const curbAmp = ctx.createGain();
    curbAmp.gain.value = 0.55;
    const curbOut = ctx.createGain();
    curbOut.gain.value = 0;
    const curbLfo = ctx.createOscillator();
    curbLfo.type = 'sine';
    curbLfo.frequency.value = 32;
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
    offBp.frequency.value = 780;
    offBp.Q.value = 1.2;
    const offGain = ctx.createGain();
    offGain.gain.value = 0;
    offSrc.connect(offBp);
    offBp.connect(offGain);
    offGain.connect(dryBus);
    offSrc.start();
    this.offroadBand = offBp;
    this.offroadGain = offGain;
  }

  private canEmitOneShot(): boolean {
    if (!this.ctx || !this.compressor || this.ctx.state !== 'running') return false;
    const s = getAudioSettings();
    return !s.muted && !this.tabHidden && s.volume > 0.005;
  }

  public triggerGearShift(dir: 'up' | 'down', carClass: CarClass): void {
    if (!this.ctx || !this.engineOutGain || !this.canEmitOneShot()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (dir === 'up') {
      // Brief 50 ms torque-cut dip
      this.shiftDipUntil = performance.now() + 55;
      try {
        this.engineOutGain.gain.cancelScheduledValues(now);
        this.engineOutGain.gain.setTargetAtTime(0.05, now, 0.008);
      } catch {
        // Ignore ramp conflicts
      }
      // Subtle mechanical clunk
      if (this.noiseBuffer && this.dryBus) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = carClass === 'f1' ? 420 : 280;
        bp.Q.value = 3.0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.11, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
        src.connect(bp);
        bp.connect(g);
        g.connect(this.dryBus);
        src.start(now);
        src.stop(now + 0.065);
      }
    } else {
      // Downshift throttle blip + exhaust crack
      this.triggerExhaustPop(carClass === 'f1' ? 0.55 : 0.72, carClass);
    }
  }

  public triggerExhaustPop(intensity: number, carClass: CarClass): void {
    if (!this.ctx || !this.dryBus || !this.canEmitOneShot()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastPopMs < 95) return;
    this.lastPopMs = nowMs;

    const ctx = this.ctx;
    const baseNow = ctx.currentTime;
    const count = carClass === 'rally' ? 2 : 1;
    const int01 = clampRange(intensity, 0.2, 1.0);

    for (let p = 0; p < count; p++) {
      const t = baseNow + p * 0.068;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(carClass === 'f1' ? 210 : 145, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.08);
      g.gain.setValueAtTime(0.22 * int01, t);
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
        bp.frequency.value = carClass === 'rally' ? 920 : 1200;
        bp.Q.value = 1.6;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.18 * int01, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
        src.connect(bp);
        bp.connect(ng);
        ng.connect(this.dryBus);
        if (this.tunnelSendGain) ng.connect(this.tunnelSendGain);
        src.start(t);
        src.stop(t + 0.095);
      }
    }
  }

  public triggerTurboBlowOff(boostLevel: number): void {
    if (!this.ctx || !this.noiseBuffer || !this.dryBus || !this.canEmitOneShot()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastBovMs < 240) return;
    this.lastBovMs = nowMs;

    const ctx = this.ctx;
    const baseNow = ctx.currentTime;
    const strength = clampRange(boostLevel, 0.35, 1.0);

    // Classic 3-pulse flutter ("pssh-tu-tu-tu")
    const offsets = [0, 0.068, 0.132];
    const amps = [0.22, 0.14, 0.08];
    const freqs = [3400, 2900, 2450];

    for (let k = 0; k < offsets.length; k++) {
      const t = baseNow + offsets[k];
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freqs[k], t);
      bp.Q.value = 3.6;
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
    if (nowMs - this.lastImpactMs < 120) return;
    this.lastImpactMs = nowMs;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amt = clampRange(intensity01, 0.12, 1.0);

    // Sub chassis thud
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(kind === 'wall' ? 105 : 135, now);
    thudOsc.frequency.exponentialRampToValueAtTime(34, now + 0.16);
    thudGain.gain.setValueAtTime(0.45 * amt, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thudOsc.connect(thudGain);
    thudGain.connect(this.dryBus);
    if (this.tunnelSendGain) thudGain.connect(this.tunnelSendGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.2);

    // Crunch noise burst
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'car' ? 1450 : 620;
      bp.Q.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.32 * amt, now);
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
      playTone(880, 0.28, 0.14);
      playTone(1320, 0.24, 0.08);
    } else {
      playTone(440, 0.12, 0.11);
    }
  }

  public playLapChime(isBestLap: boolean, isFinish: boolean): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.compressor) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = isFinish ? [660, 880, 1100, 1320] : isBestLap ? [740, 988, 1318] : [660, 880];
    notes.forEach((freq, idx) => {
      const t = now + idx * 0.075;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  public playPitWheelGun(): void {
    if (!this.canEmitOneShot() || !this.ctx || !this.dryBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.linearRampToValueAtTime(1480, now + 0.06);
    osc.frequency.setValueAtTime(1260, now + 0.12);
    g.gain.setValueAtTime(0.09, now);
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
    [587.3, 880].forEach((freq, idx) => {
      const t = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
      osc.connect(g);
      g.connect(this.compressor!);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  public update(input: SoundUpdateInput): EngineAcousticState {
    if (input.carClass !== this.lastClass) {
      this.lastClass = input.carClass;
      this.mem = createEngineMemory(input.carClass);
    }

    const acoustic = computeEngineAcoustics(input, this.mem);
    this.mem = acoustic.memory;

    if (!this.ctx || !this.isInitialized) return acoustic;
    const now = this.ctx.currentTime;

    if (!input.active || this.tabHidden || getAudioSettings().muted) {
      this.silence();
      return acoustic;
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
    });

    // Apply class harmonics & frequencies smoothly
    this.safeSetTarget(this.oscA?.frequency, acoustic.fundamentalHz * prof.harmonics[0], now, 0.016);
    this.safeSetTarget(this.oscB?.frequency, acoustic.fundamentalHz * prof.harmonics[1], now, 0.016);
    this.safeSetTarget(this.oscC?.frequency, acoustic.fundamentalHz * prof.harmonics[2], now, 0.016);
    this.safeSetTarget(this.oscGainA?.gain, prof.harmonicGains[0], now, 0.04);
    this.safeSetTarget(this.oscGainB?.gain, prof.harmonicGains[1], now, 0.04);
    this.safeSetTarget(this.oscGainC?.gain, prof.harmonicGains[2], now, 0.04);

    this.safeSetTarget(this.engineLowpass?.frequency, mix.engineFilterHz, now, 0.025);
    this.safeSetTarget(this.engineFormant?.frequency, mix.formantHz, now, 0.025);
    this.safeSetTarget(this.engineFormant?.Q, prof.formantQ, now, 0.04);

    const inShiftDip = performance.now() < this.shiftDipUntil;
    this.safeSetTarget(this.engineOutGain?.gain, inShiftDip ? 0.05 : mix.engineGain, now, 0.02);

    this.safeSetTarget(this.turboOsc?.frequency, mix.turboHz, now, 0.03);
    this.safeSetTarget(this.turboGain?.gain, mix.turboGain, now, 0.03);

    this.safeSetTarget(this.whineOsc?.frequency, mix.gearWhineHz, now, 0.025);
    this.safeSetTarget(this.whineGain?.gain, mix.gearWhineGain, now, 0.03);

    this.safeSetTarget(this.tireBand1?.frequency, mix.tireSquealHz, now, 0.025);
    this.safeSetTarget(this.tireBand2?.frequency, mix.tireSquealHz * 1.54, now, 0.025);
    this.safeSetTarget(this.tireGain?.gain, mix.tireSquealGain, now, 0.03);

    this.safeSetTarget(this.windBand?.frequency, mix.windHz, now, 0.04);
    this.safeSetTarget(this.windGain?.gain, mix.windGain, now, 0.045);

    this.safeSetTarget(this.curbLfo?.frequency, mix.curbModHz, now, 0.02);
    this.safeSetTarget(this.curbLfoGain?.gain, 0.45, now, 0.02);
    this.safeSetTarget(this.curbAmpNode?.gain, 0.55, now, 0.02);
    this.safeSetTarget(this.curbOutGain?.gain, mix.curbGain, now, 0.025);

    this.safeSetTarget(this.offroadBand?.frequency, mix.offroadHz, now, 0.03);
    this.safeSetTarget(this.offroadGain?.gain, mix.offroadGain, now, 0.03);

    this.safeSetTarget(this.tunnelOutGain?.gain, mix.tunnelWetGain, now, 0.06);

    // One-shot automatic triggers
    if (acoustic.shiftEvent) {
      this.triggerGearShift(acoustic.shiftEvent, input.carClass);
    }
    if (acoustic.triggerBov) {
      this.triggerTurboBlowOff(acoustic.boostLevel);
    } else if (acoustic.triggerLiftPop) {
      this.triggerExhaustPop(input.carClass === 'rally' ? 0.85 : 0.6, input.carClass);
    }

    return acoustic;
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
  }
}

export const carSoundEngine = new CarSoundEngine();
