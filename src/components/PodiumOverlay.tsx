import React from 'react';
import { Trophy, RotateCcw, LogOut, Clock } from 'lucide-react';
import {
  CAR_CATEGORY_META,
  CarCategory,
  RaceStandingEntry,
} from '../multiplayer/types';

export interface PodiumOverlayProps {
  circuitName: string;
  carCategory: CarCategory;
  totalLaps: number;
  standings: RaceStandingEntry[];
  myDriverId: string;
  isHost: boolean;
  isSolo: boolean;
  onReturnToLobby: () => void;
  onLeaveRoom: () => void;
}

function formatTimeMs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '--:--.--';
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const PodiumOverlay: React.FC<PodiumOverlayProps> = React.memo(({
  circuitName,
  carCategory,
  totalLaps,
  standings,
  myDriverId,
  isHost,
  isSolo,
  onReturnToLobby,
  onLeaveRoom,
}) => {
  const catMeta = CAR_CATEGORY_META[carCategory] || CAR_CATEGORY_META.open;
  const top3 = standings.slice(0, 3);
  const medals = ['🥇 1.º LUGAR', '🥈 2.º LUGAR', '🥉 3.º LUGAR'];
  const medalBorders = ['#facc15', '#cbd5e1', '#f97316'];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(2, 6, 23, 0.82)',
      backdropFilter: 'blur(14px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      zIndex: 900,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 860,
        maxHeight: '90vh',
        background: 'linear-gradient(180deg, #0f172a 0%, #090d16 100%)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: 22,
        boxShadow: '0 24px 70px rgba(0, 0, 0, 0.8)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#f8fafc',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 26px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #facc15, #f59e0b)',
              color: '#090d16',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 20px rgba(250, 204, 21, 0.35)',
            }}>
              <Trophy size={24} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#facc15', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                🏁 RESULTADOS FINAIS DA PROVA
              </div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#ffffff' }}>
                {circuitName} • {totalLaps} {totalLaps === 1 ? 'Volta' : 'Voltas'}
              </h2>
            </div>
          </div>

          <div style={{
            padding: '6px 12px',
            borderRadius: 999,
            background: `${catMeta.badgeColor}26`,
            border: `1px solid ${catMeta.badgeColor}`,
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 900,
          }}>
            {catMeta.emoji} {catMeta.label}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 26px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Top 3 Podium Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {top3.map((entry, idx) => {
              const isMe = entry.id === myDriverId;
              return (
                <div
                  key={entry.id}
                  style={{
                    background: isMe ? 'rgba(56, 189, 248, 0.14)' : 'rgba(30, 41, 59, 0.65)',
                    border: `2px solid ${medalBorders[idx]}`,
                    borderRadius: 14,
                    padding: '14px 16px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 5,
                    background: entry.primaryColor,
                  }} />
                  <div style={{ fontSize: 11, fontWeight: 900, color: medalBorders[idx], letterSpacing: '0.05em' }}>
                    {medals[idx]}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{entry.name}</span>
                    {isMe && (
                      <span style={{ fontSize: 10, background: '#38bdf8', color: '#020617', padding: '1px 6px', borderRadius: 4, fontWeight: 900 }}>
                        TU
                      </span>
                    )}
                    {entry.isAi && (
                      <span style={{ fontSize: 10, background: '#475569', color: '#e2e8f0', padding: '1px 6px', borderRadius: 4, fontWeight: 800 }}>
                        🤖 IA
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginTop: 4 }}>
                    {CAR_CATEGORY_META[entry.carClass]?.emoji} {CAR_CATEGORY_META[entry.carClass]?.shortLabel} • Grelha P{entry.gridSlot + 1}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, fontWeight: 800 }}>
                    <span style={{ color: '#e2e8f0' }}>
                      {entry.finished ? `⏱️ ${formatTimeMs(entry.finishTimeMs)}` : `Volta ${entry.lapNumber}/${totalLaps}`}
                    </span>
                    <span style={{ color: '#34d399' }}>
                      Melhor: {formatTimeMs(entry.bestLapMs)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full Classification Table */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: 'rgba(30, 41, 59, 0.9)', color: '#94a3b8', textAlign: 'left', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  <th style={{ padding: '10px 12px' }}>Pos</th>
                  <th style={{ padding: '10px 12px' }}>Piloto</th>
                  <th style={{ padding: '10px 12px' }}>Carro</th>
                  <th style={{ padding: '10px 12px' }}>Estado</th>
                  <th style={{ padding: '10px 12px' }}>Tempo / Distância</th>
                  <th style={{ padding: '10px 12px' }}>Melhor Volta</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((entry) => {
                  const isMe = entry.id === myDriverId;
                  return (
                    <tr
                      key={entry.id}
                      style={{
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                        background: isMe ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '9px 12px', fontWeight: 900, color: entry.position <= 3 ? '#facc15' : '#e2e8f0' }}>
                        P{entry.position}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 800 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: entry.primaryColor, display: 'inline-block', border: '1px solid rgba(255,255,255,0.4)' }} />
                          <span>{entry.name}</span>
                          {isMe && <span style={{ fontSize: 9.5, background: '#38bdf8', color: '#020617', padding: '1px 5px', borderRadius: 4, fontWeight: 900 }}>TU</span>}
                          {entry.isAi && <span style={{ fontSize: 9.5, background: '#334155', color: '#cbd5e1', padding: '1px 5px', borderRadius: 4, fontWeight: 800 }}>🤖</span>}
                        </div>
                      </td>
                      <td style={{ padding: '9px 12px', color: '#cbd5e1', fontWeight: 700 }}>
                        {CAR_CATEGORY_META[entry.carClass]?.emoji} {CAR_CATEGORY_META[entry.carClass]?.shortLabel}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 800 }}>
                        {!entry.connected ? (
                          <span style={{ color: '#f87171' }}>📡 Desligado</span>
                        ) : entry.finished ? (
                          <span style={{ color: '#34d399' }}>🏁 Terminou</span>
                        ) : (
                          <span style={{ color: '#fbbf24' }}>⏱️ Em pista (V{entry.lapNumber}/{totalLaps})</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#f8fafc' }}>
                        {entry.finished
                          ? formatTimeMs(entry.finishTimeMs)
                          : entry.position === 1
                          ? 'Líder'
                          : `+${entry.gapToLeaderM} m`}
                      </td>
                      <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#34d399', fontWeight: 800 }}>
                        {formatTimeMs(entry.bestLapMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '16px 26px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          background: 'rgba(15, 23, 42, 0.95)',
        }}>
          {isHost || isSolo ? (
            <button
              onClick={onReturnToLobby}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#ffffff',
                border: '1px solid #34d399',
                borderRadius: 10,
                padding: '11px 20px',
                fontWeight: 900,
                fontSize: 13.5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)',
              }}
            >
              <RotateCcw size={16} />
              <span>{isSolo ? '🔁 Voltar à Configuração' : '🔁 Nova Corrida (Voltar à Sala)'}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fbbf24', fontWeight: 800, fontSize: 13 }}>
              <Clock size={16} />
              <span>⏳ A aguardar que o anfitrião volte à sala...</span>
            </div>
          )}

          <button
            onClick={onLeaveRoom}
            style={{
              background: 'rgba(239, 68, 68, 0.18)',
              color: '#fca5a5',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              borderRadius: 10,
              padding: '10px 18px',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <LogOut size={15} />
            <span>🚪 {isSolo ? 'Sair para Lobby de Corridas' : 'Sair da Sala'}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
