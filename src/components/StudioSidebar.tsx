import React, { useState, useEffect } from 'react';
import {
  SplineNode,
  SavedCircuit,
  SprayCanType,
  RoadBranch,
  parseTrackLengthKmInput,
  MIN_TRACK_LENGTH_KM,
  MAX_TRACK_LENGTH_KM
} from '../tracks';
import { getZone, getZoneColor, ZONE_KEYS, ZONE_COLOR_KEYS, ZONE_DEFAULTS, ZoneKey, ZoneColorKey } from '../trackCorridor';
import { TRACK_THEMES } from '../trackProfile';
import { CarClass } from './Car3D';
import { CAR_CLASS_DEFAULTS, CarTuning } from './RapierCarController';
import {
  X, PenTool, Image as ImageIcon, RotateCcw, Trash2, CheckCircle2,
  Maximize2, Sliders, Layers, Sun, Sunset, Moon, Car, Camera, Zap,
  Compass, ChevronLeft, ChevronRight, Eye, EyeOff, Save, FolderOpen, Download, Upload, Undo2, Focus, PlusCircle, Play
} from 'lucide-react';

export type StudioTab = 'track2d' | 'pitlane' | 'modeling3d' | 'scenery' | 'play';

export interface StudioSidebarProps {
  activeTab?: StudioTab;
  onActiveTabChange?: (tab: StudioTab) => void;
  isOpen: boolean;
  onClose: () => void;
  trackName: string;
  onTrackNameChange: (name: string) => void;
  onNewTrack: () => void;
  savedTracks?: SavedCircuit[];
  onSaveTrack?: () => void;
  onLoadTrack?: (circuit: SavedCircuit) => void;
  onDeleteTrack?: (id: string) => void;
  onExportJson?: () => void;
  onImportJson?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  savedCircuitsCount?: number;
  onOpenSavedCircuits?: () => void;
  saveSuccessMsg?: string | null;
  controlPoints: SplineNode[];
  selectedPointIndex: number | null;
  onSelectPointIndex: (idx: number) => void;
  isClosed: boolean;
  onToggleClosed: () => void;
  onUndoPoint: () => void;
  onClearTrack: () => void;
  trackLength: number;
  onScaleTrack: (km: number) => void;
  mapImageUrl: string | null;
  onOpenMapModal: () => void;
  showMapOverlay: boolean;
  onToggleMapOverlay: (val: boolean) => void;
  mapOpacity: number;
  onMapOpacityChange: (val: number) => void;
  mapSize: number;
  onMapSizeChange: (val: number) => void;
  mapOffsetX: number;
  onMapOffsetXChange: (val: number) => void;
  mapOffsetZ: number;
  onMapOffsetZChange: (val: number) => void;
  mapRotation: number;
  onMapRotationChange: (val: number) => void;
  onCameraPreset: (mode: 'top' | 'iso') => void;  isCreatingRoad?: boolean;
  onToggleCreateRoad?: () => void;
  isLinkingRoad?: boolean;
  onToggleLinkRoad?: () => void;
  onClearSelection?: () => void;
  branches?: RoadBranch[];
  selectedBranchNode?: { branchId: string; nodeIndex: number } | null;
  onSelectBranchNode?: (sel: { branchId: string; nodeIndex: number } | null) => void;
  isDrawingPit: boolean;
  onStartDrawPit: () => void;
  onFinishDrawPit: () => void;
  onUndoPitPoint: () => void;
  onCancelDrawPit: () => void;
  customPitNodesCount: number;
  hasPitLane: boolean;
  pitEntryIndex: number | null;
  pitExitIndex: number | null;
  pitSide: 'left' | 'right';
  pitOffset: number;
  onSetStartPoint?: () => void;
  onSetPitBoxPoint?: () => void;
  onReverseTrack?: () => void;
  onApplyGlobalDefaults?: (defaults: { roadWidth: number; shoulderWidth: number; whiteLineWidth: number; curbYellowWidth: number; curbRedWidth: number; grassWidth: number; sandWidth: number; gravelWidth: number; wallThickness: number }) => void;
  onSetPitEntry: () => void;
  onSetPitExit: () => void;
  onAutoGeneratePitLane: () => void;
  onTogglePitSide: () => void;
  onUpdatePitOffset: (val: number) => void;
  onClearPitLane: () => void;
  selectedPoint: SplineNode | null;
  onUpdateHeight: (z: number) => void;
  onUpdateWidth: (w: number) => void;
  onUpdateNodeProperties?: (updates: Partial<SplineNode>, applyToAll?: boolean) => void;
  onLimitGrade?: (maxGrade: number) => void;
  onUpdateBanking: (b: number) => void;
  onUpdateShoulderWidth: (sw: number) => void;
  onDeletePoint: () => void;
  onInsertPointAfter: () => void;
  onFocusPoint: () => void;
  trackThemeId: 'f1' | 'rally' | 'monaco';
  onChangeTrackTheme: (theme: 'f1' | 'rally' | 'monaco') => void;
  environmentTheme: 'day' | 'sunset' | 'night';
  onChangeEnvironmentTheme: (theme: 'day' | 'sunset' | 'night') => void;
  showOutlines: boolean;
  onToggleOutlines: (val: boolean) => void;
  showGuardrails: boolean;
  onToggleGuardrails: (val: boolean) => void;
  showEmbankments?: boolean;
  onToggleEmbankments?: (val: boolean) => void;
  showControlPoints: boolean;
  onToggleControlPoints: (val: boolean) => void;
  cameraMode: 'chase' | 'cockpit' | 'orbit';
  onChangeCameraMode: (mode: 'chase' | 'cockpit' | 'orbit') => void;
  speedPreset: 'calm' | 'sport' | 'extreme' | string;
  onChangeSpeedPreset: (preset: any) => void;
  carClass?: CarClass;
  onChangeCarClass?: (c: CarClass) => void;
  carTuning?: CarTuning;
  onChangeCarTuning?: (t: CarTuning) => void;
  activeSpray?: SprayCanType | null;
  onChangeActiveSpray?: (s: SprayCanType | null) => void;
  sprayRadius?: number;
  onChangeSprayRadius?: (r: number) => void;
  sprayIntensity?: number;
  onChangeSprayIntensity?: (i: number) => void;
  sceneryPatchCount?: number;
  onUndoSceneryPatch?: () => void;
  onClearSceneryPatches?: () => void;
  onEnterPlayMode: () => void;
  onResetCar: () => void;
}
export const StudioSidebar: React.FC<StudioSidebarProps> = (props) => {
  const [internalTab, setInternalTab] = useState<StudioTab>('track2d');
  const activeTab = props.activeTab || internalTab;
  const [showSavedTracks, setShowSavedTracks] = useState(false);
  const [zoneSide, setZoneSide] = useState<'both' | 'L' | 'R'>('both');
  const [isWideMode, setIsWideMode] = useState(false);
  const setActiveTab = (t: StudioTab) => {
    setInternalTab(t);
    if (props.onActiveTabChange) props.onActiveTabChange(t);
  };
  const [scaleInputKm, setScaleInputKm] = useState<string>(
    props.trackLength > 0 ? (props.trackLength / 1000).toFixed(2) : '4.50'
  );

  useEffect(() => {
    if (props.trackLength > 0) {
      setScaleInputKm((props.trackLength / 1000).toFixed(2));
    }
  }, [props.trackLength]);

  const applyScaleInput = () => {
    const km = parseTrackLengthKmInput(scaleInputKm);
    if (km > 0) props.onScaleTrack(km);
  };

  if (!props.isOpen) return null;

  const currentPt = props.selectedPoint;

  return (
    <div style={{
      position: 'absolute',
      top: 52,
      right: 0,
      width: isWideMode ? '50vw' : 370,
      minWidth: isWideMode ? 540 : undefined,
      maxWidth: isWideMode ? 820 : undefined,
      transition: 'width 0.2s ease',
      height: 'calc(100vh - 52px)',
      backgroundColor: 'rgba(15, 23, 42, 0.96)',
      backdropFilter: 'blur(20px)',
      borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
      boxShadow: '-10px 0 35px rgba(0, 0, 0, 0.65)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 90,
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* HEADER */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(2, 6, 23, 0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
            padding: 7,
            borderRadius: 8,
            boxShadow: '0 0 12px rgba(2, 132, 199, 0.5)'
          }}>
            <Sliders size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: '0.05em' }}>
              ESTUDIO DA PISTA
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>
              Painel Unificado de Criação & Jogo
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setIsWideMode(w => !w)}
            style={{
              background: isWideMode ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: isWideMode ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '5px 8px',
              color: isWideMode ? '#38bdf8' : '#cbd5e1',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer'
            }}
            title="Alternar entre painel compacto e ecrã dividido (50%)"
          >
            {isWideMode ? '⤡ Compacto' : '⤢ Ecrã 50%'}
          </button>
          <button
            onClick={props.onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 8,
              padding: 6,
              color: '#cbd5e1',
              cursor: 'pointer'
            }}
            title="Fechar Estúdio"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {/* 5 MAIN WORKFLOW TABS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        padding: '8px 8px',
        background: 'rgba(15, 23, 42, 0.7)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        gap: 4
      }}>
        {[
          { id: 'track2d', label: '1. Traçado', icon: <PenTool size={13} /> },
          { id: 'pitlane', label: '2. Meta', icon: <Compass size={13} /> },
          { id: 'modeling3d', label: '3. 3D/Estilo', icon: <Layers size={13} /> },
          { id: 'scenery', label: '4. Relevo', icon: <Sliders size={13} /> },
          { id: 'play', label: '5. Corrida', icon: <Car size={13} /> }
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as StudioTab)}
              style={{
                background: isActive ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'rgba(30, 41, 59, 0.6)',
                color: isActive ? '#fff' : '#94a3b9',
                border: isActive ? '1px solid #38bdf8' : '1px solid transparent',
                borderRadius: 8,
                padding: '8px 4px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                boxShadow: isActive ? '0 0 10px rgba(56, 189, 248, 0.3)' : 'none',
                transition: 'all 0.15s'
              }}>
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {/*TAB 1: TRSÇADO 2D */}
        {activeTab === 'track2d' && (
          <>
            <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button
                  onClick={props.onNewTrack}
                  style={{
                    flex: 1,
                    background: 'linear-gradient(135deg, #e11d48, #be123c)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5
                  }}
                  title="Começar uma nova pista do zero"
                >
                  <PenTool size={12} />
                  <span>+ Nova Pista</span>
                </button>
                {props.onOpenSavedCircuits && (
                  <button
                    onClick={props.onOpenSavedCircuits}
                    style={{
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 6,
                      padding: '7px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5
                    }}
                    title="Ver circuitos gravados"
                  >
                    <FolderOpen size={12} />
                    <span>Meus Circuitos ({props.savedCircuitsCount || 0})</span>
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  🏎️ Nome do Circuito
                </span>
                {props.saveSuccessMsg && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#10b981' }}>
                    {props.saveSuccessMsg}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={props.trackName}
                  onChange={(e) => props.onTrackNameChange(e.target.value)}
                  placeholder="Ex: Circuito do Estoril"
                  style={{
                    flex: 1,
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 6,
                    padding: '7px 10px',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700
                  }}
                />
                <button
                  onClick={props.onSaveTrack}
                  style={{
                    background: props.saveSuccessMsg ? '#10b981' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: props.saveSuccessMsg ? '#000' : '#fff',
                    border: props.saveSuccessMsg ? '1px solid #fff' : 'none',
                    borderRadius: 6,
                    padding: '7px 14px',
                    fontSize: 11,
                    fontWeight: 900,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: props.saveSuccessMsg ? '0 0 16px rgba(16, 185, 129, 0.8)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                  title="Gravar circuito e boxes"
                >
                  {props.saveSuccessMsg ? <CheckCircle2 size={14} /> : <Save size={13} />}
                  <span>{props.saveSuccessMsg ? '✓ Guardado!' : 'Gravar'}</span>
                </button>
              </div>

              {/* Botões rápidos: Os Meus Circuitos e Nova Pista */}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  onClick={() => setShowSavedTracks(!showSavedTracks)}
                  style={{
                    flex: 1,
                    background: showSavedTracks ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  <FolderOpen size={13} />
                  <span>Os Meus Circuitos ({props.savedTracks?.length || 0})</span>
                </button>
                <button
                  onClick={props.onNewTrack}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    padding: '7px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="Começar novo traçado do zero"
                >
                  + Novo
                </button>
              </div>

              {/* GAVETA / SUB-PAINEL DOS CIRCUITOS GUARDADOS */}
              {showSavedTracks && (
                <div style={{ marginTop: 10, background: '#0b1329', border: '1px solid #38bdf8', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8' }}>📂 CIRCUITOS GUARDADOS</span>
                    <button
                      onClick={() => setShowSavedTracks(false)}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>

                  {(!props.savedTracks || props.savedTracks.length === 0) ? (
                    <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>
                      Ainda não tens circuitos gravados.<br />Dá um nome acima e clica em <b>[Gravar]</b>!
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {props.savedTracks.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            background: 'rgba(255,255,255,0.04)',
                            borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.06)'
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{c.name}</div>
                            <div style={{ fontSize: 9, color: '#94a3b8' }}>
                              {c.controlPoints?.length || 0} nós {c.customPitNodes && c.customPitNodes.length > 0 ? '• Box' : ''} • <span style={{ color: '#38bdf8' }}>💾 {c.fileName || (c.name + '.json')}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => {
                                props.onLoadTrack(c);
                                setShowSavedTracks(false);
                              }}
                              style={{
                                background: '#0284c7',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 10,
                                fontWeight: 800,
                                cursor: 'pointer'
                              }}
                            >
                              Carregar
                            </button>
                            <button
                              onClick={() => props.onDeleteTrack(c.id)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                color: '#fca5a5',
                                border: 'none',
                                borderRadius: 4,
                                padding: '4px 6px',
                                fontSize: 10,
                                cursor: 'pointer'
                              }}
                              title="Eliminar circuito"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
                    <button
                      onClick={props.onExportJson}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.06)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 4,
                        padding: '5px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <Download size={11} />
                      <span>Exportar JSON</span>
                    </button>
                    <label
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.06)',
                        color: '#cbd5e1',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 4,
                        padding: '5px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <Upload size={11} />
                      <span>Importar JSON</span>
                      <input type="file" accept=".json" onChange={props.onImportJson} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  Imagem de Fundo (Blueprint)
                </span>
                <span style={{ fontSize: 10, color: props.mapImageUrl ? '#10b981' : '#94a3b8', fontWeight: 700 }}>
                  {props.mapImageUrl ? 'Ativo' : 'Nenhuma'}
                </span>
              </div>
              <button
                onClick={props.onOpenMapModal}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 12px',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <ImageIcon size={14} />
                <span>Escolher Imagem (PC ou Biblioteca)</span>
              </button>

              {props.mapImageUrl && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: 'rgba(15, 23, 42, 0.8)',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
                      Imagem Visível:
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => props.onToggleMapOverlay(true)}
                        style={{
                          background: props.showMapOverlay ? '#10b981' : 'rgba(30, 41, 59, 0.8)',
                          color: props.showMapOverlay ? '#ffffff' : '#94a3b8',
                          border: props.showMapOverlay ? '1px solid #34d399' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: 5,
                          padding: '4px 12px',
                          fontSize: 10,
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        SIM
                      </button>
                      <button
                        onClick={() => props.onToggleMapOverlay(false)}
                        style={{
                          background: !props.showMapOverlay ? '#ef4444' : 'rgba(30, 41, 59, 0.8)',
                          color: !props.showMapOverlay ? '#ffffff' : '#94a3b8',
                          border: !props.showMapOverlay ? '1px solid #f87171' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: 5,
                          padding: '4px 12px',
                          fontSize: 10,
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        NÃO
                      </button>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
                      <span>Opacidade:</span>
                      <span>{Math.round(props.mapOpacity * 100)}%H</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={props.mapOpacity}
                      onChange={(e) => props.onMapOpacityChange(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>
                      <span>Escala da Imagem:</span>
                      <span>{props.mapSize}m</span>
                    </div>
                    <input
                      type="range"
                      min="400"
                      max="6000"
                      step="20"
                      value={props.mapSize}
                      onChange={(e) => props.onMapSizeChange(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: '#38bdf8' }}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Desenho do Traçado & Vista Zenital */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  Desenho Ponto a Ponto
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>
                  {props.controlPoints.length} pontos
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: '1.4', marginBottom: 10 }}>
                {props.controlPoints.length === 0
                  ? '👆 Clica no mapa 3D para colocar o Ponto 1 (Partida).'
                  : props.isClosed
                  ? '✓ Circuito fechado e gerado!'
                  : '👆 Clica no mapa para colocar o próximo ponto.'}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={() => props.onCameraPreset('top')}
                  style={{
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#38bdf8',
                    border: '1px solid #38bdf8',
                    borderRadius: 8,
                    padding: '8px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  <span>📐 Vista Zenital 2D (Ideal para decalcar)</span>
                </button>

                <div style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 4
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#f8fafc' }}>
                      Pista Fechada (Anel):
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      {props.isClosed ? '✓ Circuito fechado (gerado)' : 'Desenhando traçado aberto...'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => {
                        if (!props.isClosed) props.onToggleClosed();
                      }}
                      style={{
                        background: props.isClosed ? '#10b981' : 'rgba(30, 41, 59, 0.8)',
                        color: props.isClosed ? '#ffffff' : '#94a3b8',
                        border: props.isClosed ? '1px solid #34d399' : '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: 6,
                        padding: '5px 12px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                      title="Fechar circuito e ligar o último nó ao primeiro"
                    >
                      SIM
                    </button>
                    <button
                      onClick={() => {
                        if (props.isClosed) props.onToggleClosed();
                      }}
                      style={{
                        background: !props.isClosed ? '#f59e0b' : 'rgba(30, 41, 59, 0.8)',
                        color: !props.isClosed ? '#ffffff' : '#94a3b8',
                        border: !props.isClosed ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: 6,
                        padding: '5px 12px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                      title="Manter traçado aberto para desenhar mais pontos"
                    >
                      NÃO
                    </button>
                  </div>
                </div>

                
                                {/* Botoes de Estradas e Memoria */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, marginTop: 4 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={props.onToggleCreateRoad}
                      style={{
                        flex: 1,
                        background: props.isCreatingRoad ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(30, 41, 59, 0.8)',
                        color: props.isCreatingRoad ? '#ffffff' : '#94a3b8',
                        border: '1px solid ' + (props.isCreatingRoad ? '#34d399' : 'rgba(255, 255, 255, 0.15)'),
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 11,
                        fontWeight: 900,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        boxShadow: props.isCreatingRoad ? '0 0 14px rgba(16, 185, 129, 0.4)' : 'none'
                      }}
                      title="Ativa ou desativa a criação de novas estradas ao clicar"
                    >
                      <span>{props.isCreatingRoad ? '🔨 Construção: ATIVO' : '🔨 Modo Construção (Off)'}</span>
                    </button>

                    <button
                      onClick={props.onUndoPoint}
                      style={{
                        flex: 1,
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        borderRadius: 6,
                        padding: '7px 8px',
                        fontSize: 11,
                        fontWeight: 900,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5
                      }}
                      title="Anular o último movimento ou ligação (Ctrl+Z)"
                    >
                      <Undo2 size={13} />
                      <span>Undo / Anular Último</span>
                    </button>
                  </div>

                  <button
                    onClick={props.onClearSelection}
                    style={{
                      background: (props.selectedPointIndex !== null || props.selectedBranchNode !== null) ? 'rgba(56, 189, 248, 0.2)' : 'rgba(148, 163, 184, 0.12)',
                      color: (props.selectedPointIndex !== null || props.selectedBranchNode !== null) ? '#38bdf8' : '#94a3b8',
                      border: '1px solid ' + ((props.selectedPointIndex !== null || props.selectedBranchNode !== null) ? '#38bdf8' : 'rgba(148, 163, 184, 0.3)'),
                      borderRadius: 6,
                      padding: '7px 8px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                  >
                    <span>Limpar Memória / Desmarcar Ponto (Esc)</span>
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {props.controlPoints.length > 0 && !props.isClosed && (
                    <button
                      onClick={props.onUndoPoint}
                      style={{
                        flex: 1,
                        background: 'rgba(51, 65, 85, 0.8)',
                        color: '#cbd5e1',
                        border: '1px solid #475569',
                        borderRadius: 6,
                        padding: '7px',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Undo2 size={12} /> Desfazer</span>
                    </button>
                  )}
                  <button
                    onClick={props.onClearTrack}
                    style={{
                      flex: 1,
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#fca5a5',
                      border: '1px solid #ef4444',
                      borderRadius: 6,
                      padding: '7px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><RotateCcw size={12} /> Limpar</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Escala FIA 1:1 */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                👏 Extensão Real da Pista
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: '#94a3b8' }}>Atual:</span>
                <span style={{ color: '#10b981', fontWeight: 800 }}>
                  {(props.trackLength / 1000).toFixed(2)} km ({Math.round(props.trackLength)} m)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex: 3.34"
                  value={scaleInputKm}
                  onChange={(e) => setScaleInputKm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyScaleInput();
                  }}
                  style={{
                    width: 90,
                    background: '#0f172a',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 6,
                    padding: '6px 8px',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center'
                  }}
                />
                <span style={{ alignSelf: 'center', fontSize: 11, color: '#94a3b8' }}>km</span>
                <button
                  onClick={applyScaleInput}
                  style={{
                    flex: 1,
                    background: '#0284c7',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Escalar Circuito
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
                Em quilómetros (ex: 3.34 = 3340 m · limite {MIN_TRACK_LENGTH_KM}–{MAX_TRACK_LENGTH_KM} km)
              </div>
            </div>

            {/* ELEVAÇÃO (PONTES) & INCLINAÇÃO (BANKING) DIRETAMENTE NO PONTO 1 */}
            {(() => {
              const activeIdx = props.selectedPointIndex !== null ? props.selectedPointIndex : (props.controlPoints.length > 0 ? 0 : null);
              const targetPt = activeIdx !== null ? props.controlPoints[activeIdx] : null;
              if (!targetPt) return null;

              return (
                <button
                  onClick={() => {
                    if (props.selectedPointIndex === null) props.onSelectPointIndex(activeIdx);
                    setActiveTab('modeling3d');
                  }}
                  style={{
                    width: '100%',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: '#38bdf8',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 6
                  }}
                >
                  <span>⛰️ Elevação, Bermas &amp; Inclinação do Ponto #{activeIdx + 1}</span>
                  <span>→</span>
                </button>
              );
            })()}
          </>
        )}
﻿        {/* TAB 2: META, BOXES & VARIAVEIS POR DEFEITO */}
        {activeTab === 'pitlane' && (() => {
          const activeIdx = props.selectedPointIndex;
          const totalPts = props.controlPoints.length;

          return (
            <>
              {/* SECAO 1: LINHA DA META & SENTIDO */}
              <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                    🏁 Linha da Meta & Sentido
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981' }}>
                    {props.isClosed ? 'Circuito Fechado' : 'Troco Aberto'}
                  </span>
                </div>

                <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: '1.4', marginBottom: 10 }}>
                  A meta atual esta no <b>Ponto #1</b>. Para mudares a meta de sitio, clica no ponto pretendido e clica no botao abaixo.
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button
                    onClick={() => props.onSetStartPoint && props.onSetStartPoint()}
                    disabled={activeIdx === null || activeIdx === 0}
                    style={{
                      flex: 1,
                      background: (activeIdx !== null && activeIdx !== 0) ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(51, 65, 85, 0.5)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '8px',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: (activeIdx !== null && activeIdx !== 0) ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    title="Define o ponto selecionado como Linha de Meta e Partida"
                  >
                    <span>🎯 Mudar Meta para Ponto #{activeIdx !== null ? activeIdx + 1 : '?'}</span>
                  </button>

                  {props.onReverseTrack && (
                    <button
                      onClick={props.onReverseTrack}
                      disabled={totalPts < 2}
                      style={{
                        background: 'rgba(30, 41, 59, 0.9)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.3)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: totalPts >= 2 ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                      title="Inverte o sentido de circulacao de toda a pista"
                    >
                      <RotateCcw size={12} />
                      <span>Inverter Sentido</span>
                    </button>
                  )}
                </div>
              </div>

              {/* SECAO 3: VARIAVEIS POR DEFEITO PARA TODA A PISTA */}
              <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  📐 Variaveis por Defeito (Toda a Pista)
                </span>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, marginBottom: 8, lineHeight: 1.4 }}>
                  Configura a base padrao para todos os pontos da pista. Depois podes afinar curva a curva na aba 3D/Estilo.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 10 }}>
                  {[
                    { label: 'Asfalto F1 (18m)', w: 18, sw: 7.1, grass: 2.0, sand: 1.5, grav: 2.0, curb: 0.6 },
                    { label: 'Padrao FIA (14m)', w: 14, sw: 5.0, grass: 2.5, sand: 1.5, grav: 2.0, curb: 0.6 },
                    { label: 'Troco Rali (10m)', w: 10, sw: 3.5, grass: 1.5, sand: 2.5, grav: 3.0, curb: 0.0 },
                    { label: 'Citadino (12m)', w: 12, sw: 2.0, grass: 0.0, sand: 0.0, grav: 0.0, curb: 0.3 }
                  ].map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        if (props.onApplyGlobalDefaults) {
                          props.onApplyGlobalDefaults({
                            roadWidth: preset.w,
                            shoulderWidth: preset.sw,
                            whiteLineWidth: 0.4,
                            curbYellowWidth: preset.curb,
                            curbRedWidth: preset.curb,
                            grassWidth: preset.grass,
                            sandWidth: preset.sand,
                            gravelWidth: preset.grav,
                            wallThickness: 0.8
                          });
                        }
                      }}
                      style={{
                        background: 'rgba(15, 23, 42, 0.8)',
                        color: '#f8fafc',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: 6,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {props.onLimitGrade && (
                  <button
                    onClick={() => props.onLimitGrade(0.18)}
                    style={{
                      width: '100%',
                      background: 'rgba(74, 222, 128, 0.12)',
                      border: '1px solid #4ade80',
                      borderRadius: 6,
                      color: '#4ade80',
                      padding: '6px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                    title="Suaviza inclinacoes excessivas garantindo no maximo 18% de inclinacao"
                  >
                    ⛰️ Suavizar Relevo (Limitar a 18% inclinacao)
                  </button>
                )}
              </div>
            </>
          );
        })()}
        {/*TAB 3: MODELAÇÃO 3D & ESTILO */}
        {activeTab === 'modeling3d' && (() => {
          const activeBranch = props.selectedBranchNode && props.branches
            ? props.branches.find(b => b.id === props.selectedBranchNode!.branchId) || null
            : null;
          const activeBranchPt = activeBranch && props.selectedBranchNode
            ? activeBranch.points[props.selectedBranchNode.nodeIndex] || null
            : null;
          const isEditingBranch = Boolean(activeBranchPt);
          const activeIdx = !isEditingBranch
            ? (props.selectedPointIndex !== null ? props.selectedPointIndex : (props.controlPoints.length > 0 ? 0 : null))
            : null;
          const activePt = isEditingBranch
            ? activeBranchPt
            : (activeIdx !== null && props.controlPoints[activeIdx] ? props.controlPoints[activeIdx] : null);
          const activeKey = isEditingBranch && props.selectedBranchNode
            ? `b_${props.selectedBranchNode.branchId}_${props.selectedBranchNode.nodeIndex}`
            : `m_${activeIdx ?? 'none'}`;

          type NavItem =
            | { kind: 'main'; index: number; seqNum: number }
            | { kind: 'branch'; branchId: string; nodeIndex: number; seqNum: number };
          const navItems: NavItem[] = [];
          for (let i = 0; i < props.controlPoints.length; i++) {
            navItems.push({ kind: 'main', index: i, seqNum: i + 1 });
          }
          let nextSeqNum = props.controlPoints.length + 1;
          for (const br of (props.branches || [])) {
            br.points.forEach((bp, bpIdx) => {
              const sameAsMain = props.controlPoints.some(cp => Math.hypot(cp.x - bp.x, cp.y - bp.y) < 1.0);
              if (!sameAsMain) {
                navItems.push({ kind: 'branch', branchId: br.id, nodeIndex: bpIdx, seqNum: nextSeqNum++ });
              }
            });
          }
          const currentNavIdx = isEditingBranch && props.selectedBranchNode
            ? navItems.findIndex(
                it => it.kind === 'branch' && it.branchId === props.selectedBranchNode!.branchId && it.nodeIndex === props.selectedBranchNode!.nodeIndex
              )
            : (activeIdx !== null ? navItems.findIndex(it => it.kind === 'main' && it.index === activeIdx) : -1);
          const currentNavItem = currentNavIdx >= 0 ? navItems[currentNavIdx] : null;
          const activeSeqNum = currentNavItem ? currentNavItem.seqNum : (activeIdx !== null ? activeIdx + 1 : null);
          const selectNavItem = (item: NavItem) => {
            if (item.kind === 'main') {
              props.onSelectBranchNode?.(null);
              props.onSelectPointIndex(item.index);
            } else {
              props.onSelectBranchNode?.({ branchId: item.branchId, nodeIndex: item.nodeIndex });
            }
          };

          const asphaltW = activePt?.width ?? 18.0;
          const activeThemeCfg = TRACK_THEMES[props.trackThemeId] || TRACK_THEMES.f1_modern;
          const defaultThemeColor: Record<ZoneColorKey, string> = {
            whiteLineColor: activeThemeCfg.whiteLineColor || '#ffffff',
            curbYellowColor: activeThemeCfg.curbWarningColor || '#facc15',
            curbRedColor: activeThemeCfg.curbApexColor || '#dc2626',
            grassColor: activeThemeCfg.grassColor || '#22773b',
            sandColor: activeThemeCfg.sandColor || '#d97706',
            gravelColor: activeThemeCfg.gravelColor || '#78716c',
            wallColor: activeThemeCfg.wallColor || '#ffffff',
          };
          const colorOf = (ck: ZoneColorKey, side: 'L' | 'R') =>
            activePt ? getZoneColor(activePt, ck, side, defaultThemeColor[ck]) : defaultThemeColor[ck];
          const curAsphaltColor = activePt?.asphaltColor || activeThemeCfg.asphaltColor || '#64748b';
          const zoneOf = (key: ZoneKey, side: 'L' | 'R') => activePt ? getZone(activePt, key, side) : ZONE_DEFAULTS[key];
          const whiteLineWL = zoneOf('whiteLineWidth', 'L');
          const whiteLineWR = zoneOf('whiteLineWidth', 'R');
          const curbYellowWL = zoneOf('curbYellowWidth', 'L');
          const curbYellowWR = zoneOf('curbYellowWidth', 'R');
          const curbRedWL = zoneOf('curbRedWidth', 'L');
          const curbRedWR = zoneOf('curbRedWidth', 'R');
          const grassWL = zoneOf('grassWidth', 'L');
          const grassWR = zoneOf('grassWidth', 'R');
          const sandWL = zoneOf('sandWidth', 'L');
          const sandWR = zoneOf('sandWidth', 'R');
          const gravelWL = zoneOf('gravelWidth', 'L');
          const gravelWR = zoneOf('gravelWidth', 'R');
          const wallWL = zoneOf('wallThickness', 'L');
          const wallWR = zoneOf('wallThickness', 'R');
          const sideSum = (s: 'L' | 'R') => ZONE_KEYS.reduce((acc, k) => acc + zoneOf(k, s), 0);
          const totalFaixa = asphaltW + sideSum('L') + sideSum('R');
          const sidesDiffer = ZONE_KEYS.some(k => Math.abs(zoneOf(k, 'L') - zoneOf(k, 'R')) > 0.001);
          const applyZone = (key: string, val: number, targetSide: 'L' | 'R' | 'both' = zoneSide) => {
            if (key === 'width') { props.onUpdateWidth(val); return; }
            if (!props.onUpdateNodeProperties) return;
            if (targetSide === 'both') {
              props.onUpdateNodeProperties({ [key]: val, [key + 'L']: undefined, [key + 'R']: undefined } as Partial<SplineNode>);
            } else {
              props.onUpdateNodeProperties({ [key + targetSide]: val } as Partial<SplineNode>);
            }
          };
          const nPts = props.controlPoints.length;
          const gradeBetween = (a: SplineNode, b: SplineNode) => {
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d < 0.5) return null;
            return { pct: (((b.z ?? 0) - (a.z ?? 0)) / d) * 100, d };
          };
          let gPrev: { pct: number; d: number } | null = null;
          let gNext: { pct: number; d: number } | null = null;
          if (isEditingBranch && activeBranch && props.selectedBranchNode && activePt) {
            const bIdx = props.selectedBranchNode.nodeIndex;
            if (bIdx > 0) gPrev = gradeBetween(activePt, activeBranch.points[bIdx - 1]);
            if (bIdx < activeBranch.points.length - 1) gNext = gradeBetween(activePt, activeBranch.points[bIdx + 1]);
          } else if (activeIdx !== null && nPts >= 2 && activePt) {
            if (props.isClosed || activeIdx < nPts - 1) {
              gNext = gradeBetween(activePt, props.controlPoints[(activeIdx + 1) % nPts]);
            }
            if (props.isClosed || activeIdx > 0) {
              gPrev = gradeBetween(activePt, props.controlPoints[(activeIdx - 1 + nPts) % nPts]);
            }
          }
          const gradeColor = (p: number) => Math.abs(p) <= 12 ? '#4ade80' : Math.abs(p) <= 18 ? '#facc15' : '#f87171';
          const hasAdjacentTunnel = (() => {
            if (!activePt?.isTunnel) return false;
            if (isEditingBranch && activeBranch && props.selectedBranchNode) {
              const bIdx = props.selectedBranchNode.nodeIndex;
              const prevT = bIdx > 0 && Boolean(activeBranch.points[bIdx - 1]?.isTunnel);
              const nextT = bIdx < activeBranch.points.length - 1 && Boolean(activeBranch.points[bIdx + 1]?.isTunnel);
              return prevT || nextT;
            }
            if (activeIdx !== null && nPts >= 2) {
              const hasPrev = props.isClosed || activeIdx > 0;
              const hasNext = props.isClosed || activeIdx < nPts - 1;
              const prevT = hasPrev && Boolean(props.controlPoints[(activeIdx - 1 + nPts) % nPts]?.isTunnel);
              const nextT = hasNext && Boolean(props.controlPoints[(activeIdx + 1) % nPts]?.isTunnel);
              return prevT || nextT;
            }
            return false;
          })();

                    return (
          <>
            {/* BOTÃO DE RELEVO LATERAL (TALUDES) */}
            {props.onToggleEmbankments && (
              <button
                onClick={() => props.onToggleEmbankments?.(!props.showEmbankments)}
                style={{
                  width: '100%',
                  marginBottom: 10,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: props.showEmbankments ? '1px solid #4ade80' : '1px solid rgba(255,255,255,0.14)',
                  background: props.showEmbankments ? 'rgba(74, 222, 128, 0.16)' : 'rgba(30, 41, 59, 0.7)',
                  color: props.showEmbankments ? '#4ade80' : '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>🏔️ Relevo Lateral junto à Pista (Taludes)</span>
                <span>{props.showEmbankments ? 'ON' : 'OFF'}</span>
              </button>
            )}
            {/* 1. SELETOR DE PONTO & NAVEGAÇÃO */}
            <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 900, color: isEditingBranch ? '#f59e0b' : '#38bdf8', textTransform: 'uppercase' }}>
                    {isEditingBranch && props.selectedBranchNode && activeBranch
                      ? `PONTO #${activeSeqNum ?? (props.selectedBranchNode.nodeIndex + 1)}`
                      : (activeIdx !== null ? `PONTO #${activeIdx + 1} DE ${props.controlPoints.length}` : 'NENHUM PONTO')}
                  </span>
                  {isEditingBranch && props.selectedBranchNode && activeBranch && (
                    <span style={{ marginLeft: 6, background: '#f59e0b', color: '#000', fontSize: 9, fontWeight: 900, padding: '2px 5px', borderRadius: 4 }}>
                      BOX / RAMAL · NÓ {props.selectedBranchNode.nodeIndex + 1}/{activeBranch.points.length}
                    </span>
                  )}
                  {isEditingBranch && activePt?.isPitBox && (
                    <span style={{ marginLeft: 6, background: '#10b981', color: '#000', fontSize: 9, fontWeight: 900, padding: '2px 5px', borderRadius: 4 }}>
                      ZONA DA BOX
                    </span>
                  )}
                  {!isEditingBranch && activeIdx === 0 && (
                    <span style={{ marginLeft: 6, background: '#10b981', color: '#000', fontSize: 9, fontWeight: 900, padding: '2px 5px', borderRadius: 4 }}>
                      LINHA DA META
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={() => {
                      if (navItems.length > 0) {
                        const prev = currentNavIdx > 0 ? currentNavIdx - 1 : navItems.length - 1;
                        selectNavItem(navItems[prev]);
                      }
                    }}
                    disabled={navItems.length === 0}
                    style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5, padding: '4px 8px', color: '#cbd5e1', cursor: 'pointer' }}
                    title="Ponto anterior"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    onClick={() => {
                      if (navItems.length > 0) {
                        const next = currentNavIdx >= 0 && currentNavIdx < navItems.length - 1 ? currentNavIdx + 1 : 0;
                        selectNavItem(navItems[next]);
                      }
                    }}
                    disabled={navItems.length === 0}
                    style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5, padding: '4px 8px', color: '#cbd5e1', cursor: 'pointer' }}
                    title="Ponto seguinte"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>

              {/* PAPÉIS EXCLUSIVOS DO PONTO (PARTIDA / BOX / COPIAR) */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {isEditingBranch ? (
                  <button
                    onClick={() => props.onSetPitBoxPoint && props.onSetPitBoxPoint()}
                    style={{
                      flex: 1,
                      minWidth: '115px',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: activePt?.isPitBox ? '1px solid #10b981' : '1px solid rgba(245, 158, 11, 0.45)',
                      background: activePt?.isPitBox ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.12)',
                      color: activePt?.isPitBox ? '#34d399' : '#fbbf24',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    title="Marca este ponto como centro da zona amarela de paragem/reparação da Box (50m). Clica novamente para voltar ao centro automático."
                  >
                    <span>{activePt?.isPitBox ? '✓' : '○'}</span>
                    <span>{activePt?.isPitBox ? '🅿️ Zona da Box (Pit Stop)' : '🅿️ Definir Zona da Box'}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => props.onSetStartPoint && props.onSetStartPoint()}
                    style={{
                      flex: 1,
                      minWidth: '95px',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: activeIdx === 0 ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                      background: activeIdx === 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.04)',
                      color: activeIdx === 0 ? '#34d399' : '#94a3b8',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    title="Marca este ponto como Linha da Meta / Partida (exclusivo)"
                  >
                    <span>{activeIdx === 0 ? '✓' : '○'}</span>
                    <span>🏁 Partida/Meta</span>
                  </button>
                )}
                {((activeIdx !== null && activeIdx > 0) || (isEditingBranch && props.selectedBranchNode && props.selectedBranchNode.nodeIndex > 0)) && props.onUpdateNodeProperties && (
                  <button
                    onClick={() => {
                      const prevPt = isEditingBranch && activeBranch && props.selectedBranchNode
                        ? activeBranch.points[props.selectedBranchNode.nodeIndex - 1]
                        : (activeIdx !== null ? props.controlPoints[activeIdx - 1] : null);
                      if (!prevPt || !props.onUpdateNodeProperties) return;
                      props.onUpdateNodeProperties({
                        width: prevPt.width,
                        whiteLineWidth: prevPt.whiteLineWidth,
                        whiteLineWidthL: prevPt.whiteLineWidthL,
                        whiteLineWidthR: prevPt.whiteLineWidthR,
                        curbYellowWidth: prevPt.curbYellowWidth,
                        curbYellowWidthL: prevPt.curbYellowWidthL,
                        curbYellowWidthR: prevPt.curbYellowWidthR,
                        curbRedWidth: prevPt.curbRedWidth,
                        curbRedWidthL: prevPt.curbRedWidthL,
                        curbRedWidthR: prevPt.curbRedWidthR,
                        grassWidth: prevPt.grassWidth,
                        grassWidthL: prevPt.grassWidthL,
                        grassWidthR: prevPt.grassWidthR,
                        sandWidth: prevPt.sandWidth,
                        sandWidthL: prevPt.sandWidthL,
                        sandWidthR: prevPt.sandWidthR,
                        gravelWidth: prevPt.gravelWidth,
                        gravelWidthL: prevPt.gravelWidthL,
                        gravelWidthR: prevPt.gravelWidthR,
                        wallThickness: prevPt.wallThickness,
                        wallThicknessL: prevPt.wallThicknessL,
                        wallThicknessR: prevPt.wallThicknessR,
                        asphaltColor: prevPt.asphaltColor,
                        whiteLineColor: prevPt.whiteLineColor,
                        whiteLineColorL: prevPt.whiteLineColorL,
                        whiteLineColorR: prevPt.whiteLineColorR,
                        curbYellowColor: prevPt.curbYellowColor,
                        curbYellowColorL: prevPt.curbYellowColorL,
                        curbYellowColorR: prevPt.curbYellowColorR,
                        curbRedColor: prevPt.curbRedColor,
                        curbRedColorL: prevPt.curbRedColorL,
                        curbRedColorR: prevPt.curbRedColorR,
                        grassColor: prevPt.grassColor,
                        grassColorL: prevPt.grassColorL,
                        grassColorR: prevPt.grassColorR,
                        sandColor: prevPt.sandColor,
                        sandColorL: prevPt.sandColorL,
                        sandColorR: prevPt.sandColorR,
                        gravelColor: prevPt.gravelColor,
                        gravelColorL: prevPt.gravelColorL,
                        gravelColorR: prevPt.gravelColorR,
                        wallColor: prevPt.wallColor,
                        wallColorL: prevPt.wallColorL,
                        wallColorR: prevPt.wallColorR,
                        z: prevPt.z ?? 0,
                        banking: prevPt.banking,
                      }, false);
                    }}
                    style={{
                      flex: 1,
                      minWidth: '110px',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(56, 189, 248, 0.45)',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    title="Copiar larguras, cores e inclinação do ponto anterior"
                  >
                    <span>📋 Copiar do Anterior</span>
                  </button>
                )}
              </div>

              {activePt ? (
                <>
                  {/* 3. AFINA??O ESPEC?FICA DESTE PONTO (PASSPO 3) (15 ZONAS ESPECIFICADAS) */}
                  <div style={{ background: '#0b1329', padding: 12, borderRadius: 10, border: '1px solid #1e293b', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: '#38bdf8', letterSpacing: '0.04em' }}>
                        📐 PERFIL TRANSVERSAL (15 ZONAS)
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>
                        Faixa Total: <b style={{ color: '#fff', fontSize: 12 }}>{totalFaixa.toFixed(1)} m</b>
                      </span>
                    </div>

                    {/* SELETOR DE LADO */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      {([
                        { id: 'L', label: '◀ Esquerda' },
                        { id: 'both', label: 'Ambos os lados' },
                        { id: 'R', label: 'Direita ▶' }
                      ] as const).map(o => (
                        <button
                          key={o.id}
                          onClick={() => setZoneSide(o.id)}
                          style={{
                            flex: 1,
                            background: zoneSide === o.id ? '#0284c7' : 'rgba(255,255,255,0.05)',
                            color: zoneSide === o.id ? '#fff' : '#94a3b8',
                            border: zoneSide === o.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 5,
                            padding: '5px 2px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    {zoneSide === 'both' && sidesDiffer && (
                      <div style={{ fontSize: 9, color: '#facc15', marginBottom: 6 }}>
                        ⚠ Os lados têm medidas diferentes. Alterar em "Ambos" iguala essa faixa nos dois lados (mostra o lado esquerdo).
                      </div>
                    )}

                    {/* CORTE GRÁFICO VISUAL PROPORCIONAL DA ESTRADA */}
                    <div style={{
                      display: 'flex',
                      height: 36,
                      borderRadius: 6,
                      overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.18)',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                      marginBottom: 10
                    }}>
                      {[
                        { k: 'wallThickness', c: colorOf('wallColor', 'L') },
                        { k: 'gravelWidth', c: colorOf('gravelColor', 'L') },
                        { k: 'sandWidth', c: colorOf('sandColor', 'L') },
                        { k: 'grassWidth', c: colorOf('grassColor', 'L') },
                        { k: 'curbRedWidth', c: colorOf('curbRedColor', 'L') },
                        { k: 'curbYellowWidth', c: colorOf('curbYellowColor', 'L') },
                        { k: 'whiteLineWidth', c: colorOf('whiteLineColor', 'L') }
                      ].map(z => (
                        <div key={'L' + z.k} style={{ width: `${(zoneOf(z.k as ZoneKey, 'L') / totalFaixa) * 100}%`, background: z.c, opacity: zoneSide === 'R' ? 0.35 : 1 }} title={`${z.k} Esq: ${zoneOf(z.k as ZoneKey, 'L').toFixed(1)}m`} />
                      ))}
                      <div style={{
                        width: `${(asphaltW / totalFaixa) * 100}%`,
                        background: curAsphaltColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderLeft: '1px solid rgba(255,255,255,0.25)',
                        borderRight: '1px solid rgba(255,255,255,0.25)'
                      }}>
                        <span style={{ fontSize: 10, color: '#fff', fontWeight: 900, textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>{asphaltW.toFixed(1)}m</span>
                      </div>
                      {[
                        { k: 'wallThickness', c: colorOf('wallColor', 'R') },
                        { k: 'gravelWidth', c: colorOf('gravelColor', 'R') },
                        { k: 'sandWidth', c: colorOf('sandColor', 'R') },
                        { k: 'grassWidth', c: colorOf('grassColor', 'R') },
                        { k: 'curbRedWidth', c: colorOf('curbRedColor', 'R') },
                        { k: 'curbYellowWidth', c: colorOf('curbYellowColor', 'R') },
                        { k: 'whiteLineWidth', c: colorOf('whiteLineColor', 'R') }
                      ].slice().reverse().map(z => (
                        <div key={'R' + z.k} style={{ width: `${(zoneOf(z.k as ZoneKey, 'R') / totalFaixa) * 100}%`, background: z.c, opacity: zoneSide === 'L' ? 0.35 : 1 }} title={`${z.k} Dir: ${zoneOf(z.k as ZoneKey, 'R').toFixed(1)}m`} />
                      ))}
                    </div>

                    {/* CONTROLOS DE AJUSTE DIRETO PARA CADA UMA DAS VARIÁVEIS */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 8 }}>
                      {(() => {
                        const colorSide: 'L' | 'R' = zoneSide === 'R' ? 'R' : 'L';
                        return [
                          { key: 'width', name: 'Asfalto', valL: asphaltW, valR: asphaltW, step: 1.0, min: 6.0, max: 32.0, bg: '#0284c7', text: '#fff', colorKey: 'asphaltColor', curColor: curAsphaltColor },
                          { key: 'whiteLineWidth', name: 'Linha Branc', valL: whiteLineWL, valR: whiteLineWR, step: 0.1, min: 0.0, max: 5.0, bg: '#ffffff', text: '#000', colorKey: 'whiteLineColor', curColor: colorOf('whiteLineColor', colorSide) },
                          { key: 'curbYellowWidth', name: 'Z. Amarela', valL: curbYellowWL, valR: curbYellowWR, step: 0.1, min: 0.0, max: 5.0, bg: '#facc15', text: '#000', colorKey: 'curbYellowColor', curColor: colorOf('curbYellowColor', colorSide) },
                          { key: 'curbRedWidth', name: 'Z. Vermelha', valL: curbRedWL, valR: curbRedWR, step: 0.1, min: 0.0, max: 5.0, bg: '#ef4444', text: '#fff', colorKey: 'curbRedColor', curColor: colorOf('curbRedColor', colorSide) },
                          { key: 'grassWidth', name: 'Relva', valL: grassWL, valR: grassWR, step: 0.5, min: 0.0, max: 25.0, bg: '#15803d', text: '#fff', colorKey: 'grassColor', curColor: colorOf('grassColor', colorSide) },
                          { key: 'sandWidth', name: 'Areia', valL: sandWL, valR: sandWR, step: 0.5, min: 0.0, max: 25.0, bg: '#d97706', text: '#fff', colorKey: 'sandColor', curColor: colorOf('sandColor', colorSide) },
                          { key: 'gravelWidth', name: 'Gravilha', valL: gravelWL, valR: gravelWR, step: 0.5, min: 0.0, max: 25.0, bg: '#57534e', text: '#fff', colorKey: 'gravelColor', curColor: colorOf('gravelColor', colorSide) },
                          { key: 'wallThickness', name: 'Muro', valL: wallWL, valR: wallWR, step: 0.1, min: 0.2, max: 2.0, bg: '#94a3b8', text: '#000', colorKey: 'wallColor', curColor: colorOf('wallColor', colorSide) }
                        ];
                      })().map((item) => {
                        const isMixedBoth = zoneSide === 'both' && item.key !== 'width' && Math.abs(item.valL - item.valR) > 0.04;
                        const displayVal = isMixedBoth
                          ? `${item.valL.toFixed(1)} - ${item.valR.toFixed(1)}`
                          : (zoneSide === 'R' ? item.valR : item.valL).toFixed(1);
                        const captureSide = zoneSide;
                        const commitInput = (raw: string) => {
                          const trimmed = raw.trim().replace(/,/g, '.');
                          if (!trimmed) return;
                          const clampV = (v: number) => Math.max(item.min, Math.min(item.max, Math.round(v * 10) / 10));
                          if (captureSide === 'both' && item.key !== 'width' && trimmed.includes('-')) {
                            const parts = trimmed.split('-').map(s => parseFloat(s.trim()));
                            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && props.onUpdateNodeProperties) {
                              props.onUpdateNodeProperties({
                                [item.key + 'L']: clampV(parts[0]),
                                [item.key + 'R']: clampV(parts[1]),
                              } as Partial<SplineNode>);
                              return;
                            }
                          }
                          const n = parseFloat(trimmed);
                          if (!isNaN(n)) applyZone(item.key, clampV(n), captureSide);
                        };
                        return (
                        <div key={item.key} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '4px', border: isMixedBoth ? '1px solid rgba(250, 204, 21, 0.45)' : '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                          <div style={{ background: item.bg, color: item.text, borderRadius: 3, padding: '2px 3px', fontWeight: 900, fontSize: 8, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {item.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 5 }}>
                            <input
                              type={isMixedBoth ? 'text' : 'number'}
                              step={item.step}
                              min={item.min}
                              max={item.max}
                              defaultValue={displayVal}
                              key={`${activeKey}_${captureSide}_${item.key}_${item.valL.toFixed(1)}_${item.valR.toFixed(1)}`}
                              onBlur={(e) => commitInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  commitInput((e.target as HTMLInputElement).value);
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              style={{
                                width: '100%',
                                background: 'rgba(0,0,0,0.6)',
                                border: '1px solid rgba(255,255,255,0.22)',
                                borderRadius: 5,
                                color: isMixedBoth ? '#facc15' : '#f8fafc',
                                fontSize: isMixedBoth ? 11 : 14,
                                fontWeight: 800,
                                textAlign: 'center',
                                padding: isMixedBoth ? '7px 2px' : '5px 4px'
                              }}
                              title={isMixedBoth ? 'Esq - Dir (m). Escreve um número para igualar ou "X - Y"' : 'Escreve o valor numérico diretamente (m)'}
                            />
                          </div>
 {item.colorKey && (
 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4, gap: 3 }}>
 <input
                                type="color"
                                value={item.curColor}
                                onChange={(e) => {
                                  if (!props.onUpdateNodeProperties) return;
                                  const nextCol = e.target.value;
                                  if (item.colorKey === 'asphaltColor') {
                                    props.onUpdateNodeProperties({ asphaltColor: nextCol });
                                  } else if (captureSide === 'both') {
                                    props.onUpdateNodeProperties({
                                      [item.colorKey]: nextCol,
                                      [item.colorKey + 'L']: nextCol,
                                      [item.colorKey + 'R']: nextCol
                                    } as Partial<SplineNode>);
                                  } else {
                                    props.onUpdateNodeProperties({
                                      [item.colorKey + captureSide]: nextCol
                                    } as Partial<SplineNode>);
                                  }
                                }}
                                title={item.name}
                                style={{
                                  width: 18,
                                  height: 16,
                                  padding: 0,
                                  border: '1px solid rgba(255,255,255,0.25)',
                                  borderRadius: 3,
                                  background: 'none',
                                  cursor: 'pointer'
                                }}
                              />
                              <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 700 }}>Cor</span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>

                    {/* BOTÃO APLICAR A TODA A PISTA */}
                    <button
                      onClick={() => {
                        if (!props.onUpdateNodeProperties || !activePt) return;
                        const upd: Record<string, number | string | undefined> = { width: asphaltW };
                        ZONE_KEYS.forEach(k => {
                          upd[k] = zoneOf(k, 'L');
                          upd[k + 'L'] = zoneOf(k, 'L');
                          upd[k + 'R'] = zoneOf(k, 'R');
                        });
                        upd.asphaltColor = activePt.asphaltColor;
                        const activePtRecord = activePt as unknown as Record<string, unknown>;
                        ZONE_COLOR_KEYS.forEach(ck => {
                          upd[ck] = activePtRecord[ck] as string | undefined;
                          upd[ck + 'L'] = activePtRecord[ck + 'L'] as string | undefined;
                          upd[ck + 'R'] = activePtRecord[ck + 'R'] as string | undefined;
                        });
                        props.onUpdateNodeProperties(upd as Partial<SplineNode>, true);
                      }}
                      style={{
                        width: '100%',
                        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(2, 132, 199, 0.2))',
                        border: '1px solid #38bdf8',
                        borderRadius: 6,
                        color: '#38bdf8',
                        padding: '6px',
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                      >
                      ⚡ Aplicar este perfil (Esq + Dir) a TODA a pista
                    </button>

                    {/* ATALHOS RÁPIDOS DE LARGURA DO ASFALTO */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      {[
                        { label: 'Chicane 10m', val: 10 },
                        { label: 'F1 Padrão 14m', val: 14 },
                        { label: 'Larga 18m', val: 18 },
                        { label: 'Reta 22m', val: 22 }
                      ].map(p => (
                        <button
                          key={p.val}
                          onClick={() => props.onUpdateWidth(p.val)}
                          style={{
                            flex: 1,
                            background: Math.round(asphaltW) === p.val ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.04)',
                            color: Math.round(asphaltW) === p.val ? '#38bdf8' : '#94a3b8',
                            border: Math.round(asphaltW) === p.val ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 4,
                            padding: '4px 2px',
                            fontSize: 9,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 2b. INCLINAÇÃO LONGITUDINAL (DECLIVE) */}
                  <div style={{ background: '#0b1329', padding: 10, borderRadius: 8, border: '1px solid #1e293b', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 }}>📈 Declive da estrada</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
                      <span>← do anterior: {gPrev ? <b style={{ color: gradeColor(gPrev.pct) }}>{(-gPrev.pct).toFixed(1)}%</b> : '—'}</span>
                      <span>para o seguinte →: {gNext ? <b style={{ color: gradeColor(gNext.pct) }}>{gNext.pct.toFixed(1)}%</b> : '—'}</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>
                      Verde ≤ 12% (F1) · Amarelo ≤ 18% (Montanha) · Vermelho &gt; 25% (Parede / parte o carro)
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        onClick={() => props.onLimitGrade?.(0.15)}
                        style={{ flex: 1, background: 'rgba(74, 222, 128, 0.12)', border: '1px solid #4ade80', borderRadius: 6, color: '#4ade80', padding: '5px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                        title="Limita toda a pista a 15% de inclinação (Fórmula 1 / GT)"
                      >
                        🏎️ Máx 15% (F1)
                      </button>
                      <button
                        onClick={() => props.onLimitGrade?.(0.22)}
                        style={{ flex: 1, background: 'rgba(245, 158, 11, 0.12)', border: '1px solid #f59e0b', borderRadius: 6, color: '#fbbf24', padding: '5px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
                        title="Limita toda a pista a 22% de inclinação (Rally / Montanha)"
                      >
                        ⛰️ Máx 22% (Rally)
                      </button>
                    </div>
                  </div>

                  {/* 3. ELEVAÇÃO (Z) */}
                  <div style={{ background: '#0b1329', padding: 10, borderRadius: 8, border: '1px solid #1e293b', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                        ⛰️ Elevação (Z):
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          min="-30"
                          max="60"
                          step="0.5"
                          value={activePt.z ?? 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) props.onUpdateHeight(Math.max(-30, Math.min(60, v)));
                          }}
                          style={{
                            width: 64,
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 5,
                            color: (activePt.z ?? 0) > 0 ? '#4ade80' : (activePt.z ?? 0) < 0 ? '#f87171' : '#38bdf8',
                            fontSize: 12,
                            fontWeight: 900,
                            padding: '3px 6px',
                            textAlign: 'right'
                          }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>m</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="-30"
                      max="60"
                      step="0.5"
                      value={activePt.z ?? 0}
                      onChange={(e) => props.onUpdateHeight(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: '#4ade80', marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { label: '-16m', val: -16 },
                        { label: '-6m', val: -6 },
                        { label: '0m', val: 0 },
                        { label: '+12m', val: 12 },
                        { label: '+25m', val: 25 }
                      ].map(p => (
                        <button
                          key={p.label}
                          onClick={() => props.onUpdateHeight(p.val)}
                          style={{
                            flex: 1,
                            background: Math.round(activePt.z ?? 0) === p.val ? 'rgba(74, 222, 128, 0.25)' : 'rgba(255,255,255,0.04)',
                            color: Math.round(activePt.z ?? 0) === p.val ? '#4ade80' : '#94a3b8',
                            border: Math.round(activePt.z ?? 0) === p.val ? '1px solid #4ade80' : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 4,
                            padding: '4px 2px',
                            fontSize: 9,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3b. TÚNEL OPCIONAL NESTE PONTO */}
                  <div style={{ background: '#0b1329', padding: 10, borderRadius: 8, border: activePt.isTunnel ? '1px solid #a855f7' : '1px solid #1e293b', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: activePt.isTunnel ? '#c084fc' : '#f1f5f9' }}>
                        🚇 Túnel neste ponto?
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => props.onUpdateNodeProperties?.({ isTunnel: false }, false)}
                          style={{
                            background: !activePt.isTunnel ? '#334155' : 'rgba(30, 41, 59, 0.6)',
                            color: !activePt.isTunnel ? '#ffffff' : '#94a3b8',
                            border: !activePt.isTunnel ? '1px solid #64748b' : '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          NÃO
                        </button>
                        <button
                          onClick={() => props.onUpdateNodeProperties?.({ isTunnel: true }, false)}
                          style={{
                            background: activePt.isTunnel ? '#9333ea' : 'rgba(30, 41, 59, 0.6)',
                            color: activePt.isTunnel ? '#ffffff' : '#cbd5e1',
                            border: activePt.isTunnel ? '1px solid #c084fc' : '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 5,
                            padding: '4px 10px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          SIM · Túnel
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 9.5, color: activePt.isTunnel ? '#d8b4fe' : '#94a3b8', lineHeight: 1.35 }}>
                      {!activePt.isTunnel
                        ? 'Opcional a qualquer altura (0m, -16m, +40m). Ativa para cobrir este ponto com túnel.'
                        : hasAdjacentTunnel
                          ? '✓ Ligado ao ponto vizinho num túnel contínuo.'
                          : '✓ Túnel curto (do meio do ponto anterior até ao meio do seguinte). Ativa no ponto seguinte para alongar.'}
                    </div>
                  </div>

                  {/* 4. INCLINAÇÃO LATERAL (BANKING) */}
                  <div style={{ background: '#0b1329', padding: 10, borderRadius: 8, border: '1px solid #1e293b', marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                        📐 Inclinação Lateral (Banking):
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          type="number"
                          min="-25"
                          max="25"
                          step="0.5"
                          value={activePt.banking ?? 0}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) props.onUpdateBanking(Math.max(-25, Math.min(25, v)));
                          }}
                          style={{
                            width: 64,
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 5,
                            color: (activePt.banking ?? 0) !== 0 ? '#f59e0b' : '#94a3b8',
                            fontSize: 12,
                            fontWeight: 900,
                            padding: '3px 6px',
                            textAlign: 'right'
                          }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>°</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="-25"
                      max="25"
                      step="0.5"
                      value={activePt.banking ?? 0}
                      onChange={(e) => props.onUpdateBanking(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: '#f59e0b', marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { label: '-10°', val: -10 },
                        { label: '-5°', val: -5 },
                        { label: '0° Nível', val: 0 },
                        { label: '+5°', val: 5 },
                        { label: '+10°', val: 10 }
                      ].map(p => (
                        <button
                          key={p.label}
                          onClick={() => props.onUpdateBanking(p.val)}
                          style={{
                            flex: 1,
                            background: Math.round(activePt.banking ?? 0) === p.val ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.04)',
                            color: Math.round(activePt.banking ?? 0) === p.val ? '#fbbf24' : '#94a3b8',
                            border: Math.round(activePt.banking ?? 0) === p.val ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 4,
                            padding: '4px 2px',
                            fontSize: 9,
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 5. AÇÕES DO PONTO */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      onClick={props.onFocusPoint}
                      style={{
                        flex: 1,
                        background: 'rgba(51, 65, 85, 0.8)',
                        color: '#cbd5e1',
                        border: '1px solid #475569',
                        borderRadius: 6,
                        padding: '7px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <Focus size={12} />
                      <span>Focar</span>
                    </button>
                    <button
                      onClick={props.onInsertPointAfter}
                      style={{
                        flex: 1,
                        background: 'rgba(51, 65, 85, 0.8)',
                        color: '#cbd5e1',
                        border: '1px solid #475569',
                        borderRadius: 6,
                        padding: '7px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <PlusCircle size={12} />
                      <span>Inserir</span>
                    </button>
                    <button
                      onClick={props.onDeletePoint}
                      style={{
                        flex: 1,
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#fca5a5',
                        border: '1px solid #ef4444',
                        borderRadius: 6,
                        padding: '7px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <Trash2 size={12} />
                      <span>Apagar</span>
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '16px 0' }}>
                  Desenha os primeiros pontos no separador <b>1. Traçado</b> para ver o corte 3D.
                </div>
              )}
            </div>
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Estilo Visual da Pista
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                {[
                  { id: 'f1_modern', label: 'F1 Asfalto' },
                  { id: 'rally_gravel', label: 'Rally Terra' },
                  { id: 'classic_street', label: 'Mónaco Urbana' }
                ].map(item => {
                  const isSelected = props.trackThemeId === item.id || 
                    (item.id === 'f1_modern' && (props.trackThemeId === 'f1' || !props.trackThemeId)) ||
                    (item.id === 'rally_gravel' && props.trackThemeId === 'rally') ||
                    (item.id === 'classic_street' && props.trackThemeId === 'monaco');
                  return (
                    <button
                      key={item.id}
                      onClick={() => props.onChangeTrackTheme(item.id as any)}
                      style={{
                        background: isSelected ? '#0284c7' : 'rgba(15, 23, 42, 0.7)',
                        color: isSelected ? '#fff' : '#94a3b8',
                        border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      padding: '8px 4px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
              </div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Ambiente & Luz
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                {[
                  { id: 'day', label: 'Dia', icon: <Sun size={12} /> },
                  { id: 'sunset', label: 'Fim Dia', icon: <Sunset size={12} /> },
                  { id: 'night', label: 'Noite GP', icon: <Moon size={12} /> }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => props.onChangeEnvironmentTheme(item.id as any)}
                    style={{
                      background: props.environmentTheme === item.id ? 'rgba(245, 158, 11, 0.25)' : 'rgba(15, 23, 42, 0.7)',
                      color: props.environmentTheme === item.id ? '#fbbf24' : '#94a3b8',
                      border: props.environmentTheme === item.id ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      padding: '7px 4px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Estilo SketchUp & Guias
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1', cursor: 'pointer' }}>
                  <span>Arestas Pretas (Edges)</span>
                  <input
                    type='checkbox'
                    checked={props.showOutlines}
                    onChange={(e) => props.onToggleOutlines(e.target.checked)}
                    style={{ accentColor: '#38bdf8' }}
                  />
                </label>
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9' }}>Muros / Rails 3D</span>
                    <span style={{ fontSize: 10, color: props.showGuardrails ? '#4ade80' : '#facc15' }}>
                      {props.showGuardrails ? 'Criados nas arestas' : 'Apagados (Edi??o)'}
                    </span>
                  </div>
                  <button
                    onClick={() => props.onToggleGuardrails(!props.showGuardrails)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: 'none',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      background: props.showGuardrails ? '#ef4444' : '#0ea5e9',
                      color: '#fff'
                    }}
                  >
                    {props.showGuardrails ? '??? Apagar' : '?? Criar'}
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#00f3ff', fontWeight: 700, cursor: 'pointer' }}>
                  <span>Mostrar Nós de Edição 3D</span>
                  <input
                    type='checkbox'
                    checked={props.showControlPoints}
                    onChange={(e) => props.onToggleControlPoints(e.target.checked)}
                    style={{ accentColor: '#00f3ff' }}
                  />
                </label>
              </div>
            </div>
          </>
        );})()}

        {activeTab === 'scenery' && (
          <>
            {/* BANNER PISTA PROTEGIDA */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              borderRadius: 10,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4
            }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                🔒 Pista 100% Trancada & Protegida
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
                Escolhe uma <b>Lata de Spray</b> e clica ou arrasta no mapa para pintar manchas de relevo e paisagem. Nada invade o asfalto nem os muros (e montanhas pintadas sob viadutos tapam os pilares automaticamente!).
              </div>
            </div>

            {/* VISTAS RÁPIDAS DE CÂMARA PARA PINTAR */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                onClick={() => props.onCameraPreset('top')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #38bdf8',
                  background: 'rgba(56, 189, 248, 0.16)',
                  color: '#38bdf8',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                📐 Vista Aérea 2D (Pintar)
              </button>
              <button
                onClick={() => props.onCameraPreset('iso')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(30, 41, 59, 0.8)',
                  color: '#e2e8f0',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                🎥 Vista 3D Livre (Ver Relevo)
              </button>
            </div>

            {/* LATAS DE SPRAY */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  🥫 Latas de Spray 3D
                </span>
                {props.activeSpray && (
                  <button
                    onClick={() => props.onChangeActiveSpray?.(null)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#fca5a5',
                      border: '1px solid #ef4444',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    Pousar Lata (Rodar Mapa)
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {([
                  { id: 'mountain', label: '🏔️ Montanha', sub: 'Montes, rocha e neve (tapa pilares)', color: '#a8a29e' },
                  { id: 'forest', label: '🌲 Floresta', sub: 'Pinhal denso e árvores 3D', color: '#22c55e' },
                  { id: 'city', label: '🏙️ Cidade', sub: 'Edifícios, torres e quarteirões', color: '#38bdf8' },
                  { id: 'grandstand', label: '🎡 Bancadas GP', sub: 'Público virado para a pista', color: '#f43f5e' },
                  { id: 'pitbox', label: '🏁 Garagens Box', sub: '3 boxes coladas em fila viradas para a pista', color: '#06b6d4' },
                  { id: 'desert', label: '🏜️ Deserto & Rocha', sub: 'Dunas, rochedos e catos', color: '#f59e0b' },
                  { id: 'eraser', label: '🧽 Borracha Spray', sub: 'Apagar manchas no mapa', color: '#ef4444' },
                ] as { id: SprayCanType; label: string; sub: string; color: string }[]).map((can) => {
                  const active = props.activeSpray === can.id;
                  return (
                    <button
                      key={can.id}
                      onClick={() => props.onChangeActiveSpray?.(active ? null : can.id)}
                      style={{
                        padding: '10px 8px',
                        borderRadius: 8,
                        border: active ? `2px solid ${can.color}` : '1px solid rgba(255,255,255,0.08)',
                        background: active ? `${can.color}2e` : 'rgba(15, 23, 42, 0.75)',
                        color: '#fff',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        boxShadow: active ? `0 0 14px ${can.color}44` : 'none'
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 900 }}>{can.label}</span>
                      <span style={{ fontSize: 9.5, color: '#94a3b8', lineHeight: 1.25 }}>{can.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* AFINAÇÃO DA LATA DE SPRAY */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase' }}>
                🎛️ Ajuste do Jato de Spray
              </span>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1', marginBottom: 3 }}>
                  <span>Raio da Mancha</span>
                  <b style={{ color: '#38bdf8' }}>{props.sprayRadius ?? 75} m</b>
                </div>
                <input
                  type="range"
                  min={25}
                  max={180}
                  step={5}
                  value={props.sprayRadius ?? 75}
                  onChange={(e) => props.onChangeSprayRadius?.(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1', marginBottom: 3 }}>
                  <span>Altura / Densidade</span>
                  <b style={{ color: '#10b981' }}>{(props.sprayIntensity ?? 1.2).toFixed(1)}x</b>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={props.sprayIntensity ?? 1.2}
                  onChange={(e) => props.onChangeSprayIntensity?.(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#10b981' }}
                />
              </div>
            </div>

            {/* GESTÃO DAS MANCHAS PINTADAS + GRAVAR */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1' }}>
                  Manchas de Relevo Pintadas:
                </span>
                <span style={{ fontSize: 12, fontWeight: 900, color: '#38bdf8' }}>
                  {props.sceneryPatchCount ?? 0}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  onClick={props.onUndoSceneryPatch}
                  disabled={!props.sceneryPatchCount}
                  style={{
                    padding: '8px',
                    borderRadius: 7,
                    border: '1px solid rgba(245, 158, 11, 0.4)',
                    background: props.sceneryPatchCount ? 'rgba(245, 158, 11, 0.15)' : 'rgba(15, 23, 42, 0.4)',
                    color: props.sceneryPatchCount ? '#fbbf24' : '#475569',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: props.sceneryPatchCount ? 'pointer' : 'not-allowed'
                  }}
                >
                  ↩️ Anular Última
                </button>
                <button
                  onClick={props.onClearSceneryPatches}
                  disabled={!props.sceneryPatchCount}
                  style={{
                    padding: '8px',
                    borderRadius: 7,
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    background: props.sceneryPatchCount ? 'rgba(239, 68, 68, 0.15)' : 'rgba(15, 23, 42, 0.4)',
                    color: props.sceneryPatchCount ? '#fca5a5' : '#475569',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: props.sceneryPatchCount ? 'pointer' : 'not-allowed'
                  }}
                >
                  🗑️ Limpar Tudo
                </button>
              </div>

              {props.onSaveTrack && (
                <button
                  onClick={props.onSaveTrack}
                  style={{
                    marginTop: 4,
                    padding: '10px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 900,
                    cursor: 'pointer'
                  }}
                >
                  💾 Gravar Pista + Relevo
                </button>
              )}
            </div>
          </>
        )}

        {activeTab === 'play' && (
          <>
            {/* SELETOR DE PISTA PARA CORRIDA */}
            {props.savedTracks && props.savedTracks.length > 0 && props.onLoadTrack && (
              <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  🏁 Selecionar Pista ({props.savedTracks.length})
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 130, overflowY: 'auto' }}>
                  {props.savedTracks.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => props.onLoadTrack?.(c)}
                      style={{
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: props.trackName === c.name ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.08)',
                        background: props.trackName === c.name ? 'rgba(16, 185, 129, 0.2)' : 'rgba(15, 23, 42, 0.7)',
                        color: props.trackName === c.name ? '#34d399' : '#e2e8f0',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}
                    >
                      <span>{c.name}</span>
                      <span style={{ fontSize: 10, opacity: 0.7 }}>{c.controlPoints?.length || 0} nós</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CLASSE DE CARRO (F1, GT, RALLY, DRIFT) */}
            {props.onChangeCarClass && (
              <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                  🏎️ Classe de Carro
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 8 }}>
                  {(['f1', 'gt', 'rally', 'drift'] as CarClass[]).map((cls) => {
                    const info = CAR_CLASS_DEFAULTS[cls];
                    const active = (props.carClass || 'f1') === cls;
                    return (
                      <button
                        key={cls}
                        onClick={() => props.onChangeCarClass?.(cls)}
                        style={{
                          padding: '8px 6px',
                          borderRadius: 7,
                          border: active ? `1px solid ${info.color}` : '1px solid rgba(255,255,255,0.08)',
                          background: active ? `${info.color}33` : 'rgba(15, 23, 42, 0.7)',
                          color: active ? '#fff' : '#cbd5e1',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                        title={info.desc}
                      >
                        <div>{info.label}</div>
                        <div style={{ fontSize: 9, opacity: 0.75, marginTop: 2 }}>{info.maxSpeedKmh} km/h</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AFINAÇÕES DO CARRO */}
            {props.carTuning && props.onChangeCarTuning && (
              <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                    🔧 Afinação do Carro
                  </span>
                  <button
                    onClick={() => props.onChangeCarTuning?.({ ...CAR_CLASS_DEFAULTS[props.carClass || 'f1'] })}
                    style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, color: '#cbd5e1', fontSize: 9, fontWeight: 700, padding: '3px 6px', cursor: 'pointer' }}
                  >
                    Repor Padrão
                  </button>
                </div>
                {/* CORES DO CARRO (BASE + 2ª COR) */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.7)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1' }}>Cor Base</span>
                    <input
                      type="color"
                      value={props.carTuning.primaryColor || CAR_CLASS_DEFAULTS[props.carClass || 'f1'].primaryColor}
                      onChange={(e) => props.onChangeCarTuning?.({ ...props.carTuning!, primaryColor: e.target.value })}
                      style={{ width: 24, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    />
                  </label>
                  <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(15, 23, 42, 0.7)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1' }}>2ª Cor</span>
                    <input
                      type="color"
                      value={props.carTuning.secondaryColor || CAR_CLASS_DEFAULTS[props.carClass || 'f1'].secondaryColor}
                      onChange={(e) => props.onChangeCarTuning?.({ ...props.carTuning!, secondaryColor: e.target.value })}
                      style={{ width: 24, height: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                    />
                  </label>
                </div>

                {[
                  { key: 'maxSpeedKmh', label: 'Velocidade Máx.', min: 200, max: 440, step: 10, unit: 'km/h' },
                  { key: 'accelForce', label: 'Aceleração', min: 20, max: 65, step: 2, unit: '' },
                  { key: 'brakeForce', label: 'Travagem', min: 0.8, max: 2.2, step: 0.05, unit: 'x' },
                  { key: 'lateralGrip', label: 'Aderência (Drift ↔ Grip)', min: 2.0, max: 10.5, step: 0.2, unit: '' },
                  { key: 'steerRate', label: 'Resposta Direção', min: 1.5, max: 3.4, step: 0.1, unit: '' },
                  { key: 'suspensionStiffness', label: 'Rigidez Suspensão', min: 24, max: 64, step: 2, unit: '' },
                  { key: 'suspensionDamper', label: 'Amortecimento', min: 5.0, max: 18.0, step: 0.5, unit: '' },
                  { key: 'suspensionTravel', label: 'Curso / Altura Suspensão', min: 0.90, max: 1.45, step: 0.02, unit: 'm' },
                ].map((s) => {
                  const defVal = (CAR_CLASS_DEFAULTS[props.carClass || 'f1'] as any)[s.key] as number;
                  const val = ((props.carTuning as any)[s.key] as number | undefined) ?? defVal;
                  return (
                    <div key={s.key} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#cbd5e1', marginBottom: 2 }}>
                        <span>{s.label}</span>
                        <span style={{ fontWeight: 800, color: '#38bdf8' }}>{Number(val).toFixed(s.step < 1 ? (s.step < 0.1 ? 2 : 1) : 0)} {s.unit}</span>
                      </div>
                      <input
                        type="range"
                        min={s.min}
                        max={s.max}
                        step={s.step}
                        value={val}
                        onChange={(e) => props.onChangeCarTuning?.({ ...props.carTuning!, [s.key]: parseFloat(e.target.value) })}
                        style={{ width: '100%', accentColor: '#38bdf8' }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* BOTÂO PRINCIPAL ENTRAR NA PISTA */}
            <button
              onClick={props.onEnterPlayMode}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '16px',
                fontSize: 14,
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 8px 24px rgba(16, 185, 129, 0.45)',
                letterSpacing: '0.04em'
              }}
            >
              <Car size={20} />
              <span>ENTRAR NA PISTA & JOGAR</span>
            </button>

            {/* SENTIDO DE CONDUÇÃO */}
            {props.onReverseTrack && (
              <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                    🔄 Sentido da Pista
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    {props.controlPoints.length} nós
                  </span>
                </div>
                <button
                  onClick={props.onReverseTrack}
                  style={{
                    width: '100%',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    borderRadius: 8,
                    padding: '9px 12px',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                  title="Inverte o sentido de circulação da pista para correr no sentido oposto"
                >
                  <RotateCcw size={13} />
                  <span>Inverter Sentido de Corrida</span>
                </button>
              </div>
            )}

            {/* SELEÇÃO DE CÂMARA */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Câmara de Condução (Tecla C)
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                {[
                  { id: 'chase', label: 'Traseira' },
                  { id: 'cockpit', label: 'Capô / Cockpit' },
                  { id: 'orbit', label: 'Livre 3D' }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => props.onChangeCameraMode(item.id as any)}
                    style={{
                      background: props.cameraMode === item.id ? '#0284c7' : 'rgba(15, 23, 42, 0.7)',
                      color: props.cameraMode === item.id ? '#fff' : '#94a3b8',
                      border: props.cameraMode === item.id ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      padding: '8px 4px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* POTÊNCIA / PRESET VELLOCIDADE */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Potência & Velocidade Máxima
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
                {[
                  { id: 'calm', label: 'Rua (140)' },
                  { id: 'sport', label: 'GT3 (210)' },
                  { id: 'extreme', label: 'F1 (340)' }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => props.onChangeSpeedPreset(item.id as any)}
                    style={{
                      background: props.speedPreset === item.id ? '#10b981' : 'rgba(15, 23, 42, 0.7)',
                      color: props.speedPreset === item.id ? '#fff' : '#94a3b8',
                      border: props.speedPreset === item.id ? '1px solid #34d399' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      padding: '8px 4px',
                      fontSize: 10,
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* CONTROLES / TECLAS */}
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase' }}>
                Teclas de Controlo
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 11, color: '#cbd5e1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Acelerar / Travar:</span>
                  <span style={{ fontWeight: 800, color: '#fff' }}>W / S | ↑# / ↓</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Virar Direção:</span>
                  <span style={{ fontWeight: 800, color: '#fff' }}>A / D | ← / →</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Travão de Mão:</span>
                  <span style={{ fontWeight: 800, color: '#fff' }}>Espaço</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Ligar/Desligar Luzes:</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>Tecla L</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Mudar Câmara:</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>Tecla C</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Repor Carro:</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>Tecla R</span>
                </div>
              </div>

              <button
                onClick={props.onResetCar}
                style={{
                  width: '100%',
                  marginTop: 10,
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                  border: '1px solid #ef4444',
                  borderRadius: 6,
                  padding: '7px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><RotateCcw size={13} /> Repor Carro (R)</span>
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
};
