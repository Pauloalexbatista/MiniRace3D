import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import {
  ArrowLeft,
  CheckCircle2,
  Compass,
  Copy,
  Crown,
  Eye,
  Flag,
  Gamepad2,
  Headphones,
  Home,
  Lightbulb,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  RotateCcw,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Track3D } from '../components/Track3D';
import { Scenery3D } from '../components/Scenery3D';
import { Environment3D } from '../components/Environment3D';
import { HUD } from '../components/HUD';
import { PodiumOverlay } from '../components/PodiumOverlay';
import { RaceMinimap, MinimapDriverDot } from '../components/RaceMinimap';
import { RemoteCar3D } from '../components/RemoteCar3D';
import { AIRacerManager } from '../components/AIRacerManager';
import { GamepadSettingsModal } from '../components/GamepadSettingsModal';
import { LobbyChatBox, RoomCommsPanel } from '../components/RoomCommsPanel';
import { InRaceCommsOverlay } from '../components/InRaceCommsOverlay';
import {
  CAR_CLASS_DEFAULTS,
  CarTuning,
  RapierCarController,
} from '../components/RapierCarController';
import { CarGaragePanel, clampTuningToClass } from '../components/CarGaragePanel';
import { getGamepadStatus, subscribeGamepadStatus } from '../gamepadInput';
import { useRoomVoice } from '../multiplayer/useRoomVoice';
import {
  carSoundEngine,
  ListenerAudioPose,
  NearbyCarAudioSample,
} from '../soundEngine';
import {
  computeGridSlotPose,
  computeSpline,
  createDefaultCircuit,
  fuseAndComputePitLane,
  RoadBranch,
  SavedCircuit,
  SceneryPatch,
  SplineNode,
} from '../tracks';
import {
  AiRacerConfig,
  CAR_CATEGORY_META,
  CarCategory,
  CarClass,
  CountdownSyncInfo,
  DriverProfile,
  EnvironmentTheme,
  LocalCarNetSample,
  NetCarState,
  RaceStandingEntry,
  RoomPlayerInfo,
  SpeedPreset,
} from '../multiplayer/types';
import type { useRaceClient } from '../multiplayer/useRaceClient';

const PROFILE_STORAGE_KEY = 'minirace3d_driver_profile';
const TUNINGS_STORAGE_KEY = 'minirace3d_race_tunings';
const SAVED_CIRCUITS_STORAGE_KEY = 'minirace3d_saved_circuits';
const VALID_CAR_CLASSES: CarClass[] = ['f1', 'fe', 'gt', 'rally', 'drift'];
const EMPTY_PATCHES: SceneryPatch[] = [];
const EMPTY_BRANCHES: RoadBranch[] = [];
const EMPTY_ROOM_PLAYERS: RoomPlayerInfo[] = [];
const PHYSICS_GRAVITY: [number, number, number] = [0, -24, 0];
const SAFETY_FLOOR_ARGS: [number, number, number] = [10000, 1, 10000];

const SOLO_AI_TEMPLATES = [
  { name: 'M. Verstappen', primaryColor: '#1e3a8a', secondaryColor: '#ef4444' },
  { name: 'L. Hamilton', primaryColor: '#111827', secondaryColor: '#10b981' },
  { name: 'C. Leclerc', primaryColor: '#dc2626', secondaryColor: '#f8fafc' },
  { name: 'L. Norris', primaryColor: '#f97316', secondaryColor: '#0f172a' },
  { name: 'F. Alonso', primaryColor: '#065f46', secondaryColor: '#bef264' },
  { name: 'A. Félix', primaryColor: '#0284c7', secondaryColor: '#facc15' },
  { name: 'F. Mortara', primaryColor: '#7c3aed', secondaryColor: '#f8fafc' },
  { name: 'S. Loeb', primaryColor: '#b91c1c', secondaryColor: '#fbbf24' },
  { name: 'K. Takahashi', primaryColor: '#facc15', secondaryColor: '#090d16' },
  { name: 'O. Piastri', primaryColor: '#ea580c', secondaryColor: '#38bdf8' },
  { name: 'G. Russell', primaryColor: '#0f766e', secondaryColor: '#cbd5e1' },
];

interface CircuitOption {
  circuit: SavedCircuit;
  lengthM: number;
  hasPit: boolean;
}

interface SoloRaceSession {
  id: string;
  status: 'garage' | 'racing' | 'finished';
  isReady: boolean;
  circuit: SavedCircuit;
  carCategory: CarCategory;
  totalLaps: number;
  speedPreset: SpeedPreset;
  environmentTheme: EnvironmentTheme;
  aiCount: number;
  aiRacers: AiRacerConfig[];
  driverId: string;
  driverProfile: DriverProfile;
  gridSlot: number;
}

export interface RaceModeProps {
  raceClient: ReturnType<typeof useRaceClient>;
  initialRoomCode?: string | null;
  onClearInitialRoomCode?: () => void;
  onBackToHome: () => void;
  onGoToEditor: () => void;
}

function loadInitialProfile(): DriverProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        name: String(parsed.name || 'Piloto').slice(0, 20),
        carClass: VALID_CAR_CLASSES.includes(parsed.carClass) ? parsed.carClass : 'f1',
        primaryColor: typeof parsed.primaryColor === 'string' ? parsed.primaryColor : '#e11d48',
        secondaryColor: typeof parsed.secondaryColor === 'string' ? parsed.secondaryColor : '#f8fafc',
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return {
    name: `Piloto ${Math.floor(10 + Math.random() * 89)}`,
    carClass: 'f1',
    primaryColor: '#e11d48',
    secondaryColor: '#f8fafc',
  };
}

