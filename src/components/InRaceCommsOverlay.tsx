import React, { useEffect, useRef, useState } from 'react';
import { Headphones, MessageSquare, Mic, MicOff, Send, Volume2, VolumeX, X } from 'lucide-react';
import type { ChatMessage, RoomPlayerInfo } from '../multiplayer/types';
import type { useRoomVoice } from '../multiplayer/useRoomVoice';

export interface InRaceCommsOverlayProps {
  players: RoomPlayerInfo[];
  selfId: string | null;
  messages: ChatMessage[];
  chatOpen: boolean;
  onCloseChat: () => void;
  onSendMessage: (text: string) => void;
  voice: ReturnType<typeof useRoomVoice>;
}

const RACE_QUICK_PHRASES = ['Boa!', 'Desculpa!', 'Box!', 'GG!'];

export const InRaceCommsOverlay: React.FC<InRaceCommsOverlayProps> = ({
  players,
  selfId,
  messages,
  chatOpen,
  onCloseChat,
  onSendMessage,
  voice,
}) => {
  const [draft, setDraft] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refresh timer every 1s while collapsed to expire old toast bubbles
  useEffect(() => {
    if (chatOpen) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 20);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatOpen, messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draft.trim();
    if (clean) {
      onSendMessage(clean);
      setDraft('');
    }
    inputRef.current?.blur();
  };

  const activeSpeakers = players.filter(
    (p) => p.connected && p.voiceJoined && Boolean(voice.speakingPeers[p.id])
  );
  const voicePeersCount = players.filter((p) => p.connected && p.voiceJoined).length;
  const recentToasts = !chatOpen
    ? messages.filter((m) => nowMs - m.timestampMs < 8000).slice(-3)
    : [];

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        right: 20,
        zIndex: 920,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Active Speakers & Quick Voice Strip */}
      {voice.joined && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            pointerEvents: 'auto',
          }}
        >
          {activeSpeakers.map((sp) => (
            <div
              key={sp.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(6, 78, 59, 0.9)',
                border: '1.5px solid #34d399',
                boxShadow: '0 0 14px rgba(16, 185, 129, 0.5)',
                color: '#ecfdf5',
                fontSize: 11.5,
                fontWeight: 900,
              }}
            >
              <Mic size={12} color="#34d399" />
              <span>{sp.name}</span>
            </div>
          ))}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 9px',
              borderRadius: 999,
              background: 'rgba(15, 23, 42, 0.88)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              color: '#cbd5e1',
              fontSize: 11,
              fontWeight: 800,
              backdropFilter: 'blur(10px)',
            }}
          >
            <Headphones size={12} color="#34d399" />
            <span>{voicePeersCount}</span>
            {!voice.listenOnly && (
              <button
                type="button"
                onClick={voice.toggleMute}
                title={voice.isMuted ? 'Ligar Microfone (V)' : 'Silenciar Microfone (V)'}
                style={{
                  background: voice.isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.2)',
                  color: voice.isMuted ? '#fca5a5' : '#6ee7b7',
                  border: 'none',
                  borderRadius: 6,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {voice.isMuted ? <MicOff size={11} /> : <Mic size={11} />}
                <span>
                  {voice.isMuted
                    ? 'OFF'
                    : voice.pushToTalk
                    ? voice.pttKeyActive
                      ? 'TX'
                      : '[V]'
                    : 'ON'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={voice.toggleDeafen}
              title={voice.isDeafened ? 'Ativar áudio' : 'Silenciar áudio'}
              style={{
                background: 'transparent',
                color: voice.isDeafened ? '#fbbf24' : '#94a3b8',
                border: 'none',
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {voice.isDeafened ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          </div>
        </div>
      )}

      {/* Collapsed Recent Message Toasts */}
      {!chatOpen && recentToasts.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
            maxWidth: 300,
            pointerEvents: 'none',
          }}
        >
          {recentToasts.map((m) => (
            <div
              key={m.id}
              style={{
                background: 'rgba(15, 23, 42, 0.84)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 9,
                padding: '5px 10px',
                fontSize: 11.5,
                color: '#f8fafc',
                boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
              }}
            >
              {!m.isSystem && (
                <strong style={{ color: m.senderId === selfId ? '#7dd3fc' : '#facc15', marginRight: 5 }}>
                  {m.senderName}:
                </strong>
              )}
              <span style={{ color: m.isSystem ? '#7dd3fc' : '#e2e8f0' }}>{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Expanded In-Race Chat Drawer */}
      {chatOpen && (
        <div
          style={{
            width: 315,
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(56, 189, 248, 0.38)',
            borderRadius: 14,
            padding: 12,
            boxShadow: '0 16px 40px rgba(0,0,0,0.65)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            pointerEvents: 'auto',
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 900 }}>
              <MessageSquare size={14} color="#38bdf8" />
              <span>Chat da Corrida (T)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                inputRef.current?.blur();
                onCloseChat();
              }}
              style={{
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: 6,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Fechar chat"
            >
              <X size={13} />
            </button>
          </div>

          <div
            ref={listRef}
            style={{
              height: 185,
              overflowY: 'auto',
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: 9,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {messages.length === 0 ? (
              <div style={{ margin: 'auto', fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                Sem mensagens na corrida.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.35,
                    padding: '4px 7px',
                    borderRadius: 7,
                    background:
                      m.isSystem
                        ? 'rgba(56, 189, 248, 0.08)'
                        : m.senderId === selfId
                        ? 'rgba(56, 189, 248, 0.14)'
                        : 'rgba(30, 41, 59, 0.5)',
                    wordBreak: 'break-word',
                  }}
                >
                  {!m.isSystem && (
                    <strong
                      style={{
                        color: m.senderId === selfId ? '#7dd3fc' : '#f8fafc',
                        marginRight: 5,
                      }}
                    >
                      {m.senderName}:
                    </strong>
                  )}
                  <span style={{ color: m.isSystem ? '#7dd3fc' : '#e2e8f0' }}>{m.text}</span>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {RACE_QUICK_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => {
                  onSendMessage(phrase);
                  inputRef.current?.blur();
                }}
                style={{
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: 999,
                  padding: '3px 8px',
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {phrase}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              type="text"
              maxLength={240}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  inputRef.current?.blur();
                  onCloseChat();
                }
              }}
              placeholder="Escreve e prime Enter..."
              style={{
                flex: 1,
                background: '#090d16',
                color: '#fff',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '6px 9px',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              style={{
                background: draft.trim() ? '#0284c7' : '#334155',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0 10px',
                cursor: draft.trim() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Enviar mensagem"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
