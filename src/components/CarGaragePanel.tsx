import React from 'react';
import { RotateCcw, Sliders } from 'lucide-react';
import { CAR_CATEGORY_META, CarClass, LIVERY_PRESETS } from '../multiplayer/types';
import { CAR_CLASS_DEFAULTS, CarTuning } from './RapierCarController';

const VALID_CAR_CLASSES: CarClass[] = ['f1', 'gt', 'rally', 'drift'];

interface SliderSpec {
  key: Exclude<keyof CarTuning, 'primaryColor' | 'secondaryColor'>;
  label: string;
  pctRange: number;
  step: number;
  unit: string;
  decimals: number;
}

const SLIDER_SPECS: SliderSpec[] = [
  { key: 'maxSpeedKmh', label: 'Velocidade Máx.', pctRange: 0.10, step: 5, unit: 'km/h', decimals: 0 },
  { key: 'accelForce', label: 'Aceleração', pctRange: 0.12, step: 1, unit: '', decimals: 0 },
  { key: 'brakeForce', label: 'Travagem', pctRange: 0.18, step: 0.05, unit: 'x', decimals: 2 },
  { key: 'lateralGrip', label: 'Aderência (Drift ↔ Grip)', pctRange: 0.22, step: 0.2, unit: '', decimals: 1 },
  { key: 'steerRate', label: 'Resposta Direção', pctRange: 0.20, step: 0.05, unit: '', decimals: 2 },
  { key: 'suspensionStiffness', label: 'Rigidez Suspensão', pctRange: 0.25, step: 1, unit: '', decimals: 0 },
  { key: 'suspensionDamper', label: 'Amortecimento', pctRange: 0.25, step: 0.5, unit: '', decimals: 1 },
  { key: 'suspensionTravel', label: 'Curso / Altura Suspensão', pctRange: 0.15, step: 0.02, unit: 'm', decimals: 2 },
];

function roundToStep(val: number, step: number): number {
  return Math.round(val / step) * step;
}

export function getSliderBounds(carClass: CarClass, spec: SliderSpec): { min: number; max: number } {
  const defVal = CAR_CLASS_DEFAULTS[carClass][spec.key];
  const min = roundToStep(defVal * (1 - spec.pctRange), spec.step);
  const max = roundToStep(defVal * (1 + spec.pctRange), spec.step);
  return { min, max };
}

export function clampTuningToClass(carClass: CarClass, tuning: CarTuning): CarTuning {
  const def = CAR_CLASS_DEFAULTS[carClass];
  const next: CarTuning = {
    ...def,
    ...tuning,
    primaryColor: tuning.primaryColor || def.primaryColor,
    secondaryColor: tuning.secondaryColor || def.secondaryColor,
  };
  for (const spec of SLIDER_SPECS) {
    const { min, max } = getSliderBounds(carClass, spec);
    const val = typeof next[spec.key] === 'number' ? next[spec.key] : def[spec.key];
    next[spec.key] = Math.max(min, Math.min(max, Number(roundToStep(val, spec.step).toFixed(3))));
  }
  return next;
}

export function computeSetupPreset(
  carClass: CarClass,
  preset: 'balanced' | 'topspeed' | 'corner',
  colors: { primaryColor: string; secondaryColor: string }
): CarTuning {
  const def = CAR_CLASS_DEFAULTS[carClass];
  if (preset === 'balanced') {
    return clampTuningToClass(carClass, { ...def, ...colors });
  }
  if (preset === 'topspeed') {
    return clampTuningToClass(carClass, {
      ...def,
      maxSpeedKmh: def.maxSpeedKmh * 1.08,
      accelForce: def.accelForce * 0.96,
      lateralGrip: def.lateralGrip * 0.92,
      suspensionStiffness: def.suspensionStiffness * 1.10,
      ...colors,
    });
  }
  return clampTuningToClass(carClass, {
    ...def,
    maxSpeedKmh: def.maxSpeedKmh * 0.94,
    accelForce: def.accelForce * 1.10,
    lateralGrip: def.lateralGrip * 1.14,
    brakeForce: def.brakeForce * 1.10,
    steerRate: def.steerRate * 1.10,
    ...colors,
  });
}

export type SetupPresetId = 'balanced' | 'topspeed' | 'corner' | 'custom';

export function detectActivePreset(carClass: CarClass, tuning: CarTuning): SetupPresetId {
  const clamped = clampTuningToClass(carClass, tuning);
  const colors = {
    primaryColor: clamped.primaryColor,
    secondaryColor: clamped.secondaryColor,
  };
  for (const preset of ['balanced', 'topspeed', 'corner'] as const) {
    const target = computeSetupPreset(carClass, preset, colors);
    const matches = SLIDER_SPECS.every((spec) => Math.abs(clamped[spec.key] - target[spec.key]) <= 1e-3);
    if (matches) return preset;
  }
  return 'custom';
}