function loadInitialTunings(profile: DriverProfile): Record<CarClass, CarTuning> {
  const out: Record<CarClass, CarTuning> = {
    f1: { ...CAR_CLASS_DEFAULTS.f1, primaryColor: profile.primaryColor, secondaryColor: profile.secondaryColor },
    fe: { ...CAR_CLASS_DEFAULTS.fe, primaryColor: profile.primaryColor, secondaryColor: profile.secondaryColor },
    gt: { ...CAR_CLASS_DEFAULTS.gt, primaryColor: profile.primaryColor, secondaryColor: profile.secondaryColor },
    rally: { ...CAR_CLASS_DEFAULTS.rally, primaryColor: profile.primaryColor, secondaryColor: profile.secondaryColor },
    drift: { ...CAR_CLASS_DEFAULTS.drift, primaryColor: profile.primaryColor, secondaryColor: profile.secondaryColor },
  };
  try {
    const raw = localStorage.getItem(TUNINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const cls of VALID_CAR_CLASSES) {
        if (parsed && parsed[cls]) {
          out[cls] = clampTuningToClass(cls, {
            ...out[cls],
            ...parsed[cls],
            primaryColor: profile.primaryColor,
            secondaryColor: profile.secondaryColor,
          });
        }
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return out;
}

function buildSoloAiRacers(carCategory: CarCategory, aiCount: number): AiRacerConfig[] {
  const botCount = Math.max(0, Math.min(11, aiCount));
  const bots: AiRacerConfig[] = [];
  for (let i = 0; i < botCount; i++) {
    const tpl = SOLO_AI_TEMPLATES[i % SOLO_AI_TEMPLATES.length];
    bots.push({
      id: `ai_${i + 1}`,
      name: tpl.name,
      carClass: carCategory !== 'open' ? carCategory : VALID_CAR_CLASSES[i % VALID_CAR_CLASSES.length],
      primaryColor: tpl.primaryColor,
      secondaryColor: tpl.secondaryColor,
      gridSlot: i + 1,
      skill: 0.92 + ((i * 7) % 10) * 0.012,
    });
  }
  return bots;
}

function computeCircuitOption(circuit: SavedCircuit): CircuitOption {
  const spline = computeSpline(circuit.controlPoints, circuit.isClosed ?? true);
  const lengthM = Math.round(spline[spline.length - 1]?.distFromStart || 0);
  const hasPit =
    Boolean(circuit.branches && circuit.branches.length > 0) ||
    Boolean(circuit.customPitNodes && circuit.customPitNodes.length >= 2);
  return { circuit, lengthM, hasPit };
}

const TrackMiniPreviewSvg: React.FC<{
  controlPoints: SplineNode[];
  isClosed?: boolean;
  width?: number;
  height?: number;
}> = React.memo(({ controlPoints, isClosed = true, width = 120, height = 84 }) => {
  const pathData = useMemo(() => {
    if (!controlPoints || controlPoints.length < 2) return '';
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of controlPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = 10;
    const spanX = Math.max(10, maxX - minX);
    const spanY = Math.max(10, maxY - minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;

    const pts = controlPoints.map((p) => [
      (width * 0.5 + (p.x - cx) * scale).toFixed(1),
      (height * 0.5 + (p.y - cy) * scale).toFixed(1),
    ]);
    return `M ${pts.map((pt) => pt.join(',')).join(' L ')}${isClosed ? ' Z' : ''}`;
  }, [controlPoints, isClosed, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        background: '#090d16',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0,
      }}
    >
      {pathData && (
        <>
          <path d={pathData} fill="none" stroke="rgba(56, 189, 248, 0.28)" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" />
          <path d={pathData} fill="none" stroke="#e2e8f0" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
});

export const RaceMode: React.FC<RaceModeProps> = ({
  raceClient,
  initialRoomCode,
  onClearInitialRoomCode,
  onBackToHome,
  onGoToEditor,
}) => {
  const { joinRoom, sendSceneReady, sendCarState, sendAiStates, updatePresence } = raceClient;
  const gamepadStatus = useSyncExternalStore(subscribeGamepadStatus, getGamepadStatus);
  const [gamepadModalOpen, setGamepadModalOpen] = useState<boolean>(false);
  const [inRaceChatOpen, setInRaceChatOpen] = useState<boolean>(false);
  const [unreadRoomMsgs, setUnreadRoomMsgs] = useState<number>(0);
  const prevRoomMsgCountRef = useRef<number>(0);
  const hasGamepad = Boolean(gamepadStatus.activePad);

  const [circuits, setCircuits] = useState<CircuitOption[]>([]);
  const [localOnlyCircuits, setLocalOnlyCircuits] = useState<SavedCircuit[]>([]);
  const [isSyncingCircuits, setIsSyncingCircuits] = useState<boolean>(false);
  const [driverProfile, setDriverProfile] = useState<DriverProfile>(loadInitialProfile);
  const [raceTunings, setRaceTunings] = useState<Record<CarClass, CarTuning>>(() =>
    loadInitialTunings(loadInitialProfile())
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Room creation form state
  const [roomNameInput, setRoomNameInput] = useState<string>('Grande Prémio MiniRace');
  const [createCategory, setCreateCategory] = useState<CarCategory>('f1');
  const [createCircuitId, setCreateCircuitId] = useState<string>('');
  const [createLaps, setCreateLaps] = useState<number>(3);
  const [createSpeedPreset, setCreateSpeedPreset] = useState<SpeedPreset>('sport');
  const [createAiCount, setCreateAiCount] = useState<number>(5);
  const [createEnvTheme, setCreateEnvTheme] = useState<EnvironmentTheme>('day');
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');

  // Solo race state
  const [soloSession, setSoloSession] = useState<SoloRaceSession | null>(null);
  const [soloCountdownSync, setSoloCountdownSync] = useState<CountdownSyncInfo | null>(null);
  const [soloStandings, setSoloStandings] = useState<RaceStandingEntry[]>([]);
  const [soloFinished, setSoloFinished] = useState<boolean>(false);

  // Active 3D Race UI & Sync state
  const [cameraMode, setCameraMode] = useState<'chase' | 'cockpit' | 'orbit'>('chase');
  const [headlightsOn, setHeadlightsOn] = useState<boolean>(true);
  const [recoverTrigger, setRecoverTrigger] = useState<number>(0);
  const [racePhase, setRacePhase] = useState<'loading' | 'ready' | 'lights' | 'green' | 'racing' | 'finished'>('loading');
  const [lightsLit, setLightsLit] = useState<number>(0);
  const [localSampleSnap, setLocalSampleSnap] = useState<{ finished: boolean; finishTimeMs: number | null }>({
    finished: false,
    finishTimeMs: null,
  });

  const localCarSampleRef = useRef<LocalCarNetSample | null>(null);
  const localFinishedRef = useRef<boolean>(false);
  const hostAiStatesRef = useRef<NetCarState[]>([]);
  const soloAiFinishOrderRef = useRef<Map<string, number>>(new Map());
  const soloFinishCounterRef = useRef<number>(0);
  const soloFinishTimerRef = useRef<number | null>(null);
  const soloLastStandingsEmitRef = useRef<number>(0);
  const lastSoloOnlyKeyRef = useRef<string>('');
  const minimapDotsRef = useRef<MinimapDriverDot[]>([]);
  const autoJoinedCodeRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // Persist driver profile & per-class tunings locally
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(driverProfile));
    } catch {
      // Ignore storage write errors
    }
  }, [driverProfile]);

  // Sync live player presence (name, car, colors) to the server lobby
  useEffect(() => {
    const timer = window.setTimeout(() => {
      updatePresence({
        name: driverProfile.name,
        carClass: driverProfile.carClass,
        primaryColor: driverProfile.primaryColor,
        secondaryColor: driverProfile.secondaryColor,
        screen: 'lobby',
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [driverProfile, updatePresence]);

  useEffect(() => {
    try {
      localStorage.setItem(TUNINGS_STORAGE_KEY, JSON.stringify(raceTunings));
    } catch {
      // Ignore storage write errors
    }
  }, [raceTunings]);

  // Load saved circuits from server disk + localStorage fallback
  const loadCircuits = useCallback(async (isCancelled?: () => boolean) => {
    const mergedMap = new Map<string, SavedCircuit>();
    let apiOk = false;

    try {
      const res = await fetch('/api/circuits');
      if (res.ok) {
        const diskList: SavedCircuit[] = await res.json();
        if (Array.isArray(diskList)) {
          apiOk = true;
          diskList.forEach((c) => {
            if (c.controlPoints && c.controlPoints.length >= 3) {
              const key = (c.name || c.id || '').trim().toLowerCase();
              if (key) mergedMap.set(key, c);
            }
          });
        }
      }
    } catch {
      // Fallback below
    }

    const localOnly: SavedCircuit[] = [];
    try {
      const rawLocal = localStorage.getItem(SAVED_CIRCUITS_STORAGE_KEY);
      if (rawLocal) {
        const localList: SavedCircuit[] = JSON.parse(rawLocal);
        if (Array.isArray(localList)) {
          localList.forEach((c) => {
            const key = (c.name || c.id || '').trim().toLowerCase();
            if (key && !mergedMap.has(key) && c.controlPoints && c.controlPoints.length >= 3) {
              mergedMap.set(key, c);
              if (apiOk) {
                localOnly.push(c);
              }
            }
          });
        }
      }
    } catch {
      // Ignore invalid localStorage
    }

    if (mergedMap.size === 0) {
      const fallbackPts = createDefaultCircuit();
      const defaultCirc: SavedCircuit = {
        id: 'circuito_padrao',
        name: 'Circuito MiniRace GP',
        controlPoints: fallbackPts,
        isClosed: true,
        savedAt: Date.now(),
      };
      mergedMap.set('padrao', defaultCirc);
    }

    const opts = Array.from(mergedMap.values())
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .map(computeCircuitOption);

    if (!isCancelled?.()) {
      setLocalOnlyCircuits(apiOk ? localOnly : []);
      setCircuits(opts);
      setCreateCircuitId((prev) => prev || opts[0]?.circuit.id || '');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCircuits(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadCircuits]);

  const handleSyncLocalCircuitsToServer = useCallback(async () => {
    if (isSyncingCircuits || localOnlyCircuits.length === 0) return;
    setIsSyncingCircuits(true);
    try {
      const prepared: SavedCircuit[] = [];
      for (const c of localOnlyCircuits) {
        let finalMapUrl = c.mapImageUrl || null;
        if (finalMapUrl && finalMapUrl.startsWith('data:image')) {
          try {
            const uploadRes = await fetch('/api/upload-map', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataUrl: finalMapUrl, fileName: c.name || 'map' }),
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData?.url) finalMapUrl = String(uploadData.url);
            }
          } catch {
            // Manter URL original se upload falhar
          }
        }
        prepared.push({ ...c, mapImageUrl: finalMapUrl });
      }

      let ok = false;
      let savedCount = 0;
      const bulkRes = await fetch('/api/circuits/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuits: prepared }),
      });
      if (bulkRes.ok) {
        const data = await bulkRes.json();
        ok = true;
        savedCount = Number.isFinite(Number(data?.savedCount)) ? Number(data.savedCount) : prepared.length;
      } else if (bulkRes.status === 404) {
        for (const item of prepared) {
          try {
            const r = await fetch('/api/circuits', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            });
            if (r.ok) savedCount++;
          } catch {
            // Continuar com os restantes
          }
        }
        ok = savedCount > 0;
      }

      if (ok && savedCount > 0) {
        await loadCircuits();
        showToast(
          `✓ ${savedCount} ${savedCount === 1 ? 'pista publicada' : 'pistas publicadas'} online para todos!`
        );
      } else {
        showToast('⚠️ Falha ao publicar pistas para o servidor.');
      }
    } catch {
      showToast('⚠️ Falha ao publicar pistas para o servidor.');
    } finally {
      setIsSyncingCircuits(false);
    }
  }, [isSyncingCircuits, localOnlyCircuits, loadCircuits, showToast]);

  // Auto-join invite code (?room=CODE)
  useEffect(() => {
    if (
      initialRoomCode &&
      raceClient.connectionState === 'connected' &&
      !raceClient.currentRoom &&
      !soloSession &&
      autoJoinedCodeRef.current !== initialRoomCode
    ) {
      autoJoinedCodeRef.current = initialRoomCode;
      joinRoom(initialRoomCode, driverProfile);
      onClearInitialRoomCode?.();
    }
  }, [initialRoomCode, raceClient.connectionState, raceClient.currentRoom, soloSession, driverProfile, joinRoom, onClearInitialRoomCode]);

  const currentRoom = raceClient.currentRoom;
  const isOnlineRacing = Boolean(currentRoom && currentRoom.status !== 'lobby');
  const isSoloRacing = Boolean(soloSession && soloSession.status !== 'garage');
  const isSoloGarage = Boolean(soloSession && soloSession.status === 'garage');
  const isActiveRace = isOnlineRacing || isSoloRacing;

  const roomVoice = useRoomVoice({
    raceClient,
    roomCode: currentRoom?.code ?? null,
    selfId: raceClient.selfId,
    players: currentRoom?.players ?? EMPTY_ROOM_PLAYERS,
  });

  useEffect(() => {
    if (!isOnlineRacing) {
      setInRaceChatOpen(false);
      setUnreadRoomMsgs(0);
    }
  }, [isOnlineRacing]);

  useEffect(() => {
    const count = raceClient.roomMessages.length;
    if (isOnlineRacing && !inRaceChatOpen && count > prevRoomMsgCountRef.current) {
      setUnreadRoomMsgs((prev) => prev + (count - prevRoomMsgCountRef.current));
    }
    prevRoomMsgCountRef.current = count;
  }, [raceClient.roomMessages.length, isOnlineRacing, inRaceChatOpen]);

  useEffect(() => {
    if (inRaceChatOpen) {
      setUnreadRoomMsgs(0);
    }
  }, [inRaceChatOpen]);

  const isHost = Boolean(currentRoom && raceClient.selfId && currentRoom.hostId === raceClient.selfId);
  const myDriverId = isSoloRacing
    ? soloSession!.driverId
    : raceClient.selfId || 'local';

  // Active race parameters resolved cleanly for Online OR Solo
  const activeRaceCircuit: SavedCircuit | null = useMemo(() => {
    if (isSoloRacing && soloSession) return soloSession.circuit;
    if (isOnlineRacing && raceClient.activeCircuit) return raceClient.activeCircuit;
    return null;
  }, [isSoloRacing, soloSession, isOnlineRacing, raceClient.activeCircuit]);

  const activeTotalLaps = isSoloRacing
    ? soloSession!.totalLaps
    : currentRoom?.totalLaps || 3;

  const activeSpeedPreset: SpeedPreset = isSoloRacing
    ? soloSession!.speedPreset
    : currentRoom?.speedPreset || 'sport';

  const activeEnvTheme: EnvironmentTheme = isSoloRacing
    ? soloSession!.environmentTheme
    : currentRoom?.environmentTheme || 'day';

  const activeCarCategory: CarCategory = isSoloRacing
    ? soloSession!.carCategory
    : currentRoom?.carCategory || 'open';

  const activeAiRacers: AiRacerConfig[] = isSoloRacing
    ? soloSession!.aiRacers
    : raceClient.aiRacers;

  const myPlayerOnline = currentRoom?.players.find((p) => p.id === raceClient.selfId) || null;
  const myGridSlot = isSoloRacing
    ? soloSession!.gridSlot
    : myPlayerOnline?.gridSlot ?? 0;

  const myCarClass: CarClass = isSoloRacing
    ? soloSession!.driverProfile.carClass
    : myPlayerOnline?.carClass || (activeCarCategory !== 'open' ? activeCarCategory : driverProfile.carClass);

  const myPrimaryColor = isSoloRacing
    ? soloSession!.driverProfile.primaryColor
    : myPlayerOnline?.primaryColor || driverProfile.primaryColor;

  const mySecondaryColor = isSoloRacing
    ? soloSession!.driverProfile.secondaryColor
    : myPlayerOnline?.secondaryColor || driverProfile.secondaryColor;

  const myCarTuning: CarTuning = useMemo(() => {
    const baseTuning = raceTunings[myCarClass] || CAR_CLASS_DEFAULTS[myCarClass];
    return clampTuningToClass(myCarClass, {
      ...baseTuning,
      primaryColor: myPrimaryColor,
      secondaryColor: mySecondaryColor,
    });
  }, [raceTunings, myCarClass, myPrimaryColor, mySecondaryColor]);

  const currentSpline = useMemo(() => {
    if (!activeRaceCircuit?.controlPoints || activeRaceCircuit.controlPoints.length < 2) return [];
    return computeSpline(activeRaceCircuit.controlPoints, activeRaceCircuit.isClosed ?? true);
  }, [activeRaceCircuit]);

  const currentPitSpline = useMemo(() => {
    if (!activeRaceCircuit?.customPitNodes || activeRaceCircuit.customPitNodes.length < 2) return undefined;
    return fuseAndComputePitLane(activeRaceCircuit.controlPoints, activeRaceCircuit.customPitNodes, currentSpline);
  }, [activeRaceCircuit, currentSpline]);

  const { groundY, safetyFloorY } = useMemo(() => {
    let minZ = Infinity;
    for (const p of currentSpline) {
      if (p.z < minZ) minZ = p.z;
    }
    for (const br of activeRaceCircuit?.branches || []) {
      for (const bp of br.points || []) {
        const bz = bp.z ?? 0;
        if (bz < minZ) minZ = bz;
      }
    }
    if (!Number.isFinite(minZ)) minZ = 0;
    return {
      groundY: Math.min(-0.35, minZ - 0.35),
      safetyFloorY: Math.min(-2, minZ - 8),
    };
  }, [currentSpline, activeRaceCircuit?.branches]);

  const safetyFloorPos = useMemo<[number, number, number]>(() => [0, safetyFloorY - 1.0, 0], [safetyFloorY]);

  // Reset per-race local refs whenever a new race mounts
  useEffect(() => {
    if (!isActiveRace) {
      setRacePhase('loading');
      setLightsLit(0);
      localFinishedRef.current = false;
      setLocalSampleSnap({ finished: false, finishTimeMs: null });
      localCarSampleRef.current = null;
      hostAiStatesRef.current = [];
      minimapDotsRef.current = [];
      return;
    }
    setCameraMode('chase');
    setRacePhase('loading');
    setLightsLit(0);
    localFinishedRef.current = false;
    setLocalSampleSnap({ finished: false, finishTimeMs: null });
    localCarSampleRef.current = null;
    hostAiStatesRef.current = [];
    soloAiFinishOrderRef.current.clear();
    soloFinishCounterRef.current = 0;
    lastSoloOnlyKeyRef.current = '';
  }, [isActiveRace, activeRaceCircuit?.id]);

  // Synchronized countdown driver (shared by Online & Solo)
  const activeSync = isSoloRacing ? soloCountdownSync : raceClient.countdownSync;
  const isRaceFinished = isSoloRacing
    ? soloFinished
    : currentRoom?.status === 'finished';

  useEffect(() => {
    if (!isActiveRace) return;
    if (isRaceFinished) {
      setRacePhase('finished');
      setLightsLit(0);
      return;
    }
    if (!activeSync) {
      setRacePhase('loading');
      setLightsLit(0);
      return;
    }

    let rafId = 0;
    let lastPhase = '';
    let lastLit = -1;
    const setPhaseIfChanged = (phase: 'ready' | 'lights' | 'green' | 'racing', lit: number) => {
      if (phase !== lastPhase) {
        lastPhase = phase;
        setRacePhase(phase);
      }
      if (lit !== lastLit) {
        lastLit = lit;
        setLightsLit(lit);
      }
    };

    const tickCountdown = () => {
      const now = performance.now();
      const { countdownStartLocalMs, raceGoLocalMs } = activeSync;

      if (now < countdownStartLocalMs) {
        setPhaseIfChanged('ready', 0);
      } else if (now < raceGoLocalMs) {
        const elapsed = now - countdownStartLocalMs;
        const lit = elapsed >= 1800 ? 3 : elapsed >= 900 ? 2 : 1;
        setPhaseIfChanged('lights', lit);
      } else if (now < raceGoLocalMs + 1800) {
        setPhaseIfChanged('green', 0);
      } else {
        setPhaseIfChanged('racing', 0);
        return; // Countdown complete
      }
      rafId = window.requestAnimationFrame(tickCountdown);
    };

    rafId = window.requestAnimationFrame(tickCountdown);
    return () => window.cancelAnimationFrame(rafId);
  }, [isActiveRace, activeSync, isRaceFinished]);

  // Key 'C' camera switch, Key 'L' headlights toggle, Key 'T' in-race chat toggle
  const handleToggleHeadlights = useCallback(() => setHeadlightsOn((prev) => !prev), []);
  const handleCycleCamera = useCallback(
    () => setCameraMode((prev) => (prev === 'chase' ? 'cockpit' : prev === 'cockpit' ? 'orbit' : 'chase')),
    []
  );
  const handleNoopSpeedPreset = useCallback(() => {}, []);
  const handleRecoverCar = useCallback(() => setRecoverTrigger((prev) => prev + 1), []);

  useEffect(() => {
    if (!isActiveRace) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (e.code === 'KeyC' && !e.repeat) {
        handleCycleCamera();
      } else if (e.code === 'KeyL' && !e.repeat) {
        setHeadlightsOn((prev) => !prev);
      } else if (isOnlineRacing && e.code === 'KeyT' && !e.repeat) {
        e.preventDefault();
        setInRaceChatOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActiveRace, isOnlineRacing, handleCycleCamera]);

  const handleSceneReady = useCallback(() => {
    if (isSoloRacing) {
      const now = performance.now();
      setSoloCountdownSync({
        countdownStartLocalMs: now + 350,
        raceGoLocalMs: now + 3050,
      });
    } else {
      sendSceneReady();
    }
  }, [isSoloRacing, sendSceneReady]);

  const updateSoloStandingsIfDue = useCallback(
    (force = false) => {
      if (!soloSession) return;
      const now = performance.now();
      if (!force && now - soloLastStandingsEmitRef.current < 250) return;
      soloLastStandingsEmitRef.current = now;

      const localSample = localCarSampleRef.current;
      if (!force && soloSession.aiRacers.length === 0) {
        const key = `${localSample?.lapNumber ?? 1}:${localSample?.completedLaps ?? 0}:${Boolean(localSample?.inPit)}:${Boolean(localSample?.finished)}`;
        if (key === lastSoloOnlyKeyRef.current) return;
        lastSoloOnlyKeyRef.current = key;
      }
      const entries: Array<RaceStandingEntry & { _order: number }> = [];

      entries.push({
        id: soloSession.driverId,
        name: soloSession.driverProfile.name,
        isAi: false,
        carClass: soloSession.driverProfile.carClass,
        primaryColor: soloSession.driverProfile.primaryColor,
        secondaryColor: soloSession.driverProfile.secondaryColor,
        gridSlot: soloSession.gridSlot,
        position: 1,
        lapNumber: localSample?.lapNumber ?? 1,
        completedLaps: localSample?.completedLaps ?? 0,
        totalLaps: soloSession.totalLaps,
        raceProgress: localSample?.raceProgress ?? -6.9,
        speedKmh: localSample?.speedKmh ?? 0,
        inPit: Boolean(localSample?.inPit),
        engineHealth: Math.round(localSample?.engineHealth ?? 100),
        tireHealth: Math.round(localSample?.tireHealth ?? 100),
        finished: Boolean(localSample?.finished),
        finishTimeMs: localSample?.finishTimeMs ?? null,
        bestLapMs: localSample?.bestLapMs ?? null,
        lastLapMs: localSample?.lastLapMs ?? null,
        connected: true,
        gapToLeaderM: 0,
        _order: localSample?.finished ? 0 : Number.MAX_SAFE_INTEGER,
      });

      const aiMap = new Map<string, NetCarState>();
      for (const st of hostAiStatesRef.current) aiMap.set(st.id, st);

      for (const bot of soloSession.aiRacers) {
        const st = aiMap.get(bot.id);
        if (st?.finished && !soloAiFinishOrderRef.current.has(bot.id)) {
          soloAiFinishOrderRef.current.set(bot.id, ++soloFinishCounterRef.current);
        }
        entries.push({
          id: bot.id,
          name: bot.name,
          isAi: true,
          carClass: bot.carClass,
          primaryColor: bot.primaryColor,
          secondaryColor: bot.secondaryColor,
          gridSlot: bot.gridSlot,
          position: 0,
          lapNumber: st?.lapNumber ?? 1,
          completedLaps: st?.completedLaps ?? 0,
          totalLaps: soloSession.totalLaps,
          raceProgress: st?.raceProgress ?? -(4.5 + bot.gridSlot * 8 + 2.4),
          speedKmh: Math.round(st?.speedKmh ?? 0),
          inPit: Boolean(st?.inPit),
          engineHealth: 100,
          tireHealth: 100,
          finished: Boolean(st?.finished),
          finishTimeMs: st?.finishTimeMs ?? null,
          bestLapMs: st?.bestLapMs ?? null,
          lastLapMs: st?.lastLapMs ?? null,
          connected: true,
          gapToLeaderM: 0,
          _order: soloAiFinishOrderRef.current.get(bot.id) ?? Number.MAX_SAFE_INTEGER,
        });
      }

      entries.sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished && b.finished) {
          return (a.finishTimeMs ?? Infinity) - (b.finishTimeMs ?? Infinity);
        }
        if (Math.abs(b.raceProgress - a.raceProgress) > 0.05) {
          return b.raceProgress - a.raceProgress;
        }
        return a.gridSlot - b.gridSlot;
      });

      const leaderProg = entries[0]?.raceProgress ?? 0;
      const clean: RaceStandingEntry[] = entries.map((e, idx) => {
        const { _order, ...rest } = e;
        void _order;
        return {
          ...rest,
          position: idx + 1,
          gapToLeaderM: idx === 0 ? 0 : Math.max(0, Math.round(leaderProg - e.raceProgress)),
        };
      });
      setSoloStandings(clean);
    },
    [soloSession]
  );

  const handleLocalCarSample = useCallback(
    (sample: LocalCarNetSample) => {
      localCarSampleRef.current = sample;
      if (sample.finished && !localFinishedRef.current) {
        localFinishedRef.current = true;
        setLocalSampleSnap({ finished: true, finishTimeMs: sample.finishTimeMs });
        if (isSoloRacing && soloFinishTimerRef.current === null) {
          updateSoloStandingsIfDue(true);
          soloFinishTimerRef.current = window.setTimeout(() => {
            updateSoloStandingsIfDue(true);
            setSoloFinished(true);
          }, 1500);
        }
      }

      if (isSoloRacing) {
        updateSoloStandingsIfDue(false);
      } else {
        sendCarState(sample);
      }
    },
    [isSoloRacing, sendCarState, updateSoloStandingsIfDue]
  );

  const handleAiStatesUpdate = useCallback(
    (states: NetCarState[]) => {
      hostAiStatesRef.current = states;
      if (isSoloRacing) {
        updateSoloStandingsIfDue(false);
      } else if (isHost) {
        sendAiStates(states);
      }
    },
    [isSoloRacing, isHost, sendAiStates, updateSoloStandingsIfDue]
  );

  useEffect(() => {
    return () => {
      if (soloFinishTimerRef.current !== null) {
        window.clearTimeout(soloFinishTimerRef.current);
      }
    };
  }, []);

  const activeStandings: RaceStandingEntry[] = isSoloRacing
    ? soloStandings
    : isRaceFinished && raceClient.finalStandings
    ? raceClient.finalStandings
    : raceClient.standings;

  const prevStandingsRankMapRef = useRef<Record<string, number>>({});
  const standingsRankMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of activeStandings) {
      m[s.id] = s.position;
    }
    const prev = prevStandingsRankMapRef.current;
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(m);
    if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === m[k])) {
      return prev;
    }
    prevStandingsRankMapRef.current = m;
    return m;
  }, [activeStandings]);

  const standingsRankMapRef = useRef<Record<string, number>>(standingsRankMap);
  standingsRankMapRef.current = standingsRankMap;

  const standingsById = useMemo(() => {
    const m: Record<string, RaceStandingEntry> = {};
    for (const s of activeStandings) {
      m[s.id] = s;
    }
    return m;
  }, [activeStandings]);

  const { cachedGridPoses, cachedRemotePosesF1, cachedRemotePosesOther } = useMemo(() => {
    const isClosedFlag = activeRaceCircuit?.isClosed ?? true;
    const poses = Array.from({ length: 12 }, (_, slot) =>
      computeGridSlotPose(currentSpline, isClosedFlag, slot)
    );
    const f1Poses = poses.map((sp) => ({
      pos: [sp.x, sp.y + 0.04, sp.z] as [number, number, number],
      yaw: sp.yaw,
    }));
    const otherPoses = poses.map((sp) => ({
      pos: [sp.x, sp.y + 0.01, sp.z] as [number, number, number],
      yaw: sp.yaw,
    }));
    return {
      cachedGridPoses: poses,
      cachedRemotePosesF1: f1Poses,
      cachedRemotePosesOther: otherPoses,
    };
  }, [currentSpline, activeRaceCircuit?.isClosed]);

  // 60ms Minimap dots aggregation (updates ref directly, zero React re-renders!)
  useEffect(() => {
    if (!isActiveRace || currentSpline.length < 2) return;

    const timer = window.setInterval(() => {
      const rankMap = standingsRankMapRef.current;
      const dots: MinimapDriverDot[] = [];
      const nearbyCars: NearbyCarAudioSample[] = [];
      const localS = localCarSampleRef.current;
      const myFallback = cachedGridPoses[Math.max(0, Math.min(11, myGridSlot))] ?? cachedGridPoses[0];

      dots.push({
        id: myDriverId,
        x: localS ? localS.x : myFallback.x,
        z: localS ? localS.z : myFallback.z,
        color: myPrimaryColor,
        isMe: true,
        isAi: false,
        connected: true,
        finished: Boolean(localS?.finished),
        position: rankMap[myDriverId] || myGridSlot + 1,
      });

      if (isOnlineRacing && currentRoom) {
        for (const p of currentRoom.players) {
          if (p.id === myDriverId) continue;
          const remote = raceClient.remoteCarsRef.current.get(p.id)?.curr;
          const fallback = remote ?? cachedGridPoses[Math.max(0, Math.min(11, p.gridSlot))] ?? cachedGridPoses[0];
          dots.push({
            id: p.id,
            x: remote ? remote.x : fallback.x,
            z: remote ? remote.z : fallback.z,
            color: p.primaryColor,
            isMe: false,
            isAi: false,
            connected: p.connected,
            finished: Boolean(remote?.finished),
            position: rankMap[p.id] || p.gridSlot + 1,
          });
          if (p.connected && remote) {
            nearbyCars.push({
              id: p.id,
              carClass: p.carClass,
              x: remote.x,
              y: remote.y,
              z: remote.z,
              vx: remote.vx,
              vy: remote.vy,
              vz: remote.vz,
              speedKmh: remote.speedKmh,
            });
          }
        }
      }

      const aiMap = new Map<string, NetCarState>();
      for (const st of hostAiStatesRef.current) aiMap.set(st.id, st);

      for (const bot of activeAiRacers) {
        const hostSt = isSoloRacing || isHost ? aiMap.get(bot.id) : undefined;
        const remoteSt = !hostSt ? raceClient.remoteCarsRef.current.get(bot.id)?.curr : undefined;
        const st = hostSt || remoteSt;
        const fallback = st ?? cachedGridPoses[Math.max(0, Math.min(11, bot.gridSlot))] ?? cachedGridPoses[0];
        dots.push({
          id: bot.id,
          x: st ? st.x : fallback.x,
          z: st ? st.z : fallback.z,
          color: bot.primaryColor,
          isMe: false,
          isAi: true,
          connected: true,
          finished: Boolean(st?.finished),
          position: rankMap[bot.id] || bot.gridSlot + 1,
        });
        if (st) {
          nearbyCars.push({
            id: bot.id,
            carClass: bot.carClass,
            x: st.x,
            y: st.y,
            z: st.z,
            vx: st.vx,
            vy: st.vy,
            vz: st.vz,
            speedKmh: st.speedKmh,
          });
        }
      }

      minimapDotsRef.current = dots;

      if (localS) {
        const listenerPose: ListenerAudioPose = {
          x: localS.x,
          y: localS.y,
          z: localS.z,
          vx: localS.vx,
          vy: localS.vy,
          vz: localS.vz,
          qx: localS.qx,
          qy: localS.qy,
          qz: localS.qz,
          qw: localS.qw,
        };
        carSoundEngine.updateNearbyCars(true, listenerPose, nearbyCars);
      } else {
        carSoundEngine.silenceNearbyCars();
      }
    }, 60);

    return () => {
      window.clearInterval(timer);
      carSoundEngine.silenceNearbyCars();
    };
  }, [
    isActiveRace,
    isOnlineRacing,
    isSoloRacing,
    isHost,
    currentRoom,
    activeRaceCircuit,
    currentSpline,
    cachedGridPoses,
    myDriverId,
    myGridSlot,
    myPrimaryColor,
    activeAiRacers,
    raceClient.remoteCarsRef,
  ]);

  const selectedCreateCircuit = useMemo(
    () => circuits.find((c) => c.circuit.id === createCircuitId) || circuits[0] || null,
    [circuits, createCircuitId]
  );

  const handleCreateOnlineRoom = () => {
    if (!selectedCreateCircuit) {
      showToast('⚠️ Nenhuma pista disponível. Cria uma no Editor primeiro!');
      return;
    }
    const effectiveCarClass: CarClass =
      createCategory !== 'open' ? createCategory : driverProfile.carClass;
    const nextProfile: DriverProfile = { ...driverProfile, carClass: effectiveCarClass };
    setDriverProfile(nextProfile);

    raceClient.createRoom({
      name: roomNameInput.trim() || `GP ${selectedCreateCircuit.circuit.name}`,
      carCategory: createCategory,
      circuitId: selectedCreateCircuit.circuit.id,
      circuitName: selectedCreateCircuit.circuit.name,
      circuitLengthM: selectedCreateCircuit.lengthM,
      circuitData: selectedCreateCircuit.circuit,
      totalLaps: createLaps,
      speedPreset: createSpeedPreset,
      environmentTheme: createEnvTheme,
      aiCount: createAiCount,
      profile: nextProfile,
    });
  };

  const handleOpenSoloGarage = () => {
    if (!selectedCreateCircuit) {
      showToast('⚠️ Nenhuma pista disponível.');
      return;
    }
    if (soloFinishTimerRef.current !== null) {
      window.clearTimeout(soloFinishTimerRef.current);
      soloFinishTimerRef.current = null;
    }

    const effectiveCarClass: CarClass =
      createCategory !== 'open' ? createCategory : driverProfile.carClass;
    const prof: DriverProfile = { ...driverProfile, carClass: effectiveCarClass };
    setDriverProfile(prof);

    setSoloFinished(false);
    setSoloCountdownSync(null);
    setSoloStandings([]);
    setSoloSession({
      id: `solo_${Date.now()}`,
      status: 'garage',
      isReady: false,
      circuit: selectedCreateCircuit.circuit,
      carCategory: createCategory,
      totalLaps: createLaps,
      speedPreset: createSpeedPreset,
      environmentTheme: createEnvTheme,
      aiCount: createAiCount,
      aiRacers: buildSoloAiRacers(createCategory, createAiCount),
      driverId: 'solo_player',
      driverProfile: prof,
      gridSlot: 0,
    });
  };

  const handleConfirmStartSoloRace = () => {
    setSoloFinished(false);
    setSoloCountdownSync(null);
    setSoloStandings([]);
    setSoloSession((prev) => (prev ? { ...prev, status: 'racing' } : null));
  };

  const handleLeaveActiveRace = () => {
    if (soloFinishTimerRef.current !== null) {
      window.clearTimeout(soloFinishTimerRef.current);
      soloFinishTimerRef.current = null;
    }
    if (soloSession) {
      setSoloSession(null);
      setSoloFinished(false);
      setSoloCountdownSync(null);
      setSoloStandings([]);
    } else {
      raceClient.leaveRoom();
    }
  };

  const gamepadTriggerButton = (
    <button
      type="button"
      onClick={() => setGamepadModalOpen(true)}
      title="Testar e configurar comando / volante"
      style={{
        background: hasGamepad ? 'rgba(16, 185, 129, 0.16)' : 'rgba(30, 41, 59, 0.88)',
        border: hasGamepad ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(255,255,255,0.16)',
        color: hasGamepad ? '#34d399' : '#cbd5e1',
        borderRadius: 9,
        padding: '6px 10px',
        fontSize: 11.5,
        fontWeight: 800,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Gamepad2 size={14} />
      <span>{hasGamepad ? 'Comando ON' : 'Comando'}</span>
    </button>
  );

  const pendingInviteBanner = raceClient.pendingInvite ? (
    <div
      style={{
        maxWidth: 1240,
        margin: '16px auto 0',
        padding: '0 20px',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.22), rgba(16, 185, 129, 0.16))',
          border: '1.5px solid #38bdf8',
          borderRadius: 14,
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          boxShadow: '0 10px 30px rgba(2, 132, 199, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>📩</span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: '#fff' }}>
              {raceClient.pendingInvite.fromName} convidou-te para correr em{' '}
              <span style={{ color: '#38bdf8' }}>{raceClient.pendingInvite.roomName}</span>!
            </div>
            <div style={{ fontSize: 11.5, color: '#cbd5e1', fontWeight: 700, marginTop: 2 }}>
              🏁 {raceClient.pendingInvite.circuitName} • Sala #{raceClient.pendingInvite.roomCode}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              const code = raceClient.pendingInvite?.roomCode;
              if (!code) return;
              if (soloSession) {
                setSoloSession(null);
                setSoloFinished(false);
                setSoloCountdownSync(null);
                setSoloStandings([]);
              }
              raceClient.joinRoom(code, driverProfile);
            }}
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff',
              border: '1px solid #34d399',
              borderRadius: 9,
              padding: '8px 15px',
              fontSize: 12.5,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            Entrar Agora
          </button>
          <button
            type="button"
            onClick={raceClient.dismissInvite}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 9,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Ignorar
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ============================================================================
  // VIEW 3: ACTIVE 3D RACE (ONLINE MULTIPLAYER OR SOLO)
  // ============================================================================
  if (isActiveRace && activeRaceCircuit && currentSpline.length >= 2) {
    const isClosed = activeRaceCircuit.isClosed ?? true;
    const isAiAuthority = isSoloRacing || isHost;
    const waitingText =
      racePhase === 'loading'
        ? isSoloRacing
          ? `⏳ A PREPARAR GRELHA (P${myGridSlot + 1})...`
          : `⏳ NA GRELHA (P${myGridSlot + 1}) — A AGUARDAR PILOTOS (${raceClient.readyProgress?.readyCount ?? 0}/${raceClient.readyProgress?.totalHumans ?? currentRoom?.connectedHumans ?? 1} PRONTOS)...`
        : null;

    const myStanding = standingsById[myDriverId];
    const finishBannerData =
      localSampleSnap.finished && !isRaceFinished
        ? {
            position: myStanding?.position || 1,
            finishTimeMs: localSampleSnap.finishTimeMs || myStanding?.finishTimeMs || 0,
            waitingOthers: !isSoloRacing,
            remainingSec: raceClient.finishDeadlineLocalMs
              ? Math.max(0, (raceClient.finishDeadlineLocalMs - performance.now()) / 1000)
              : null,
          }
        : null;

    const totalDriversCount = isSoloRacing
      ? 1 + activeAiRacers.length
      : (currentRoom?.players.filter((p) => p.connected).length || 1) + activeAiRacers.length;

    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#090d16' }}>
        {/* Host Migration / Toast Banner */}
        {(toastMsg || raceClient.hostNotice) && (
          <div style={{
            position: 'fixed',
            top: 62,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 950,
            background: 'rgba(15, 23, 42, 0.96)',
            color: '#facc15',
            border: '1px solid rgba(250, 204, 21, 0.5)',
            borderRadius: 10,
            padding: '8px 16px',
            fontWeight: 800,
            fontSize: 12.5,
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          }}>
            {toastMsg || raceClient.hostNotice}
          </div>
        )}

        {/* Clean Race Top Navbar */}
        <header style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 52,
          background: 'rgba(15, 23, 42, 0.94)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          zIndex: 100,
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleLeaveActiveRace}
              style={{
                background: 'rgba(239, 68, 68, 0.18)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 8,
                padding: '6px 11px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <LogOut size={13} />
              <span>Sair da Corrida</span>
            </button>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#fff', fontWeight: 900, fontSize: 13.5 }}>
                  {activeRaceCircuit.name}
                </span>
                <span style={{
                  background: isSoloRacing ? 'rgba(56, 189, 248, 0.2)' : 'rgba(244, 63, 94, 0.22)',
                  color: isSoloRacing ? '#7dd3fc' : '#fda4af',
                  fontSize: 10,
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 5,
                }}>
                  {isSoloRacing ? 'SOLO' : `SALA ${currentRoom?.code}`}
                </span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 700 }}>
                {CAR_CATEGORY_META[activeCarCategory]?.emoji} {CAR_CATEGORY_META[activeCarCategory]?.shortLabel} • {activeTotalLaps} {activeTotalLaps === 1 ? 'Volta' : 'Voltas'} • P{myGridSlot + 1} na Grelha
              </div>
            </div>
          </div>

          {/* Center: Camera Switch + Recover */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, background: 'rgba(2, 6, 23, 0.7)', padding: 3, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <button
                onClick={() => setCameraMode('chase')}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  border: cameraMode === 'chase' ? '1px solid #38bdf8' : 'none',
                  background: cameraMode === 'chase' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                  color: cameraMode === 'chase' ? '#ffffff' : '#94a3b8',
                }}
              >
                🏎️ 3ª Pessoa
              </button>
              <button
                onClick={() => setCameraMode('cockpit')}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  border: cameraMode === 'cockpit' ? '1px solid #38bdf8' : 'none',
                  background: cameraMode === 'cockpit' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                  color: cameraMode === 'cockpit' ? '#ffffff' : '#94a3b8',
                }}
              >
                👀 Onboard
              </button>
              <button
                onClick={() => setCameraMode('orbit')}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  border: cameraMode === 'orbit' ? '1px solid #38bdf8' : 'none',
                  background: cameraMode === 'orbit' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                  color: cameraMode === 'orbit' ? '#ffffff' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Compass size={12} />
                <span>Órbita</span>
              </button>
            </div>

            <button
              onClick={handleRecoverCar}
              title="Voltar à pista junto ao acidente (-35m)"
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: '1px solid rgba(251, 191, 36, 0.45)',
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RotateCcw size={13} />
              <span>Recuperar (R)</span>
            </button>

            <button
              onClick={handleToggleHeadlights}
              title="Ligar/Desligar faróis dianteiros (Tecla L)"
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: headlightsOn ? '1px solid rgba(250, 204, 21, 0.55)' : '1px solid rgba(148, 163, 184, 0.35)',
                background: headlightsOn ? 'rgba(250, 204, 21, 0.18)' : 'rgba(30, 41, 59, 0.7)',
                color: headlightsOn ? '#fde047' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Lightbulb size={13} />
              <span>{headlightsOn ? 'Faróis: ON (L)' : 'Faróis: OFF (L)'}</span>
            </button>
          </div>

          {/* Right: Voice, Chat, Gamepad, Live Racers + Ping */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isSoloRacing && currentRoom && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!roomVoice.joined) {
                      roomVoice.joinVoice({ listenOnly: false });
                    } else if (!roomVoice.listenOnly) {
                      roomVoice.toggleMute();
                    } else {
                      roomVoice.leaveVoice();
                    }
                  }}
                  title={
                    !roomVoice.joined
                      ? 'Ligar chat de voz (microfone + auscultadores)'
                      : roomVoice.listenOnly
                      ? 'Em modo Só Ouvir (clica para sair)'
                      : roomVoice.isMuted
                      ? 'Ligar microfone (Tecla V)'
                      : 'Silenciar microfone (Tecla V)'
                  }
                  style={{
                    background: !roomVoice.joined
                      ? 'rgba(30, 41, 59, 0.9)'
                      : roomVoice.isMuted || roomVoice.listenOnly
                      ? 'rgba(245, 158, 11, 0.18)'
                      : 'rgba(16, 185, 129, 0.2)',
                    border: !roomVoice.joined
                      ? '1px solid rgba(255,255,255,0.16)'
                      : roomVoice.isMuted || roomVoice.listenOnly
                      ? '1px solid rgba(251, 191, 36, 0.45)'
                      : '1px solid rgba(52, 211, 153, 0.5)',
                    color: !roomVoice.joined
                      ? '#e2e8f0'
                      : roomVoice.isMuted || roomVoice.listenOnly
                      ? '#fde68a'
                      : '#6ee7b7',
                    borderRadius: 9,
                    padding: '6px 10px',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {!roomVoice.joined ? (
                    <Headphones size={14} />
                  ) : roomVoice.isMuted || roomVoice.listenOnly ? (
                    <MicOff size={14} />
                  ) : (
                    <Mic size={14} />
                  )}
                  <span>
                    {!roomVoice.joined
                      ? 'Ligar Voz'
                      : roomVoice.listenOnly
                      ? 'Só Ouvir'
                      : roomVoice.isMuted
                      ? 'Mic OFF'
                      : 'Voz ON'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setInRaceChatOpen((prev) => !prev)}
                  title="Abrir/Fechar chat da sala (Tecla T)"
                  style={{
                    position: 'relative',
                    background: inRaceChatOpen ? 'rgba(56, 189, 248, 0.24)' : 'rgba(30, 41, 59, 0.9)',
                    border: inRaceChatOpen ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.16)',
                    color: inRaceChatOpen ? '#fff' : '#e2e8f0',
                    borderRadius: 9,
                    padding: '6px 10px',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <MessageSquare size={14} />
                  <span>Chat (T)</span>
                  {unreadRoomMsgs > 0 && (
                    <span
                      style={{
                        background: '#e11d48',
                        color: '#fff',
                        fontSize: 9.5,
                        fontWeight: 900,
                        padding: '1px 5px',
                        borderRadius: 999,
                      }}
                    >
                      {unreadRoomMsgs}
                    </span>
                  )}
                </button>
              </>
            )}

            {gamepadTriggerButton}

            <div style={{
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              color: '#34d399',
              padding: '5px 11px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
            }}>
              {isSoloRacing
                ? `🟢 ${totalDriversCount} carros em prova`
                : `🟢 ${totalDriversCount} pilotos em prova • ${raceClient.pingMs} ms`}
            </div>
          </div>
        </header>

        {/* 3D Race Canvas */}
        <ErrorBoundary fallbackTitle="Recuperador da Corrida 3D">
          <Canvas
            shadows
            dpr={[1, 1.5]}
            camera={{ position: [0, 360, 480], fov: 50, near: 0.5, far: 10000 }}
            style={{ width: '100%', height: '100%' }}
          >
            <Environment3D theme={activeEnvTheme} groundY={groundY} />
            <Scenery3D
              patches={activeRaceCircuit.sceneryPatches ?? EMPTY_PATCHES}
              spline={currentSpline}
              isClosed={isClosed}
              branches={activeRaceCircuit.branches ?? EMPTY_BRANCHES}
              pitSpline={currentPitSpline}
              groundY={groundY}
            />

            <Physics gravity={PHYSICS_GRAVITY} timeStep={1 / 60} interpolate={true}>
              <RigidBody type="fixed" friction={0.05} restitution={0.05}>
                <CuboidCollider args={SAFETY_FLOOR_ARGS} position={safetyFloorPos} />
              </RigidBody>

              <Track3D
                enablePhysics={true}
                groundY={groundY}
                spline={currentSpline}
                controlPoints={activeRaceCircuit.controlPoints}
                pitSpline={currentPitSpline}
                branches={activeRaceCircuit.branches ?? EMPTY_BRANCHES}
                isClosed={isClosed}
                showOutlines={true}
                showGuardrails={true}
                showEmbankments={true}
                showLayers={true}
                showControlPoints={false}
                showRedRibbon={false}
                showElectricZones={activeCarCategory === 'fe' || myCarClass === 'fe' || activeCarCategory === 'open'}
                theme={activeEnvTheme}
                trackThemeId={(activeRaceCircuit.trackThemeId as any) || 'f1_modern'}
              />

              {/* Local Driver Physics Car */}
              <RapierCarController
                spline={currentSpline}
                controlPoints={activeRaceCircuit.controlPoints}
                isClosed={isClosed}
                isRaceActive={true}
                branches={activeRaceCircuit.branches ?? EMPTY_BRANCHES}
                pitSpline={currentPitSpline}
                nearbyCarDotsRef={minimapDotsRef}
                groundY={groundY}
                cameraMode={cameraMode}
                speedPreset={activeSpeedPreset}
                carClass={myCarClass}
                carTuning={myCarTuning}
                headlightsOn={headlightsOn}
                onToggleHeadlights={handleToggleHeadlights}
                onCycleCamera={handleCycleCamera}
                environmentTheme={activeEnvTheme}
                recoverTrigger={recoverTrigger}
                gridSlotIndex={myGridSlot}
                totalLaps={activeTotalLaps}
                externalRaceControl={true}
                externalPhase={racePhase}
                externalLightsLit={lightsLit}
                onSceneReady={handleSceneReady}
                onLocalCarSample={handleLocalCarSample}
              />

              {/* Remote Human Drivers (Online Mode) */}
              {isOnlineRacing &&
                currentRoom?.players
                  .filter((p) => p.id !== myDriverId)
                  .map((p) => {
                    const slotIdx = Math.max(0, Math.min(11, p.gridSlot));
                    const initPose = p.carClass === 'f1' || p.carClass === 'fe' ? cachedRemotePosesF1[slotIdx] : cachedRemotePosesOther[slotIdx];
                    const st = standingsById[p.id];
                    return (
                      <RemoteCar3D
                        key={p.id}
                        driverId={p.id}
                        name={p.name}
                        carClass={p.carClass}
                        primaryColor={p.primaryColor}
                        secondaryColor={p.secondaryColor}
                        initialPose={initPose}
                        remoteCarsRef={raceClient.remoteCarsRef}
                        positionRank={st?.position}
                        isAi={false}
                        inPit={st?.inPit}
                        finished={st?.finished}
                        connected={p.connected}
                        environmentTheme={activeEnvTheme}
                      />
                    );
                  })}

              {/* AI Bot Racers: Authoritative Manager on Host/Solo, RemoteCar3D on Guests */}
              {isAiAuthority && activeAiRacers.length > 0 && (
                <AIRacerManager
                  aiRacers={activeAiRacers}
                  spline={currentSpline}
                  isClosed={isClosed}
                  totalLaps={activeTotalLaps}
                  speedPreset={activeSpeedPreset}
                  racePhase={racePhase}
                  raceGoTimestampMs={activeSync?.raceGoLocalMs ?? 0}
                  localCarPosRef={localCarSampleRef}
                  remoteCarsRef={raceClient.remoteCarsRef}
                  standingsMap={standingsRankMap}
                  environmentTheme={activeEnvTheme}
                  onAiStatesUpdate={handleAiStatesUpdate}
                />
              )}

              {!isAiAuthority &&
                activeAiRacers.map((bot) => {
                  const slotIdx = Math.max(0, Math.min(11, bot.gridSlot));
                  const initPose = bot.carClass === 'f1' || bot.carClass === 'fe' ? cachedRemotePosesF1[slotIdx] : cachedRemotePosesOther[slotIdx];
                  const st = standingsById[bot.id];
                  return (
                    <RemoteCar3D
                      key={bot.id}
                      driverId={bot.id}
                      name={bot.name}
                      carClass={bot.carClass}
                      primaryColor={bot.primaryColor}
                      secondaryColor={bot.secondaryColor}
                      initialPose={initPose}
                      remoteCarsRef={raceClient.remoteCarsRef}
                      positionRank={st?.position}
                      isAi={true}
                      inPit={st?.inPit}
                      finished={st?.finished}
                      connected={true}
                      environmentTheme={activeEnvTheme}
                    />
                  );
                })}
            </Physics>

            <OrbitControls
              makeDefault
              enabled={cameraMode === 'orbit'}
              enableDamping
              dampingFactor={0.06}
              minDistance={10}
              maxDistance={3000}
              maxPolarAngle={Math.PI / 2 - 0.01}
            />
          </Canvas>
        </ErrorBoundary>

        {/* Race HUD + Standings Tower */}
        <HUD
          showLapTimer={true}
          cameraMode={cameraMode}
          speedPreset={activeSpeedPreset}
          onChangeCameraMode={setCameraMode}
          onChangeSpeedPreset={handleNoopSpeedPreset}
          onResetCar={handleRecoverCar}
          headlightsOn={headlightsOn}
          onToggleHeadlights={handleToggleHeadlights}
          totalLaps={activeTotalLaps}
          gridSlotNumber={myGridSlot + 1}
          waitingBannerText={waitingText}
          standings={activeStandings}
          myDriverId={myDriverId}
          finishBanner={finishBannerData}
        />

        {/* Bottom-Left 2D Live Track Minimap */}
        <RaceMinimap
          spline={currentSpline}
          isClosed={isClosed}
          branches={activeRaceCircuit.branches ?? EMPTY_BRANCHES}
          pitSpline={currentPitSpline}
          dotsRef={minimapDotsRef}
          circuitName={activeRaceCircuit.name}
        />

        {/* Final Podium Overlay */}
        {isRaceFinished && (
          <PodiumOverlay
            circuitName={activeRaceCircuit.name}
            carCategory={activeCarCategory}
            totalLaps={activeTotalLaps}
            standings={activeStandings}
            myDriverId={myDriverId}
            isHost={isHost}
            isSolo={isSoloRacing}
            onReturnToLobby={() => {
              if (isSoloRacing) {
                setSoloSession((prev) => (prev ? { ...prev, status: 'garage', isReady: false } : null));
                setSoloFinished(false);
                setSoloCountdownSync(null);
              } else {
                raceClient.returnToLobby();
              }
            }}
            onLeaveRoom={handleLeaveActiveRace}
          />
        )}

        {/* In-Race Text & Voice Comms Overlay */}
        {!isSoloRacing && currentRoom && (
          <InRaceCommsOverlay
            players={currentRoom.players}
            selfId={raceClient.selfId}
            messages={raceClient.roomMessages}
            chatOpen={inRaceChatOpen}
            onCloseChat={() => setInRaceChatOpen(false)}
            onSendMessage={(text) => raceClient.sendChatMessage('room', text)}
            voice={roomVoice}
          />
        )}

        <GamepadSettingsModal open={gamepadModalOpen} onClose={() => setGamepadModalOpen(false)} />
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: PRE-RACE GARAGE & CONFIRMATION (ONLINE ROOM OR SOLO PRE-RACE)
  // ============================================================================
  if ((currentRoom && currentRoom.status === 'lobby') || (isSoloGarage && soloSession)) {
    const isSoloLobbyView = Boolean(isSoloGarage && soloSession);
    const lobbyCategory: CarCategory = isSoloLobbyView
      ? soloSession!.carCategory
      : currentRoom!.carCategory;
    const roomCatMeta = CAR_CATEGORY_META[lobbyCategory] || CAR_CATEGORY_META.open;
    const lobbyCircuitId = isSoloLobbyView ? soloSession!.circuit.id : currentRoom!.circuitId;
    const lobbyCircuitName = isSoloLobbyView ? soloSession!.circuit.name : currentRoom!.circuitName;
    const lobbyCircuitOpt = circuits.find(
      (c) => c.circuit.id === lobbyCircuitId || c.circuit.name === lobbyCircuitName
    );
    const lobbyCircuitLengthM = isSoloLobbyView
      ? lobbyCircuitOpt?.lengthM || computeCircuitOption(soloSession!.circuit).lengthM
      : currentRoom!.circuitLengthM;
    const lobbyTotalLaps = isSoloLobbyView ? soloSession!.totalLaps : currentRoom!.totalLaps;
    const lobbySpeedPreset = isSoloLobbyView ? soloSession!.speedPreset : currentRoom!.speedPreset;
    const lobbyEnvTheme = isSoloLobbyView ? soloSession!.environmentTheme : currentRoom!.environmentTheme;
    const lobbyAiCount = isSoloLobbyView ? soloSession!.aiCount : currentRoom!.aiCount;
    const lobbyName = isSoloLobbyView ? 'Garagem & Afinação Pré-Corrida' : currentRoom!.name;

    const myCarLocked = lobbyCategory !== 'open';
    const effectiveMyClass: CarClass = myCarLocked
      ? (lobbyCategory as CarClass)
      : isSoloLobbyView
      ? soloSession!.driverProfile.carClass
      : driverProfile.carClass;

    const connectedHumans = isSoloLobbyView
      ? [
          {
            id: soloSession!.driverId,
            name: driverProfile.name,
            carClass: effectiveMyClass,
            primaryColor: driverProfile.primaryColor,
            secondaryColor: driverProfile.secondaryColor,
            isReady: soloSession!.isReady,
            sceneReady: false,
            connected: true,
            gridSlot: 0,
          },
        ]
      : currentRoom!.players.filter((p) => p.connected);

    const readyHumansCount = connectedHumans.filter((p) => p.isReady).length;
    const myReadyFlag = Boolean(myPlayerOnline?.isReady);

    const activeGarageTuning = clampTuningToClass(effectiveMyClass, {
      ...(raceTunings[effectiveMyClass] || CAR_CLASS_DEFAULTS[effectiveMyClass]),
      primaryColor: driverProfile.primaryColor,
      secondaryColor: driverProfile.secondaryColor,
    });

    const copyInviteLink = async () => {
      if (!currentRoom) return;
      const inviteUrl = `${window.location.origin}/?mode=race&room=${currentRoom.code}`;
      try {
        await navigator.clipboard.writeText(inviteUrl);
        showToast(`📋 Link de convite copiado! Código: ${currentRoom.code}`);
      } catch {
        showToast(`🔗 Partilha o código: ${currentRoom.code}`);
      }
    };

    const previewTotalGrid = Math.min(12, connectedHumans.length + lobbyAiCount);
    const previewAiSlots = Math.max(0, previewTotalGrid - connectedHumans.length);
    const invitablePlayers =
      !isSoloLobbyView && currentRoom
        ? raceClient.onlinePlayers.filter(
            (p) =>
              p.id !== raceClient.selfClientId &&
              p.roomCode !== currentRoom.code &&
              p.status !== 'racing'
          )
        : [];

    return (
      <div style={{
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '100vh',
        overflowY: 'auto',
        background: 'linear-gradient(180deg, #060913 0%, #0f172a 100%)',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        paddingBottom: 40,
      }}>
        {(toastMsg || raceClient.errorMsg || raceClient.hostNotice || raceClient.inviteNotice) && (
          <div style={{
            position: 'fixed',
            top: 66,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 900,
            background: raceClient.errorMsg ? '#991b1b' : '#065f46',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10,
            padding: '10px 18px',
            fontWeight: 800,
            fontSize: 13,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span>{raceClient.errorMsg || toastMsg || raceClient.hostNotice || raceClient.inviteNotice}</span>
            {raceClient.errorMsg && (
              <button
                onClick={raceClient.clearError}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Header */}
        <header style={{
          height: 60,
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          padding: '0 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => (isSoloLobbyView ? setSoloSession(null) : raceClient.leaveRoom())}
              style={{
                background: 'rgba(239, 68, 68, 0.16)',
                color: '#fca5a5',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                borderRadius: 8,
                padding: '7px 12px',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ArrowLeft size={14} />
              <span>{isSoloLobbyView ? 'Voltar ao Lobby' : 'Sair da Sala'}</span>
            </button>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{lobbyName}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                {roomCatMeta.emoji} Categoria {roomCatMeta.label} •{' '}
                {isSoloLobbyView
                  ? `1 Humano + ${previewAiSlots} Bots IA`
                  : `${connectedHumans.length}/${currentRoom!.maxHumans} Humanos`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {gamepadTriggerButton}
            {isSoloLobbyView ? (
              <span style={{
                background: 'rgba(16, 185, 129, 0.16)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                color: '#34d399',
                borderRadius: 10,
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 900,
              }}>
                ⚡ MODO SOLO • AFINAÇÃO PRÉ-CORRIDA
              </span>
            ) : (
              <>
                <div style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1.5px solid #38bdf8',
                  borderRadius: 10,
                  padding: '6px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>CÓDIGO:</span>
                  <span style={{ fontSize: 16, fontWeight: 950, letterSpacing: '0.14em', color: '#38bdf8' }}>
                    {currentRoom!.code}
                  </span>
                </div>
                <button
                  onClick={copyInviteLink}
                  style={{
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 14px',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Copy size={14} />
                  <span>Copiar Link de Convite</span>
                </button>
              </>
            )}
          </div>
        </header>

        {isSoloLobbyView && pendingInviteBanner}

        {/* 2 or 3-Column Pre-Race Grid */}
        <div style={{
          maxWidth: isSoloLobbyView ? 1120 : 1380,
          margin: '20px auto 0',
          padding: '0 20px',
          boxSizing: 'border-box',
          display: 'grid',
          gridTemplateColumns: isSoloLobbyView
            ? 'repeat(auto-fit, minmax(380px, 1fr))'
            : 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 20,
          alignItems: 'start',
        }}>
          {/* Left Column: Reusable Driver Garage & Fine Car Tuning */}
          <CarGaragePanel
            driverName={driverProfile.name}
            onChangeDriverName={(name) => {
              setDriverProfile((prev) => ({ ...prev, name }));
              if (isSoloLobbyView) {
                setSoloSession((prev) =>
                  prev ? { ...prev, driverProfile: { ...prev.driverProfile, name } } : null
                );
              } else {
                raceClient.updateProfile({ name });
              }
            }}
            carClass={effectiveMyClass}
            carClassLocked={myCarLocked}
            lockedLabel={`Fixada pela corrida (${roomCatMeta.shortLabel})`}
            onChangeCarClass={(cls) => {
              setDriverProfile((prev) => ({ ...prev, carClass: cls }));
              if (isSoloLobbyView) {
                setSoloSession((prev) =>
                  prev ? { ...prev, driverProfile: { ...prev.driverProfile, carClass: cls } } : null
                );
              } else {
                raceClient.updateProfile({ carClass: cls });
              }
            }}
            tuning={activeGarageTuning}
            onChangeTuning={(nextTuning) => {
              setRaceTunings((prev) => ({ ...prev, [effectiveMyClass]: nextTuning }));
              const colorsChanged =
                nextTuning.primaryColor !== driverProfile.primaryColor ||
                nextTuning.secondaryColor !== driverProfile.secondaryColor;
              if (colorsChanged) {
                setDriverProfile((prev) => ({
                  ...prev,
                  primaryColor: nextTuning.primaryColor,
                  secondaryColor: nextTuning.secondaryColor,
                }));
                if (isSoloLobbyView) {
                  setSoloSession((prev) =>
                    prev
                      ? {
                          ...prev,
                          driverProfile: {
                            ...prev.driverProfile,
                            primaryColor: nextTuning.primaryColor,
                            secondaryColor: nextTuning.secondaryColor,
                          },
                        }
                      : null
                  );
                } else {
                  raceClient.updateProfile({
                    primaryColor: nextTuning.primaryColor,
                    secondaryColor: nextTuning.secondaryColor,
                  });
                }
              }
            }}
            onResetTuning={() => {
              const resetVal: CarTuning = {
                ...CAR_CLASS_DEFAULTS[effectiveMyClass],
                primaryColor: driverProfile.primaryColor,
                secondaryColor: driverProfile.secondaryColor,
              };
              setRaceTunings((prev) => ({ ...prev, [effectiveMyClass]: resetVal }));
            }}
          />

          {/* Right Column: Read-Only Race Summary + Starting Grid & Unified Action */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Compact Read-Only Race Summary Card */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 18,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>🏁 Resumo da Prova</h3>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', background: '#1e293b', padding: '3px 8px', borderRadius: 6 }}>
                  Definido no Lobby
                </span>
              </div>

              <div style={{
                background: '#090d16',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                {lobbyCircuitOpt && (
                  <TrackMiniPreviewSvg
                    controlPoints={lobbyCircuitOpt.circuit.controlPoints}
                    isClosed={lobbyCircuitOpt.circuit.isClosed}
                    width={96}
                    height={68}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>{lobbyCircuitName}</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 700, marginTop: 3 }}>
                    {(lobbyCircuitLengthM / 1000).toFixed(2)} km • {lobbyTotalLaps} {lobbyTotalLaps === 1 ? 'volta' : 'voltas'}
                  </div>
                  <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 800, marginTop: 4 }}>
                    {roomCatMeta.emoji} {roomCatMeta.label}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: 9, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>POTÊNCIA</div>
                  <div style={{ fontSize: 12, fontWeight: 900, marginTop: 2 }}>
                    {lobbySpeedPreset === 'extreme' ? '🔴 F1 Real' : lobbySpeedPreset === 'calm' ? '🟢 Calmo' : '🟡 Médio'}
                  </div>
                </div>
                <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: 9, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>AMBIENTE</div>
                  <div style={{ fontSize: 12, fontWeight: 900, marginTop: 2 }}>
                    {lobbyEnvTheme === 'night' ? '🌙 Noite' : lobbyEnvTheme === 'sunset' ? '🌅 Pôr do Sol' : '☀️ Dia'}
                  </div>
                </div>
                <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: 9, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>BOTS IA</div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#facc15', marginTop: 2 }}>{lobbyAiCount} bots</div>
                </div>
                <div style={{ background: '#090d16', padding: '8px 10px', borderRadius: 9, border: '1px solid #1e293b' }}>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', fontWeight: 800 }}>GRELHA</div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: '#34d399', marginTop: 2 }}>{previewTotalGrid} carros</div>
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
                Para alterar pista, voltas ou categoria, volta atrás ao lobby.
              </div>
            </div>

            {/* Starting Grid & Unified Action Area */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 18,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>🚦 Grelha de Partida</h3>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#34d399' }}>
                    {isSoloLobbyView
                      ? `${previewTotalGrid} carros em pista`
                      : `${readyHumansCount}/${connectedHumans.length} prontos • ${previewTotalGrid} carros`}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
                  {connectedHumans.map((p, idx) => {
                    const isMe = isSoloLobbyView || p.id === raceClient.selfId;
                    const pHost = !isSoloLobbyView && currentRoom ? p.id === currentRoom.hostId : true;
                    const isSpeaking = !isSoloLobbyView && Boolean(roomVoice.speakingPeers[p.id]);
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 11px',
                          borderRadius: 10,
                          background: isMe ? 'rgba(56, 189, 248, 0.14)' : '#090d16',
                          border: isMe ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid #1e293b',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', width: 22 }}>
                            P{idx + 1}
                          </span>
                          <span style={{
                            width: 14,
                            height: 14,
                            borderRadius: 4,
                            background: `linear-gradient(135deg, ${p.primaryColor} 60%, ${p.secondaryColor} 60%)`,
                            border: '1px solid rgba(255,255,255,0.4)',
                          }} />
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span>{p.name}</span>
                              {pHost && <Crown size={12} color="#facc15" />}
                              {isMe && <span style={{ fontSize: 9, background: '#38bdf8', color: '#020617', padding: '1px 5px', borderRadius: 4, fontWeight: 900 }}>TU</span>}
                              {!isSoloLobbyView && p.voiceJoined && (
                                <span
                                  title={p.voiceMuted ? 'Na voz (microfone silenciado)' : 'Na chamada de voz'}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    padding: '1px 5px',
                                    borderRadius: 999,
                                    background: isSpeaking
                                      ? 'rgba(16, 185, 129, 0.28)'
                                      : p.voiceMuted
                                      ? 'rgba(239, 68, 68, 0.16)'
                                      : 'rgba(52, 211, 153, 0.15)',
                                    border: isSpeaking ? '1px solid #34d399' : '1px solid transparent',
                                    color: p.voiceMuted ? '#fca5a5' : '#34d399',
                                  }}
                                >
                                  {p.voiceMuted ? <MicOff size={10} /> : <Mic size={10} />}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700 }}>
                              {CAR_CATEGORY_META[p.carClass]?.emoji} {CAR_CATEGORY_META[p.carClass]?.shortLabel}
                            </div>
                          </div>
                        </div>

                        <span style={{
                          fontSize: 11,
                          fontWeight: 900,
                          color: isSoloLobbyView ? '#38bdf8' : p.isReady ? '#34d399' : '#fbbf24',
                        }}>
                          {isSoloLobbyView ? '🔧 Na Garagem' : p.isReady ? '✅ PRONTO' : '⏳ A afinar'}
                        </span>
                      </div>
                    );
                  })}

                  {Array.from({ length: previewAiSlots }).map((_, idx) => (
                    <div
                      key={`ai_prev_${idx}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 11px',
                        borderRadius: 9,
                        background: 'rgba(15, 23, 42, 0.5)',
                        border: '1px dashed #334155',
                        opacity: 0.78,
                        fontSize: 11.5,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 900, color: '#64748b', width: 22 }}>
                          P{connectedHumans.length + idx + 1}
                        </span>
                        <span style={{ color: '#cbd5e1', fontWeight: 700 }}>
                          🤖 {SOLO_AI_TEMPLATES[idx % SOLO_AI_TEMPLATES.length].name}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800 }}>BOT IA</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {isSoloLobbyView ? (
                  <button
                    onClick={handleConfirmStartSoloRace}
                    style={{
                      padding: '14px 18px',
                      borderRadius: 12,
                      fontWeight: 950,
                      fontSize: 14.5,
                      cursor: 'pointer',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      border: '1px solid #34d399',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      boxShadow: '0 10px 26px rgba(16, 185, 129, 0.4)',
                    }}
                  >
                    <Play size={17} fill="#fff" />
                    <span>🚦 ESTOU PRONTO — ENTRAR NA CORRIDA</span>
                  </button>
                ) : connectedHumans.length >= 2 ? (
                  <>
                    <button
                      onClick={() => raceClient.setReady(!myReadyFlag)}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 12,
                        fontWeight: 950,
                        fontSize: 14,
                        cursor: 'pointer',
                        background: myReadyFlag
                          ? 'rgba(16, 185, 129, 0.24)'
                          : 'linear-gradient(135deg, #10b981, #059669)',
                        border: myReadyFlag ? '1.5px solid #34d399' : '1px solid #34d399',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        boxShadow: myReadyFlag ? 'none' : '0 10px 24px rgba(16, 185, 129, 0.35)',
                      }}
                    >
                      <CheckCircle2 size={17} />
                      <span>
                        {myReadyFlag
                          ? `✅ PRONTO! A aguardar pilotos (${readyHumansCount}/${connectedHumans.length})... (Cancelar)`
                          : '✅ ESTOU PRONTO PARA CORRER'}
                      </span>
                    </button>
                    <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>
                      A corrida arranca automaticamente assim que todos confirmarem Pronto!
                    </div>
                    {isHost && (
                      <button
                        onClick={() => raceClient.startRace()}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 9,
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                          background: 'rgba(225, 29, 72, 0.15)',
                          border: '1px solid rgba(251, 113, 133, 0.4)',
                          color: '#fda4af',
                        }}
                      >
                        Forçar arranque agora (Anfitrião)
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{
                      fontSize: 11.5,
                      color: '#38bdf8',
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.28)',
                      borderRadius: 9,
                      padding: '8px 11px',
                      textAlign: 'center',
                      fontWeight: 700,
                    }}>
                      Partilha o código <strong>{currentRoom!.code}</strong> para entrarem mais amigos, ou arranca já com os bots IA.
                    </div>
                    <button
                      onClick={() => raceClient.startRace()}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 12,
                        fontWeight: 950,
                        fontSize: 14.5,
                        cursor: 'pointer',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        border: '1px solid #34d399',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        boxShadow: '0 10px 26px rgba(16, 185, 129, 0.4)',
                      }}
                    >
                      <Play size={17} fill="#fff" />
                      <span>🚦 INICIAR CORRIDA AGORA</span>
                    </button>
                  </>
                )}
              </div>

              {/* Quick Invite Online Players */}
              {!isSoloLobbyView && currentRoom && invitablePlayers.length > 0 && (
                <div
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: 11,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 900, color: '#cbd5e1' }}>
                    <UserPlus size={14} color="#38bdf8" />
                    <span>Convidar pilotos no Lobby ({invitablePlayers.length})</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {invitablePlayers.map((op) => (
                      <div
                        key={op.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: 999,
                          padding: '4px 6px 4px 9px',
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: op.primaryColor,
                          }}
                        />
                        <span>{op.name}</span>
                        <button
                          type="button"
                          onClick={() => raceClient.inviteOnlinePlayer(op.id)}
                          style={{
                            background: '#0284c7',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 999,
                            padding: '2px 8px',
                            fontSize: 10,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          Convidar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Third Column: Room Voice & Text Chat (Online Rooms) */}
          {!isSoloLobbyView && currentRoom && (
            <RoomCommsPanel
              players={currentRoom.players}
              selfId={raceClient.selfId}
              messages={raceClient.roomMessages}
              isOnline={raceClient.connectionState === 'connected'}
              onSendMessage={(text) => raceClient.sendChatMessage('room', text)}
              voice={roomVoice}
            />
          )}
        </div>

        <GamepadSettingsModal open={gamepadModalOpen} onClose={() => setGamepadModalOpen(false)} />
      </div>
    );
  }

  // ============================================================================
  // VIEW 1: ONLINE ROOM BROWSER + CREATE RACE + QUICK SOLO
  // ============================================================================
  const isOnline = raceClient.connectionState === 'connected';

  return (
    <div style={{
      width: '100%',
      boxSizing: 'border-box',
      minHeight: '100vh',
      overflowY: 'auto',
      background: 'radial-gradient(circle at 85% 10%, rgba(225, 29, 72, 0.14), transparent 40%), linear-gradient(180deg, #060913 0%, #0f172a 100%)',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: 40,
    }}>
      {(toastMsg || raceClient.errorMsg) && (
        <div style={{
          position: 'fixed',
          top: 66,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 900,
          background: raceClient.errorMsg ? '#991b1b' : '#065f46',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: 10,
          padding: '10px 18px',
          fontWeight: 800,
          fontSize: 13,
          boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span>{raceClient.errorMsg || toastMsg}</span>
          {raceClient.errorMsg && (
            <button
              onClick={raceClient.clearError}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <header style={{
        height: 60,
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '0 22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onBackToHome}
            style={{
              background: 'rgba(30, 41, 59, 0.9)',
              color: '#e2e8f0',
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: 8,
              padding: '7px 11px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Home size={14} />
            <span>Menu</span>
          </button>
          <button
            onClick={onGoToEditor}
            style={{
              background: 'rgba(2, 132, 199, 0.2)',
              color: '#7dd3fc',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: 8,
              padding: '7px 11px',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Wrench size={14} />
            <span>Editor Pistas</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
            <Flag size={18} color="#f43f5e" />
            <span style={{ fontSize: 16, fontWeight: 950, letterSpacing: '0.04em' }}>
              MODO CORRIDAS
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 800 }}>Piloto:</span>
            <input
              type="text"
              maxLength={20}
              value={driverProfile.name}
              onChange={(e) => setDriverProfile((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="O teu nome"
              style={{
                background: '#090d16',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12.5,
                fontWeight: 800,
                width: 145,
              }}
            />
          </div>

          {gamepadTriggerButton}

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 999,
            background: isOnline ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)',
            border: `1px solid ${isOnline ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)'}`,
            color: isOnline ? '#34d399' : '#f87171',
            fontSize: 11.5,
            fontWeight: 800,
          }}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{isOnline ? `Online • ${raceClient.pingMs} ms` : 'Offline'}</span>
          </div>
        </div>
      </header>

      {pendingInviteBanner}

      {/* Main Two-Column Lobby */}
      <div style={{
        maxWidth: 1240,
        margin: '24px auto 0',
        padding: '0 20px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 22,
      }}>
        {/* Left: Open Online Rooms + Join by Code */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>🌐 Salas Online Abertas</h2>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                Entra numa corrida ativa ou junta-te pelo código da sala
              </div>
            </div>
            <button
              onClick={raceClient.refreshRooms}
              disabled={!isOnline}
              style={{
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '7px 11px',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: isOnline ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <RefreshCw size={13} />
              <span>Atualizar</span>
            </button>
          </div>

          {/* Join by Code */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              maxLength={6}
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              placeholder="Código da sala (ex: A7K2)"
              style={{
                flex: 1,
                background: '#090d16',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '0.08em',
              }}
            />
            <button
              onClick={() => {
                if (!joinCodeInput.trim()) return;
                raceClient.joinRoom(joinCodeInput, driverProfile);
              }}
              disabled={!isOnline || !joinCodeInput.trim()}
              style={{
                background: isOnline && joinCodeInput.trim() ? '#0284c7' : '#334155',
                color: '#fff',
                border: 'none',
                borderRadius: 9,
                padding: '9px 16px',
                fontWeight: 900,
                fontSize: 12.5,
                cursor: isOnline && joinCodeInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Entrar
            </button>
          </div>

          {/* Room List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
            {raceClient.rooms.length === 0 ? (
              <div style={{
                padding: '20px 14px',
                textAlign: 'center',
                background: '#090d16',
                borderRadius: 14,
                border: '1px dashed #334155',
                color: '#94a3b8',
              }}>
                <Users size={24} style={{ opacity: 0.5, marginBottom: 6 }} />
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0' }}>
                  Nenhuma sala online aberta neste momento
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4 }}>
                  Cria uma corrida ao lado e partilha o código ou convida quem estiver online abaixo!
                </div>
              </div>
            ) : (
              raceClient.rooms.map((rm) => {
                const cat = CAR_CATEGORY_META[rm.carCategory] || CAR_CATEGORY_META.open;
                const canJoin = isOnline && rm.status === 'lobby' && rm.humanCount < rm.maxHumans;
                return (
                  <div
                    key={rm.code}
                    style={{
                      background: '#090d16',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 14,
                      padding: '13px 15px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          background: `${cat.badgeColor}33`,
                          border: `1px solid ${cat.badgeColor}`,
                          color: '#fff',
                          fontSize: 10.5,
                          fontWeight: 900,
                          padding: '2px 7px',
                          borderRadius: 5,
                        }}>
                          {cat.emoji} {cat.shortLabel}
                        </span>
                        <span style={{ fontSize: 14.5, fontWeight: 900, color: '#fff' }}>{rm.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>#{rm.code}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 700 }}>
                        🏁 {rm.circuitName} • {rm.totalLaps} voltas • 👤 {rm.humanCount}/{rm.maxHumans} humanos • 🤖 {rm.aiCount} IA
                      </div>
                      <div style={{ fontSize: 11, color: rm.status === 'lobby' ? '#34d399' : '#fbbf24', fontWeight: 800 }}>
                        {rm.status === 'lobby' ? '🟢 Aberta na Grelha' : '🏁 Em prova'} • Anfitrião: {rm.hostName}
                      </div>
                    </div>

                    <button
                      disabled={!canJoin}
                      onClick={() => raceClient.joinRoom(rm.code, driverProfile)}
                      style={{
                        background: canJoin ? 'linear-gradient(135deg, #10b981, #059669)' : '#334155',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 9,
                        padding: '9px 16px',
                        fontWeight: 900,
                        fontSize: 12.5,
                        cursor: canJoin ? 'pointer' : 'not-allowed',
                        opacity: canJoin ? 1 : 0.55,
                      }}
                    >
                      {rm.status !== 'lobby' ? 'Em prova' : rm.humanCount >= rm.maxHumans ? 'Cheia' : 'Entrar'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Online Players Presence List */}
          <div
            style={{
              background: '#090d16',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 14,
              padding: 13,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 900, color: '#e2e8f0' }}>
                <Users size={15} color="#34d399" />
                <span>Pilotos Online ({raceClient.onlinePlayers.length})</span>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b' }}>
                Quem está ligado agora
              </span>
            </div>

            {raceClient.onlinePlayers.length === 0 ? (
              <div style={{ fontSize: 11.5, color: '#64748b', textAlign: 'center', padding: '10px 0' }}>
                {isOnline ? 'Sem pilotos ligados.' : 'A ligar ao servidor...'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 165, overflowY: 'auto', paddingRight: 2 }}>
                {raceClient.onlinePlayers.map((op) => {
                  const isMe = op.id === raceClient.selfClientId;
                  const targetRoom =
                    op.status === 'in_room' && op.roomCode
                      ? raceClient.rooms.find((r) => r.code === op.roomCode)
                      : null;
                  const canQuickJoin =
                    !isMe &&
                    isOnline &&
                    Boolean(targetRoom && targetRoom.status === 'lobby' && targetRoom.humanCount < targetRoom.maxHumans);

                  const statusLabel =
                    op.status === 'lobby'
                      ? '🟢 No Lobby'
                      : op.status === 'home'
                      ? '🏠 No Menu'
                      : op.status === 'in_room'
                      ? `🟡 Na Sala #${op.roomCode}`
                      : '🏁 Em Corrida';
                  const statusColor =
                    op.status === 'lobby'
                      ? '#34d399'
                      : op.status === 'home'
                      ? '#94a3b8'
                      : op.status === 'in_room'
                      ? '#facc15'
                      : '#fb7185';

                  return (
                    <div
                      key={op.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 9,
                        background: isMe ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.72)',
                        border: isMe ? '1px solid rgba(56, 189, 248, 0.32)' : '1px solid #1e293b',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: op.primaryColor,
                            border: '1.5px solid rgba(255,255,255,0.6)',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 800,
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {op.name}
                        </span>
                        {isMe && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 900,
                              background: '#38bdf8',
                              color: '#020617',
                              padding: '1px 5px',
                              borderRadius: 4,
                            }}
                          >
                            TU
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: statusColor }}>
                          {statusLabel}
                        </span>
                        {canQuickJoin && targetRoom && (
                          <button
                            type="button"
                            onClick={() => raceClient.joinRoom(targetRoom.code, driverProfile)}
                            style={{
                              background: '#059669',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              padding: '4px 9px',
                              fontSize: 10.5,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            Entrar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Global Lobby Chat */}
          <LobbyChatBox
            messages={raceClient.lobbyMessages}
            selfClientId={raceClient.selfClientId}
            isOnline={isOnline}
            onSendMessage={(text) => raceClient.sendChatMessage('lobby', text)}
          />
        </div>

        {/* Right: Create Race Room / Quick Solo */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18,
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 15,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>➕ Criar Nova Corrida</h2>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
              Configura o tipo de carro, circuito, voltas e adversários
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              Nome da Corrida
            </label>
            <input
              type="text"
              maxLength={40}
              value={roomNameInput}
              onChange={(e) => setRoomNameInput(e.target.value)}
              style={{
                width: '100%',
                background: '#090d16',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 9,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 800,
              }}
            />
          </div>

          {/* Car Category */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 5 }}>
              Tipo de Carro / Categoria
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {(['f1', 'fe', 'gt', 'rally', 'drift', 'open'] as CarCategory[]).map((cat) => {
                const m = CAR_CATEGORY_META[cat];
                const active = createCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setCreateCategory(cat)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: 9,
                      cursor: 'pointer',
                      background: active ? `${m.badgeColor}33` : '#090d16',
                      border: active ? `1.5px solid ${m.badgeColor}` : '1px solid #334155',
                      color: '#fff',
                      fontSize: 11.5,
                      fontWeight: 900,
                    }}
                  >
                    <div>{m.emoji}</div>
                    <div style={{ marginTop: 2 }}>{m.shortLabel}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 5 }}>
              {CAR_CATEGORY_META[createCategory].desc}
            </div>
          </div>

          {/* Circuit Picker */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 5 }}>
              Selecionar Pista ({circuits.length} disponíveis)
            </label>
            {localOnlyCircuits.length > 0 && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.14)',
                  border: '1px solid rgba(251, 191, 36, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fde68a' }}>
                  ⚠️ {localOnlyCircuits.length}{' '}
                  {localOnlyCircuits.length === 1 ? 'pista só neste browser' : 'pistas só neste browser'} (invisíveis para amigos)
                </span>
                <button
                  type="button"
                  disabled={isSyncingCircuits}
                  onClick={handleSyncLocalCircuitsToServer}
                  style={{
                    background: isSyncingCircuits
                      ? 'rgba(245, 158, 11, 0.25)'
                      : 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: isSyncingCircuits ? '#fde68a' : '#090d16',
                    border: '1px solid rgba(251, 191, 36, 0.65)',
                    borderRadius: 8,
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: isSyncingCircuits ? 'wait' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {isSyncingCircuits ? '⏳ A publicar...' : '☁️ Publicar Online'}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 200, overflowY: 'auto' }}>
              {circuits.map((opt) => {
                const active = selectedCreateCircuit?.circuit.id === opt.circuit.id;
                return (
                  <div
                    key={opt.circuit.id}
                    onClick={() => setCreateCircuitId(opt.circuit.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCreateCircuitId(opt.circuit.id); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      borderRadius: 11,
                      cursor: 'pointer',
                      background: active ? 'rgba(56, 189, 248, 0.14)' : '#090d16',
                      border: active ? '1.5px solid #38bdf8' : '1px solid #1e293b',
                    }}
                  >
                    <TrackMiniPreviewSvg
                      controlPoints={opt.circuit.controlPoints}
                      isClosed={opt.circuit.isClosed}
                      width={82}
                      height={54}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{opt.circuit.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>
                        {(opt.lengthM / 1000).toFixed(2)} km • {opt.circuit.controlPoints.length} nós
                        {opt.hasPit ? ' • 🔧 Box' : ''}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Laps */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 5 }}>
              Número de Voltas: <span style={{ color: '#38bdf8' }}>{createLaps}</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[1, 2, 3, 5, 8, 10, 15].map((n) => (
                <button
                  key={n}
                  onClick={() => setCreateLaps(n)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: 'pointer',
                    background: createLaps === n ? '#0284c7' : '#090d16',
                    border: createLaps === n ? '1px solid #38bdf8' : '1px solid #334155',
                    color: '#fff',
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Speed Preset & Environment */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Potência
              </label>
              <select
                value={createSpeedPreset}
                onChange={(e) => setCreateSpeedPreset(e.target.value as SpeedPreset)}
                style={{
                  width: '100%',
                  background: '#090d16',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <option value="calm">🟢 Calmo (140)</option>
                <option value="sport">🟡 Médio (210)</option>
                <option value="extreme">🔴 F1 Real (340)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Ambiente
              </label>
              <select
                value={createEnvTheme}
                onChange={(e) => setCreateEnvTheme(e.target.value as EnvironmentTheme)}
                style={{
                  width: '100%',
                  background: '#090d16',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <option value="day">☀️ Dia</option>
                <option value="sunset">🌅 Pôr do Sol</option>
                <option value="night">🌙 Noite</option>
              </select>
            </div>
          </div>

          {/* AI Bots slider */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Carros IA para preencher grelha (até 12 total)</span>
              <span style={{ color: '#facc15' }}>{createAiCount} bots IA</span>
            </label>
            <input
              type="range"
              min={0}
              max={11}
              value={createAiCount}
              onChange={(e) => setCreateAiCount(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>
            <button
              onClick={handleCreateOnlineRoom}
              disabled={!isOnline || !selectedCreateCircuit}
              style={{
                background: isOnline && selectedCreateCircuit
                  ? 'linear-gradient(135deg, #e11d48, #f43f5e)'
                  : '#334155',
                color: '#fff',
                border: isOnline ? '1px solid #fb7185' : 'none',
                borderRadius: 12,
                padding: '13px 18px',
                fontWeight: 950,
                fontSize: 14,
                cursor: isOnline && selectedCreateCircuit ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: isOnline ? '0 8px 24px rgba(225, 29, 72, 0.35)' : 'none',
              }}
            >
              <Users size={17} />
              <span>🌐 Criar Sala Online (Até 6 Amigos)</span>
            </button>

            <button
              onClick={handleOpenSoloGarage}
              disabled={!selectedCreateCircuit}
              style={{
                background: 'rgba(16, 185, 129, 0.16)',
                color: '#34d399',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                borderRadius: 11,
                padding: '11px 16px',
                fontWeight: 900,
                fontSize: 13,
                cursor: selectedCreateCircuit ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Zap size={16} />
              <span>⚡ Preparar Corrida Solo (+ {createAiCount} Bots IA)</span>
            </button>
          </div>
        </div>
      </div>

      <GamepadSettingsModal open={gamepadModalOpen} onClose={() => setGamepadModalOpen(false)} />
    </div>
  );
};
