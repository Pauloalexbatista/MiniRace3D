import React, { useEffect, useRef, useState } from 'react';
import {
  Headphones,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ChatMessage, RoomPlayerInfo } from '../multiplayer/types';
import type { useRoomVoice } from '../multiplayer/useRoomVoice';

function formatMsgTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export interface LobbyChatBoxProps {
  messages: ChatMessage[];
  selfClientId: string | null;
  isOnline: boolean;
  onSendMessage: (text: string) => void;
}

const LOBBY_QUICK_CHIPS = ['👋 Olá!', '🏎️ Vamos correr?', '🆕 Vou criar sala!'];

export const LobbyChatBox: React.FC<LobbyChatBoxProps> = ({
  messages,
  selfClientId,
  isOnline,
  onSendMessage,
}) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || !isOnline) return;
    onSendMessage(clean);
    setDraft('');
  };

  return (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 900, color: '#e2e8f0' }}>
          <MessageSquare size={15} color="#38bdf8" />
          <span>Chat Geral do Lobby</span>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b' }}>
          Combina corridas antes de criar sala
        </span>
      </div>

      <div
        ref={listRef}
        style={{
          height: 155,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          paddingRight: 4,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>
            Ainda sem mensagens. Diz olá aos pilotos online!
          </div>
        ) : (
          messages.map((m) => {
            const isMe = selfClientId && m.senderId === selfClientId;
            return (
              <div
                key={m.id}
                style={{
                  fontSize: 12,
                  lineHeight: 1.38,
                  padding: '5px 8px',
                  borderRadius: 8,
                  background: isMe ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.75)',
                  border: isMe ? '1px solid rgba(56, 189, 248, 0.25)' : '1px solid rgba(255,255,255,0.05)',
                  wordBreak: 'break-word',
                }}
              >
                <span style={{ fontSize: 10, color: '#64748b', marginRight: 5 }}>
                  {formatMsgTime(m.timestampMs)}
                </span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: m.senderColor,
                    marginRight: 5,
                  }}
                />
                <strong style={{ color: isMe ? '#7dd3fc' : '#f8fafc', marginRight: 5 }}>
                  {m.senderName}:
                </strong>
                <span style={{ color: '#e2e8f0' }}>{m.text}</span>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {LOBBY_QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={!isOnline}
            onClick={() => onSendMessage(chip)}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 999,
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 700,
              cursor: isOnline ? 'pointer' : 'not-allowed',
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 7 }}>
        <input
          type="text"
          maxLength={240}
          value={draft}
          disabled={!isOnline}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isOnline ? 'Escreve uma mensagem no lobby...' : 'Sem ligação ao servidor'}
          style={{
            flex: 1,
            background: '#0f172a',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 600,
          }}
        />
        <button
          type="submit"
          disabled={!isOnline || !draft.trim()}
          style={{
            background: isOnline && draft.trim() ? '#0284c7' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0 12px',
            fontWeight: 800,
            fontSize: 12,
            cursor: isOnline && draft.trim() ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Send size={13} />
          <span>Enviar</span>
        </button>
      </form>
    </div>
  );
};

export interface RoomCommsPanelProps {
  players: RoomPlayerInfo[];
  selfId: string | null;
  messages: ChatMessage[];
  isOnline: boolean;
  onSendMessage: (text: string) => void;
  voice: ReturnType<typeof useRoomVoice>;
}

const ROOM_QUICK_CHIPS = ['👍 Pronto!', '⏱️ Espera 1 min', '🏎️ Boa corrida!', '🎧 Liga a voz!'];

