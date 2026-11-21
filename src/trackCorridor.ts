export interface GlobalTrackProfile {
  roadWidth: number;
  whiteLineWidth: number;
  curbYellowWidth: number;
  curbRedWidth: number;
  grassWidth: number;
  sandWidth: number;
  gravelWidth: number;
  wallThickness: number;
}

export const DEFAULT_TRACK_PROFILE: GlobalTrackProfile = {
  roadWidth: 14.0,
  whiteLineWidth: 0.4,
  curbYellowWidth: 0.8,
  curbRedWidth: 0.8,
  grassWidth: 2.0,
  sandWidth: 2.0,
  gravelWidth: 2.5,
  wallThickness: 0.8
};

import type { SplineNode } from './tracks';

// ============================================================
// PERFIL TRANSVERSAL (por lado) - fonte única de verdade
// Ordem a partir do asfalto: Linha Branca -> Z.Amarela -> Z.Vermelha
//                            -> Relva -> Areia -> Gravilha -> Muro
// ============================================================

export const ZONE_KEYS = [
  'whiteLineWidth',
  'curbYellowWidth',
  'curbRedWidth',
  'grassWidth',
  'sandWidth',
  'gravelWidth',
  'wallThickness'
] as const;

export type ZoneKey = typeof ZONE_KEYS[number];
export type ZoneSide = 'L' | 'R';

/** Valores por defeito de cada faixa (metros) */
export const ZONE_DEFAULTS: Record<ZoneKey, number> = {
  whiteLineWidth: 0.4,
  curbYellowWidth: 0.6,
  curbRedWidth: 0.6,
  grassWidth: 2.0,
  sandWidth: 1.5,
  gravelWidth: 2.0,
  wallThickness: 0.8
};

/** Faixas que ficam entre o asfalto e o muro (tudo menos o muro) */
export const BERMA_KEYS: ZoneKey[] = ZONE_KEYS.filter(k => k !== 'wallThickness');

/**
 * Lê a largura de uma faixa num lado.
 * Prioridade: valor específico do lado (ex: grassWidthL) -> valor comum (grassWidth) -> defeito.
 */
export function getZone(node: SplineNode, key: ZoneKey, side: ZoneSide): number {
  const n = node as unknown as Record<string, unknown>;
  const sideVal = n[key + side];
  if (typeof sideVal === 'number' && isFinite(sideVal)) return sideVal;
  const baseVal = n[key];
  if (typeof baseVal === 'number' && isFinite(baseVal)) return baseVal;
  return ZONE_DEFAULTS[key];
}

/** Largura total da berma (sem o muro) num lado */
export function bermaWidth(node: SplineNode, side: ZoneSide): number {
  return BERMA_KEYS.reduce((acc, k) => acc + getZone(node, k, side), 0);
}

/** Interpola todas as faixas (por lado) entre dois nós - usado pela spline */


