import React, { useSyncExternalStore } from 'react';
import { SurfaceType, SpeedPreset } from '../physics';
import { subscribeTelemetry, getTelemetry, requestStartCountdown } from '../telemetryStore';
import {
  getAudioSettings,
  subscribeAudioSettings,
  toggleAudioMuted,
  setAudioVolume,
  carSoundEngine,
} from '../soundEngine';
import type { RaceStandingEntry } from '../multiplayer/types';

interface HUDProps {
  speedKmh?: number;
  throttle?: number;
  brake?: number;
  steer?: number;
  surface?: SurfaceType;
  inPitLane?: boolean;
  lapNumber?: number;
  lapTimeMs?: number;
  bestLapMs?: number | null;
  lastLapMs?: number | null;
  showLapTimer?: boolean;
  cameraMode: 'chase' | 'cockpit' | 'orbit';
  speedPreset: SpeedPreset;
  onChangeCameraMode: (mode: 'chase' | 'cockpit' | 'orbit') => void;
  onChangeSpeedPreset: (preset: SpeedPreset) => void;
  onResetCar: () => void;
  headlightsOn?: boolean;
  onToggleHeadlights?: () => void;
  totalLaps?: number;
  gridSlotNumber?: number;
  waitingBannerText?: string | null;
  standings?: RaceStandingEntry[];
  myDriverId?: string;
  finishBanner?: {
    position: number;
    finishTimeMs: number;
    waitingOthers: boolean;
    remainingSec: number | null;
  } | null;
}

