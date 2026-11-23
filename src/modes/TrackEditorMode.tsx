import { ErrorBoundary } from '../components/ErrorBoundary';
import { useCircuitStorage } from '../hooks/useCircuitStorage';
import { ReferenceMapOverlay } from '../components/ReferenceMapOverlay';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  RAW_TRACKS,
  parseStudioControlPoints,
  parsePitControlPoints,
  fuseAndComputePitLane,
  generatePitLaneFromNodes,
  applyElevationProfile,
  computeSpline,
  SplineNode,
  RoadBranch,
  SceneryPatch,
  SprayCanType,
  scaleControlPointsToLength,
  scaleNodes2D,
  computeCentroid2D,
  estimateControlPointsLength,
  formatBlueprintDisplayName,
  MIN_TRACK_LENGTH_KM,
  MAX_TRACK_LENGTH_KM,
  SavedCircuit,
  createDefaultCircuit
} from '../tracks';
import { Track3D } from '../components/Track3D';
import { Scenery3D } from '../components/Scenery3D';
import { Environment3D } from '../components/Environment3D';
import { PointEditor } from '../components/PointEditor';
import { StudioSidebar, StudioTab } from '../components/StudioSidebar';
import { RapierCarController, CAR_CLASS_DEFAULTS, CarTuning } from '../components/RapierCarController';
import { CarClass } from '../components/Car3D';
import { HUD } from '../components/HUD';
import { SurfaceType, SpeedPreset } from '../physics';
import { TrackThemeId } from '../trackProfile';
import {
  Image as ImageIcon,
  Sun,
  Moon,
  Sunset,
  Camera,
  Layers,
  Mountain,
  PlusCircle,
  Sliders,
  X,
  Flag,
  PenTool,
  Save,
  FolderOpen,
  Download,
  Upload,
  Eye,
  Compass,
  Play,
  CheckCircle2,
  Trash2,
  RotateCcw,
  Undo2,
  Home,
  Lightbulb
} from 'lucide-react';

export interface TrackEditorModeProps {
  onBackToHome: () => void;
  onGoToRace: () => void;
}

const PHYSICS_GRAVITY: [number, number, number] = [0, -24, 0];
const SAFETY_FLOOR_ARGS: [number, number, number] = [10000, 1, 10000];