export function lerpColorHex(hexA: string, hexB: string, t: number): string {
  const parse = (h: string) => {
    let clean = (h || "").replace("#", "");
    if (clean.length === 3) clean = clean.split("").map(x => x + x).join("");
    const num = parseInt(clean, 16);
    return isNaN(num) ? [255, 255, 255] : [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function interpZones(p1: SplineNode, p2: SplineNode, t: number): Partial<SplineNode> {
  const out: Record<string, any> = {};
  for (const k of ZONE_KEYS) {
    for (const s of ["L", "R"] as ZoneSide[]) {
      const a = getZone(p1, k, s);
      const b = getZone(p2, k, s);
      out[k + s] = a + (b - a) * t;
    }
  }

  const colorKeys = [
    "asphaltColor",
    "whiteLineColor",
    "curbYellowColor",
    "curbRedColor",
    "grassColor",
    "sandColor",
    "gravelColor",
    "wallColor"
  ] as const;

  for (const ck of colorKeys) {
    const c1 = (p1 as any)[ck];
    const c2 = (p2 as any)[ck];
    if (c1 && c2) {
      out[ck] = lerpColorHex(c1, c2, t);
    } else if (c1) {
      out[ck] = c1;
    } else if (c2) {
      out[ck] = c2;
    }
  }

  return out as Partial<SplineNode>;
}

// ============================================================
// CORREDOR: onde fica o muro em cada fatia da spline
// Usado pelo Track3D (desenho) E pelo CarController (colisão)
// ============================================================

export interface Corridor {
  /** escala aplicada às bermas (1 = medidas completas) */
  scaleL: number[];
  scaleR: number[];
  /** distância do eixo central à face interior do muro */
  wallL: number[];
  wallR: number[];
  /** espessura do muro */
  wallTL: number[];
  wallTR: number[];
}

/**
 * Lógica:
 * 1. Em cada fatia mede-se o raio da curva. No lado de DENTRO da curva o muro
 *    nunca pode ficar mais longe do eixo do que ~90% do raio (senão dobra/cruza).
 * 2. Mede-se a distância a outros troços da pista (ganchos, retas paralelas).
 *    Cada troço só pode usar metade do espaço entre os dois eixos.
 * 3. Se o espaço não chega, TODAS as faixas encolhem proporcionalmente
 *    (nenhuma desaparece) e o muro mantém-se sempre presente.
 * 4. Erosão + suavização: o encolhimento começa antes do bico e é gradual.
 */
export function computeCorridor(spline: SplineNode[], isClosed: boolean = true): Corridor {
  const N = spline.length;
  const scaleL = new Array(N).fill(1.0);
  const scaleR = new Array(N).fill(1.0);
  const wallL = new Array(N).fill(0);
  const wallR = new Array(N).fill(0);
  const wallTL = new Array(N).fill(ZONE_DEFAULTS.wallThickness);
  const wallTR = new Array(N).fill(ZONE_DEFAULTS.wallThickness);
  if (N < 3) return { scaleL, scaleR, wallL, wallR, wallTL, wallTR };

  const idx = (k: number) => (isClosed ? ((k % N) + N) % N : Math.max(0, Math.min(N - 1, k)));
  const totalLen = spline[N - 1].distFromStart ?? 0;

  for (let i = 0; i < N; i++) {
    const p = spline[i];
    const prev = spline[idx(i - 1)];
    const next = spline[idx(i + 1)];
    const hw = (p.width || 18) / 2;

    // Normal lateral (esquerda = (-ty, tx))
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const sx = -ty;
    const sy = tx;

    const wTL = getZone(p, 'wallThickness', 'L');
    const wTR = getZone(p, 'wallThickness', 'R');
    wallTL[i] = wTL;
    wallTR[i] = wTR;
    const bL = bermaWidth(p, 'L');
    const bR = bermaWidth(p, 'R');

    // Apenas restringe se estiver fisicamente perto de OUTRO tro?o distante da pista (ex: duas retas paralelas coladas)
    let maxL = 1e9;
    let maxR = 1e9;
    const maxSideReach = hw + Math.max(bL + wTL, bR + wTR);
    const reach = Math.max(hw + 30, maxSideReach * 2.15);

    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const q = spline[j];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      if (Math.abs((q.z ?? 0) - (p.z ?? 0)) > 4) continue; // viaduto / desn?vel 3D

      let arcDist = Math.abs((q.distFromStart ?? 0) - (p.distFromStart ?? 0));
      if (isClosed && totalLen > 0) arcDist = Math.min(arcDist, totalLen - arcDist);

      // Detetar também a perna oposta de um gancho apertado (onde a tangente inverte o sentido)
      const qPrev = spline[idx(j - 1)];
      const qNext = spline[idx(j + 1)];
      let qtx = qNext.x - qPrev.x;
      let qty = qNext.y - qPrev.y;
      const qtl = Math.hypot(qtx, qty) || 1;
      qtx /= qtl;
      qty /= qtl;
      const tangentDot = tx * qtx + ty * qty;
      const isOppositeHairpin = tangentDot < 0.15 && arcDist > hw * 1.4;
      if (!isOppositeHairpin && arcDist < d * 2.0 + 15) continue;

      const limit = d * 0.48;
      const sideDot = dx * sx + dy * sy;
      if (sideDot > 0) maxL = Math.min(maxL, limit);
      else maxR = Math.min(maxR, limit);
    }

    // Manter margem mínima de berma para o muro fechar naturalmente antes do bico da estrada
    const minScaleL = bL > 0 ? Math.min(0.35, 2.0 / bL) : 1.0;
    const minScaleR = bR > 0 ? Math.min(0.35, 2.0 / bR) : 1.0;
    scaleL[i] = bL > 0 && maxL < 1e8 ? Math.max(minScaleL, Math.min(1.0, (maxL - hw - wTL) / bL)) : 1.0;
    scaleR[i] = bR > 0 && maxR < 1e8 ? Math.max(minScaleR, Math.min(1.0, (maxR - hw - wTR) / bR)) : 1.0;
  }

  // Suaviza??o ligeira apenas onde houver interfer?ncia entre tro?os diferentes
  for (let pass = 0; pass < 2; pass++) {
    const cL = [...scaleL];
    const cR = [...scaleR];
    for (let i = 0; i < N; i++) {
      const a = idx(i - 1), b = idx(i + 1);
      scaleL[i] = cL[a] * 0.2 + cL[i] * 0.6 + cL[b] * 0.2;
      scaleR[i] = cR[a] * 0.2 + cR[i] * 0.6 + cR[b] * 0.2;
    }
  }

  for (let i = 0; i < N; i++) {
    const p = spline[i];
    const hw = (p.width || 18) / 2;
    wallL[i] = hw + bermaWidth(p, 'L') * scaleL[i];
    wallR[i] = hw + bermaWidth(p, 'R') * scaleR[i];
  }

  return { scaleL, scaleR, wallL, wallR, wallTL, wallTR };
}


export interface SurfaceSpan {
  hw: number;
  white: number;
  curbYellow: number;
  curbRed: number;
  grass: number;
  sand: number;
  gravel: number;
  wall: number;
}

export function getSurfaceSpansAt(
  node: SplineNode,
  scaleL: number,
  scaleR: number
): { left: SurfaceSpan; right: SurfaceSpan } {
  const hw = (node.width || 18) / 2;
  const wWhiteL = getZone(node, 'whiteLineWidth', 'L') * scaleL;
  const wYellowL = getZone(node, 'curbYellowWidth', 'L') * scaleL;
  const wRedL = getZone(node, 'curbRedWidth', 'L') * scaleL;
  const wGrassL = getZone(node, 'grassWidth', 'L') * scaleL;
  const wSandL = getZone(node, 'sandWidth', 'L') * scaleL;
  const wGravelL = getZone(node, 'gravelWidth', 'L') * scaleL;

  const wWhiteR = getZone(node, 'whiteLineWidth', 'R') * scaleR;
  const wYellowR = getZone(node, 'curbYellowWidth', 'R') * scaleR;
  const wRedR = getZone(node, 'curbRedWidth', 'R') * scaleR;
  const wGrassR = getZone(node, 'grassWidth', 'R') * scaleR;
  const wSandR = getZone(node, 'sandWidth', 'R') * scaleR;
  const wGravelR = getZone(node, 'gravelWidth', 'R') * scaleR;

  return {
    left: {
      hw,
      white: hw + wWhiteL,
      curbYellow: hw + wWhiteL + wYellowL,
      curbRed: hw + wWhiteL + wYellowL + wRedL,
      grass: hw + wWhiteL + wYellowL + wRedL + wGrassL,
      sand: hw + wWhiteL + wYellowL + wRedL + wGrassL + wSandL,
      gravel: hw + wWhiteL + wYellowL + wRedL + wGrassL + wSandL + wGravelL,
      wall: hw + wWhiteL + wYellowL + wRedL + wGrassL + wSandL + wGravelL
    },
    right: {
      hw,
      white: hw + wWhiteR,
      curbYellow: hw + wWhiteR + wYellowR,
      curbRed: hw + wWhiteR + wYellowR + wRedR,
      grass: hw + wWhiteR + wYellowR + wRedR + wGrassR,
      sand: hw + wWhiteR + wYellowR + wRedR + wGrassR + wSandR,
      gravel: hw + wWhiteR + wYellowR + wRedR + wGrassR + wSandR + wGravelR,
      wall: hw + wWhiteR + wYellowR + wRedR + wGrassR + wSandR + wGravelR
    }
  };
}