export const HUD: React.FC<HUDProps> = React.memo((props) => {
  const store = useSyncExternalStore(subscribeTelemetry, getTelemetry);
  const audio = useSyncExternalStore(subscribeAudioSettings, getAudioSettings);
  const speedKmh = props.speedKmh ?? store.speedKmh;
  const throttle = props.throttle ?? store.throttle;
  const brake = props.brake ?? store.brake;
  const surface = props.surface ?? store.surface;
  const engineHealth = store.engineHealth;
  const tireHealth = store.tireHealth;
  const inPitBoxZone = store.inPitBoxZone;
  const pitStopProgress = store.pitStopProgress;
  const pitStopRemainingSec = store.pitStopRemainingSec;
  const pitStopStatus = store.pitStopStatus;
  const raceStartPhase = store.raceStartPhase;
  const startLightsLit = store.startLightsLit;
  const recoveryNotice = store.recoveryNotice;
  const isFlipped = store.isFlipped;
  const lapNumber = props.lapNumber ?? store.lapNumber;
  const lapTimeMs = props.lapTimeMs ?? store.lapTimeMs;
  const bestLapMs = props.bestLapMs !== undefined ? props.bestLapMs : store.bestLapMs;
  const lastLapMs = props.lastLapMs !== undefined ? props.lastLapMs : store.lastLapMs;
  const showLapTimer = props.showLapTimer ?? true;
  const headlightsOn = props.headlightsOn ?? store.headlightsOn;
  const isBraking = store.isBraking || brake > 0.05;
  const { totalLaps, gridSlotNumber, waitingBannerText, standings, myDriverId, finishBanner } = props;
  const getGear = (speed: number) => {
    if (speed < 5) return 'N';
    if (speed < 40) return '1';
    if (speed < 75) return '2';
    if (speed < 115) return '3';
    if (speed < 155) return '4';
    if (speed < 195) return '5';
    if (speed < 235) return '6';
    if (speed < 275) return '7';
    return '8';
  };

  const gear =
    props.speedKmh != null
      ? getGear(speedKmh)
      : store.gear < 0
      ? 'R'
      : store.gear === 0
      ? 'N'
      : String(store.gear);
  const rpmNorm =
    props.speedKmh != null
      ? Math.max(0, Math.min(1, speedKmh / 300))
      : Math.max(0, Math.min(1, store.rpmNorm));
  const roundedSpeed = Math.round(speedKmh);

  const getHealthColor = (pct: number) => {
    if (pct >= 70) return '#10b981';
    if (pct >= 40) return '#facc15';
    return '#ef4444';
  };

  const enginePct = Math.round(engineHealth);
  const tirePct = Math.round(tireHealth);
  const engineColor = getHealthColor(enginePct);
  const tireColor = getHealthColor(tirePct);
  const engineCapPct = Math.round(25 + 0.75 * enginePct);
  const tireCapPct =
    tirePct < 45 ? Math.round((1 - 0.30 * Math.min(1, (45 - tirePct) / 25)) * 100) : 100;

  const getSurfaceInfo = () => {
    if (inPitBoxZone) {
      return { label: '🔧 ZONA DE BOX (REPARAR 3s)', color: '#facc15' };
    }
    switch (surface) {
      case 'TRACK':
        return { label: '🏁 ASFALTO (100%)', color: '#10b981' };
      case 'CURB':
        return { label: '⚪ FAIXA BRANCA (-10% VEL.)', color: '#f8fafc' };
      case 'CURB_WIDE':
        return { label: '🟡 FAIXA AMARELA (-20% VEL.)', color: '#facc15' };
      case 'CURB_APEX':
        return { label: '🔴 FAIXA VERMELHA (-30% VEL.)', color: '#ef4444' };
      case 'GRASS':
        return { label: '🌿 RELVA (-40% VEL.)', color: '#4ade80' };
      case 'SAND':
        return { label: '🏜️ AREIA (-50% VEL.)', color: '#f59e0b' };
      case 'GRAVEL':
      default:
        return { label: '🪨 GRAVILHA (-60% VEL.)', color: '#a8a29e' };
    }
  };

  const surfaceInfo = getSurfaceInfo();

  const formatLap = (ms: number | null | undefined) => {
    if (ms == null || ms <= 0) return '--:--.--';
    const totalSec = ms / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const hundredths = Math.floor((ms % 1000) / 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  };

  return (
    <>
      {/* TOP CENTER: F1 START LIGHTS GANTRY OVERLAY (ready -> 3 reds -> green GO!) */}
      {showLapTimer && (raceStartPhase === 'ready' || raceStartPhase === 'lights' || raceStartPhase === 'green') && (
        <div
          onClick={() => {
            if (raceStartPhase === 'ready' && !waitingBannerText) requestStartCountdown();
          }}
          style={{
            position: 'absolute',
            top: 68,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(14px)',
            border: `2px solid ${raceStartPhase === 'green' ? '#10b981' : raceStartPhase === 'lights' ? '#ef4444' : '#38bdf8'}`,
            borderRadius: 16,
            padding: '12px 24px',
            color: '#f8fafc',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            boxShadow: '0 14px 36px rgba(0,0,0,0.65)',
            zIndex: 60,
            pointerEvents: raceStartPhase === 'ready' && !waitingBannerText ? 'auto' : 'none',
            cursor: raceStartPhase === 'ready' && !waitingBannerText ? 'pointer' : 'default',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            minWidth: 340,
            userSelect: 'none'
          }}
        >
          {/* F1 Lights Pod Housing (3 Red + 1 Green) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#020617',
            padding: '8px 14px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.14)'
          }}>
            {[1, 2, 3].map((idx) => {
              const lit = raceStartPhase === 'lights' && startLightsLit >= idx;
              return (
                <div
                  key={`pod_red_${idx}`}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: lit ? '#ef4444' : '#1e293b',
                    border: `2px solid ${lit ? '#fca5a5' : '#334155'}`,
                    boxShadow: lit ? '0 0 18px 4px rgba(239, 68, 68, 0.85)' : 'inset 0 2px 6px rgba(0,0,0,0.8)',
                    transition: 'all 0.08s ease-out'
                  }}
                />
              );
            })}
            <div style={{ width: 2, height: 22, background: 'rgba(255,255,255,0.16)', margin: '0 2px' }} />
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: raceStartPhase === 'green' ? '#10b981' : '#1e293b',
                border: `2px solid ${raceStartPhase === 'green' ? '#6ee7b7' : '#334155'}`,
                boxShadow: raceStartPhase === 'green' ? '0 0 22px 6px rgba(16, 185, 129, 0.9)' : 'inset 0 2px 6px rgba(0,0,0,0.8)',
                transition: 'all 0.08s ease-out'
              }}
            />
          </div>
          <div style={{
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: '0.03em',
            textAlign: 'center',
            color: raceStartPhase === 'green' ? '#34d399' : raceStartPhase === 'lights' ? '#fca5a5' : '#e0f2fe'
          }}>
            {raceStartPhase === 'ready' && (waitingBannerText || `🏁 GRELHA DE PARTIDA (P${gridSlotNumber ?? 1}) — TOQUE NUMA TECLA QUANDO ESTIVER PRONTO`)}
            {raceStartPhase === 'lights' && '🔴 PREPARAR PARTIDA...'}
            {raceStartPhase === 'green' && '🟢 PARTIDA! ACELERA!'}
          </div>
        </div>
      )}

      {/* TOP CENTER: CHECKERED FLAG FINISH BANNER */}
      {showLapTimer && finishBanner && (
        <div style={{
          position: 'absolute',
          top: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(6, 78, 59, 0.95)',
          backdropFilter: 'blur(14px)',
          border: '2px solid #34d399',
          borderRadius: 16,
          padding: '12px 24px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 14px 36px rgba(0,0,0,0.6)',
          zIndex: 60,
          pointerEvents: 'none',
          textAlign: 'center',
          minWidth: 340,
        }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#6ee7b7' }}>
            🏁 TERMINASTE EM {finishBanner.position}.º LUGAR! — {formatLap(finishBanner.finishTimeMs)}
          </div>
          {finishBanner.waitingOthers && (
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#d1fae5', marginTop: 4 }}>
              ⏳ A aguardar os restantes pilotos
              {finishBanner.remainingSec != null ? ` (${Math.max(0, Math.ceil(finishBanner.remainingSec))}s)...` : '...'}
            </div>
          )}
        </div>
      )}

      {/* TOP CENTER: RECOVERY NOTICE OR FLIPPED HINT */}
      {showLapTimer && !finishBanner && raceStartPhase === 'racing' && pitStopStatus === 'none' && (recoveryNotice || isFlipped) && (
        <div style={{
          position: 'absolute',
          top: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          background: isFlipped && !recoveryNotice ? 'rgba(127, 29, 29, 0.94)' : 'rgba(30, 41, 59, 0.94)',
          backdropFilter: 'blur(12px)',
          border: `2px solid ${isFlipped && !recoveryNotice ? '#ef4444' : '#f59e0b'}`,
          borderRadius: 12,
          padding: '9px 18px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12.5,
          fontWeight: 900,
          boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
          zIndex: 55,
          pointerEvents: 'none',
          textAlign: 'center'
        }}>
          {recoveryNotice
            ? '↩️ CARRO RECUPERADO EM PISTA (-35m DE PENALIZAÇÃO)'
            : '⚠️ CARRO CAPOTADO — CARREGUE EM [R] PARA VOLTAR À PISTA (-35m)'}
        </div>
      )}

      {/* TOP CENTER: PIT STOP REPAIR BANNER (3s COUNTDOWN) */}
      {pitStopStatus !== 'none' && !finishBanner && (
        <div style={{
          position: 'absolute',
          top: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          background:
            pitStopStatus === 'done'
              ? 'rgba(6, 78, 59, 0.94)'
              : pitStopStatus === 'repairing'
              ? 'rgba(15, 23, 42, 0.96)'
              : 'rgba(30, 41, 59, 0.92)',
          backdropFilter: 'blur(12px)',
          border: `2px solid ${
            pitStopStatus === 'done'
              ? '#10b981'
              : pitStopStatus === 'repairing'
              ? '#facc15'
              : pitStopStatus === 'slow_down'
              ? '#f59e0b'
              : '#34d399'
          }`,
          borderRadius: 14,
          padding: '10px 20px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
          zIndex: 55,
          pointerEvents: 'none',
          minWidth: 280,
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: '0.03em',
            color:
              pitStopStatus === 'done'
                ? '#34d399'
                : pitStopStatus === 'repairing'
                ? '#fde047'
                : pitStopStatus === 'slow_down'
                ? '#fbbf24'
                : '#6ee7b7'
          }}>
            {pitStopStatus === 'slow_down' && '🟡 ZONA DE BOX — PÁRA O CARRO (3s) PARA REPARAR'}
            {pitStopStatus === 'repairing' && `🔧 A REPARAR NA BOX... ${pitStopRemainingSec.toFixed(1)}s`}
            {pitStopStatus === 'done' && '✅ BOX CONCLUÍDA! MOTOR E PNEUS A 100%!'}
            {pitStopStatus === 'full' && '✅ ZONA DE BOX — CARRO A 100%'}
          </div>
          {pitStopStatus === 'repairing' && (
            <div style={{
              marginTop: 7,
              height: 8,
              width: '100%',
              background: '#334155',
              borderRadius: 4,
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${Math.round(pitStopProgress * 100)}%`,
                background: 'linear-gradient(90deg, #f59e0b, #10b981)',
                transition: 'width 0.06s linear'
              }} />
            </div>
          )}
        </div>
      )}
      {/* TOP LEFT: F1 LAP TIMER & BEST LAP (1º LUGAR) - apenas no modo Corrida/Jogar */}
      {showLapTimer && (
      <div style={{
        position: 'absolute',
        top: 66,
        left: 20,
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 12,
        padding: '10px 14px',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        zIndex: 45,
        pointerEvents: 'none'
      }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.08em' }}>VOLTA</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
            #{lapNumber}{totalLaps ? ` / ${totalLaps}` : ''}
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)' }} />
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.08em' }}>TEMPO</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#ffffff', fontVariantNumeric: 'tabular-nums' }}>
            {raceStartPhase === 'ready' || raceStartPhase === 'lights' ? '00:00.00' : formatLap(lapTimeMs)}
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)' }} />
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: '#10b981', letterSpacing: '0.08em' }}>1º LUGAR (MELHOR)</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>{formatLap(bestLapMs)}</div>
        </div>
        {lastLapMs != null && (
          <>
            <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)' }} />
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.08em' }}>ÚLTIMA</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>{formatLap(lastLapMs)}</div>
            </div>
          </>
        )}
      </div>
      )}

      {/* LEFT SIDE: F1 LIVE STANDINGS TOWER */}
      {showLapTimer && standings && standings.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 136,
          left: 20,
          width: 245,
          maxHeight: 'calc(100vh - 365px)',
          overflowY: 'auto',
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 14,
          padding: '8px 10px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          zIndex: 42,
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          <div style={{
            fontSize: 9.5,
            fontWeight: 900,
            color: '#94a3b8',
            letterSpacing: '0.08em',
            padding: '2px 4px 6px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>🏆 CLASSIFICAÇÃO</span>
            <span>{standings.length} EM PROVA</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            {standings.map((entry) => {
              const isMe = entry.id === myDriverId;
              const statusText = !entry.connected
                ? '📡 OFF'
                : entry.finished
                ? '🏁'
                : entry.inPit
                ? '🔧 BOX'
                : entry.position === 1
                ? 'LÍDER'
                : `+${entry.gapToLeaderM}m`;
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 6px',
                    borderRadius: 7,
                    background: isMe ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.45)',
                    border: isMe ? '1px solid rgba(56, 189, 248, 0.5)' : '1px solid transparent',
                    opacity: entry.connected ? 1 : 0.55,
                    fontSize: 11,
                  }}
                >
                  <span style={{
                    width: 18,
                    fontWeight: 900,
                    color: entry.position === 1 ? '#facc15' : entry.position <= 3 ? '#e2e8f0' : '#94a3b8',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {entry.position}.º
                  </span>
                  <span style={{
                    width: 4,
                    height: 14,
                    borderRadius: 2,
                    background: entry.primaryColor,
                    flexShrink: 0,
                  }} />
                  <span style={{
                    flex: 1,
                    fontWeight: isMe ? 900 : 700,
                    color: '#f8fafc',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {entry.isAi ? '🤖 ' : ''}{entry.name}
                  </span>
                  {isMe && (
                    <span style={{
                      fontSize: 8.5,
                      fontWeight: 900,
                      background: '#38bdf8',
                      color: '#020617',
                      padding: '1px 4px',
                      borderRadius: 3,
                    }}>
                      EU
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>
                    V{entry.lapNumber}/{entry.totalLaps}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    minWidth: 38,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: entry.finished
                      ? '#34d399'
                      : entry.inPit
                      ? '#facc15'
                      : !entry.connected
                      ? '#f87171'
                      : '#cbd5e1',
                  }}>
                    {statusText}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BOTTOM RIGHT: SPEEDOMETER & GEAR HUD */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        right: 24,
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 20,
        padding: '16px 20px',
        boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        minWidth: 220,
        userSelect: 'none',
        zIndex: 10
      }}>
        {/* 12-Segment F1 RPM Shift-Light Strip */}
        <div style={{ width: '100%', display: 'flex', gap: 3, alignItems: 'center', marginBottom: 2 }}>
          {Array.from({ length: 12 }, (_, idx) => {
            const thresh = (idx + 1) / 12;
            const lit = rpmNorm >= thresh * 0.94;
            const redlineBlink = rpmNorm > 0.93 && Math.floor(performance.now() / 75) % 2 === 0;
            const activeColor = idx < 5 ? '#10b981' : idx < 9 ? '#f59e0b' : '#ef4444';
            const glowColor = idx < 5 ? 'rgba(16,185,129,0.55)' : idx < 9 ? 'rgba(245,158,11,0.65)' : 'rgba(239,68,68,0.85)';
            const showLit = rpmNorm > 0.93 ? redlineBlink : lit;
            return (
              <div
                key={`rpm_led_${idx}`}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: showLit ? activeColor : '#1e293b',
                  boxShadow: showLit ? `0 0 8px ${glowColor}` : 'inset 0 1px 2px rgba(0,0,0,0.6)',
                  transition: 'background 0.04s ease',
                }}
              />
            );
          })}
        </div>

        {/* Gear and Speed */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          {/* Gear Badge */}
          <div style={{
            background: gear === 'R' ? '#f59e0b' : '#e11d48',
            color: '#fff',
            fontWeight: 900,
            fontSize: 26,
            width: 44,
            height: 44,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(225, 29, 72, 0.4)'
          }}>
            {gear}
          </div>

          {/* Speed Digital */}
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <span style={{
              color: '#ffffff',
              fontSize: 48,
              fontWeight: 900,
              fontFamily: 'monospace',
              letterSpacing: '-0.04em',
              lineHeight: 1
            }}>
              {roundedSpeed}
            </span>
            <span style={{
              color: '#94a3b8',
              fontSize: 13,
              fontWeight: 800,
              marginLeft: 4,
              textTransform: 'uppercase'
            }}>
              km/h
            </span>
          </div>
        </div>

        {/* Headlights & Rear Brake Light Indicators */}
        <div style={{ width: '100%', display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            type="button"
            onClick={props.onToggleHeadlights}
            title="Ligar/Desligar faróis dianteiros (Tecla L)"
            style={{
              flex: 1,
              padding: '4px 8px',
              borderRadius: 7,
              border: headlightsOn ? '1px solid rgba(250, 204, 21, 0.55)' : '1px solid rgba(148, 163, 184, 0.25)',
              background: headlightsOn ? 'rgba(250, 204, 21, 0.18)' : 'rgba(30, 41, 59, 0.75)',
              color: headlightsOn ? '#fde047' : '#64748b',
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.04em',
              cursor: props.onToggleHeadlights ? 'pointer' : 'default',
              boxShadow: headlightsOn ? '0 0 12px rgba(250, 204, 21, 0.22)' : 'none',
              transition: 'all 0.12s ease',
            }}
          >
            {headlightsOn ? '💡 FARÓIS ON (L)' : '💡 FARÓIS OFF (L)'}
          </button>
          <div
            style={{
              padding: '4px 10px',
              borderRadius: 7,
              border: isBraking ? '1px solid rgba(248, 113, 113, 0.8)' : '1px solid rgba(148, 163, 184, 0.2)',
              background: isBraking ? 'rgba(239, 68, 68, 0.35)' : 'rgba(30, 41, 59, 0.65)',
              color: isBraking ? '#fecaca' : '#64748b',
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.06em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isBraking ? '0 0 14px rgba(239, 68, 68, 0.55)' : 'none',
              transition: 'all 0.08s ease',
            }}
          >
            🔴 STOP
          </div>
        </div>

        {/* Audio Mute & Volume Controls */}
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              carSoundEngine.unlock();
              toggleAudioMuted();
            }}
            title="Ligar/Silenciar som (Tecla M)"
            style={{
              padding: '4px 8px',
              borderRadius: 7,
              border: !audio.muted && audio.volume > 0.01
                ? '1px solid rgba(56, 189, 248, 0.5)'
                : '1px solid rgba(148, 163, 184, 0.25)',
              background: !audio.muted && audio.volume > 0.01
                ? 'rgba(56, 189, 248, 0.16)'
                : 'rgba(30, 41, 59, 0.75)',
              color: !audio.muted && audio.volume > 0.01 ? '#7dd3fc' : '#94a3b8',
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.03em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {audio.muted || audio.volume <= 0.01 ? '🔇 MUDO (M)' : '🔊 SOM ON (M)'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={audio.muted ? 0 : audio.volume}
            onChange={(e) => {
              carSoundEngine.unlock();
              setAudioVolume(Number(e.target.value));
            }}
            aria-label="Volume do som"
            style={{
              flex: 1,
              height: 4,
              accentColor: '#38bdf8',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Throttle & Brake Pedals Bar */}
        <div style={{ width: '100%', display: 'flex', gap: 8, marginTop: 4 }}>
          {/* Brake Bar (Red) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#f87171' }}>TRAVÃO</div>
            <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.round(brake * 100)}%`,
                background: '#ef4444',
                transition: 'width 0.05s'
              }} />
            </div>
          </div>

          {/* Throttle Bar (Green) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#4ade80' }}>ACELERAÇÃO</div>
            <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.round(throttle * 100)}%`,
                background: '#10b981',
                transition: 'width 0.05s'
              }} />
            </div>
          </div>
        </div>

        {/* Engine & Tire Health Bars */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, fontWeight: 800 }}>
              <span style={{ color: '#cbd5e1' }}>🔧 MOTOR</span>
              <span style={{ color: engineColor }}>
                {enginePct}%{enginePct <= 20 ? ` (MÍN. • V.Máx ${engineCapPct}%)` : enginePct < 99 ? ` (V.Máx ${engineCapPct}%)` : ''}
              </span>
            </div>
            <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${enginePct}%`,
                background: engineColor,
                transition: 'width 0.1s'
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, fontWeight: 800 }}>
              <span style={{ color: '#cbd5e1' }}>🛞 PNEUS</span>
              <span style={{ color: tireColor }}>
                {tirePct}%{tirePct < 45 ? ` (PATINAGEM • V.Máx ${tireCapPct}%)` : ''}
              </span>
            </div>
            <div style={{ height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${tirePct}%`,
                background: tireColor,
                transition: 'width 0.1s'
              }} />
            </div>
          </div>
        </div>

        {/* Surface Badge */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.85)',
          borderRadius: 8,
          padding: '5px 10px',
          width: '100%',
          textAlign: 'center',
          fontSize: 10,
          fontWeight: 800,
          color: surfaceInfo.color,
          border: `1px solid ${surfaceInfo.color}44`,
          marginTop: 2
        }}>
          {surfaceInfo.label}
        </div>
      </div>

      </>
  );
});