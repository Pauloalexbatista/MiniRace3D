import * as THREE from 'three';

export type TrackThemeId = 'f1_modern' | 'rally_gravel' | 'classic_street' | 'f1' | 'rally' | 'monaco';

export interface TrackThemeConfig {
  id: TrackThemeId;
  name: string;
  defaultRoadWidth: number;
  minRoadWidth: number;
  maxRoadWidth: number;
  defaultShoulderWidth: number;
  hasCurbs: boolean;
  curbMaxApexWidth: number;
  curbMaxWarningWidth: number;
  barrierType: 'concrete_wall' | 'armco' | 'natural_slope' | 'none';
  barrierHeight: number;
  barrierThickness: number;
  
  // SketchUp visual palette
  asphaltColor: string;
  pitAsphaltColor: string;
  whiteLineColor: string;
  curbWarningColor: string;
  curbApexColor: string;
  grassColor: string;
  embankColor: string;
  wallColor: string;
  outlineColor: string;
  pitMarkingColor: string;
  sandColor?: string;
  gravelColor?: string;
}

export const TRACK_THEMES_INTERNAL: Record<string, TrackThemeConfig> = {
  f1_modern: {
    id: 'f1_modern',
    name: 'F1 Grand Prix (Moderno)',
    defaultRoadWidth: 16.0,
    minRoadWidth: 7.5,
    maxRoadWidth: 26.0,
    defaultShoulderWidth: 6.5,
    hasCurbs: true,
    curbMaxApexWidth: 1.85,
    curbMaxWarningWidth: 1.60,
    barrierType: 'concrete_wall',
    barrierHeight: 1.40,
    barrierThickness: 0.85,
    asphaltColor: '#64748b',
    pitAsphaltColor: '#20232b',
    whiteLineColor: '#ffffff',
    curbWarningColor: '#facc15',
    curbApexColor: '#dc2626',
    grassColor: '#22773b',
    embankColor: '#1a542b',
    wallColor: '#ffffff',
    outlineColor: '#0f172a',
    pitMarkingColor: '#eab308',
    sandColor: '#d97706',
    gravelColor: '#78716c'
  },
  rally_gravel: {
    id: 'rally_gravel',
    name: 'Rali WRC (Terra & Cascalho)',
    defaultRoadWidth: 7.0,
    minRoadWidth: 4.5,
    maxRoadWidth: 14.0,
    defaultShoulderWidth: 2.5,
    hasCurbs: false, // Rally tracks do not have F1 concrete curbs!
    curbMaxApexWidth: 0,
    curbMaxWarningWidth: 0,
    barrierType: 'natural_slope',
    barrierHeight: 0.90,
    barrierThickness: 0.50,
    asphaltColor: '#5c4533', // Terra batida / cascalho castanho
    pitAsphaltColor: '#453224',
    whiteLineColor: '#8c735d',
    curbWarningColor: '#785b42',
    curbApexColor: '#4a3321',
    grassColor: '#3d3020', // Solo natural / vegetação agreste
    embankColor: '#2d2215',
    wallColor: '#9ca3af', // Rails metálicos ou madeira
    outlineColor: '#281d13',
    pitMarkingColor: '#f97316'
  },
  classic_street: {
    id: 'classic_street',
    name: 'Circuito Citadino / Clássico',
    defaultRoadWidth: 11.0,
    minRoadWidth: 6.5,
    maxRoadWidth: 18.0,
    defaultShoulderWidth: 2.0, // Muros colados estilo Mónaco
    hasCurbs: true,
    curbMaxApexWidth: 1.20,
    curbMaxWarningWidth: 1.00,
    barrierType: 'concrete_wall',
    barrierHeight: 1.50,
    barrierThickness: 0.70,
    asphaltColor: '#374151',
    pitAsphaltColor: '#1f2937',
    whiteLineColor: '#f3f4f6',
    curbWarningColor: '#fbbf24',
    curbApexColor: '#ef4444',
    grassColor: '#15803d',
    embankColor: '#166534',
    wallColor: '#e5e7eb',
    outlineColor: '#111827',
    pitMarkingColor: '#38bdf8'
  }
};
// Alias mapping to support both canonical and shorthand ids ('f1', 'rally', 'monaco')
TRACK_THEMES_INTERNAL['f1'] = TRACK_THEMES_INTERNAL.f1_modern;
TRACK_THEMES_INTERNAL['rally'] = TRACK_THEMES_INTERNAL.rally_gravel;
TRACK_THEMES_INTERNAL['monaco'] = TRACK_THEMES_INTERNAL.classic_street;

export const TRACK_THEMES: Record<string, TrackThemeConfig> = new Proxy(TRACK_THEMES_INTERNAL, {
  get(target, prop: string) {
    return target[prop] || target.f1_modern;
  }
});


