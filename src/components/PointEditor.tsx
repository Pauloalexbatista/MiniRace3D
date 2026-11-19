import React from 'react';
import { SplineNode } from '../tracks';
import { Sliders, X, ChevronLeft, ChevronRight, Crosshair, Flag, LogIn, LogOut, Trash2, RotateCw, Plus, Maximize2, PenTool } from 'lucide-react';

interface PointEditorProps {
  selectedPointIndex: number | null;
  totalPoints: number;
  selectedPoint: SplineNode | null;
  isClosed: boolean;
  pitEntryIndex: number | null;
  pitExitIndex: number | null;
  pitSide?: 'left' | 'right';
  pitOffset?: number;
  hasPitLane?: boolean;
  trackLength?: number;
  onScaleTrack?: (targetKm: number) => void;
  onToggleClosed: () => void;
  onSelectIndex: (idx: number) => void;
  onUpdateHeight: (z: number) => void;
  onUpdateWidth: (w: number) => void;
  onUpdateBanking: (b: number) => void;
  onUpdateShoulderWidth: (sw: number) => void;
  onSetAsStartPoint: () => void;
  onSetAsPitEntry: () => void;
  onSetAsPitExit: () => void;
  onAutoGeneratePitLane?: () => void;
  onStartDrawPit?: () => void;
  onTogglePitSide?: () => void;
  onUpdatePitOffset?: (offset: number) => void;
  onClearPitLane?: () => void;
  onDeletePoint?: () => void;
  onInsertPointAfter?: () => void;
  onFocusPoint: () => void;
  onResetTrack?: () => void;
  onClose: () => void;
}

