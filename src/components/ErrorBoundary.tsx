import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Sparkles, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('MiniRace3D ErrorBoundary apanhou um erro:', error, errorInfo);
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  handleClearDraftAndReload = () => {
    try {
      localStorage.removeItem('minirace3d_current_draft');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'radial-gradient(ellipse at center, #1e293b 0%, #0f172a 100%)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          zIndex: 99999,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            background: 'rgba(30, 41, 59, 0.85)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 16,
            padding: '32px 36px',
            maxWidth: 540,
            width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            textAlign: 'center'
          }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '2px solid #ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 18px'
            }}>
              <AlertTriangle size={28} color="#ef4444" />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px', color: '#ffffff' }}>
              {this.props.fallbackTitle || 'Recuperação do MiniRace 3D'}
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
              Ocorreu uma exceção no motor 3D. Os teus circuitos guardados continuam em segurança. Escolhe como queres recuperar:
            </p>

            {this.state.error && (
              <div style={{
                background: '#090d16',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#fca5a5',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: 24,
                maxHeight: 100
              }}>
                {this.state.error.name}: {this.state.error.message}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={this.handleTryAgain}
                style={{
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  color: '#ffffff',
                  border: '1px solid #38bdf8',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)'
                }}
              >
                <RefreshCw size={15} />
                <span>Tentar Recuperar a Cena</span>
              </button>

              <button
                onClick={this.handleClearDraftAndReload}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                <RotateCcw size={14} />
                <span>Limpar Rascunho Atual e Recarregar</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