export const RoomCommsPanel: React.FC<RoomCommsPanelProps> = ({
  players,
  selfId,
  messages,
  isOnline,
  onSendMessage,
  voice,
}) => {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (!clean || !isOnline) return;
    onSendMessage(clean);
    setDraft('');
  };

  const voiceParticipants = players.filter((p) => p.connected && p.voiceJoined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Voice Chat Card */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          border: voice.joined
            ? '1px solid rgba(52, 211, 153, 0.45)'
            : '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Headphones size={17} color={voice.joined ? '#34d399' : '#38bdf8'} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Chat de Voz</h3>
          </div>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              color: voice.joined ? '#34d399' : '#94a3b8',
              background: voice.joined ? 'rgba(16, 185, 129, 0.16)' : '#1e293b',
              padding: '3px 8px',
              borderRadius: 999,
            }}
          >
            {voiceParticipants.length} {voiceParticipants.length === 1 ? 'na chamada' : 'na chamada'}
          </span>
        </div>

        <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600, lineHeight: 1.4 }}>
          Fala com os teus amigos por auscultadores antes e durante toda a corrida!
        </div>

        {voice.voiceError && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgba(251, 191, 36, 0.45)',
              color: '#fde68a',
              borderRadius: 9,
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>{voice.voiceError}</span>
            <button
              type="button"
              onClick={voice.clearVoiceError}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fde68a',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Active Voice Participants */}
        {voiceParticipants.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {voiceParticipants.map((p) => {
              const isMe = p.id === selfId;
              const speaking = Boolean(voice.speakingPeers[p.id]);
              const peerConn = !isMe ? voice.peerStates[p.id] : undefined;
              const connDotColor =
                peerConn === 'connected'
                  ? '#10b981'
                  : peerConn === 'failed'
                  ? '#ef4444'
                  : peerConn === 'connecting'
                  ? '#f59e0b'
                  : '#38bdf8';

              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 9px',
                    borderRadius: 999,
                    background: speaking ? 'rgba(16, 185, 129, 0.22)' : '#090d16',
                    border: speaking
                      ? '1.5px solid #34d399'
                      : '1px solid rgba(255,255,255,0.12)',
                    boxShadow: speaking ? '0 0 12px rgba(16, 185, 129, 0.4)' : 'none',
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: '#f8fafc',
                  }}
                >
                  {p.voiceMuted ? (
                    <MicOff size={12} color="#f87171" />
                  ) : (
                    <Mic size={12} color={speaking ? '#34d399' : '#cbd5e1'} />
                  )}
                  <span>{p.name}</span>
                  {isMe && (
                    <span style={{ fontSize: 9, color: '#38bdf8', fontWeight: 900 }}>TU</span>
                  )}
                  {!isMe && voice.joined && (
                    <span
                      title={
                        peerConn === 'connected'
                          ? 'Áudio P2P ligado'
                          : peerConn === 'failed'
                          ? 'Falha NAT/Rede P2P'
                          : 'A estabelecer ligação P2P...'
                      }
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: connDotColor,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Voice Controls */}
        {!voice.joined ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={!isOnline || voice.joining}
              onClick={() => voice.joinVoice({ listenOnly: false })}
              style={{
                flex: 1,
                minWidth: 165,
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#fff',
                border: '1px solid #34d399',
                borderRadius: 10,
                padding: '9px 12px',
                fontSize: 12.5,
                fontWeight: 900,
                cursor: isOnline && !voice.joining ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Mic size={15} />
              <span>{voice.joining ? 'A ligar...' : 'Ligar Voz (Mic + Fones)'}</span>
            </button>
            <button
              type="button"
              disabled={!isOnline || voice.joining}
              onClick={() => voice.joinVoice({ listenOnly: true })}
              style={{
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: 10,
                padding: '9px 12px',
                fontSize: 12,
                fontWeight: 800,
                cursor: isOnline && !voice.joining ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Headphones size={14} />
              <span>Só Ouvir</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {!voice.listenOnly ? (
                <button
                  type="button"
                  onClick={voice.toggleMute}
                  title="Alternar microfone (Tecla V ou botão configurado em Comando)"
                  style={{
                    flex: 1,
                    background: voice.isMuted
                      ? 'rgba(239, 68, 68, 0.2)'
                      : voice.effectiveTransmitting
                      ? 'rgba(16, 185, 129, 0.22)'
                      : 'rgba(56, 189, 248, 0.16)',
                    color: voice.isMuted ? '#fca5a5' : '#ecfdf5',
                    border: voice.isMuted
                      ? '1px solid rgba(248, 113, 113, 0.45)'
                      : '1px solid rgba(52, 211, 153, 0.45)',
                    borderRadius: 9,
                    padding: '7px 10px',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  {voice.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  <span>
                    {voice.isMuted
                      ? 'Mic Desligado (V)'
                      : voice.pushToTalk
                      ? voice.pttKeyActive
                        ? 'A falar...'
                        : 'Premir [V] / Comando'
                      : 'Mic Ligado (V)'}
                  </span>
                </button>
              ) : (
                <span
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    background: '#090d16',
                    border: '1px solid #334155',
                    borderRadius: 9,
                    padding: '7px 10px',
                    fontSize: 11.5,
                    fontWeight: 800,
                    color: '#94a3b8',
                  }}
                >
                  <Headphones size={14} />
                  <span>Modo Só Ouvir</span>
                </span>
              )}

              <button
                type="button"
                onClick={voice.toggleDeafen}
                title="Silenciar/Ativar áudio dos outros pilotos"
                style={{
                  background: voice.isDeafened ? 'rgba(245, 158, 11, 0.22)' : '#1e293b',
                  color: voice.isDeafened ? '#fde68a' : '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: 9,
                  padding: '7px 10px',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {voice.isDeafened ? <VolumeX size={14} /> : <Volume2 size={14} />}
                <span>{voice.isDeafened ? 'Fones Mudados' : 'Fones ON'}</span>
              </button>

              <button
                type="button"
                onClick={voice.leaveVoice}
                title="Sair da chamada de voz"
                style={{
                  background: 'rgba(239, 68, 68, 0.18)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: 9,
                  padding: '7px 10px',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <PhoneOff size={14} />
                <span>Sair</span>
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                background: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: 9,
                padding: '7px 10px',
              }}
            >
              {!voice.listenOnly && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#cbd5e1',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={voice.pushToTalk}
                    onChange={(e) => voice.setPushToTalk(e.target.checked)}
                    style={{ accentColor: '#38bdf8' }}
                  />
                  <span>Premir [V] / Comando p/ falar</span>
                </label>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                <Volume2 size={13} color="#94a3b8" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={voice.voiceVolume}
                  onChange={(e) => voice.setVoiceVolume(Number(e.target.value))}
                  aria-label="Volume do chat de voz"
                  style={{ flex: 1, height: 4, accentColor: '#34d399', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94a3b8', width: 32, textAlign: 'right' }}>
                  {Math.round(voice.voiceVolume * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Room Text Chat Card */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 18,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={16} color="#38bdf8" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>Chat da Sala</h3>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8' }}>
            Tecla [T] na corrida
          </span>
        </div>

        <div
          ref={listRef}
          style={{
            height: 225,
            overflowY: 'auto',
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: 11,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>
              Sem mensagens nesta sala ainda.
            </div>
          ) : (
            messages.map((m) => {
              const isMe = selfId && m.senderId === selfId;
              if (m.isSystem) {
                return (
                  <div
                    key={m.id}
                    style={{
                      fontSize: 11,
                      color: '#7dd3fc',
                      fontWeight: 700,
                      padding: '3px 6px',
                      borderRadius: 6,
                      background: 'rgba(56, 189, 248, 0.08)',
                    }}
                  >
                    <span style={{ color: '#64748b', marginRight: 5 }}>{formatMsgTime(m.timestampMs)}</span>
                    {m.text}
                  </div>
                );
              }
              return (
                <div
                  key={m.id}
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    padding: '5px 8px',
                    borderRadius: 8,
                    background: isMe ? 'rgba(56, 189, 248, 0.14)' : 'rgba(15, 23, 42, 0.8)',
                    border: isMe ? '1px solid rgba(56, 189, 248, 0.28)' : '1px solid rgba(255,255,255,0.05)',
                    wordBreak: 'break-word',
                  }}
                >
                  <span style={{ fontSize: 10, color: '#64748b', marginRight: 5 }}>
                    {formatMsgTime(m.timestampMs)}
                  </span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: m.senderColor,
                      marginRight: 5,
                    }}
                  />
                  <strong style={{ color: isMe ? '#7dd3fc' : '#f8fafc', marginRight: 5 }}>
                    {m.senderName}:
                  </strong>
                  <span style={{ color: '#e2e8f0' }}>{m.text}</span>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {ROOM_QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={!isOnline}
              onClick={() => onSendMessage(chip)}
              style={{
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: 999,
                padding: '4px 9px',
                fontSize: 10.5,
                fontWeight: 700,
                cursor: isOnline ? 'pointer' : 'not-allowed',
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 7 }}>
          <input
            type="text"
            maxLength={240}
            value={draft}
            disabled={!isOnline}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Mensagem para a sala..."
            style={{
              flex: 1,
              background: '#090d16',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 9,
              padding: '8px 11px',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          />
          <button
            type="submit"
            disabled={!isOnline || !draft.trim()}
            style={{
              background: isOnline && draft.trim() ? '#0284c7' : '#334155',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '0 13px',
              fontWeight: 800,
              fontSize: 12,
              cursor: isOnline && draft.trim() ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Send size={13} />
            <span>Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
};
