import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Gamepad2, RotateCcw, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  captureBaselineSnapshot,
  detectNextBindingFromBaseline,
  formatGamepadBinding,
  GamepadAction,
  GamepadBaselineSnapshot,
  getGamepadStatus,
  recalibrateGamepads,
  resetGamepadConfig,
  setCustomGamepadBinding,
  setGamepadConfig,
  setPreferredGamepadIndex,
  startGamepadUiPolling,
  stopGamepadUiPolling,
  subscribeGamepadStatus,
} from '../gamepadInput';

export interface GamepadSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const ACTION_ROWS: Array<{ action: GamepadAction; label: string }> = [
  { action: 'throttle', label: 'Acelerar' },
  { action: 'brake', label: 'Travar / Marcha-atrás' },
  { action: 'steerLeft', label: 'Virar à Esquerda' },
  { action: 'steerRight', label: 'Virar à Direita' },
  { action: 'handbrake', label: 'Travão de Mão' },
  { action: 'recover', label: 'Recuperar na Pista (-35m)' },
  { action: 'headlights', label: 'Faróis (L)' },
  { action: 'camera', label: 'Mudar Câmara (C)' },
  { action: 'pushToTalk', label: 'Falar no Chat de Voz (Mic / PTT)' },
];

export const GamepadSettingsModal: React.FC<GamepadSettingsModalProps> = ({ open, onClose }) => {
  const status = useSyncExternalStore(subscribeGamepadStatus, getGamepadStatus);
  const [listeningAction, setListeningAction] = useState<GamepadAction | null>(null);
  const [baseline, setBaseline] = useState<GamepadBaselineSnapshot | null>(null);

  useEffect(() => {
    if (!open) {
      setListeningAction(null);
      setBaseline(null);
      return;
    }
    startGamepadUiPolling();
    return () => {
      stopGamepadUiPolling();
    };
  }, [open]);

  // Listening loop when user clicks "Alterar" on an action
  useEffect(() => {
    if (!open || !listeningAction || !baseline) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setListeningAction(null);
        setBaseline(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const timer = window.setInterval(() => {
      const detected = detectNextBindingFromBaseline(baseline);
      if (detected) {
        setCustomGamepadBinding(listeningAction, detected);
        setListeningAction(null);
        setBaseline(null);
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearInterval(timer);
    };
  }, [open, listeningAction, baseline]);

  if (!open) return null;

  const activePad = status.activePad;
  const steerPct = Math.round(status.live.steer * 100);
  const throttlePct = Math.round(status.live.throttle * 100);
  const brakePct = Math.round(status.live.brake * 100);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 960,
        background: 'rgba(2, 6, 23, 0.78)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#0f172a',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 18,
          padding: 20,
          color: '#f8fafc',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.75)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: activePad ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.16)',
                border: `1px solid ${activePad ? '#34d399' : '#38bdf8'}`,
                color: activePad ? '#34d399' : '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Gamepad2 size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>🎮 Configurar &amp; Testar Comando</h3>
              <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>
                Suporte para comandos Xbox, PlayStation, USB genéricos e DirectInput
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Security / Context Warning */}
        {(!status.isSecureContext || !status.apiAvailable || status.lastError) && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(251, 191, 36, 0.45)',
              borderRadius: 12,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 12,
              color: '#fde68a',
              fontWeight: 700,
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              {!status.isSecureContext
                ? 'Nota: Alguns browsers bloqueiam comandos (e microfone) em HTTP por IP remoto. Usa HTTPS ou localhost se o comando não responder.'
                : status.lastError
                ? `Erro ao ler API de comandos: ${status.lastError}`
                : 'A API de comandos (navigator.getGamepads) não está disponível neste browser.'}
            </div>
          </div>
        )}

        {/* Active Pad Banner */}
        <div
          style={{
            background: '#090d16',
            border: activePad ? '1px solid rgba(52, 211, 153, 0.45)' : '1px dashed #334155',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {activePad ? <CheckCircle2 size={17} color="#34d399" /> : <Gamepad2 size={17} color="#94a3b8" />}
              <span style={{ fontSize: 13, fontWeight: 900, color: activePad ? '#ecfdf5' : '#cbd5e1' }}>
                {activePad ? activePad.id : 'Nenhum comando ativo detetado'}
              </span>
            </div>
            {activePad && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 900,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: activePad.mapping === 'standard' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                  color: activePad.mapping === 'standard' ? '#34d399' : '#fbbf24',
                  border: `1px solid ${activePad.mapping === 'standard' ? 'rgba(52, 211, 153, 0.4)' : 'rgba(251, 191, 36, 0.4)'}`,
                }}
              >
                {activePad.mapping === 'standard' ? 'Mapeamento Padrão' : 'Genérico / DirectInput'} • Slot #{activePad.index}
              </span>
            )}
          </div>

          {!activePad && (
            <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.45 }}>
              Liga o comando (USB ou Bluetooth) e{' '}
              <strong style={{ color: '#e2e8f0' }}>prime qualquer botão com esta janela em foco</strong> para o browser o detetar.
              Se usares um comando paralelo ou volante, podes remapear os botões abaixo.
            </div>
          )}

          {status.connectedPads.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>Comando selecionado:</span>
              <select
                value={status.config.preferredIndex === null ? 'auto' : String(status.config.preferredIndex)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreferredGamepadIndex(v === 'auto' ? null : Number(v));
                }}
                style={{
                  background: '#0f172a',
                  color: '#fff',
                  border: '1px solid #334155',
                  borderRadius: 7,
                  padding: '4px 8px',
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                <option value="auto">Automático (o último com atividade)</option>
                {status.connectedPads.map((p) => (
                  <option key={p.index} value={String(p.index)}>
                    Slot #{p.index} — {p.id.slice(0, 42)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Live Input Bars */}
        <div
          style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          {/* Steering Bar (-100% to +100%) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
              <span style={{ color: '#38bdf8' }}>DIREÇÃO</span>
              <span style={{ color: '#e2e8f0' }}>
                {steerPct > 4 ? `← ${steerPct}%` : steerPct < -4 ? `${Math.abs(steerPct)}% →` : 'Centro'}
              </span>
            </div>
            <div style={{ position: 'relative', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#64748b' }} />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: steerPct >= 0 ? `${50 - Math.min(50, steerPct * 0.5)}%` : '50%',
                  width: `${Math.min(50, Math.abs(steerPct) * 0.5)}%`,
                  background: '#38bdf8',
                }}
              />
            </div>
          </div>

          {/* Throttle Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
              <span style={{ color: '#34d399' }}>ACELERAÇÃO</span>
              <span style={{ color: '#e2e8f0' }}>{throttlePct}%</span>
            </div>
            <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${throttlePct}%`, background: '#10b981' }} />
            </div>
          </div>

          {/* Brake Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
              <span style={{ color: '#f87171' }}>TRAVÃO</span>
              <span style={{ color: '#e2e8f0' }}>{brakePct}%</span>
            </div>
            <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${brakePct}%`, background: '#ef4444' }} />
            </div>
          </div>

          {/* Handbrake & Pressed Buttons */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, marginBottom: 5 }}>
              <span style={{ color: '#fbbf24' }}>TRAVÃO DE MÃO</span>
              <span style={{ color: status.live.handbrake ? '#facc15' : '#64748b' }}>
                {status.live.handbrake ? 'ATIVO' : 'OFF'}
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700 }}>
              {status.live.pressedButtons.length > 0
                ? `Botões ativos: ${status.live.pressedButtons.join(', ')}`
                : 'Prime botões/gatilhos para testar'}
            </div>
          </div>
        </div>

        {/* Deadzone & Invert Steer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '10px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: '#cbd5e1', whiteSpace: 'nowrap' }}>
              Zona Morta: {Math.round(status.config.deadzone * 100)}%
            </span>
            <input
              type="range"
              min={0.04}
              max={0.25}
              step={0.01}
              value={status.config.deadzone}
              onChange={(e) => setGamepadConfig({ deadzone: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#38bdf8', cursor: 'pointer' }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={status.config.invertSteer}
              onChange={(e) => setGamepadConfig({ invertSteer: e.target.checked })}
              style={{ accentColor: '#38bdf8', width: 15, height: 15 }}
            />
            <span>Inverter Direção</span>
          </label>
        </div>

        {/* Custom Action Remap Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#e2e8f0' }}>Mapeamento de Botões</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => recalibrateGamepads()}
                title="Releitura do ponto zero dos analógicos e botões em repouso"
                style={{
                  background: '#1e293b',
                  color: '#7dd3fc',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: 8,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Recalibrar Repouso
              </button>
              <button
                onClick={() => {
                  setListeningAction(null);
                  setBaseline(null);
                  resetGamepadConfig();
                }}
                style={{
                  background: '#1e293b',
                  color: '#cbd5e1',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <RotateCcw size={12} />
                <span>Repor Padrão</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ACTION_ROWS.map((row) => {
              const customBinding = status.config.customBindings[row.action];
              const isListening = listeningAction === row.action;
              return (
                <div
                  key={row.action}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 9,
                    background: isListening ? 'rgba(56, 189, 248, 0.14)' : '#090d16',
                    border: isListening ? '1px solid #38bdf8' : '1px solid #1e293b',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0' }}>{row.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: isListening ? '#38bdf8' : customBinding ? '#34d399' : '#94a3b8',
                      }}
                    >
                      {isListening
                        ? 'Prime um botão ou gatilho (Esc cancela)...'
                        : formatGamepadBinding(row.action, customBinding)}
                    </span>
                    {customBinding && !isListening && (
                      <button
                        onClick={() => setCustomGamepadBinding(row.action, null)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #334155',
                          color: '#94a3b8',
                          borderRadius: 6,
                          padding: '3px 7px',
                          fontSize: 10,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Padrão
                      </button>
                    )}
                    <button
                      disabled={!activePad}
                      onClick={() => {
                        if (isListening) {
                          setListeningAction(null);
                          setBaseline(null);
                          return;
                        }
                        const snap = captureBaselineSnapshot();
                        if (snap) {
                          setBaseline(snap);
                          setListeningAction(row.action);
                        }
                      }}
                      style={{
                        background: isListening ? '#e11d48' : activePad ? '#1e293b' : '#0f172a',
                        color: activePad ? '#fff' : '#475569',
                        border: '1px solid #334155',
                        borderRadius: 7,
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: activePad ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {isListening ? 'Cancelar' : 'Alterar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Raw Browser Diagnostics */}
        <div
          style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11,
          }}
        >
          <div style={{ fontWeight: 900, color: '#94a3b8', letterSpacing: '0.04em' }}>
            DIAGNÓSTICO RAW DO BROWSER
          </div>
          {status.connectedPads.length === 0 ? (
            <div style={{ color: '#64748b', fontWeight: 600 }}>
              Nenhum dispositivo recebido por navigator.getGamepads().
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {status.connectedPads.map((p) => (
                  <div
                    key={p.index}
                    style={{
                      color: p.isActive ? '#6ee7b7' : '#94a3b8',
                      fontWeight: p.isActive ? 800 : 600,
                      fontFamily: 'monospace',
                    }}
                  >
                    {p.isActive ? '▶ ' : '  '}Slot #{p.index}: {p.id} [{p.mapping}] • {p.axesCount} eixos, {p.buttonsCount} botões
                  </div>
                ))}
              </div>
              <div style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>
                Botões raw:{' '}
                {status.live.rawPressedButtons.length > 0
                  ? status.live.rawPressedButtons.map((b) => `#${b.index}(${b.value.toFixed(2)})`).join(' ')
                  : 'nenhum'}
              </div>
              <div style={{ color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                Eixos raw: [{status.live.axes.map((a) => a.toFixed(2)).join(', ')}]
              </div>
            </>
          )}
          <div style={{ color: '#94a3b8', fontSize: 10.5, lineHeight: 1.4, marginTop: 2 }}>
            Dica Logitech (F310/F710): verifica o interruptor <strong>X / D</strong> na parte traseira (recomendado em{' '}
            <strong>X</strong>) e o botão <strong>MODE</strong> caso o analógico pareça trocado com o D-Pad.
          </div>
        </div>
      </div>
    </div>
  );
};