export interface CalculatedCrossSection {
  halfWidth: number;
  whiteLineWidth: number;
  yellowCurbWidth: number;
  redCurbWidth: number;
  grassWidth: number;
  sandWidth: number;
  gravelWidth: number;
  shoulderWidth: number;
  barrierHeight: number;
  barrierThickness: number;
  showBarrier: boolean;
}

/**
 * Calculates adaptive, proportional dimensions for a track cross-section node.
 * Eliminates arbitrary fixed meters and smoothly scales all layers.
 */
export function calculateCrossSection(
  rawWidth: number | undefined,
  isExtendedTight: boolean,
  isApexTight: boolean,
  customShoulder: number | undefined,
  themeConfig: TrackThemeConfig = TRACK_THEMES.f1_modern,
  nodeOverrides?: {
    whiteLineWidth?: number;
    curbYellowWidth?: number;
    curbRedWidth?: number;
    grassWidth?: number;
    sandWidth?: number;
    gravelWidth?: number;
    wallThickness?: number;
  }
): CalculatedCrossSection {
  const roadW = rawWidth || themeConfig.defaultRoadWidth;
  const clampedRoadW = Math.max(themeConfig.minRoadWidth, Math.min(themeConfig.maxRoadWidth, roadW));
  const halfWidth = clampedRoadW / 2;

  const whiteLineWidth = nodeOverrides?.whiteLineWidth ?? 0.4;
  const yellowCurbWidth = nodeOverrides?.curbYellowWidth ?? 0.6;
  const redCurbWidth = nodeOverrides?.curbRedWidth ?? 0.6;
  const grassWidth = nodeOverrides?.grassWidth ?? 2.0;
  const sandWidth = nodeOverrides?.sandWidth ?? 1.5;
  const gravelWidth = nodeOverrides?.gravelWidth ?? 2.0;
  const barrierThickness = nodeOverrides?.wallThickness ?? themeConfig.barrierThickness ?? 0.8;

  const totalBermas = whiteLineWidth + yellowCurbWidth + redCurbWidth + grassWidth + sandWidth + gravelWidth;
  const shoulderWidth = customShoulder !== undefined ? Math.max(totalBermas, customShoulder) : totalBermas;
  const showBarrier = themeConfig.barrierType !== 'none';

  return {
    halfWidth,
    whiteLineWidth,
    yellowCurbWidth,
    redCurbWidth,
    grassWidth,
    sandWidth,
    gravelWidth,
    shoulderWidth,
    barrierHeight: themeConfig.barrierHeight,
    barrierThickness,
    showBarrier
  };
}

export interface TrackFrame3D {
  pos: THREE.Vector3;
  side: THREE.Vector3;
  up: THREE.Vector3;
  tangent: THREE.Vector3;
}

/**
 * Builds the exact 3D reference frames (pos, side, up, tangent) for each node of the spline,
 * incorporating banking tilt and center height compensation (yDrop).
 * This ensures Track3D rendering and CarController physics use 100% identical geometry.
 */
export function buildTrackFrames(spline: SplineNode[], isClosed: boolean = true, themeConfig: TrackThemeConfig = TRACK_THEMES.f1_modern): TrackFrame3D[] {
  const N = spline.length;
  const frames: TrackFrame3D[] = [];
  if (N < 2) return frames;

  for (let i = 0; i < N; i++) {
    const curr = spline[i];
    const prev = isClosed ? spline[(i - 1 + N) % N] : spline[Math.max(0, i - 1)];
    const next = isClosed ? spline[(i + 1) % N] : spline[Math.min(N - 1, i + 1)];

    const pCurr = new THREE.Vector3(curr.x, curr.z ?? 0, curr.y);
    const pPrev = new THREE.Vector3(prev.x, prev.z ?? 0, prev.y);
    const pNext = new THREE.Vector3(next.x, next.z ?? 0, next.y);

    let tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
    if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);

    let up = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(tangent, up).normalize();
    if (side.lengthSq() === 0) side.set(0, 0, 1);

    up = new THREE.Vector3().crossVectors(side, tangent).normalize();

    if (curr.banking) {
      const bankingRad = (curr.banking * Math.PI) / 180;
      side.applyAxisAngle(tangent, bankingRad);
      up.applyAxisAngle(tangent, bankingRad);
    }

    const cross = calculateCrossSection(
      curr.width,
      curr.isExtendedTight || false,
      curr.isApexTight || false,
      curr.shoulderWidth,
      themeConfig,
      curr
    );

    if (curr.banking) {
      const bankingRad = Math.abs((curr.banking * Math.PI) / 180);
      const maxHalfW = cross.halfWidth + (cross.shoulderWidth || 8.0) + (cross.barrierThickness || 1.0);
      const yDrop = Math.sin(bankingRad) * maxHalfW;
      pCurr.y += yDrop;
    }

    frames.push({
      pos: pCurr,
      side,
      up,
      tangent
    });
  }

  return frames;
}