export interface CarGaragePanelProps {
  driverName: string;
  onChangeDriverName: (name: string) => void;
  carClass: CarClass;
  carClassLocked: boolean;
  lockedLabel?: string;
  onChangeCarClass: (c: CarClass) => void;
  tuning: CarTuning;
  onChangeTuning: (t: CarTuning) => void;
  onResetTuning: () => void;
}

export const CarGaragePanel: React.FC<CarGaragePanelProps> = ({
  driverName,
  onChangeDriverName,
  carClass,
  carClassLocked,
  lockedLabel,
  onChangeCarClass,
  tuning,
  onChangeTuning,
  onResetTuning,
}) => {
  const def = CAR_CLASS_DEFAULTS[carClass];
  const activeTuning = clampTuningToClass(carClass, tuning);
  const activePreset = detectActivePreset(carClass, activeTuning);

  const dnaBars = [
    {
      label: 'Velocidade',
      pct: Math.min(100, Math.max(4, Math.round((activeTuning.maxSpeedKmh / 420) * 100))),
      display: `${Math.round(activeTuning.maxSpeedKmh)} km/h`,
      color: '#38bdf8',
    },
    {
      label: 'Aderência',
      pct: Math.min(100, Math.max(4, Math.round((activeTuning.lateralGrip / 15) * 100))),
      display: `${activeTuning.lateralGrip.toFixed(1)}`,
      color: '#34d399',
    },
    {
      label: 'Travagem',
      pct: Math.min(100, Math.max(4, Math.round((activeTuning.brakeForce / 2.2) * 100))),
      display: `${activeTuning.brakeForce.toFixed(2)}x`,
      color: '#f59e0b',
    },
  ];

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.92)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 18,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>🏎️ Garagem &amp; Afinação</h3>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#38bdf8' }}>{def.label}</span>
      </div>

      {/* Driver Name */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
          Nome do Piloto
        </label>
        <input
          type="text"
          maxLength={20}
          value={driverName}
          onChange={(e) => onChangeDriverName(e.target.value)}
          style={{
            width: '100%',
            background: '#090d16',
            color: '#fff',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '8px 11px',
            fontSize: 13,
            fontWeight: 800,
          }}
        />
      </div>

      {/* Car Class Selector */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
          <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>Classe do Carro</label>
          {carClassLocked && lockedLabel && (
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24' }}>
              🔒 {lockedLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {VALID_CAR_CLASSES.map((cls) => {
            const meta = CAR_CATEGORY_META[cls];
            const selected = carClass === cls;
            const disabled = carClassLocked && cls !== carClass;
            return (
              <button
                key={cls}
                disabled={disabled}
                onClick={() => onChangeCarClass(cls)}
                style={{
                  padding: '7px 4px',
                  borderRadius: 9,
                  textAlign: 'center',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.35 : 1,
                  background: selected ? `${meta.badgeColor}33` : '#090d16',
                  border: selected ? `1.5px solid ${meta.badgeColor}` : '1px solid #334155',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                <div>{meta.emoji}</div>
                <div style={{ marginTop: 1 }}>{meta.shortLabel}</div>
              </button>
            );
          })}
        </div>

        {/* Live Class DNA Comparison (absolute scale across all classes) */}
        <div style={{
          marginTop: 8,
          background: '#090d16',
          border: '1px solid #1e293b',
          borderRadius: 10,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, fontWeight: 800, color: '#94a3b8' }}>
            <span>🧬 DNA da Classe ({CAR_CATEGORY_META[carClass].shortLabel})</span>
            <span style={{ color: '#64748b' }}>Escala comparativa geral</span>
          </div>
          {dnaBars.map((bar) => (
            <div key={bar.label} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 56px', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#cbd5e1' }}>{bar.label}</span>
              <div style={{ height: 6, background: '#1e293b', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${bar.pct}%`,
                    height: '100%',
                    background: bar.color,
                    borderRadius: 999,
                    transition: 'width 0.18s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, color: bar.color, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {bar.display}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Livery & Colors */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 5 }}>
          Pintura &amp; Cores da Equipa
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 8 }}>
          {LIVERY_PRESETS.map((preset) => {
            const active =
              activeTuning.primaryColor.toLowerCase() === preset.primaryColor.toLowerCase() &&
              activeTuning.secondaryColor.toLowerCase() === preset.secondaryColor.toLowerCase();
            return (
              <button
                key={preset.name}
                title={preset.name}
                onClick={() =>
                  onChangeTuning({
                    ...activeTuning,
                    primaryColor: preset.primaryColor,
                    secondaryColor: preset.secondaryColor,
                  })
                }
                style={{
                  height: 24,
                  borderRadius: 7,
                  cursor: 'pointer',
                  border: active ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                  background: `linear-gradient(135deg, ${preset.primaryColor} 60%, ${preset.secondaryColor} 60%)`,
                }}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{
            flex: 1,
            fontSize: 10.5,
            fontWeight: 700,
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#090d16',
            padding: '5px 9px',
            borderRadius: 8,
            border: '1px solid #334155',
            cursor: 'pointer',
          }}>
            <span>Cor Base</span>
            <input
              type="color"
              value={activeTuning.primaryColor}
              onChange={(e) => onChangeTuning({ ...activeTuning, primaryColor: e.target.value })}
              style={{ width: 24, height: 18, border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
          </label>
          <label style={{
            flex: 1,
            fontSize: 10.5,
            fontWeight: 700,
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#090d16',
            padding: '5px 9px',
            borderRadius: 8,
            border: '1px solid #334155',
            cursor: 'pointer',
          }}>
            <span>Faixa</span>
            <input
              type="color"
              value={activeTuning.secondaryColor}
              onChange={(e) => onChangeTuning({ ...activeTuning, secondaryColor: e.target.value })}
              style={{ width: 24, height: 18, border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
          </label>
        </div>
      </div>

      {/* Car Setup & Fine Tuning Sliders */}
      <div style={{
        background: '#090d16',
        borderRadius: 12,
        padding: 12,
        border: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Sliders size={13} />
            <span>AFINAÇÃO DO CARRO (SETUP)</span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {activePreset === 'custom' && (
              <span style={{
                background: 'rgba(168, 85, 247, 0.18)',
                border: '1px solid rgba(192, 132, 252, 0.45)',
                color: '#d8b4fe',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 7px',
              }}>
                🔧 Personalizado
              </span>
            )}
            <button
              onClick={onResetTuning}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 6,
                color: '#cbd5e1',
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <RotateCcw size={10} />
              <span>Repor Padrão</span>
            </button>
          </div>
        </div>

        {/* 1-Click Setup Presets */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
          {(
            [
              { id: 'balanced', label: '⚖️ Equilibrado (Padrão)', title: 'Afinação padrão equilibrada da classe' },
              { id: 'topspeed', label: '🚀 Ponta (Retas)', title: '+8% Velocidade Máx., menos arrasto para circuitos rápidos' },
              { id: 'corner', label: '🎯 Curvas (Técnico)', title: '+14% Aderência, +10% Aceleração e Travagem para pistas sinuosas' },
            ] as const
          ).map((p) => {
            const isSelected = activePreset === p.id;
            return (
              <button
                key={p.id}
                title={p.title}
                onClick={() =>
                  onChangeTuning(
                    computeSetupPreset(carClass, p.id, {
                      primaryColor: activeTuning.primaryColor,
                      secondaryColor: activeTuning.secondaryColor,
                    })
                  )
                }
                style={{
                  padding: '6px 4px',
                  borderRadius: 7,
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.85)',
                  border: isSelected ? '1.5px solid #38bdf8' : '1px solid #334155',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.22)' : 'none',
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.35, padding: '2px 2px 0' }}>
          O centro de cada barra é o padrão equilibrado da classe — usa os presets acima ou ajusta ao teu estilo.
        </div>

        {/* 8 Fine-Tuning Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
          {SLIDER_SPECS.map((spec) => {
            const { min, max } = getSliderBounds(carClass, spec);
            const val = activeTuning[spec.key];
            const centerPct = Math.min(92, Math.max(8, ((def[spec.key] - min) / Math.max(1e-6, max - min)) * 100));
            const minFmt = `${min.toFixed(spec.decimals)}${spec.unit ? ` ${spec.unit}` : ''}`;
            const maxFmt = `${max.toFixed(spec.decimals)}${spec.unit ? ` ${spec.unit}` : ''}`;
            const leftHint =
              spec.key === 'lateralGrip'
                ? `${minFmt} (Mais Drift)`
                : spec.key === 'suspensionStiffness'
                ? `${minFmt} (Macia)`
                : minFmt;
            const rightHint =
              spec.key === 'lateralGrip'
                ? `(Mais Grip) ${maxFmt}`
                : spec.key === 'suspensionStiffness'
                ? `(Rígida) ${maxFmt}`
                : maxFmt;

            return (
              <div key={spec.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, marginBottom: 1 }}>
                  <span style={{ color: '#cbd5e1' }}>{spec.label}</span>
                  <span style={{ color: '#38bdf8', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
                    {val.toFixed(spec.decimals)}{spec.unit ? ` ${spec.unit}` : ''}
                  </span>
                </div>
                <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${centerPct.toFixed(1)}%`,
                      top: 3,
                      bottom: 3,
                      width: 2,
                      transform: 'translateX(-1px)',
                      background: 'rgba(255,255,255,0.28)',
                      borderRadius: 1,
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                  />
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={spec.step}
                    value={val}
                    onChange={(e) => {
                      const nextVal = parseFloat(e.target.value);
                      onChangeTuning(
                        clampTuningToClass(carClass, {
                          ...activeTuning,
                          [spec.key]: nextVal,
                        })
                      );
                    }}
                    style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer', position: 'relative', zIndex: 1, margin: 0 }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#64748b', marginTop: 1 }}>
                  <span>{leftHint}</span>
                  <span>{rightHint}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