export const TrackEditorMode: React.FC<TrackEditorModeProps> = ({ onBackToHome, onGoToRace }) => {
  const [tracksList, setTracksList] = useState(RAW_TRACKS);
  const [isStudioOpen, setIsStudioOpen] = useState<boolean>(true);
  const [selectedTrackId, setSelectedTrackId] = useState<string>(RAW_TRACKS[0]?.id || 'nova_pista');
  const [trackName, setTrackName] = useState<string>('Nova Pista');
// Storage state gerido via useCircuitStorage hook
  
  const [isClosed, setIsClosed] = useState<boolean>(false);
  const [elevationType, setElevationType] = useState<'flat' | 'hills' | 'spa_style' | 'rollercoaster' | 'custom'>('hills');
  const [elevationAmplitude, setElevationAmplitude] = useState<number>(14);

  const [controlPoints, setControlPoints] = useState<SplineNode[]>([]);  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [branches, setBranches] = useState<RoadBranch[]>([]);
  const [selectedBranchNode, setSelectedBranchNode] = useState<{ branchId: string; nodeIndex: number } | null>(null);
  const [isCreatingRoad, setIsCreatingRoad] = useState<boolean>(false);
  const [isLinkingRoad, setIsLinkingRoad] = useState<boolean>(false);
  const [linkStartNode, setLinkStartNode] = useState<SplineNode | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const historyRef = useRef<Array<{ controlPoints: SplineNode[]; branches: RoadBranch[]; isClosed: boolean }>>([]);
  const pushHistory = () => {
    historyRef.current.push({
      controlPoints: controlPoints.map(p => ({ ...p })),
      branches: branches.map(b => ({ ...b, points: b.points.map(p => ({ ...p })) })),
      isClosed
    });
    if (historyRef.current.length > 50) historyRef.current.shift();
  };

  // Pit Lane state
  const [pitEntryIndex, setPitEntryIndex] = useState<number | null>(null);
  const [pitExitIndex, setPitExitIndex] = useState<number | null>(null);
  const [customPitNodes, setCustomPitNodes] = useState<SplineNode[] | null>(null);
  const [pitSide, setPitSide] = useState<'left' | 'right'>('left');
  const [disableSvgPit, setDisableSvgPit] = useState<boolean>(false);
  const [pitOffset, setPitOffset] = useState<number>(18);

  // Driving & Camera mode
  const [cameraMode, setCameraMode] = useState<'chase' | 'cockpit' | 'orbit'>('orbit');
  const [cameraPreset, setCameraPreset] = useState<'iso' | 'top' | 'ground' | 'close'>('top');
  const [localToastMsg, setLocalToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string | null, durationMs = 4500) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setLocalToastMsg(msg);
    if (msg) {
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        setLocalToastMsg(null);
      }, durationMs);
    }
  };
  const [speedPreset, setSpeedPreset] = useState<SpeedPreset>('sport');
  const [carClass, setCarClass] = useState<CarClass>('f1');
  const [carTuning, setCarTuning] = useState<CarTuning>(CAR_CLASS_DEFAULTS.f1);
  const [sceneryPatches, setSceneryPatches] = useState<SceneryPatch[]>([]);
  const [activeSpray, setActiveSpray] = useState<SprayCanType | null>('mountain');
  const [sprayRadius, setSprayRadius] = useState<number>(75);
  const [sprayIntensity, setSprayIntensity] = useState<number>(1.2);
  const [sprayCursorPos, setSprayCursorPos] = useState<[number, number] | null>(null);
  const isSprayingRef = useRef<boolean>(false);
  const lastSprayPosRef = useRef<{ x: number; z: number } | null>(null);

  const applySprayAt = (x: number, z: number) => {
    if (studioTab !== 'scenery' || !activeSpray) return;
    if (activeSpray === 'eraser') {
      setSceneryPatches(prev =>
        prev.filter(p => Math.hypot(p.x - x, p.z - z) > sprayRadius + p.radius * 0.35)
      );
      return;
    }
    const newPatch: SceneryPatch = {
      id: 'sp_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      type: activeSpray,
      x: Math.round(x * 10) / 10,
      z: Math.round(z * 10) / 10,
      radius: sprayRadius,
      intensity: sprayIntensity,
      seed: Math.round(Math.abs(x * 13.7 + z * 31.3)) + (Date.now() % 997),
    };
    setSceneryPatches(prev => [...prev, newPatch]);
  };
  const [resetTrigger, setResetTrigger] = useState(0);
  const [raceStartTrigger, setRaceStartTrigger] = useState(0);
  const [recoverTrigger, setRecoverTrigger] = useState(0);
  const [headlightsOn, setHeadlightsOn] = useState<boolean>(true);
  const handleToggleHeadlights = useCallback(() => setHeadlightsOn((prev) => !prev), []);
  const [trackThemeId, setTrackThemeId] = useState<TrackThemeId>('f1_modern');

  // Visual settings
  const [theme, setTheme] = useState<'day' | 'sunset' | 'night'>('day');
  const [showOutlines, setShowOutlines] = useState<boolean>(true);
  const [showGuardrails, setShowGuardrails] = useState<boolean>(true);
  const [showControlPoints, setShowControlPoints] = useState<boolean>(true);
  const [showRedRibbon, setShowRedRibbon] = useState<boolean>(true);
  const [showEmbankments, setShowEmbankments] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);

  // Reference Blueprint Map state
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [showMapOverlay, setShowMapOverlay] = useState<boolean>(false);
  const [mapOpacity, setMapOpacity] = useState<number>(0.7);
  const [mapSize, setMapSize] = useState<number>(1200);
  const [mapOffsetX, setMapOffsetX] = useState<number>(0);
  const [mapOffsetZ, setMapOffsetZ] = useState<number>(0);
  const [mapRotation, setMapRotation] = useState<number>(0);
  const [showMapModal, setShowMapModal] = useState<boolean>(false);
  const [keepTrackOnMapLoad, setKeepTrackOnMapLoad] = useState<boolean>(true);
  const [showSavedModal, setShowSavedModal] = useState<boolean>(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingNode, setIsDraggingNode] = useState<boolean>(false);
  const [isDrawingPit, setIsDrawingPit] = useState<boolean>(false);  const [studioTab, setStudioTab] = useState<StudioTab>('track2d');
  const [newTrackName, setNewTrackName] = useState<string>('');
  const [newTrackSvg, setNewTrackSvg] = useState<string>('');

  const controlsRef = useRef<OrbitControlsImpl>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const currentRawTrack = useMemo(() => {
    return tracksList.find(t => t.id === selectedTrackId) || tracksList[0];
  }, [tracksList, selectedTrackId]);

  // Inicialização: Garantir câmara zenital por defeito para modo estúdio / desenho
  useEffect(() => {
    handleCameraPreset('top');
  }, []);

    // Criar uma pista 100% do zero para desenhar
  const handleCreateNewTrack = () => {
    const nomeNovo = 'Circuito ' + (savedCircuits.length + 1);
    setTrackName(nomeNovo);
    setControlPoints([]);
    setBranches([]);
    setSceneryPatches([]);
    setSelectedBranchNode(null);
    setSelectedPointIndex(null);
    setIsClosed(false);
    setCustomPitNodes(null);
    setPitEntryIndex(null);
    setPitExitIndex(null);
    setMapImageUrl(null);
    setShowMapOverlay(false);
    setStudioTab('track2d');
    setIsStudioOpen(true);
    handleCameraPreset('top');
    try {
      localStorage.removeItem('minirace3d_current_draft');
    } catch {}
    showToast('? Nova pista iniciada! Clica no cho para colocar o Ponto #1.');
    setTimeout(() => showToast(null), 3500);
  };

  const handleAmplitudeChange = (amp: number) => {
    setElevationAmplitude(amp);
    if (!currentRawTrack) return;
    const baseCP = parseStudioControlPoints(currentRawTrack.svg_data, 0.9, 18, isClosed);
    const elevatedCP = applyElevationProfile(
      baseCP,
      elevationType === 'custom' ? 'hills' : elevationType,
      amp
    );
    setControlPoints(elevatedCP);
  };

  const currentSpline = useMemo(() => {
    if (controlPoints.length < 2) return [];
    return computeSpline(controlPoints, isClosed);
  }, [controlPoints, isClosed]);

  const currentPitSpline = useMemo(() => {
    if (customPitNodes && customPitNodes.length >= 2) {
      return fuseAndComputePitLane(controlPoints, customPitNodes, currentSpline);
    }
    if (!disableSvgPit && currentRawTrack && currentRawTrack.pit_svg_data && controlPoints.length > 2) {
      const pitCP = parsePitControlPoints(currentRawTrack.pit_svg_data, 0.9, 11, currentRawTrack.svg_data);
      if (pitCP.length >= 2) {
        return fuseAndComputePitLane(controlPoints, pitCP, currentSpline);
      }
    }
    return undefined;
  }, [customPitNodes, disableSvgPit, currentRawTrack, controlPoints, currentSpline]);

  const trackStats = useMemo(() => {
    if (currentSpline.length === 0) return { length: 0, minZ: 0, maxZ: 0 };
    let minZ = Infinity;
    let maxZ = -Infinity;
    currentSpline.forEach(p => {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    });
    branches.forEach(b => {
      b.points.forEach(bp => {
        const z = bp.z ?? 0;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      });
    });
    const len = currentSpline[currentSpline.length - 1]?.distFromStart || 0;
    return {
      length: Math.round(len),
      minZ: Math.round(minZ * 10) / 10,
      maxZ: Math.round(maxZ * 10) / 10
    };
  }, [currentSpline, branches]);

  const selectedPoint = useMemo(() => {
    if (selectedBranchNode !== null) {
      const br = branches.find(b => b.id === selectedBranchNode.branchId);
      return br?.points[selectedBranchNode.nodeIndex] ?? null;
    }
    return selectedPointIndex !== null ? (controlPoints[selectedPointIndex] ?? null) : null;
  }, [selectedBranchNode, branches, selectedPointIndex, controlPoints]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setSelectedPointIndex(null);
        setSelectedBranchNode(null);
        setIsCreatingRoad(false);
        setIsLinkingRoad(false);
        setActiveBranchId(null);
        setLinkStartNode(null);
        showToast("?? Memria limpa e seleo desmarcada.");
        setTimeout(() => showToast(null), 2000);
      }

      const active = document.activeElement;
      const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

      if ((e.code === 'Delete' || e.code === 'Backspace') && (selectedPointIndex !== null || selectedBranchNode !== null) && !isInput) {
        handleDeleteSelectedPoint();
      }

      if (e.code === 'KeyL' && !e.repeat && !isInput) {
        setHeadlightsOn((prev) => !prev);
      }

      if (e.code === 'KeyE' && !isInput) {
        setShowControlPoints(prev => {
          const next = !prev;
          if (next) {
            setCameraMode('orbit');
            if (selectedPointIndex === null && controlPoints.length > 0) {
              setSelectedPointIndex(0);
            }
          } else {
            setCameraMode('chase');
            setSelectedPointIndex(null);
          }
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPointIndex, selectedBranchNode, controlPoints.length]);

  const resolveTargetPointIndex = (): number | null => {
    const targetIdx = selectedPointIndex !== null ? selectedPointIndex : (controlPoints.length > 0 ? 0 : null);
    if (targetIdx === null || targetIdx >= controlPoints.length) return null;
    if (selectedPointIndex === null) setSelectedPointIndex(targetIdx);
    return targetIdx;
  };

  const handleUpdateSelectedShoulderWidth = (newShoulder: number) => {
    const roundedSW = Math.round(newShoulder * 10) / 10;
    if (selectedBranchNode !== null) {
      setBranches(prev => prev.map(b =>
        b.id === selectedBranchNode.branchId
          ? { ...b, points: b.points.map((bp, i) => i === selectedBranchNode.nodeIndex ? { ...bp, shoulderWidth: roundedSW } : bp) }
          : b
      ));
      return;
    }
    const targetIdx = resolveTargetPointIndex();
    if (targetIdx === null) return;
    setControlPoints(prev => {
      if (targetIdx >= prev.length) return prev;
      const next = [...prev];
      next[targetIdx] = {
        ...next[targetIdx],
        shoulderWidth: roundedSW
      };
      return next;
    });
  };

  const handleUpdateSelectedHeight = (newZ: number) => {
    const roundedZ = Math.round(newZ * 10) / 10;
    if (selectedBranchNode !== null) {
      setBranches(prev => prev.map(b =>
        b.id === selectedBranchNode.branchId
          ? { ...b, points: b.points.map((bp, i) => i === selectedBranchNode.nodeIndex ? { ...bp, z: roundedZ } : bp) }
          : b
      ));
      return;
    }
    const targetIdx = resolveTargetPointIndex();
    if (targetIdx === null) return;
    setElevationType('custom');
    const targetPt = controlPoints[targetIdx];

    setControlPoints(prev => {
      if (targetIdx >= prev.length) return prev;
      const next = [...prev];
      next[targetIdx] = {
        ...next[targetIdx],
        z: roundedZ
      };
      return next;
    });

    // Se o ponto tem estradas/ramais ligados a ele,
    // todos os nós dos ramais cravados sobem exatamente para a mesma altura!
    if (targetPt) {
      setBranches(prev => prev.map(b => ({
        ...b,
        points: b.points.map(bp => {
          if (bp.linkedMainNodeIndex === targetIdx || Math.hypot(bp.x - targetPt.x, bp.y - targetPt.y) < 2.0) {
            return { ...bp, z: roundedZ, linkedMainNodeIndex: targetIdx };
          }
          return bp;
        })
      })));
    }
  };

  const handleUpdateSelectedWidth = (newWidth: number) => {
    const roundedW = Math.round(newWidth * 10) / 10;
    if (selectedBranchNode !== null) {
      setBranches(prev => prev.map(b =>
        b.id === selectedBranchNode.branchId
          ? { ...b, points: b.points.map((bp, i) => i === selectedBranchNode.nodeIndex ? { ...bp, width: roundedW } : bp) }
          : b
      ));
      return;
    }
    const targetIdx = resolveTargetPointIndex();
    if (targetIdx === null) return;
    setControlPoints(prev => {
      if (targetIdx >= prev.length) return prev;
      const next = [...prev];
      next[targetIdx] = {
        ...next[targetIdx],
        width: roundedW
      };
      return next;
    });
  };

  const handleUpdateNodeProperties = (updates: Partial<SplineNode>, applyToAll: boolean = false) => {
    if (applyToAll) {
      setControlPoints(prev => prev.map(p => ({ ...p, ...updates })));
      setBranches(prev => prev.map(b => ({ ...b, points: b.points.map(bp => ({ ...bp, ...updates })) })));
      showToast('✓ Perfil aplicado a toda a pista!');
      return;
    }
    if (selectedBranchNode !== null) {
      setBranches(prev => prev.map(b =>
        b.id === selectedBranchNode.branchId
          ? { ...b, points: b.points.map((bp, i) => i === selectedBranchNode.nodeIndex ? { ...bp, ...updates } : bp) }
          : b
      ));
      return;
    }
    const targetIdx = resolveTargetPointIndex();
    if (targetIdx === null) return;
    setControlPoints(prev => {
      if (targetIdx < prev.length) {
        const next = [...prev];
        next[targetIdx] = { ...next[targetIdx], ...updates };
        return next;
      }
      return prev;
    });
  };

  const handleUpdateSelectedBanking = (newBanking: number) => {
    if (selectedBranchNode !== null) {
      setBranches(prev => prev.map(b =>
        b.id === selectedBranchNode.branchId
          ? { ...b, points: b.points.map((bp, i) => i === selectedBranchNode.nodeIndex ? { ...bp, banking: newBanking } : bp) }
          : b
      ));
      return;
    }
    const targetIdx = resolveTargetPointIndex();
    if (targetIdx === null) return;
    setControlPoints(prev => {
      if (targetIdx >= prev.length) return prev;
      const next = [...prev];
      next[targetIdx] = {
        ...next[targetIdx],
        banking: newBanking
      };
      return next;
    });
  };

  // Limita a inclinação longitudinal entre pontos consecutivos (ex: 0.18 = 18%)
  const handleLimitGrade = (maxGrade: number) => {
    setElevationType('custom');
    setControlPoints(prev => {
      const n = prev.length;
      if (n < 2) return prev;
      const zs = prev.map(p => p.z ?? 0);
      const pairs = isClosed ? n : n - 1;
      for (let iter = 0; iter < 200; iter++) {
        let changed = false;
        for (let k = 0; k < pairs; k++) {
          const k2 = (k + 1) % n;
          const d = Math.max(1, Math.hypot(prev[k2].x - prev[k].x, prev[k2].y - prev[k].y));
          const dz = zs[k2] - zs[k];
          const maxDz = maxGrade * d;
          if (Math.abs(dz) > maxDz + 0.01) {
            const excess = (Math.abs(dz) - maxDz) / 2;
            const s = Math.sign(dz);
            zs[k2] -= s * excess;
            zs[k] += s * excess;
            changed = true;
          }
        }
        if (!changed) break;
      }
      return prev.map((p, i) => ({ ...p, z: Math.round(zs[i] * 10) / 10 }));
    });
  };

  const handleSetAsStartPoint = () => {
    if (selectedPointIndex === null || selectedPointIndex === 0) return;
    const k = selectedPointIndex;
    setControlPoints(prev => {
      return [...prev.slice(k), ...prev.slice(0, k)].map((p, idx) => ({
        ...p,
        nodeIndex: idx
      }));
    });
    setSelectedPointIndex(0);
    setResetTrigger(prev => prev + 1);
  };

  const handleTogglePitBoxPoint = () => {
    if (selectedBranchNode === null) return;
    pushHistory();
    setBranches(prev => prev.map(b => {
      if (b.id !== selectedBranchNode.branchId) return b;
      const wasPitBox = Boolean(b.points[selectedBranchNode.nodeIndex]?.isPitBox);
      return {
        ...b,
        points: b.points.map((bp, i) => ({
          ...bp,
          isPitBox: i === selectedBranchNode.nodeIndex ? !wasPitBox : false
        }))
      };
    }));
  };

  const handleSetAsPitEntry = () => {
    if (selectedPointIndex === null) return;
    setPitEntryIndex(selectedPointIndex);
    setDisableSvgPit(true);
    if (pitExitIndex !== null && pitExitIndex !== selectedPointIndex) {
      const offset = pitSide === 'left' ? pitOffset : -pitOffset;
      const generated = generatePitLaneFromNodes(controlPoints, selectedPointIndex, pitExitIndex, offset);
      setCustomPitNodes(generated);
    }
  };

  const handleAutoGeneratePitLane = () => {
    if (selectedPointIndex === null || controlPoints.length < 5) return;
    const entry = selectedPointIndex;
    const exit = (selectedPointIndex + 4) % controlPoints.length;
    setPitEntryIndex(entry);
    setPitExitIndex(exit);
    setDisableSvgPit(true);
    const offset = pitSide === 'left' ? pitOffset : -pitOffset;
    const generated = generatePitLaneFromNodes(controlPoints, entry, exit, offset);
    setCustomPitNodes(generated);
  };

  const handleSetAsPitExit = () => {
    if (selectedPointIndex === null) return;
    setPitExitIndex(selectedPointIndex);
    setDisableSvgPit(true);
    if (pitEntryIndex !== null && pitEntryIndex !== selectedPointIndex) {
      const offset = pitSide === 'left' ? pitOffset : -pitOffset;
      const generated = generatePitLaneFromNodes(controlPoints, pitEntryIndex, selectedPointIndex, offset);
      setCustomPitNodes(generated);
    }
  };

  const handleTogglePitSide = () => {
    const nextSide = pitSide === 'left' ? 'right' : 'left';
    setPitSide(nextSide);
    if (pitEntryIndex !== null && pitExitIndex !== null && pitEntryIndex !== pitExitIndex) {
      const offset = nextSide === 'left' ? 18 : -18;
      const generated = generatePitLaneFromNodes(controlPoints, pitEntryIndex, pitExitIndex, offset);
      setCustomPitNodes(generated);
    }
  };

    const handleReverseTrack = () => {
    if (controlPoints.length < 2) return;
    pushHistory();
    setControlPoints(prev => [...prev].reverse().map((p, idx) => ({ ...p, nodeIndex: idx })));
    setSelectedPointIndex(0);
    setResetTrigger(prev => prev + 1);
    showToast("🔄 Sentido da pista invertido!");
    setTimeout(() => showToast(null), 2500);
  };

  const handleApplyGlobalDefaults = (defaults: {
    roadWidth: number;
    shoulderWidth: number;
    whiteLineWidth: number;
    curbYellowWidth: number;
    curbRedWidth: number;
    grassWidth: number;
    sandWidth: number;
    gravelWidth: number;
    wallThickness: number;
  }) => {
    pushHistory();
    const applyToNode = (p: SplineNode): SplineNode => ({
      ...p,
      width: defaults.roadWidth,
      shoulderWidth: defaults.shoulderWidth,
      whiteLineWidth: defaults.whiteLineWidth,
      curbYellowWidth: defaults.curbYellowWidth,
      curbRedWidth: defaults.curbRedWidth,
      grassWidth: defaults.grassWidth,
      sandWidth: defaults.sandWidth,
      gravelWidth: defaults.gravelWidth,
      wallThickness: defaults.wallThickness,
      whiteLineWidthL: undefined, whiteLineWidthR: undefined,
      curbYellowWidthL: undefined, curbYellowWidthR: undefined,
      curbRedWidthL: undefined, curbRedWidthR: undefined,
      grassWidthL: undefined, grassWidthR: undefined,
      sandWidthL: undefined, sandWidthR: undefined,
      gravelWidthL: undefined, gravelWidthR: undefined,
      wallThicknessL: undefined, wallThicknessR: undefined
    });
    setControlPoints(prev => prev.map(applyToNode));
    setBranches(prev => prev.map(b => ({ ...b, points: b.points.map(applyToNode) })));
    showToast("📐 Perfil padrão aplicado a toda a pista e Box!");
    setTimeout(() => showToast(null), 2500);
  };

  const handleClearPitLane = () => {
    setCustomPitNodes(null);
    setPitEntryIndex(null);
    setPitExitIndex(null);    setDisableSvgPit(true);
  };

  const handleDeleteSelectedPoint = () => {
    pushHistory();
    if (selectedBranchNode !== null) {
      setBranches(prev => {
        return prev.map(b => {
          if (b.id === selectedBranchNode.branchId) {
            const nextPts = b.points.filter((_, i) => i !== selectedBranchNode.nodeIndex);
            return { ...b, points: nextPts };
          }
          return b;
        }).filter(b => b.points.length >= 2);
      });
      setSelectedBranchNode(null);
      return;
    }

    if (selectedPointIndex === null || controlPoints.length === 0) return;
    setElevationType('custom');
    const idxToRemove = selectedPointIndex;
    setControlPoints(prev => {
      const remaining = prev.filter((_, idx) => idx !== idxToRemove).map((p, idx) => ({ ...p, nodeIndex: idx }));
      return remaining;
    });
    setSelectedPointIndex(prev => {
      if (prev === null || controlPoints.length <= 1) return null;
      return Math.min(prev, controlPoints.length - 2);
    });
    setResetTrigger(prev => prev + 1);
  };

  const handleInsertPointAfter = () => {
    if (selectedBranchNode !== null) {
      const branch = branches.find(b => b.id === selectedBranchNode.branchId);
      if (!branch || branch.points.length === 0) return;
      const bIdx = selectedBranchNode.nodeIndex;
      if (bIdx >= branch.points.length - 1) return;
      pushHistory();
      const pCurr = branch.points[bIdx];
      const pNext = branch.points[bIdx + 1];
      const newPoint: SplineNode = {
        x: (pCurr.x + pNext.x) / 2,
        y: (pCurr.y + pNext.y) / 2,
        z: ((pCurr.z ?? 0) + (pNext.z ?? 0)) / 2,
        width: ((pCurr.width || 18) + (pNext.width || 18)) / 2,
        banking: ((pCurr.banking || 0) + (pNext.banking || 0)) / 2,
        isTunnel: Boolean(pCurr.isTunnel && pNext.isTunnel),
        whiteLineWidth: ((pCurr.whiteLineWidth ?? 0.4) + (pNext.whiteLineWidth ?? 0.4)) / 2,
        curbYellowWidth: ((pCurr.curbYellowWidth ?? 0.6) + (pNext.curbYellowWidth ?? 0.6)) / 2,
        curbRedWidth: ((pCurr.curbRedWidth ?? 0.6) + (pNext.curbRedWidth ?? 0.6)) / 2,
        grassWidth: ((pCurr.grassWidth ?? 2.0) + (pNext.grassWidth ?? 2.0)) / 2,
        sandWidth: ((pCurr.sandWidth ?? 1.5) + (pNext.sandWidth ?? 1.5)) / 2,
        gravelWidth: ((pCurr.gravelWidth ?? 2.0) + (pNext.gravelWidth ?? 2.0)) / 2,
        wallThickness: ((pCurr.wallThickness ?? 0.8) + (pNext.wallThickness ?? 0.8)) / 2,
        shoulderWidth: ((pCurr.shoulderWidth ?? 7.1) + (pNext.shoulderWidth ?? 7.1)) / 2
      };
      setBranches(prev => prev.map(b => {
        if (b.id !== selectedBranchNode.branchId) return b;
        const updated = [...b.points];
        updated.splice(bIdx + 1, 0, newPoint);
        return { ...b, points: updated.map((pt, i) => ({ ...pt, nodeIndex: i })) };
      }));
      setSelectedBranchNode({ branchId: selectedBranchNode.branchId, nodeIndex: bIdx + 1 });
      return;
    }

    if (selectedPointIndex === null || controlPoints.length === 0) return;
    setElevationType('custom');
    const idx = selectedPointIndex;
    const nextIdx = (idx + 1) % controlPoints.length;
    const pCurr = controlPoints[idx];
    const pNext = controlPoints[nextIdx];

    const newPoint: SplineNode = {
      x: (pCurr.x + pNext.x) / 2,
      y: (pCurr.y + pNext.y) / 2,
      z: ((pCurr.z ?? 0) + (pNext.z ?? 0)) / 2,
      width: ((pCurr.width || 18) + (pNext.width || 18)) / 2,
      banking: ((pCurr.banking || 0) + (pNext.banking || 0)) / 2,
      isTunnel: Boolean(pCurr.isTunnel && pNext.isTunnel),
      whiteLineWidth: ((pCurr.whiteLineWidth ?? 0.4) + (pNext.whiteLineWidth ?? 0.4)) / 2,
      curbYellowWidth: ((pCurr.curbYellowWidth ?? 0.6) + (pNext.curbYellowWidth ?? 0.6)) / 2,
      curbRedWidth: ((pCurr.curbRedWidth ?? 0.6) + (pNext.curbRedWidth ?? 0.6)) / 2,
      grassWidth: ((pCurr.grassWidth ?? 2.0) + (pNext.grassWidth ?? 2.0)) / 2,
      sandWidth: ((pCurr.sandWidth ?? 1.5) + (pNext.sandWidth ?? 1.5)) / 2,
      gravelWidth: ((pCurr.gravelWidth ?? 2.0) + (pNext.gravelWidth ?? 2.0)) / 2,
      wallThickness: ((pCurr.wallThickness ?? 0.8) + (pNext.wallThickness ?? 0.8)) / 2,
      shoulderWidth: ((pCurr.shoulderWidth ?? 7.1) + (pNext.shoulderWidth ?? 7.1)) / 2
    };

    const updated = [...controlPoints];
    updated.splice(idx + 1, 0, newPoint);
    setControlPoints(updated);
    setSelectedPointIndex(idx + 1);
    setResetTrigger(prev => prev + 1);
  };

  const handleUpdatePitOffset = (newOffset: number) => {
    setPitOffset(newOffset);
    if (pitEntryIndex !== null && pitExitIndex !== null && pitEntryIndex !== pitExitIndex) {
      const offset = pitSide === 'left' ? newOffset : -newOffset;
      const generated = generatePitLaneFromNodes(controlPoints, pitEntryIndex, pitExitIndex, offset);
      setCustomPitNodes(generated);
    }
  };

  const handleFocusPoint = () => {
    if (!selectedPoint || !controlsRef.current) return;
    setCameraMode('orbit');
    const ctrl = controlsRef.current;
    setAutoRotate(false);
    ctrl.target.set(selectedPoint.x, selectedPoint.z + 2, selectedPoint.y);
    ctrl.object.position.set(selectedPoint.x - 35, selectedPoint.z + 25, selectedPoint.y - 45);
    ctrl.update();
  };

  const handleCameraPreset = (preset: 'iso' | 'top' | 'ground' | 'close') => {
    setCameraPreset(preset);
    setCameraMode('orbit');
    if (!controlsRef.current) return;
    const ctrl = controlsRef.current;
    setAutoRotate(false);

    if (preset === 'iso') {
      ctrl.object.position.set(0, 360, 480);
      ctrl.target.set(0, 0, 0);
    } else if (preset === 'top') {
      ctrl.object.position.set(0, 750, 1);
      ctrl.target.set(0, 0, 0);
    } else if (preset === 'ground') {
      if (currentSpline.length > 0) {
        const p0 = currentSpline[0];
        ctrl.object.position.set(p0.x - 30, p0.z + 10, p0.y - 35);
        ctrl.target.set(p0.x, p0.z + 4, p0.y);
      } else {
        ctrl.object.position.set(-60, 15, -60);
        ctrl.target.set(0, 0, 0);
      }
    } else if (preset === 'close') {
      ctrl.object.position.set(0, 160, 220);
      ctrl.target.set(0, 0, 0);
    }
    ctrl.update();
  };

  const handleScaleTrack = (targetKm: number) => {
    if (!Number.isFinite(targetKm) || targetKm <= 0 || controlPoints.length < 2) return;
    if (targetKm < MIN_TRACK_LENGTH_KM) {
      showToast(`⚠️ Comprimento mínimo permitido: ${MIN_TRACK_LENGTH_KM} km (${Math.round(MIN_TRACK_LENGTH_KM * 1000)} m).`);
      return;
    }
    if (targetKm > MAX_TRACK_LENGTH_KM) {
      if (targetKm >= 200 && targetKm <= MAX_TRACK_LENGTH_KM * 1000) {
        showToast(`⚠️ O campo está em km (máx. ${MAX_TRACK_LENGTH_KM} km), não em metros! Para ${Math.round(targetKm)} m escreve ${(targetKm / 1000).toFixed(2)} km.`);
      } else {
        showToast(`⚠️ Comprimento máximo permitido: ${MAX_TRACK_LENGTH_KM} km.`);
      }
      return;
    }

    pushHistory();
    const targetMeters = targetKm * 1000;
    const { scaledNodes, scaleFactor, centroid } = scaleControlPointsToLength(
      controlPoints,
      targetMeters,
      isClosed
    );
    setControlPoints(scaledNodes);

    // Scale pit lane synchronously if present to maintain alignment
    if (customPitNodes && customPitNodes.length > 0) {
      setCustomPitNodes(scaleNodes2D(customPitNodes, centroid.cx, centroid.cy, scaleFactor));
    } else if (!disableSvgPit && currentRawTrack?.pit_svg_data) {
      const pitCP = parsePitControlPoints(currentRawTrack.pit_svg_data, 0.9, 11, currentRawTrack.svg_data);
      if (pitCP.length >= 2) {
        setCustomPitNodes(scaleNodes2D(pitCP, centroid.cx, centroid.cy, scaleFactor));
        setDisableSvgPit(true);
      }
    }

    if (branches.length > 0) {
      setBranches(prev => prev.map(b => ({
        ...b,
        points: scaleNodes2D(b.points, centroid.cx, centroid.cy, scaleFactor)
      })));
    }

    if (sceneryPatches.length > 0) {
      setSceneryPatches(prev => prev.map(p => ({
        ...p,
        x: Math.round((centroid.cx + (p.x - centroid.cx) * scaleFactor) * 10) / 10,
        z: Math.round((centroid.cy + (p.z - centroid.cy) * scaleFactor) * 10) / 10
      })));
    }

    setElevationType('custom');
    setResetTrigger(prev => prev + 1);
    showToast(`✓ Pista escalada para ${targetKm.toFixed(2)} km (${Math.round(targetMeters)} m).`);
  };


  const handleSwapMapOnly = (url: string) => {
    setMapImageUrl(url);
    setShowMapOverlay(true);
    setShowMapModal(false);
    showToast('🖼️ Imagem de fundo atualizada! A tua pista atual foi mantida.');
  };

  const rasterizeToPngDataUrl = (url: string, baseName: string, wHint?: number, hHint?: number): Promise<{ dataUrl: string; fileName: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const natW = img.naturalWidth || img.width || wHint || 1600;
          const natH = img.naturalHeight || img.height || hHint || 1600;
          const maxDim = 2048;
          const scale = Math.min(1, maxDim / Math.max(natW, natH));
          const cw = Math.max(1, Math.round(natW * scale));
          const ch = Math.max(1, Math.round(natH * scale));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D context unavailable');
          ctx.drawImage(img, 0, 0, cw, ch);
          const pngUrl = canvas.toDataURL('image/png');
          const cleanName = baseName.replace(/\.[^/.]+$/, '') + '.png';
          resolve({ dataUrl: pngUrl, fileName: cleanName });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = url;
    });

  const rasterizeSvgText = async (svgText: string, baseName: string): Promise<{ dataUrl: string; fileName: string }> => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) {
      throw new Error('SVG inválido');
    }
    if (!svgEl.getAttribute('xmlns')) {
      svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    const rawW = svgEl.getAttribute('width') || '';
    const rawH = svgEl.getAttribute('height') || '';
    let w = parseFloat(rawW);
    let h = parseFloat(rawH);
    const hasNumericSize =
      Number.isFinite(w) && w > 0 && !rawW.includes('%') &&
      Number.isFinite(h) && h > 0 && !rawH.includes('%');
    if (!hasNumericSize) {
      const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && Number.isFinite(vb[2]) && vb[2] > 0 && Number.isFinite(vb[3]) && vb[3] > 0) {
        w = vb[2];
        h = vb[3];
      } else {
        w = 1600;
        h = 1600;
      }
    }
    const maxDim = 2048;
    const maxSide = Math.max(w, h);
    const scale = maxSide > maxDim || maxSide < 1024 ? maxDim / maxSide : 1;
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));
    svgEl.setAttribute('width', String(targetW));
    svgEl.setAttribute('height', String(targetH));
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const objUrl = URL.createObjectURL(blob);
    try {
      return await rasterizeToPngDataUrl(objUrl, baseName, targetW, targetH);
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  };

  const prepareUploadedMapDataUrl = async (file: File): Promise<{ dataUrl: string; fileName: string } | null> => {
    const lowerName = file.name.toLowerCase();
    const mime = (file.type || '').toLowerCase();

    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm') || mime === 'text/html') {
      const txt = await file.text();
      const svgMatch = txt.match(/<svg[\s\S]*?<\/svg>/i);
      if (svgMatch) {
        return await rasterizeSvgText(svgMatch[0], file.name);
      }
      showToast("⚠️ Esse ficheiro é uma página HTML (não uma imagem). Abre-o no browser, clica direito na imagem do circuito e escolhe 'Guardar imagem como...' (PNG/JPG/SVG).");
      return null;
    }

    if (lowerName.endsWith('.svg') || mime === 'image/svg+xml') {
      const svgTxt = await file.text();
      return await rasterizeSvgText(svgTxt, file.name);
    }

    if (
      lowerName.endsWith('.avif') ||
      lowerName.endsWith('.bmp') ||
      lowerName.endsWith('.gif') ||
      mime === 'image/avif' ||
      mime === 'image/bmp' ||
      mime === 'image/gif'
    ) {
      const objUrl = URL.createObjectURL(file);
      try {
        return await rasterizeToPngDataUrl(objUrl, file.name);
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const res = ev.target?.result;
        if (typeof res === 'string') resolve(res);
        else reject(new Error('Failed to read file'));
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    return { dataUrl, fileName: file.name };
  };

  const handleSelectReferenceMap = (url: string, originalFileName?: string) => {
    if (keepTrackOnMapLoad && controlPoints.length > 0) {
      handleSwapMapOnly(url);
    } else {
      handleLoadMapAndClear(url, originalFileName);
    }
  };

  const handleLoadMapAndClear = (url: string, originalFileName?: string) => {
    setMapImageUrl(url);
    setShowMapOverlay(true);
    const derivedName = formatBlueprintDisplayName(originalFileName || url);
    const trimmedCurrent = (trackName || '').trim();
    const isDefaultName =
      !trimmedCurrent ||
      /^nova pista$/i.test(trimmedCurrent) ||
      /^circuito(\s+\d+)?$/i.test(trimmedCurrent);
    const nextName = (controlPoints.length > 0 || isDefaultName) ? derivedName : trimmedCurrent;
    setTrackName(nextName);
    setControlPoints([]); // Tela 100% limpa pronta para desenhar
    setBranches([]);
    setSceneryPatches([]);
    setSelectedPointIndex(null);
    setIsClosed(false);
    setCustomPitNodes(null);
    setPitEntryIndex(null);
    setPitExitIndex(null);
    setShowMapModal(false);
    setShowControlPoints(true);
    setCameraMode('orbit');
    handleCameraPreset('top');
    setResetTrigger(prev => prev + 1);
    showToast(`📍 Imagem "${nextName}" pronta no chão! Clica para desenhar.`);
  };

  const handleAddPointAt = (x: number, z: number) => {
    // Se não estivermos a desenhar box e o Modo Construção estiver OFF:
    // NUNCA coloca pontos nem cria estradas!
    if (!isDrawingPit && !isCreatingRoad) {
      if (selectedPointIndex !== null || selectedBranchNode !== null) {
        setSelectedPointIndex(null);
        setSelectedBranchNode(null);
      }
      return;
    }

    // SE NÃO ESTAMOS NA ABA 1 (TRAÇADO) NEM A DESENHAR BOX:
    if (studioTab !== 'track2d' && !isDrawingPit) {
      return;
    }
    if (isDrawingPit) {
      let nodeElevation = 0;
      if (currentSpline && currentSpline.length > 0) {
        let minDist = Infinity;
        for (let i = 0; i < currentSpline.length; i++) {
          const d = Math.hypot(currentSpline[i].x - x, currentSpline[i].y - z);
          if (d < minDist) {
            minDist = d;
            nodeElevation = currentSpline[i].z ?? 0;
          }
        }
      }

      const newPitNode: SplineNode = {
        x: Math.round(x * 10) / 10,
        y: Math.round(z * 10) / 10,
        z: nodeElevation,
        width: 8.5,
        shoulderWidth: 3.5,
        banking: 0
      };
      setCustomPitNodes(prev => [...(prev || []), newPitNode]);
      setDisableSvgPit(true);
      return;
    }

    const roundedX = Math.round(x * 10) / 10;
    const roundedZ = Math.round(z * 10) / 10;

    pushHistory();

    // 1. SE A PISTA PRINCIPAL AINDA NO EST FECHADA:
    // Estamos a desenhar a Pista Principal sequencialmente (Ponto 1, 2, 3...)
    if (!isClosed) {
      const tooClose = controlPoints.some(p => Math.hypot(p.x - x, p.y - z) < 8);
      if (tooClose) return;

      const newIdx = controlPoints.length;
      const prevPt = controlPoints.length > 0 ? controlPoints[controlPoints.length - 1] : null;
      const newPt: SplineNode = {
        x: roundedX,
        y: roundedZ,
        z: prevPt?.z || 0,
        width: prevPt?.width || 18,
        shoulderWidth: prevPt?.shoulderWidth || 7.1,
        whiteLineWidth: 0.4,
        curbYellowWidth: 0.6,
        curbRedWidth: 0.6,
        grassWidth: 2.0,
        sandWidth: 1.5,
        gravelWidth: 2.0,
        wallThickness: 0.8,
        banking: 0,
        nodeIndex: newIdx
      };
      setControlPoints(prev => [...prev, newPt]);
      setSelectedPointIndex(newIdx);
      setElevationType('custom');
      return;
    }

    // 2. SE A PISTA ESTÁ FECHADA E O MODO CONSTRUÇÃO ESTÁ DESLIGADO:
    // NUNCA cria novas estradas acidentais! Apenas desseleciona para libertar o rato.
    if (!isCreatingRoad) {
      if (selectedPointIndex !== null || selectedBranchNode !== null) {
        setSelectedPointIndex(null);
        setSelectedBranchNode(null);
      }
      return;
    }

    // 3. SE O MODO CONSTRUÇÃO ESTÁ LIGADO e estamos a estender um ramal:
    if (selectedBranchNode !== null) {
      const branch = branches.find(b => b.id === selectedBranchNode.branchId);
      if (branch) {
        const fromPt = branch.points[selectedBranchNode.nodeIndex];
        const newPt: SplineNode = {
          x: roundedX,
          y: roundedZ,
          z: fromPt?.z || 0,
          width: fromPt?.width || 18,
          shoulderWidth: 7.1,
          whiteLineWidth: 0.4,
          banking: 0,
          nodeIndex: branch.points.length
        };

        setBranches(prev => prev.map(b => {
          if (b.id === selectedBranchNode.branchId) {
            return { ...b, points: [...b.points, newPt] };
          }
          return b;
        }));
        setSelectedBranchNode({ branchId: selectedBranchNode.branchId, nodeIndex: branch.points.length });
        showToast("✓ Estrada estendida!");
        setTimeout(() => showToast(null), 2000);
        return;
      }
    }

    // 4. SE O MODO CONSTRUÇÃO ESTÁ LIGADO e um ponto da pista principal está selecionado:
    // Cria uma nova estrada a partir dele
    if (selectedPointIndex !== null && selectedPointIndex >= 0 && selectedPointIndex < controlPoints.length) {
      const startPt = controlPoints[selectedPointIndex];
      const newPt: SplineNode = {
        x: roundedX,
        y: roundedZ,
        z: startPt.z || 0,
        width: startPt.width || 18,
        shoulderWidth: 7.1,
        whiteLineWidth: 0.4,
        banking: 0,
        nodeIndex: 1
      };
      const newBranchId = 'branch_' + Date.now();
      const newBranch: RoadBranch = {
        id: newBranchId,
        points: [{ ...startPt, nodeIndex: 0 }, newPt]
      };

      setBranches(prev => [...prev, newBranch]);
      setSelectedBranchNode({ branchId: newBranchId, nodeIndex: 1 });
      setSelectedPointIndex(null);
      showToast(`✓ Nova estrada criada a partir do Ponto #${selectedPointIndex + 1}!`);
      setTimeout(() => showToast(null), 3000);
      return;
    }

    // 5. SE O MODO CONSTRUÇÃO ESTÁ LIGADO e nenhum ponto estava selecionado:
    // Cria uma nova estrada independente
    if (studioTab !== 'track2d') return;

    const newPt: SplineNode = {
      x: roundedX,
      y: roundedZ,
      z: 0,
      width: 18,
      shoulderWidth: 7.1,
      whiteLineWidth: 0.4,
      banking: 0,
      nodeIndex: 0
    };
    const newBranchId = 'branch_' + Date.now();
    setBranches(prev => [...prev, { id: newBranchId, points: [newPt] }]);
    setSelectedBranchNode({ branchId: newBranchId, nodeIndex: 0 });
    showToast("🛣️ Ponto #1 da nova estrada colocado.");
    setTimeout(() => showToast(null), 3000);
  };

  const handleUndoLastPoint = () => {
    if (historyRef.current.length > 0) {
      const lastState = historyRef.current.pop()!;
      setControlPoints(lastState.controlPoints);
      setBranches(lastState.branches);
      setIsClosed(lastState.isClosed);
      setSelectedPointIndex(null);
      setSelectedBranchNode(null);
      showToast("\u21A9 \u00DAltimo movimento anulado!");
      setTimeout(() => showToast(null), 2000);
      return;
    }

    if (branches.length > 0) {
      setBranches(prev => {
        const next = [...prev];
        const lastBranch = next[next.length - 1];
        if (lastBranch.points.length > 2) {
          next[next.length - 1] = { ...lastBranch, points: lastBranch.points.slice(0, -1) };
          return next;
        } else {
          return next.slice(0, -1);
        }
      });
      setSelectedBranchNode(null);
      setSelectedPointIndex(null);
      showToast("\u21A9 \u00DAltima estrada/ponto anulado!");
      setTimeout(() => showToast(null), 2000);
      return;
    }

    if (controlPoints.length > 0) {
      setControlPoints(prev => prev.slice(0, prev.length - 1));
      setSelectedPointIndex(null);
      showToast("\u21A9 \u00DAltimo ponto anulado!");
      setTimeout(() => showToast(null), 2000);
    }
  };

  
  const handleClearSelection = () => {
    setSelectedPointIndex(null);
    setSelectedBranchNode(null);
    setIsCreatingRoad(false);
    setIsLinkingRoad(false);
    setActiveBranchId(null);
    setLinkStartNode(null);
    showToast("?? Memria limpa e seleo desmarcada.");
    setTimeout(() => showToast(null), 2000);
  };

  const handleClearTrackToZero = () => {
    historyRef.current = [];
    setControlPoints([]);
    setBranches([]);
    setSceneryPatches([]);
    setSelectedBranchNode(null);
    setSelectedPointIndex(null);
    setIsClosed(false);
    setCustomPitNodes(null);
    setPitEntryIndex(null);
    setPitExitIndex(null);
    try {
      localStorage.removeItem('minirace3d_current_draft');
    } catch {}
    showToast('? Pista limpa! Clica no cho para comear o Ponto #1.');
    setTimeout(() => showToast(null), 3000);
  };

  const handleMovePoint = (index: number, newX: number, newY: number) => {
    setElevationType('custom');
    const oldPt = controlPoints[index];
    const roundedX = Math.round(newX * 10) / 10;
    const roundedY = Math.round(newY * 10) / 10;

    setControlPoints(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = {
          ...next[index],
          x: roundedX,
          y: roundedY
        };
      }
      return next;
    });

    // Se o ponto arrastado tiver ramais/estradas ligadas a ele, move os nós juntos!
    if (oldPt) {
      setBranches(prev => prev.map(b => ({
        ...b,
        points: b.points.map(bp => {
          if (bp.linkedMainNodeIndex === index || Math.hypot(bp.x - oldPt.x, bp.y - oldPt.y) < 2.0) {
            return { ...bp, x: roundedX, y: roundedY, linkedMainNodeIndex: index };
          }
          return bp;
        })
      })));
    }
  };

  const handleLoadSavedTrack = (circuit: SavedCircuit) => {
    let loadedPoints = circuit.controlPoints || [];
    let loadedBranches = circuit.branches || [];
    let loadedScenery = circuit.sceneryPatches || [];
    let loadedPitNodes = circuit.customPitNodes || null;
    const loadedClosed = circuit.isClosed ?? true;

    const estLen = estimateControlPointsLength(loadedPoints, loadedClosed);
    if (loadedPoints.length >= 2 && estLen > 50_000) {
      const targetMeters =
        estLen / 1000 >= MIN_TRACK_LENGTH_KM * 1000 && estLen / 1000 <= MAX_TRACK_LENGTH_KM * 1000
          ? estLen / 1000
          : 4500;
      const factor = targetMeters / estLen;
      const centroid = computeCentroid2D(loadedPoints);
      loadedPoints = scaleNodes2D(loadedPoints, centroid.cx, centroid.cy, factor);
      loadedBranches = loadedBranches.map(b => ({
        ...b,
        points: scaleNodes2D(b.points, centroid.cx, centroid.cy, factor)
      }));
      if (loadedPitNodes && loadedPitNodes.length > 0) {
        loadedPitNodes = scaleNodes2D(loadedPitNodes, centroid.cx, centroid.cy, factor);
      }
      if (loadedScenery.length > 0) {
        loadedScenery = loadedScenery.map(p => ({
          ...p,
          x: Math.round((centroid.cx + (p.x - centroid.cx) * factor) * 10) / 10,
          z: Math.round((centroid.cy + (p.z - centroid.cy) * factor) * 10) / 10
        }));
      }
      showToast(
        `⚠️ O circuito "${circuit.name}" tinha ${(estLen / 1000).toFixed(1)} km (escala excessiva) e foi recuperado automaticamente para ${(targetMeters / 1000).toFixed(2)} km.`
      );
    }

    setTrackName(circuit.name);
    setControlPoints(loadedPoints);
    setBranches(loadedBranches);
    setSceneryPatches(loadedScenery);
    setSelectedBranchNode(null);
    setCustomPitNodes(loadedPitNodes);
    setIsClosed(loadedClosed);
    if (circuit.mapImageUrl !== undefined) {
      setMapImageUrl(circuit.mapImageUrl);
      setShowMapOverlay(Boolean(circuit.mapImageUrl));
    }
    if (circuit.mapSize !== undefined) setMapSize(circuit.mapSize);
    if (circuit.mapOffsetX !== undefined) setMapOffsetX(circuit.mapOffsetX);
    if (circuit.mapOffsetZ !== undefined) setMapOffsetZ(circuit.mapOffsetZ);
    if (circuit.mapRotation !== undefined) setMapRotation(circuit.mapRotation);
    if (circuit.trackThemeId) setTrackThemeId(circuit.trackThemeId as any);
    setSelectedPointIndex(loadedPoints.length > 0 ? 0 : null);
    setDisableSvgPit(true);
    setResetTrigger(prev => prev + 1);
  };

  const {
    savedCircuits,
    saveSuccessMsg,
    saveCurrentTrack: handleSaveCurrentTrack,
    deleteSavedTrack: handleDeleteSavedTrack,
    exportJson: handleExportJson,
    importJson: handleImportJson
  } = useCircuitStorage({
    trackName,
    controlPoints,
    branches,
    sceneryPatches,
    customPitNodes,
    isClosed,
    mapImageUrl,
    mapSize,
    mapOffsetX,
    mapOffsetZ,
    mapRotation,
    trackThemeId,
    onLoadTrack: handleLoadSavedTrack
  });

  const handleResetTrackToFourPoints = () => {
    setElevationType('custom');
    const starter: SplineNode[] = [
      { x: -180, y: -100, z: 0, width: 18, shoulderWidth: 6.5, banking: 0, nodeIndex: 0 },
      { x: 180, y: -100, z: 0, width: 18, shoulderWidth: 6.5, banking: 0, nodeIndex: 1 },
      { x: 180, y: 100, z: 0, width: 18, shoulderWidth: 6.5, banking: 0, nodeIndex: 2 },
      { x: -180, y: 100, z: 0, width: 18, shoulderWidth: 6.5, banking: 0, nodeIndex: 3 }
    ];
    setControlPoints(starter);
    setBranches([]);
    setSceneryPatches([]);
    setSelectedPointIndex(0);
    setCustomPitNodes(null);
    setPitEntryIndex(null);
    setPitExitIndex(null);
    setResetTrigger(prev => prev + 1);
  };

  const handleAddCustomTrack = () => {
    if (!newTrackSvg.trim()) return;
    const name = newTrackName.trim() || `Pista Custom ${tracksList.length + 1}`;
    const id = `custom_${Date.now()}`;
    const newTrack = {
      id,
      name,
      svg_data: newTrackSvg.trim()
    };
    setTracksList(prev => [newTrack, ...prev]);
    setSelectedTrackId(id);
    // closed import
    setNewTrackName('');
    setNewTrackSvg('');
  };

  const groundY = Math.min(-0.35, trackStats.minZ - 0.35);
  const safetyFloorY = Math.min(-2, trackStats.minZ - 8);
  const safetyFloorPos = useMemo<[number, number, number]>(() => [0, safetyFloorY - 1.0, 0], [safetyFloorY]);
  const isDrivingMode = !isStudioOpen || studioTab === 'play' || cameraMode !== 'orbit';

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#0f172a', cursor: isDrawingPit ? 'crosshair' : 'default' }}>
      {/* Floating Save Confirmation Toast */}
      {(saveSuccessMsg || localToastMsg) && (
        <div style={{
          position: 'absolute',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          background: '#10b981',
          color: '#000',
          padding: '10px 22px',
          borderRadius: 10,
          fontWeight: 900,
          fontSize: 13,
          boxShadow: '0 8px 30px rgba(16, 185, 129, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '2px solid #fff'
        }}>
          <span>{saveSuccessMsg || localToastMsg}</span>
        </div>
      )}

      {/* Floating Top Banner when Drawing Pit Lane */}
      {isDrawingPit && (
        <div style={{
          position: 'absolute',
          top: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'rgba(15, 23, 42, 0.96)',
          border: '2px solid #06b6d4',
          boxShadow: '0 8px 32px rgba(6, 182, 212, 0.4)',
          borderRadius: 12,
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          color: '#fff',
          backdropFilter: 'blur(10px)',
          fontFamily: 'Inter, system-ui, sans-serif'
        }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            🅿️ <b>A desenhar Box com o rato:</b> Clica no mapa nos pontos da Box (Entrada, Garagens, Curva, Saída).
            <span style={{ marginLeft: 10, color: '#38bdf8', fontWeight: 800 }}>({customPitNodes?.length || 0} nós)</span>
          </div>
          <button
            onClick={() => setIsDrawingPit(false)}
            disabled={(customPitNodes?.length || 0) < 2}
            style={{
              background: (customPitNodes?.length || 0) >= 2 ? 'linear-gradient(135deg, #10b981, #059669)' : '#334155',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontWeight: 800,
              fontSize: 12,
              cursor: (customPitNodes?.length || 0) >= 2 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
          >
            ✓ Concluir Box
          </button>
          <button
            onClick={() => setCustomPitNodes(prev => prev && prev.length > 0 ? prev.slice(0, -1) : null)}
            disabled={!customPitNodes || customPitNodes.length === 0}
            style={{
              background: '#334155',
              color: '#e2e8f0',
              border: '1px solid #475569',
              borderRadius: 8,
              padding: '6px 12px',
              fontWeight: 700,
              fontSize: 12,
              cursor: customPitNodes && customPitNodes.length > 0 ? 'pointer' : 'not-allowed'
            }}
          >
            ↩️ Desfazer
          </button>
          <button
            onClick={() => { setCustomPitNodes(null); setIsDrawingPit(false); }}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              color: '#fca5a5',
              border: '1px solid #ef4444',
              borderRadius: 8,
              padding: '6px 12px',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            Cancelar
          </button>
        </div>
      )}
      
      <ErrorBoundary fallbackTitle="Recuperador do Motor 3D">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 750, 1], fov: 50, near: 0.5, far: 10000 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Environment3D theme={theme} groundY={groundY} />

        {/* Priority Click Surface for Drawing Pit Lane */}
        {isDrawingPit && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.6, 0]}
            onClick={(e) => {
              e.stopPropagation();
              handleAddPointAt(e.point.x, e.point.z);
            }}
          >
            <planeGeometry args={[100000, 100000]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        )}

        {/* Reference Blueprint Map on Ground Plane */}
        <ReferenceMapOverlay
          imageUrl={mapImageUrl}
          visible={showMapOverlay}
          opacity={mapOpacity}
          size={mapSize}
          offsetX={mapOffsetX}
          offsetZ={mapOffsetZ}
          rotationAngle={mapRotation}
          groundY={groundY}
          onClick={handleAddPointAt}
        />

        {/* Ground click receiver to place points or spray scenery */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, studioTab === 'scenery' ? groundY + 0.1 : groundY - 0.05, 0]}
          onPointerDown={(e) => {
            pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
            if (studioTab === 'scenery' && activeSpray && e.button === 0) {
              e.stopPropagation();
              isSprayingRef.current = true;
              lastSprayPosRef.current = { x: e.point.x, z: e.point.z };
              applySprayAt(e.point.x, e.point.z);
            }
          }}
          onPointerMove={(e) => {
            if (studioTab === 'scenery') {
              setSprayCursorPos([e.point.x, e.point.z]);
              if (isSprayingRef.current && activeSpray) {
                const last = lastSprayPosRef.current;
                const minStep = activeSpray === 'eraser' ? sprayRadius * 0.3 : sprayRadius * 0.55;
                if (!last || Math.hypot(e.point.x - last.x, e.point.z - last.z) >= minStep) {
                  lastSprayPosRef.current = { x: e.point.x, z: e.point.z };
                  applySprayAt(e.point.x, e.point.z);
                }
              }
            }
          }}
          onPointerUp={() => {
            isSprayingRef.current = false;
            lastSprayPosRef.current = null;
          }}
          onPointerLeave={() => {
            isSprayingRef.current = false;
            lastSprayPosRef.current = null;
            setSprayCursorPos(null);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (studioTab === 'scenery') return; // Pista 100% protegida no modo Relevo!
            if (!pointerDownPosRef.current) return;
            const dist = Math.hypot(e.clientX - pointerDownPosRef.current.x, e.clientY - pointerDownPosRef.current.y);
            pointerDownPosRef.current = null;
            if (dist > 5) return; // Movimento do rato para rodar o mapa: NÃO cria estrada!
            handleAddPointAt(e.point.x, e.point.z);
          }}
        >
          <planeGeometry args={[20000, 20000]} />
          <meshBasicMaterial visible={false} />
        </mesh>

        {/* 3D Scenery & Relief (Mountains, Forests, Cities, Grandstands, Desert, Water) */}
        <Scenery3D
          patches={sceneryPatches}
          spline={currentSpline}
          isClosed={isClosed}
          branches={branches}
          pitSpline={currentPitSpline}
          groundY={groundY}
          cursorPos={studioTab === 'scenery' ? sprayCursorPos : null}
          activeSpray={studioTab === 'scenery' ? activeSpray : null}
          sprayRadius={sprayRadius}
        />

        <Physics gravity={PHYSICS_GRAVITY} timeStep={1 / 60} interpolate={true}>
          {/* Chão sólido infinito de segurança */}
          <RigidBody type="fixed" friction={0.05} restitution={0.05}>
            <CuboidCollider args={SAFETY_FLOOR_ARGS} position={safetyFloorPos} />
          </RigidBody>

          {true && (
            <Track3D
              enablePhysics={true}
              groundY={groundY}
              spline={currentSpline}
            controlPoints={controlPoints}
            pitSpline={currentPitSpline}
            branches={branches}
            selectedBranchNode={selectedBranchNode}
            onSelectBranchNode={(bId, nIdx) => {
              const branch = branches.find(b => b.id === bId);
              const targetPt = branch?.points[nIdx];
              if (!targetPt) return;

              // Se estavamos a desenhar outro ramal e clicamos neste:
              // une os dois ramais e termina (apenas com Modo Construção LIGADO)!
              if (isCreatingRoad && selectedBranchNode !== null && selectedBranchNode.branchId !== bId) {
                pushHistory();
                setBranches(prev => prev.map(b => {
                  if (b.id === selectedBranchNode.branchId) {
                    return { ...b, points: [...b.points, { ...targetPt, nodeIndex: b.points.length }] };
                  }
                  return b;
                }));
                setSelectedBranchNode(null);
                showToast("✓ Estradas unidas!");
                setTimeout(() => showToast(null), 3000);
                return;
              }

              // "se eu ligar 2 pontos eles unem-se":
              // Se tinhamos um ponto da pista principal selecionado e clicamos num no de ramal:
              // APENAS com Modo Construção LIGADO!
              if (isCreatingRoad && selectedPointIndex !== null) {
                pushHistory();
                const ptA = controlPoints[selectedPointIndex];
                const newBranch: RoadBranch = {
                  id: 'branch_' + Date.now(),
                  points: [{ ...ptA, nodeIndex: 0 }, { ...targetPt, nodeIndex: 1 }]
                };
                setBranches(prev => [...prev, newBranch]);
                setSelectedPointIndex(null); // LIMPA A MEMORIA!
                showToast(`✓ Estrada criada a unir Ponto #${selectedPointIndex + 1} a esta estrada!`);
                setTimeout(() => showToast(null), 3000);
                return;
              }

              setSelectedBranchNode({ branchId: bId, nodeIndex: nIdx });
              setSelectedPointIndex(null);
            }}
            onMoveBranchNode={(bId, nIdx, newX, newY) => {
              setBranches(prev => prev.map(b => {
                if (b.id === bId) {
                  const nextPts = [...b.points];
                  if (nextPts[nIdx]) {
                    nextPts[nIdx] = { ...nextPts[nIdx], x: Math.round(newX * 10) / 10, y: Math.round(newY * 10) / 10 };
                  }
                  return { ...b, points: nextPts };
                }
                return b;
              }));
            }}
            selectedPointIndex={selectedPointIndex}
            isClosed={isClosed}
            onSelectPoint={(idx) => {
              const targetPt = controlPoints[idx];

              // A. Se a pista nao esta fechada e clicamos no Ponto 0:
              // Fecha a pista principal!
              if (!isClosed && controlPoints.length >= 3 && idx === 0) {
                pushHistory();
                setIsClosed(true);
                setSelectedPointIndex(null);
                showToast("✓ Circuito fechado com sucesso!");
                setTimeout(() => showToast(null), 3000);
                return;
              }

              // B. Se estavamos a desenhar um ramal e clicamos num ponto existente da pista:
              // APENAS une a estrada se o Modo Construção estiver LIGADO!
              if (isCreatingRoad && selectedBranchNode !== null) {
                pushHistory();
                setBranches(prev => prev.map(b => {
                  if (b.id === selectedBranchNode.branchId) {
                    return {
                      ...b,
                      points: [
                        ...b.points,
                        { ...targetPt, linkedMainNodeIndex: idx, nodeIndex: b.points.length }
                      ]
                    };
                  }
                  return b;
                }));
                setSelectedBranchNode(null);
                setSelectedPointIndex(null); // Conclui e limpa a memoria!
                showToast(`✓ Estrada unida ao Ponto #${idx + 1} com sucesso!`);
                setTimeout(() => showToast(null), 3000);
                return;
              }

              // C. "se eu ligar 2 pontos eles unem-se":
              // Apenas cria nova estrada entre pontos se o MODO CONSTRUÇÃO estiver ATIVO!
              if (isCreatingRoad && selectedPointIndex !== null && selectedPointIndex !== idx) {
                pushHistory();
                const ptA = controlPoints[selectedPointIndex];
                const ptB = controlPoints[idx];
                const newBranch: RoadBranch = {
                  id: 'branch_' + Date.now(),
                  points: [
                    { ...ptA, linkedMainNodeIndex: selectedPointIndex, nodeIndex: 0 },
                    { ...ptB, linkedMainNodeIndex: idx, nodeIndex: 1 }
                  ]
                };
                setBranches(prev => [...prev, newBranch]);
                setSelectedPointIndex(null); // LIMPA A MEMORIA PARA NAO CONTINUAR A LIGAR EM CADEIA!
                showToast(`✓ Estrada criada a unir Ponto #${selectedPointIndex + 1} e Ponto #${idx + 1}!`);
                setTimeout(() => showToast(null), 3000);
                return;
              }

              // D. Se o modo construção está desligado ou nenhum ponto estava selecionado:
              // Simplesmente seleciona o ponto para editar elevação, posição ou parâmetros!
              setSelectedPointIndex(idx);
              setSelectedBranchNode(null);
            }}
            onMovePoint={handleMovePoint}
            onDragStateChange={(drag) => setIsDraggingNode(drag)}
            showOutlines={showOutlines}
            showGuardrails={showGuardrails && (!isStudioOpen || studioTab !== 'track2d')}
            showEmbankments={showEmbankments}
            showLayers={!isStudioOpen || studioTab !== 'track2d'}
            showControlPoints={showControlPoints && !isDrivingMode && studioTab !== 'scenery'}
            showRedRibbon={showRedRibbon && studioTab !== 'scenery'}
            theme={theme}
            trackThemeId={trackThemeId}
          />
        )}

        {/* Visualizacao 3D dos Nos da Box (Apenas visivel no modo de edicao de Boxes, nunca a conduzir) */}
        {isStudioOpen && (studioTab === 'pitlane' || isDrawingPit) && customPitNodes && customPitNodes.map((pt, i) => {
          // If dense generated spline (> 10 nodes), only show entry and exit labels to prevent visual clutter
          if (customPitNodes.length > 10 && i !== 0 && i !== customPitNodes.length - 1) return null;
          const isEntry = i === 0;
          const isExit = i === customPitNodes.length - 1 && customPitNodes.length > 1;
          const color = isEntry ? '#10b981' : (isExit ? '#f59e0b' : '#06b6d4');
          const label = isEntry ? '#1 ENTRADA BOX' : (isExit ? `#${i + 1} SAÍDA BOX` : `#${i + 1} BOX`);

          return (
            <group key={`pit-node-${i}`} position={[pt.x, (pt.z || 0) + 0.6, pt.y]}>
              <mesh>
                <sphereGeometry args={[isEntry || isExit ? 4.2 : 3.2, 16, 16]} />
                <meshStandardMaterial
                  color={color}
                  emissive={color}
                  emissiveIntensity={0.9}
                />
              </mesh>
{/*               <Html */}
{/*                 position={[0, 4.2, 0]} */}
{/*                 center */}
{/*                 distanceFactor={60} */}
{/*                 style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }} */}
{/*               > */}
{/*                 <div style={{ */}
{/*                   background: isEntry ? 'rgba(16, 185, 129, 0.95)' : (isExit ? 'rgba(245, 158, 11, 0.95)' : 'rgba(6, 182, 212, 0.95)'), */}
{/*                   color: '#000000', */}
{/*                   fontSize: 10, */}
{/*                   fontWeight: 900, */}
{/*                   padding: '2px 8px', */}
{/*                   borderRadius: 6, */}
{/*                   boxShadow: '0 2px 8px rgba(0,0,0,0.5)', */}
{/*                   border: '1px solid rgba(255,255,255,0.4)', */}
{/*                   letterSpacing: '0.05em' */}
{/*                 }}> */}
{/*                   {label} */}
{/*                 </div> */}
{/*               </Html> */}
            </group>
          );
        })}
        {/* 3D CAR CONTROLLER & PHYSICS (RAPIER 3D) */}
        {isClosed && currentSpline.length > 2 && (
          <RapierCarController
            spline={currentSpline}
            isClosed={isClosed}
            isRaceActive={isDrivingMode}
            branches={branches}
            pitSpline={currentPitSpline}
            groundY={groundY}
            cameraMode={cameraMode}
            speedPreset={speedPreset}
            carClass={carClass}
            carTuning={carTuning}
            headlightsOn={headlightsOn}
            onToggleHeadlights={handleToggleHeadlights}
            onCycleCamera={() => setCameraMode((prev) => (prev === 'chase' ? 'cockpit' : prev === 'cockpit' ? 'orbit' : 'chase'))}
            environmentTheme={theme}
            resetTrigger={resetTrigger}
            raceStartTrigger={raceStartTrigger}
            recoverTrigger={recoverTrigger}
          />
        )}
        </Physics>

        {/* Free Orbit Controls only when in Orbit mode */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={cameraMode === 'orbit' && !isDraggingNode && !(isStudioOpen && studioTab === 'scenery' && activeSpray !== null)}
          enableDamping
          dampingFactor={0.06}
          minDistance={10}
          maxDistance={3000}
          maxPolarAngle={Math.PI / 2 - 0.01}
          autoRotate={autoRotate}
          autoRotateSpeed={0.8}
        />
      </Canvas>
      </ErrorBoundary>

      {/* DRIVING HUD & SPEEDOMETER */}
      <HUD
        showLapTimer={!isStudioOpen || studioTab === 'play'}
        cameraMode={cameraMode}
        speedPreset={speedPreset}
        onChangeCameraMode={(m) => setCameraMode(m)}
        onChangeSpeedPreset={(p) => setSpeedPreset(p)}
        onResetCar={() => setRecoverTrigger(prev => prev + 1)}
        headlightsOn={headlightsOn}
        onToggleHeadlights={handleToggleHeadlights}
      />

      {/* ======================================================== */}
      {/* 🏁 BARRA SUPERIOR FIXA COLADA AO TOPO (TOP NAVBAR)       */}
      {/* ======================================================== */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 52,
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 100,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.45)',
        gap: 12
      }}>
        {/* 1. LADO ESQUERDO: MENU + CORRIDAS + LOGO + NOME DO CIRCUITO */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
          <button
            onClick={onBackToHome}
            title="Voltar ao Menu Principal"
            style={{
              background: 'rgba(30, 41, 59, 0.9)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 7,
              padding: '5px 9px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <Home size={13} />
            <span>Menu</span>
          </button>
          <button
            onClick={onGoToRace}
            title="Ir para o Modo Corridas (Online & Solo)"
            style={{
              background: 'rgba(225, 29, 72, 0.22)',
              color: '#fda4af',
              border: '1px solid rgba(244, 63, 94, 0.45)',
              borderRadius: 7,
              padding: '5px 9px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <span>🏁 Corridas</span>
          </button>
          <div style={{
            background: 'linear-gradient(135deg, #e11d48, #f43f5e)',
            borderRadius: 8,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 2px 10px rgba(225, 29, 72, 0.4)'
          }}>
            <Flag size={18} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 14, letterSpacing: '0.05em' }}>
                MINIRACE 3D
              </span>
              <span style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontSize: 10,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 5,
                border: '1px solid rgba(56, 189, 248, 0.25)',
                maxWidth: 150,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {trackName || 'Circuito'}
              </span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>
              {controlPoints.length} nós • {((trackStats.length || 0) / 1000).toFixed(2)} km
            </div>
          </div>
        </div>

        {/* 2. CENTRO: CÂMARAS DE CONDUÇÃO, POTÊNCIA & REINICIAR (BOTÕES QUE ESTAVAM FLUTUANTES) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* CÂMARAS */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(15, 23, 42, 0.7)', padding: 3, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <button
              onClick={() => setCameraMode('chase')}
              title="Câmara de seguimento em 3ª pessoa (Tecla C)"
              style={{
                padding: '5px 9px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: cameraMode === 'chase' ? '1px solid #38bdf8' : 'none',
                background: cameraMode === 'chase' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: cameraMode === 'chase' ? '#ffffff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <span>🏎️ 3ª Pessoa (Atrás)</span>
            </button>
            <button
              onClick={() => setCameraMode('cockpit')}
              title="Câmara a bordo no capô (Tecla C)"
              style={{
                padding: '5px 9px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: cameraMode === 'cockpit' ? '1px solid #38bdf8' : 'none',
                background: cameraMode === 'cockpit' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: cameraMode === 'cockpit' ? '#ffffff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <span>👀 Piloto Onboard (T-Cam)</span>
            </button>
            <button
              onClick={() => { setCameraMode('orbit'); handleCameraPreset('iso'); }}
              title="Órbita livre de 360 graus com o rato"
              style={{
                padding: '5px 9px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: cameraMode === 'orbit' && cameraPreset !== 'top' ? '1px solid #38bdf8' : 'none',
                background: cameraMode === 'orbit' && cameraPreset !== 'top' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                color: cameraMode === 'orbit' && cameraPreset !== 'top' ? '#ffffff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <Compass size={13} />
              <span>Órbita 360° (Rato)</span>
            </button>
            <button
              onClick={() => { setCameraMode('orbit'); handleCameraPreset('top'); }}
              title="Vista zenital superior 2D para desenhar"
              style={{
                padding: '5px 9px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                border: cameraMode === 'orbit' && cameraPreset === 'top' ? '1px solid #00f3ff' : 'none',
                background: cameraMode === 'orbit' && cameraPreset === 'top' ? 'rgba(0, 243, 255, 0.25)' : 'transparent',
                color: cameraMode === 'orbit' && cameraPreset === 'top' ? '#00f3ff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
            >
              <Eye size={13} />
              <span>2D Zenital</span>
            </button>
          </div>

          {/* SEPARADOR */}
          <div style={{ width: 1, height: 22, background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px' }} />

          {/* POTÊNCIA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(15, 23, 42, 0.7)', padding: '3px 6px', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', marginRight: 2 }}>POTÊNCIA:</span>
            <button
              onClick={() => setSpeedPreset('calm')}
              title="Velocidade suave e controlável até 140 km/h"
              style={{
                padding: '4px 7px',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                border: speedPreset === 'calm' ? '1px solid #10b981' : 'none',
                background: speedPreset === 'calm' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
                color: speedPreset === 'calm' ? '#34d399' : '#94a3b8'
              }}
            >
              🟢 Calmo (140)
            </button>
            <button
              onClick={() => setSpeedPreset('sport')}
              title="Velocidade média desportiva até 210 km/h"
              style={{
                padding: '4px 7px',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                border: speedPreset === 'sport' ? '1px solid #f59e0b' : 'none',
                background: speedPreset === 'sport' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                color: speedPreset === 'sport' ? '#fbbf24' : '#94a3b8'
              }}
            >
              🟡 Médio (210)
            </button>
            <button
              onClick={() => setSpeedPreset('extreme')}
              title="Potência total de F1 até 340 km/h"
              style={{
                padding: '4px 7px',
                borderRadius: 5,
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                border: speedPreset === 'extreme' ? '1px solid #ef4444' : 'none',
                background: speedPreset === 'extreme' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                color: speedPreset === 'extreme' ? '#f87171' : '#94a3b8'
              }}
            >
              🔴 F1 Real (340)
            </button>
          </div>

          {/* SEPARADOR */}
          <div style={{ width: 1, height: 22, background: 'rgba(255, 255, 255, 0.15)', margin: '0 2px' }} />

          {/* RECUPERAR (R) + REINICIAR CORRIDA */}
          <button
            onClick={() => setRecoverTrigger(prev => prev + 1)}
            title="Voltar à pista junto ao acidente (-35m de penalização)"
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
              gap: 5
            }}
          >
            <RotateCcw size={13} />
            <span>Recuperar (R)</span>
          </button>
          <button
            onClick={() => setResetTrigger(prev => prev + 1)}
            title="Reiniciar corrida do zero na grelha P1 (Shift+R)"
            style={{
              padding: '6px 10px',
              borderRadius: 7,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
          >
            <RotateCcw size={13} />
            <span>Reiniciar</span>
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
              gap: 5
            }}
          >
            <Lightbulb size={13} />
            <span>{headlightsOn ? 'Faróis (L)' : 'Faróis OFF (L)'}</span>
          </button>
        </div>

        {/* 3. LADO DIREITO: ESTÚDIO + CORRER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* BOTÃO ARESTA VERMELHA */}
          <button
            onClick={() => setShowRedRibbon(!showRedRibbon)}
            title="Ligar/Desligar visualização da Aresta Vermelha guia das bermas e muros"
            style={{
              background: showRedRibbon ? 'rgba(239, 68, 68, 0.25)' : 'rgba(30, 41, 59, 0.85)',
              color: showRedRibbon ? '#f87171' : '#94a3b8',
              border: showRedRibbon ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}
          >
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: showRedRibbon ? '#ef4444' : '#64748b' }} />
            <span>Faixa Vermelha {showRedRibbon ? 'ON' : 'OFF'}</span>
          </button>

          {/* BOTÃO ALTERNAR ESTÚDIO */}
          <button
            onClick={() => setIsStudioOpen(!isStudioOpen)}
            style={{
              background: isStudioOpen ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'rgba(30, 41, 59, 0.85)',
              color: '#ffffff',
              border: isStudioOpen ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: isStudioOpen ? '0 2px 10px rgba(2, 132, 199, 0.4)' : 'none'
            }}
          >
            <Sliders size={13} />
            <span>Estúdio {isStudioOpen ? 'ON' : 'OFF'}</span>
          </button>

          {/* BOTÃO CORRER */}
          <button
            onClick={() => {
              setIsStudioOpen(false);
              setCameraMode('chase');
              setRaceStartTrigger(prev => prev + 1);
            }}
            title="Fechar estúdio e acelerar a fundo na pista"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#ffffff',
              border: '1px solid #34d399',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 900,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 12px rgba(16, 185, 129, 0.4)'
            }}
          >
            <Play size={13} fill="#fff" />
            <span>Correr</span>
          </button>
        </div>
      </header>

      {/* TOAST CONFIRMAÇÃO DE GRAVAÇÃO */}
      {saveSuccessMsg && (
        <div style={{
          position: 'fixed',
          top: 64,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(16, 185, 129, 0.95)',
          color: '#ffffff',
          padding: '8px 18px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 800,
          boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
          zIndex: 1200,
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          <CheckCircle2 size={16} />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* MODAL: OS MEUS CIRCUITOS */}
      {showSavedModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 16,
            width: '90%',
            maxWidth: 580,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FolderOpen size={20} color="#38bdf8" />
                <h3 style={{ margin: 0, color: '#f8fafc', fontSize: 16, fontWeight: 800 }}>
                  Os Meus Circuitos Guardados
                </h3>
                <button
                  onClick={() => {
                    handleCreateNewTrack();
                    setShowSavedModal(false);
                  }}
                  style={{
                    background: '#e11d48',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    marginLeft: 8
                  }}
                >
                  <PenTool size={12} />
                  <span>+ Nova Pista</span>
                </button>
                <span style={{
                  background: 'rgba(56, 189, 248, 0.2)',
                  color: '#38bdf8',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 800
                }}>
                  {savedCircuits.length}
                </span>
              </div>
              <button
                onClick={() => setShowSavedModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {savedCircuits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8' }}>
                  <p style={{ margin: '0 0 10px', fontSize: 14 }}>Ainda não tens circuitos guardados.</p>
                  <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                    Desenha um traçado e clica no botão <strong>"Gravar"</strong> na barra superior!
                  </p>
                </div>
              ) : (
                savedCircuits.map(c => (
                  <div
                    key={c.id}
                    style={{
                      background: 'rgba(30, 41, 59, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, color: '#f8fafc', fontSize: 14 }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                        {c.controlPoints?.length || 0} nós • <span style={{ color: '#38bdf8' }}>💾 {c.fileName ? `circuits/${c.fileName}` : 'No Disco'}</span> • {new Date(c.savedAt).toLocaleDateString('pt-PT')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => {
                          handleLoadSavedTrack(c);
                          setShowSavedModal(false);
                        }}
                        style={{
                          background: '#0284c7',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 6,
                          padding: '6px 14px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Carregar
                      </button>
                      <button
                        onClick={() => handleDeleteSavedTrack(c.id)}
                        title="Eliminar este circuito"
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* STUDIO SIDEBAR */}
      <StudioSidebar
        activeTab={studioTab}
        onActiveTabChange={(t) => {
          setStudioTab(t);
          if (t === 'modeling3d' && selectedPointIndex === null && !selectedBranchNode && controlPoints.length > 0) {
            setSelectedPointIndex(0);
          }
        }}
        isOpen={isStudioOpen}
        onClose={() => setIsStudioOpen(false)}
        trackName={trackName}
        onTrackNameChange={(name) => setTrackName(name)}
        onNewTrack={handleCreateNewTrack}
        savedTracks={savedCircuits}
        onSaveTrack={handleSaveCurrentTrack}
        onLoadTrack={handleLoadSavedTrack}
        onDeleteTrack={handleDeleteSavedTrack}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        savedCircuitsCount={savedCircuits.length}
        onOpenSavedCircuits={() => setShowSavedModal(true)}
        saveSuccessMsg={saveSuccessMsg || localToastMsg}
        controlPoints={controlPoints}
        selectedPointIndex={selectedPointIndex}
        onSelectPointIndex={(idx) => {
          setSelectedBranchNode(null);
          setSelectedPointIndex(idx);
          const pt = controlPoints[idx];
          if (pt && controlsRef.current) {
            setCameraMode('orbit');
            setAutoRotate(false);
            const ctrl = controlsRef.current;
            ctrl.target.set(pt.x, (pt.z || 0) + 2, pt.y);
            ctrl.object.position.set(pt.x - 35, (pt.z || 0) + 25, pt.y - 45);
            ctrl.update();
          }
        }}
        branches={branches}
        selectedBranchNode={selectedBranchNode}
        onSelectBranchNode={(sel) => {
          setSelectedBranchNode(sel);
          setSelectedPointIndex(null);
          if (sel && controlsRef.current) {
            const br = branches.find(b => b.id === sel.branchId);
            const pt = br?.points[sel.nodeIndex];
            if (pt) {
              setCameraMode('orbit');
              setAutoRotate(false);
              const ctrl = controlsRef.current;
              ctrl.target.set(pt.x, (pt.z || 0) + 2, pt.y);
              ctrl.object.position.set(pt.x - 35, (pt.z || 0) + 25, pt.y - 45);
              ctrl.update();
            }
          }
        }}
        onClearSelection={handleClearSelection}
        isClosed={isClosed}
        onToggleClosed={() => setIsClosed(!isClosed)}
        onUndoPoint={handleUndoLastPoint}
        onClearTrack={handleClearTrackToZero}
        trackLength={trackStats.length || 0}
        onScaleTrack={handleScaleTrack}
        mapImageUrl={mapImageUrl}
        onOpenMapModal={() => setShowMapModal(true)}
        showMapOverlay={showMapOverlay}
        onToggleMapOverlay={(val) => setShowMapOverlay(val)}
        mapOpacity={mapOpacity}
        onMapOpacityChange={(val) => setMapOpacity(val)}
        mapSize={mapSize}
        onMapSizeChange={(val) => setMapSize(val)}
        mapOffsetX={mapOffsetX}
        onMapOffsetXChange={(val) => setMapOffsetX(val)}
        mapOffsetZ={mapOffsetZ}
        onMapOffsetZChange={(val) => setMapOffsetZ(val)}
        mapRotation={mapRotation}
        onMapRotationChange={(val) => setMapRotation(val)}
        onCameraPreset={handleCameraPreset}
        isCreatingRoad={isCreatingRoad}
        onToggleCreateRoad={() => {
          setIsCreatingRoad(prev => {
            const next = !prev;
            if (!next) {
              setSelectedPointIndex(null);
              setSelectedBranchNode(null);
              showToast("Modo Construção DESLIGADO. Não cria novas estradas.");
            } else {
              showToast("Modo Construção ATIVADO. Podes desenhar estradas.");
            }
            setTimeout(() => showToast(null), 2500);
            return next;
          });
        }}
        isDrawingPit={isDrawingPit}
        onStartDrawPit={() => { setIsDrawingPit(true); setCustomPitNodes([]); setDisableSvgPit(true); }}
        onFinishDrawPit={() => setIsDrawingPit(false)}
        onUndoPitPoint={() => setCustomPitNodes(prev => prev && prev.length > 0 ? prev.slice(0, prev.length - 1) : null)}
        onCancelDrawPit={() => { setCustomPitNodes(null); setIsDrawingPit(false); }}
        customPitNodesCount={customPitNodes?.length || 0}
        hasPitLane={Boolean(currentPitSpline)}
        pitEntryIndex={pitEntryIndex}
        pitExitIndex={pitExitIndex}
        pitSide={pitSide}
        pitOffset={pitOffset}
        onSetStartPoint={handleSetAsStartPoint}
        onSetPitBoxPoint={handleTogglePitBoxPoint}
        onReverseTrack={handleReverseTrack}
        onApplyGlobalDefaults={handleApplyGlobalDefaults}
        onSetPitEntry={handleSetAsPitEntry}
        onSetPitExit={handleSetAsPitExit}
        onAutoGeneratePitLane={handleAutoGeneratePitLane}
        onTogglePitSide={handleTogglePitSide}
        onUpdatePitOffset={handleUpdatePitOffset}
        onClearPitLane={handleClearPitLane}
        selectedPoint={selectedPoint}
        onUpdateHeight={handleUpdateSelectedHeight}
        onUpdateWidth={handleUpdateSelectedWidth}
        onUpdateNodeProperties={handleUpdateNodeProperties}
        onLimitGrade={handleLimitGrade}
        onUpdateBanking={handleUpdateSelectedBanking}
        onUpdateShoulderWidth={handleUpdateSelectedShoulderWidth}
        onDeletePoint={handleDeleteSelectedPoint}
        onInsertPointAfter={handleInsertPointAfter}
        onFocusPoint={handleFocusPoint}
        trackThemeId={trackThemeId as any}
        onChangeTrackTheme={(th) => setTrackThemeId(th as any)}
        environmentTheme={theme}
        onChangeEnvironmentTheme={(th) => setTheme(th)}
        showOutlines={showOutlines}
        onToggleOutlines={(val) => setShowOutlines(val)}
        showGuardrails={showGuardrails}
        onToggleGuardrails={(val) => setShowGuardrails(val)}
        showEmbankments={showEmbankments}
        onToggleEmbankments={(val) => setShowEmbankments(val)}
        showControlPoints={showControlPoints}
        onToggleControlPoints={(val) => setShowControlPoints(val)}
        cameraMode={cameraMode}
        onChangeCameraMode={(m) => setCameraMode(m)}
        speedPreset={speedPreset}
        onChangeSpeedPreset={(p) => setSpeedPreset(p)}
        carClass={carClass}
        onChangeCarClass={(c) => {
          setCarClass(c);
          setCarTuning({ ...CAR_CLASS_DEFAULTS[c] });
        }}
        carTuning={carTuning}
        onChangeCarTuning={setCarTuning}
        activeSpray={activeSpray}
        onChangeActiveSpray={(s) => {
          setActiveSpray(s);
          if (s && s !== 'water' && s !== 'eraser') {
            setSprayRadius((r) => Math.min(r, 180));
          }
        }}
        sprayRadius={sprayRadius}
        onChangeSprayRadius={setSprayRadius}
        sprayIntensity={sprayIntensity}
        onChangeSprayIntensity={setSprayIntensity}
        sceneryPatchCount={sceneryPatches.length}
        onUndoSceneryPatch={() => setSceneryPatches(prev => prev.slice(0, -1))}
        onClearSceneryPatches={() => setSceneryPatches([])}
        onEnterPlayMode={() => {
          isStudioOpen && setIsStudioOpen(false);
          setCameraMode('chase');
          setRaceStartTrigger(prev => prev + 1);
        }}
        onResetCar={() => setResetTrigger(prev => prev + 1)}
      />

      {/* MODAL: IMPORTAR IMAGEM LIMPA */}
      {showMapModal && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100
        }}>
          <div style={{
            width: 460,
            background: '#1e293b',
            border: '1.5px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ImageIcon size={18} color="#38bdf8" />
                <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 16 }}>
                  Importar Imagem do Mapa
                </span>
              </div>
              <button
                onClick={() => setShowMapModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {controlPoints.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, background: '#0f172a', padding: 4, borderRadius: 8, border: '1px solid #334155' }}>
                <button
                  onClick={() => setKeepTrackOnMapLoad(true)}
                  style={{
                    flex: 1,
                    padding: '7px 8px',
                    borderRadius: 6,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    background: keepTrackOnMapLoad ? '#0284c7' : 'transparent',
                    color: keepTrackOnMapLoad ? '#fff' : '#94a3b8'
                  }}
                >
                  🖼️ Só trocar imagem (manter pista)
                </button>
                <button
                  onClick={() => setKeepTrackOnMapLoad(false)}
                  style={{
                    flex: 1,
                    padding: '7px 8px',
                    borderRadius: 6,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    background: !keepTrackOnMapLoad ? '#e11d48' : 'transparent',
                    color: !keepTrackOnMapLoad ? '#fff' : '#94a3b8'
                  }}
                >
                  🧹 Limpar pista e começar do zero
                </button>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                Escolhe a imagem para projetar no chão. A tela ficará 100% limpa para começares a colocar os teus pontos do zero!
              </p>
            )}

            {/* 1. Escolher do computador */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#38bdf8', marginBottom: 6 }}>
                📁 Escolher Imagem do Computador:
              </label>
              <input
                type="file"
                accept="image/*,.svg,.webp,.avif,.png,.jpg,.jpeg,.gif,.bmp,.jfif,.html,.htm"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const prepared = await prepareUploadedMapDataUrl(file);
                    if (!prepared) return;
                    try {
                      const uploadRes = await fetch('/api/upload-map', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dataUrl: prepared.dataUrl, fileName: prepared.fileName })
                      });
                      if (uploadRes.ok) {
                        const data = await uploadRes.json();
                        if (data.url) {
                          handleSelectReferenceMap(data.url, file.name);
                          return;
                        }
                      }
                    } catch {}
                    handleSelectReferenceMap(prepared.dataUrl, file.name);
                  } catch {
                    showToast('⚠️ Não foi possível carregar esse ficheiro como imagem.');
                  }
                }}
                style={{
                  width: '100%',
                  background: '#0f172a',
                  color: '#fff',
                  border: '2px dashed #0284c7',
                  borderRadius: 10,
                  padding: '14px',
                  fontSize: 12,
                  cursor: 'pointer',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* 2. Ou escolher da nossa pasta */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                Ou escolher um circuito da nossa pasta:
              </label>
              <select
                onChange={(e) => {
                  if (e.target.value) handleSelectReferenceMap(e.target.value);
                }}
                defaultValue=""
                style={{
                  width: '100%',
                  background: '#0f172a',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: 12,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="" disabled>-- Selecionar Circuito de Referência --</option>
                <option value="/maps/Estoril.webp">🇵🇹 Circuito do Estoril</option>
                <option value="/maps/Portimao.png">🇵🇹 Autódromo de Portimão (Algarve)</option>
                <option value="/maps/Silverstone_Circuit.png">🇬🇧 Silverstone Grand Prix</option>
                <option value="/maps/Circuit_de_Spa-Francorchamps.png">🇧🇪 Spa-Francorchamps</option>
                <option value="/maps/Monza2.png">🇮🇹 Autodromo Nazionale Monza</option>
                <option value="/maps/Red_Bull_Ring.png">🇦🇹 Red Bull Ring</option>
                <option value="/maps/Interlagos_Circuit.png">🇧🇷 Autódromo de Interlagos</option>
                <option value="/maps/Suzuka_Circuit.png">🇯🇵 Suzuka International Racing Course</option>
                <option value="/maps/Catalunha.jpg">🇪🇸 Circuit de Barcelona-Catalunya</option>
                <option value="/maps/Circuit_Gilles_Villeneuve.png">🇨🇦 Circuit Gilles-Villeneuve</option>
                <option value="/maps/Albert_Park_Circuit.png">🇦🇺 Albert Park (Melbourne)</option>
                <option value="/maps/LasVegas2.png">🇺🇸 Las Vegas Strip Circuit</option>
                <option value="/maps/LUSAIL2.png">🇶🇦 Lusail International Circuit</option>
                <option value="/maps/Celoricodabeira.jpg">🇵🇹 Celorico da Beira</option>
                <option value="/maps/Vialonga.png">🏁 Circuito de Vialonga</option></select>
            </div>
          </div>
        </div>
      )}

            
    </div>
  );
}