export const PointEditor: React.FC<PointEditorProps> = ({
  selectedPointIndex,
  totalPoints,
  selectedPoint,
  isClosed,
  pitEntryIndex,
  pitExitIndex,
  pitSide = 'left',
  pitOffset = 18,
  hasPitLane = true,
  trackLength = 0,
  onScaleTrack,
  onToggleClosed,
  onSelectIndex,
  onUpdateHeight,
  onUpdateWidth,
  onUpdateBanking,
  onUpdateShoulderWidth,
  onSetAsStartPoint,
  onSetAsPitEntry,
  onSetAsPitExit,
  onAutoGeneratePitLane,
  onStartDrawPit,
  onTogglePitSide,
  onUpdatePitOffset,
  onClearPitLane,
  onDeletePoint,
  onInsertPointAfter,
  onFocusPoint,
  onResetTrack,
  onClose
}) => {
  const zVal = selectedPoint?.z ?? 0;
  const widthVal = selectedPoint?.width || 18;
  const shoulderVal = selectedPoint?.shoulderWidth ?? 6.5;
  const bankingDeg = selectedPoint?.banking ?? 0;
  const isPitEntry = selectedPointIndex !== null && selectedPointIndex === pitEntryIndex;
  const isPitExit = selectedPointIndex !== null && selectedPointIndex === pitExitIndex;

  const [scaleTargetKm, setScaleTargetKm] = React.useState<string>(
    trackLength && trackLength > 0 ? (trackLength / 1000).toFixed(2) : '4.8'
  );

  React.useEffect(() => {
    if (trackLength && trackLength > 0) {
      setScaleTargetKm((trackLength / 1000).toFixed(2));
    }
  }, [trackLength]);

  return (
    <div style={{
      position: 'absolute',
      top: 86,
      right: 16,
      width: 310,
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(16px)',
      border: selectedPoint ? '2px solid #00f3ff' : '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: 16,
      padding: 16,
      boxShadow: selectedPoint ? '0 12px 40px rgba(0, 243, 255, 0.25)' : '0 12px 36px rgba(0,0,0,0.5)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      maxHeight: 'calc(100vh - 120px)',
      overflowY: 'auto'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sliders size={16} color="#00f3ff" />
          <span style={{ color: '#ffffff', fontWeight: 900, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Plasticina 3D do Traçado
          </span>
        </div>
        {selectedPointIndex !== null && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Botao Limpar e Comecar do Zero */}
      {onResetTrack && (
        <button
          onClick={onResetTrack}
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 8,
            padding: '7px 10px',
            color: '#fca5a5',
            fontSize: 10,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
          title="Reinicia o traçado para 4 pontos ovais simples no chão"
        >
          <RotateCw size={12} />
          <span>Começar Traçado do Zero (4 Pontos)</span>
        </button>
      )}

      {/* Dimensionamento Real por Quilometros Desejados (FIA 1:1) */}
      {onScaleTrack && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
          borderRadius: 12,
          padding: '10px 12px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Maximize2 size={13} color="#38bdf8" />
              <span style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>
                Escala Real (FIA 1:1)
              </span>
            </div>
            <span style={{ color: '#38bdf8', fontSize: 11, fontWeight: 900 }}>
              {trackLength ? (trackLength / 1000).toFixed(2) + ' km' : '--'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="35.0"
                value={scaleTargetKm}
                onChange={(e) => setScaleTargetKm(e.target.value)}
                placeholder="Ex: 4.8"
                style={{
                  width: '100%',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: 6,
                  padding: '5px 28px 5px 8px',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 800,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <span style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 10,
                color: '#94a3b8',
                fontWeight: 700
              }}>
                km
              </span>
            </div>

            <button
              onClick={() => {
                const val = parseFloat(scaleTargetKm);
                if (!isNaN(val) && val > 0) {
                  onScaleTrack(val);
                }
              }}
              style={{
                background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                border: '1px solid #38bdf8',
                borderRadius: 6,
                padding: '6px 10px',
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(56, 189, 248, 0.3)'
              }}
              title="Redimensiona proporcionalmente a pista a partir do baricentro para atingir este comprimento exato em km"
            >
              Escalar Traçado
            </button>
          </div>

          {/* Presets Rapidos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
            {[
              { km: 3.3, label: '3.3k (MCO)' },
              { km: 4.3, label: '4.3k (RBR)' },
              { km: 5.8, label: '5.8k (SIL)' },
              { km: 7.0, label: '7.0k (SPA)' }
            ].map(p => (
              <button
                key={p.km}
                onClick={() => {
                  setScaleTargetKm(p.km.toFixed(1));
                  onScaleTrack(p.km);
                }}
                style={{
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 4,
                  padding: '4px 2px',
                  color: '#cbd5e1',
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
      )}

      {/* Global Track Mode: Circuito Fechado vs Rali Aberto */}
      <div style={{
        background: 'rgba(30, 41, 59, 0.7)',
        borderRadius: 10,
        padding: '8px 10px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 800 }}>Tipo de Traçado</span>
          <span style={{ color: isClosed ? '#38bdf8' : '#f59e0b', fontSize: 10, fontWeight: 600 }}>
            {isClosed ? '🔄 Circuito Fechado (Anel)' : '🏁 Troço de Rali (Aberto)'}
          </span>
        </div>
        <button
          onClick={onToggleClosed}
          style={{
            background: isClosed ? 'rgba(56, 189, 248, 0.2)' : 'rgba(245, 158, 11, 0.2)',
            border: isClosed ? '1px solid #38bdf8' : '1px solid #f59e0b',
            borderRadius: 6,
            padding: '5px 10px',
            color: '#fff',
            fontSize: 10,
            fontWeight: 800,
            cursor: 'pointer'
          }}
        >
          {isClosed ? 'Mudar p/ Rali' : 'Mudar p/ Circuito'}
        </button>
      </div>

      {selectedPoint && selectedPointIndex !== null ? (
        <>
          {/* Node Navigation Bar */}
          <div style={{
            background: 'rgba(0, 243, 255, 0.1)',
            border: '1px solid rgba(0, 243, 255, 0.3)',
            borderRadius: 10,
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <button
              onClick={() => onSelectIndex((selectedPointIndex - 1 + totalPoints) % totalPoints)}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#fff',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <ChevronLeft size={16} />
            </button>

            <div style={{ textAlign: 'center' }}>
              <span style={{ color: '#00f3ff', fontWeight: 900, fontSize: 14 }}>
                PONTO #{selectedPointIndex + 1}
              </span>
              <div style={{ fontSize: 9, color: '#94a3b8' }}>
                {isPitEntry && '🅿️ Entrada da Box • '}
                {isPitExit && '🏁 Saída da Box • '}
                {selectedPointIndex === 0 ? '🏁 Linha de Partida' : `de ${totalPoints} nós`}
              </div>
            </div>

            <button
              onClick={() => onSelectIndex((selectedPointIndex + 1) % totalPoints)}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#fff',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Action Buttons: Focar & Partida */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {onInsertPointAfter && (
              <button
                onClick={onInsertPointAfter}
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(6, 182, 212, 0.3))',
                  border: '1.5px solid #10b981',
                  borderRadius: 8,
                  padding: '7px 8px',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: 'pointer'
                }}
                title="Insere um novo ponto a seguir ao ponto selecionado para desenhar novas curvas"
              >
                <Plus size={13} color="#34d399" />
                <span>+ Inserir Ponto</span>
              </button>
            )}

            {onDeletePoint && (
              <button
                onClick={onDeletePoint}
                disabled={totalPoints === 0}
                style={{
                  background: totalPoints === 0 ? 'rgba(30, 41, 59, 0.5)' : 'rgba(239, 68, 68, 0.2)',
                  border: totalPoints === 0 ? '1px solid #334155' : '1px solid #ef4444',
                  borderRadius: 8,
                  padding: '7px 8px',
                  color: totalPoints === 0 ? '#64748b' : '#fca5a5',
                  fontSize: 10,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: totalPoints === 0 ? 'not-allowed' : 'pointer'
                }}
                title="Apaga o ponto selecionado (mínimo 3 pontos)"
              >
                <Trash2 size={13} />
                <span>Apagar Ponto</span>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              onClick={onFocusPoint}
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: 8,
                padding: '6px 8px',
                color: '#34d399',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer'
              }}
            >
              <Crosshair size={13} />
              <span>Focar Câmara</span>
            </button>

            <button
              onClick={onSetAsStartPoint}
              style={{
                background: selectedPointIndex === 0 ? 'rgba(244, 63, 94, 0.3)' : 'rgba(30, 41, 59, 0.8)',
                border: selectedPointIndex === 0 ? '1px solid #f43f5e' : '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                padding: '6px 8px',
                color: selectedPointIndex === 0 ? '#fff' : '#cbd5e1',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer'
              }}
            >
              <Flag size={13} />
              <span>{selectedPointIndex === 0 ? 'Partida ✓' : 'Definir Partida'}</span>
            </button>
          </div>

          {/* Pit Lane Markers: Entrada e Saída da Box */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            borderRadius: 10,
            padding: 10,
            border: '1px solid rgba(0, 243, 255, 0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                🅿️ Rua das Boxes (Pit Lane)
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, color: hasPitLane ? '#10b981' : '#f59e0b' }}>
                {hasPitLane ? '● Box Ativa' : '○ Sem Box'}
              </span>
            </div>

            {/* Auto Generate Button */}
            {onAutoGeneratePitLane && (
              <button
                onClick={onAutoGeneratePitLane}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(56, 189, 248, 0.25))',
                  border: '1px solid #10b981',
                  borderRadius: 6,
                  padding: '7px 8px',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  marginBottom: 8
                }}
                title="Gera uma box paralela nesta reta a começar no ponto selecionado"
              >
                <span>✨ Gerar Box nesta Reta (Auto 4 Nós)</span>
              </button>
            )}

            {/* Manual Two-Point Picker */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                onClick={onSetAsPitEntry}
                style={{
                  background: isPitEntry ? 'rgba(16, 185, 129, 0.4)' : 'rgba(15, 23, 42, 0.8)',
                  border: isPitEntry ? '1.5px solid #10b981' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  padding: '6px 4px',
                  color: isPitEntry ? '#34d399' : '#cbd5e1',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: 'pointer'
                }}
              >
                <LogIn size={12} />
                <span>{isPitEntry ? 'Entrada Box ✓' : 'Marcar Entrada'}</span>
              </button>

              <button
                onClick={onSetAsPitExit}
                style={{
                  background: isPitExit ? 'rgba(56, 189, 248, 0.4)' : 'rgba(15, 23, 42, 0.8)',
                  border: isPitExit ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  padding: '6px 4px',
                  color: isPitExit ? '#38bdf8' : '#cbd5e1',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  cursor: 'pointer'
                }}
              >
                <LogOut size={12} />
                <span>{isPitExit ? 'Saída Box ✓' : 'Marcar Saída'}</span>
              </button>
            </div>

            {/* Clear Box & Side buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              {onTogglePitSide && (
                <button
                  onClick={onTogglePitSide}
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 6,
                    padding: '5px 4px',
                    color: '#cbd5e1',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    cursor: 'pointer'
                  }}
                  title="Muda a box para o lado esquerdo ou direito da pista"
                >
                  <RotateCw size={11} />
                  <span>Lado: {pitSide === 'left' ? '⬅️ Esq' : '➡️ Dir'}</span>
                </button>
              )}

              {onClearPitLane && (
                <button
                  onClick={onClearPitLane}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid #ef4444',
                    borderRadius: 6,
                    padding: '5px 4px',
                    color: '#fca5a5',
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    cursor: 'pointer'
                  }}
                  title="Apaga a estrada das boxes desta pista"
                >
                  <Trash2 size={11} />
                  <span>Apagar Box</span>
                </button>
              )}
            </div>

            {/* Explanatory helper guide */}
            <div style={{ marginTop: 6, fontSize: 9, color: '#94a3b8', lineHeight: 1.4 }}>
              {pitEntryIndex !== null && pitExitIndex === null && (
                <span style={{ color: '#34d399', fontWeight: 700 }}>
                  ✓ Entrada no Ponto #{pitEntryIndex + 1}! Agora seleciona o ponto do fim da reta e clica em 'Marcar Saída'.
                </span>
              )}
              {hasPitLane && pitEntryIndex !== null && pitExitIndex !== null && (
                <span style={{ color: '#38bdf8' }}>
                  ✓ Box ligada do Ponto #{pitEntryIndex + 1} ao Ponto #{pitExitIndex + 1}.
                </span>
              )}
              {!hasPitLane && pitEntryIndex === null && (
                <span>Como desenhar: clica em 'Marcar Entrada' neste ponto e depois 'Marcar Saída' à frente, ou usa o botão Auto acima.</span>
              )}
            </div>

            {/* Pit Offset Distance Slider */}
            {onUpdatePitOffset && hasPitLane && (
              <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginBottom: 2 }}>
                  <span>Afastamento da Box</span>
                  <span style={{ color: '#38bdf8', fontWeight: 800 }}>{pitOffset}m</span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="32"
                  step="1"
                  value={pitOffset}
                  onChange={(e) => onUpdatePitOffset(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>
            )}
          </div>

          {/* 1. ALTURA */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: 10,
            padding: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                ⛰️ Altura (Elevação Z)
              </span>
              <span style={{
                color: zVal > 0 ? '#4ade80' : (zVal < 0 ? '#f87171' : '#cbd5e1'),
                fontSize: 13,
                fontWeight: 900
              }}>
                {zVal > 0 ? `+${zVal.toFixed(1)}m` : `${zVal.toFixed(1)}m`}
              </span>
            </div>

            <input
              type="range"
              min="-25"
              max="45"
              step="1"
              value={zVal}
              onChange={(e) => onUpdateHeight(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#00f3ff', cursor: 'pointer', marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[-5, -1, 0, 1, 5].map(step => (
                <button
                  key={step}
                  onClick={() => {
                    if (step === 0) onUpdateHeight(0);
                    else onUpdateHeight(zVal + step);
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    background: step === 0 ? '#334155' : 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    color: step === 0 ? '#f8fafc' : (step > 0 ? '#4ade80' : '#f87171'),
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {step === 0 ? 'Plano' : (step > 0 ? `+${step}m` : `${step}m`)}
                </button>
              ))}
            </div>
          </div>

          {/* 2. LARGURA */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: 10,
            padding: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                ↔️ Largura da Pista
              </span>
              <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 900 }}>
                {widthVal.toFixed(1)}m
              </span>
            </div>

            <input
              type="range"
              min="8"
              max="34"
              step="1"
              value={widthVal}
              onChange={(e) => onUpdateWidth(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer', marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[
                { w: 10, label: 'Chicane 10m' },
                { w: 18, label: 'Padrão 18m' },
                { w: 26, label: 'Larga 26m' }
              ].map(item => (
                <button
                  key={item.w}
                  onClick={() => onUpdateWidth(item.w)}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    background: widthVal === item.w ? 'rgba(56, 189, 248, 0.3)' : 'rgba(15, 23, 42, 0.8)',
                    border: widthVal === item.w ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    color: widthVal === item.w ? '#ffffff' : '#cbd5e1',
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* BERMA / DISTÂNCIA DO MURO */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: 10,
            padding: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                🛡️ Muro / Berma Lateral
              </span>
              <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 900 }}>
                {shoulderVal.toFixed(1)}m
              </span>
            </div>

            <input
              type="range"
              min="1.5"
              max="12"
              step="0.5"
              value={shoulderVal}
              onChange={(e) => onUpdateShoulderWidth(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#a78bfa', cursor: 'pointer', marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[
                { label: 'Colado (1.5m)', val: 1.5 },
                { label: 'Normal (6.5m)', val: 6.5 },
                { label: 'Largo (10m)', val: 10.0 }
              ].map(preset => (
                <button
                  key={preset.label}
                  onClick={() => onUpdateShoulderWidth(preset.val)}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    background: shoulderVal === preset.val ? '#7c3aed' : 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. INCLINAÇÃO LATERAL */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            borderRadius: 10,
            padding: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9' }}>
                📐 Inclinação Lateral (Banking)
              </span>
              <span style={{
                color: bankingDeg !== 0 ? '#f59e0b' : '#cbd5e1',
                fontSize: 13,
                fontWeight: 900
              }}>
                {bankingDeg > 0 ? `+${bankingDeg}°` : `${bankingDeg}°`}
              </span>
            </div>

            <input
              type="range"
              min="-22"
              max="22"
              step="1"
              value={bankingDeg}
              onChange={(e) => onUpdateBanking(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer', marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
              {[-10, -5, 0, 5, 10].map(deg => (
                <button
                  key={deg}
                  onClick={() => onUpdateBanking(deg)}
                  style={{
                    flex: 1,
                    padding: '4px 2px',
                    background: bankingDeg === deg ? 'rgba(245, 158, 11, 0.3)' : 'rgba(15, 23, 42, 0.8)',
                    border: bankingDeg === deg ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    color: bankingDeg === deg ? '#ffffff' : '#cbd5e1',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {deg === 0 ? 'Nível' : (deg > 0 ? `+${deg}°` : `${deg}°`)}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{
          padding: '16px 12px',
          textAlign: 'center',
          background: 'rgba(30, 41, 59, 0.4)',
          borderRadius: 10,
          border: '1px dashed rgba(255, 255, 255, 0.15)'
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>👆</div>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: 12, marginBottom: 4 }}>
            Clica em qualquer nó na pista!
          </div>
          <div style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.4, marginBottom: 10 }}>
            Ajusta altura, largura, inclinação, ou define a <b>Entrada e Saída das Boxes</b>.
          </div>
          <button
            onClick={() => onSelectIndex(0)}
            style={{
              background: '#00f3ff',
              color: '#0f172a',
              border: 'none',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            Selecionar Ponto #1
          </button>
        </div>
      )}
    </div>
  );
};