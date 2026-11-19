import React from 'react';
import { Flag, Wrench, Trophy, Wifi, WifiOff, ArrowRight, Users, MapPin } from 'lucide-react';
import type { ConnectionState } from '../multiplayer/useRaceClient';

export interface HomeScreenProps {
  onSelectEditor: () => void;
  onSelectRace: () => void;
  savedCircuitsCount: number;
  activeRoomsCount: number;
  connectionState: ConnectionState;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onSelectEditor,
  onSelectRace,
  savedCircuitsCount,
  activeRoomsCount,
  connectionState,
}) => {
  const isOnline = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  return (
    <div style={{
      width: '100%',
      boxSizing: 'border-box',
      minHeight: '100vh',
      overflowY: 'auto',
      background: 'radial-gradient(circle at 20% 20%, rgba(225, 29, 72, 0.16), transparent 45%), radial-gradient(circle at 80% 15%, rgba(56, 189, 248, 0.16), transparent 45%), linear-gradient(180deg, #060913 0%, #0f172a 100%)',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 1020, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Header Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #e11d48, #f43f5e)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 30px rgba(225, 29, 72, 0.45)',
            }}>
              <Flag size={26} color="#ffffff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950, letterSpacing: '0.04em', color: '#ffffff' }}>
                MINIRACE 3D
              </h1>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
                Estúdio de Circuitos 3D &amp; Competições Multijogador em Tempo Real
              </div>
            </div>
          </div>

          {/* Live Server Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 999,
            background: isOnline
              ? 'rgba(16, 185, 129, 0.14)'
              : isConnecting
              ? 'rgba(245, 158, 11, 0.14)'
              : 'rgba(239, 68, 68, 0.14)',
            border: `1px solid ${
              isOnline ? 'rgba(52, 211, 153, 0.45)' : isConnecting ? 'rgba(251, 191, 36, 0.45)' : 'rgba(248, 113, 113, 0.45)'
            }`,
            fontSize: 12,
            fontWeight: 800,
            color: isOnline ? '#34d399' : isConnecting ? '#fbbf24' : '#f87171',
          }}>
            {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>
              {isOnline
                ? `🟢 Servidor Online • ${activeRoomsCount} ${activeRoomsCount === 1 ? 'sala ativa' : 'salas ativas'}`
                : isConnecting
                ? '🟡 A ligar ao servidor de salas...'
                : '🔴 Modo Offline (Solo disponível)'}
            </span>
          </div>
        </div>

        {/* Two Main Mode Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 22,
        }}>
          {/* Card 1: Track Editor 3D */}
          <div
            onClick={onSelectEditor}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectEditor(); }}
            style={{
              background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.78) 0%, rgba(15, 23, 42, 0.92) 100%)',
              border: '1.5px solid rgba(56, 189, 248, 0.35)',
              borderRadius: 22,
              padding: 26,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 20,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              transition: 'transform 0.15s ease, border-color 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'rgba(56, 189, 248, 0.18)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#38bdf8',
                }}>
                  <Wrench size={26} />
                </div>
                <span style={{
                  background: 'rgba(56, 189, 248, 0.16)',
                  color: '#7dd3fc',
                  padding: '5px 11px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
                  <MapPin size={13} />
                  {savedCircuitsCount} {savedCircuitsCount === 1 ? 'pista guardada' : 'pistas guardadas'}
                </span>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: '#38bdf8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  MODO 1 • ESTÚDIO DE CRIAÇÃO
                </div>
                <h2 style={{ margin: '4px 0 8px', fontSize: 23, fontWeight: 900, color: '#ffffff' }}>
                  🛠️ Editor de Pistas 3D
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#cbd5e1' }}>
                  Desenha traçados por cima de mapas reais ou do zero, molda elevações e curvas inclinadas,
                  configura bermas e zona de Box, pinta relevo e bancadas 3D com latas de spray e testa logo
                  com 1 carro em pista.
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['Traçado 2D/3D', 'Relevo & Inclinação', 'Box & Bermas', 'Spray Cenário 3D', 'Teste 1 Carro'].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#bae6fd',
                      background: 'rgba(2, 132, 199, 0.18)',
                      border: '1px solid rgba(56, 189, 248, 0.22)',
                      padding: '4px 9px',
                      borderRadius: 7,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #0284c7, #2563eb)',
              color: '#ffffff',
              borderRadius: 12,
              padding: '13px 18px',
              fontWeight: 900,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 8px 22px rgba(2, 132, 199, 0.35)',
            }}>
              <span>Abrir Editor de Pistas 3D</span>
              <ArrowRight size={18} />
            </div>
          </div>

          {/* Card 2: Racing & Online Rooms Mode */}
          <div
            onClick={onSelectRace}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectRace(); }}
            style={{
              background: 'linear-gradient(180deg, rgba(45, 22, 39, 0.72) 0%, rgba(15, 23, 42, 0.94) 100%)',
              border: '1.5px solid rgba(244, 63, 94, 0.45)',
              borderRadius: 22,
              padding: 26,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 20,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              transition: 'transform 0.15s ease, border-color 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'rgba(225, 29, 72, 0.2)',
                  border: '1px solid rgba(244, 63, 94, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fb7185',
                }}>
                  <Trophy size={26} />
                </div>
                <span style={{
                  background: 'rgba(244, 63, 94, 0.16)',
                  color: '#fda4af',
                  padding: '5px 11px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}>
                  <Users size={13} />
                  Até 6 Humanos + 12 Carros
                </span>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: '#fb7185', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  MODO 2 • COMPETIÇÃO &amp; MULTIJOGADOR
                </div>
                <h2 style={{ margin: '4px 0 8px', fontSize: 23, fontWeight: 900, color: '#ffffff' }}>
                  🏁 Modo Corridas (Online &amp; Solo)
                </h2>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: '#cbd5e1' }}>
                  Cria salas por categoria (F1, GT, Rally, Drift ou Livre), escolhe o circuito e o número de voltas,
                  personaliza o teu carro na garagem, convida amigos e corre em tempo real com semáforo sincronizado,
                  classificação ao vivo, paragens na Box e Pódio final.
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['Salas Online', 'Garagem & Cores', 'Semáforo Sincronizado', 'Bots IA', 'Radar & Pódio'].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#fecdd3',
                      background: 'rgba(225, 29, 72, 0.18)',
                      border: '1px solid rgba(244, 63, 94, 0.25)',
                      padding: '4px 9px',
                      borderRadius: 7,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #e11d48, #f43f5e)',
              color: '#ffffff',
              borderRadius: 12,
              padding: '13px 18px',
              fontWeight: 900,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 8px 22px rgba(225, 29, 72, 0.4)',
            }}>
              <span>Entrar no Lobby de Corridas</span>
              <ArrowRight size={18} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
