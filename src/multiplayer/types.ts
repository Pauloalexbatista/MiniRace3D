import type { CarClass } from '../components/Car3D';
import type { SpeedPreset } from '../physics';
import type { SavedCircuit } from '../tracks';

export type CarCategory = 'f1' | 'gt' | 'rally' | 'drift' | 'open';
export type RoomStatus = 'lobby' | 'loading' | 'countdown' | 'racing' | 'finished';
export type EnvironmentTheme = 'day' | 'sunset' | 'night';

export interface DriverProfile {
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
}

export interface RoomPlayerInfo {
  id: string;
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
  isReady: boolean;
  sceneReady: boolean;
  connected: boolean;
  gridSlot: number;
  voiceJoined?: boolean;
  voiceMuted?: boolean;
}

export type OnlinePlayerStatus = 'home' | 'lobby' | 'in_room' | 'racing';

export interface OnlinePlayerInfo {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  carClass: CarClass;
  status: OnlinePlayerStatus;
  roomCode: string | null;
  roomName: string | null;
  connectedAt: number;
}

export interface ChatMessage {
  id: string;
  scope: 'lobby' | 'room';
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestampMs: number;
  isSystem?: boolean;
}

export interface RoomInviteNotification {
  fromId: string;
  fromName: string;
  roomCode: string;
  roomName: string;
  circuitName: string;
  carCategory: CarCategory;
  sentAtMs: number;
}

export type VoiceServerEvent =
  | { type: 'voice_peer_joined'; peerId: string; name: string; muted: boolean }
  | { type: 'voice_peer_left'; peerId: string }
  | { type: 'voice_peer_muted'; peerId: string; muted: boolean }
  | {
      type: 'voice_signal';
      fromId: string;
      signalType: 'offer' | 'answer' | 'ice';
      data: unknown;
    };

export interface AiRacerConfig {
  id: string;
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
  gridSlot: number;
  skill: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  hostName: string;
  carCategory: CarCategory;
  circuitId: string;
  circuitName: string;
  circuitLengthM: number;
  totalLaps: number;
  speedPreset: SpeedPreset;
  environmentTheme: EnvironmentTheme;
  aiCount: number;
  humanCount: number;
  maxHumans: number;
  status: RoomStatus;
  createdAt: number;
}

export interface RoomDetail {
  code: string;
  name: string;
  hostId: string;
  carCategory: CarCategory;
  circuitId: string;
  circuitName: string;
  circuitLengthM: number;
  totalLaps: number;
  speedPreset: SpeedPreset;
  environmentTheme: EnvironmentTheme;
  aiCount: number;
  maxHumans: number;
  status: RoomStatus;
  players: RoomPlayerInfo[];
  connectedHumans: number;
  aiRacers: AiRacerConfig[];
  createdAt: number;
}

export interface NetCarState {
  id: string;
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
  steer: number;
  speedKmh: number;
  wheelRoll: number;
  braking?: boolean;
  headlights?: boolean;
  lapNumber: number;
  completedLaps: number;
  trackS: number;
  raceProgress: number;
  surface: string;
  engineHealth: number;
  tireHealth: number;
  inPit: boolean;
  bestLapMs: number | null;
  lastLapMs: number | null;
  finished: boolean;
  finishTimeMs: number | null;
  isAi?: boolean;
  timestampMs?: number;
}

export interface LocalCarNetSample {
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
  steer: number;
  speedKmh: number;
  wheelRoll: number;
  braking?: boolean;
  headlights?: boolean;
  lapNumber: number;
  completedLaps: number;
  trackS: number;
  raceProgress: number;
  surface: string;
  engineHealth: number;
  tireHealth: number;
  inPit: boolean;
  bestLapMs: number | null;
  lastLapMs: number | null;
  finished: boolean;
  finishTimeMs: number | null;
}

export interface RaceStandingEntry {
  id: string;
  name: string;
  isAi: boolean;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
  gridSlot: number;
  position: number;
  lapNumber: number;
  completedLaps: number;
  totalLaps: number;
  raceProgress: number;
  speedKmh: number;
  inPit: boolean;
  engineHealth: number;
  tireHealth: number;
  finished: boolean;
  finishTimeMs: number | null;
  bestLapMs: number | null;
  lastLapMs: number | null;
  connected: boolean;
  gapToLeaderM: number;
}

export interface RemoteCarBufferEntry {
  prev: NetCarState;
  curr: NetCarState;
  receivedAtMs: number;
  prevReceivedAtMs: number;
}

export interface ReadyProgressInfo {
  readyCount: number;
  totalHumans: number;
  readyIds: string[];
}

export interface CountdownSyncInfo {
  countdownStartLocalMs: number;
  raceGoLocalMs: number;
}

export interface CarCategoryMeta {
  id: CarCategory;
  label: string;
  shortLabel: string;
  emoji: string;
  desc: string;
  badgeColor: string;
}

export const CAR_CATEGORY_META: Record<CarCategory, CarCategoryMeta> = {
  f1: {
    id: 'f1',
    label: 'Fórmula 1',
    shortLabel: 'F1',
    emoji: '🏎️',
    desc: 'Monolugares de alta carga aerodinâmica, travagem extrema e curva sobre carris.',
    badgeColor: '#e11d48',
  },
  gt: {
    id: 'gt',
    label: 'GT Racing',
    shortLabel: 'GT3',
    emoji: '🏁',
    desc: 'Superdesportivos GT3 equilibrados para disputas roda a roda.',
    badgeColor: '#2563eb',
  },
  rally: {
    id: 'rally',
    label: 'Rally WRC',
    shortLabel: 'Rally',
    emoji: '🌲',
    desc: 'Suspensão longa, tração agressiva fora de pista e controlo em deriva.',
    badgeColor: '#f59e0b',
  },
  drift: {
    id: 'drift',
    label: 'Drift Pro',
    shortLabel: 'Drift',
    emoji: '🔥',
    desc: 'Traseira solta, ângulos largos de deriva e contra-brecagem contínua.',
    badgeColor: '#8b5cf6',
  },
  open: {
    id: 'open',
    label: 'Classe Livre (Mista)',
    shortLabel: 'Misto',
    emoji: '⚡',
    desc: 'Cada piloto escolhe livremente entre F1, GT, Rally ou Drift na garagem.',
    badgeColor: '#10b981',
  },
};

export interface LiveryPreset {
  name: string;
  primaryColor: string;
  secondaryColor: string;
}

export const LIVERY_PRESETS: LiveryPreset[] = [
  { name: 'Scuderia Rosso', primaryColor: '#e11d48', secondaryColor: '#f8fafc' },
  { name: 'Azul Racing', primaryColor: '#2563eb', secondaryColor: '#f8fafc' },
  { name: 'Papaya GP', primaryColor: '#f97316', secondaryColor: '#0f172a' },
  { name: 'Verde Britânico', primaryColor: '#059669', secondaryColor: '#bef264' },
  { name: 'Prata Petronas', primaryColor: '#334155', secondaryColor: '#2dd4bf' },
  { name: 'Roxo Drift', primaryColor: '#8b5cf6', secondaryColor: '#fbbf24' },
  { name: 'Ouro WRC', primaryColor: '#eab308', secondaryColor: '#0f172a' },
  { name: 'Branco Gulf', primaryColor: '#f8fafc', secondaryColor: '#0284c7' },
];

export type { SavedCircuit, CarClass, SpeedPreset };
