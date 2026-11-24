import { SurfaceType } from './physics';

export type PitStopStatus = 'none' | 'slow_down' | 'repairing' | 'done' | 'full';
export type RaceStartPhase = 'ready' | 'lights' | 'green' | 'racing';

export interface TelemetryData {
  speedKmh: number;
  gear: number;
  rpmNorm: number;
  throttle: number;
  brake: number;
  steer: number;
  headlightsOn: boolean;
  isBraking: boolean;
  surface: SurfaceType;
  surfacePenaltyPct: number;
  engineHealth: number;
  tireHealth: number;
  inPitLane: boolean;
  inPitBoxZone: boolean;
  pitStopProgress: number;
  pitStopRemainingSec: number;
  pitStopStatus: PitStopStatus;
  raceStartPhase: RaceStartPhase;
  startLightsLit: number;
  recoveryNotice: boolean;
  isFlipped: boolean;
  lapNumber: number;
  lapTimeMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  isElectric: boolean;
  batteryPct: number;
  attackModeRemainingSec: number;
  isRegenerating: boolean;
  isCharging: boolean;
  isDrafting: boolean;
}

export const DEFAULT_TELEMETRY: TelemetryData = {
  speedKmh: 0,
  gear: 0,
  rpmNorm: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  headlightsOn: true,
  isBraking: false,
  surface: 'TRACK',
  surfacePenaltyPct: 0,
  engineHealth: 100,
  tireHealth: 100,
  inPitLane: false,
  inPitBoxZone: false,
  pitStopProgress: 0,
  pitStopRemainingSec: 0,
  pitStopStatus: 'none',
  raceStartPhase: 'ready',
  startLightsLit: 0,
  recoveryNotice: false,
  isFlipped: false,
  lapNumber: 1,
  lapTimeMs: 0,
  bestLapMs: null,
  lastLapMs: null,
  isElectric: false,
  batteryPct: 100,
  attackModeRemainingSec: 0,
  isRegenerating: false,
  isCharging: false,
  isDrafting: false,
};

let currentTelemetry: TelemetryData = { ...DEFAULT_TELEMETRY };
const listeners = new Set<() => void>();
let startCountdownHandler: (() => void) | null = null;

export function registerStartCountdownHandler(fn: (() => void) | null): void {
  startCountdownHandler = fn;
}

export function requestStartCountdown(): void {
  startCountdownHandler?.();
}

export function publishTelemetry(next: TelemetryData): void {
  currentTelemetry = next;
  listeners.forEach((l) => l());
}

export function getTelemetry(): TelemetryData {
  return currentTelemetry;
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
