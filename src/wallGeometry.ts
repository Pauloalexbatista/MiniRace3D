// Shared wall geometry: the SAME computation used by Track3D drawing is used by the
// physics (CarController) -> visible wall == physical wall.
import { SplineNode } from './tracks';
import { Corridor, bermaWidth } from './trackCorridor';
import { TRACK_THEMES } from './trackProfile';

export interface Pt2 { x: number; y: number; }

export interface WallPolylines {
  /** Inner face of the left wall, one point per spline node */
  left: Pt2[];
  /** Inner face of the right wall, one point per spline node */
  right: Pt2[];
  /** Asphalt half width actually drawn (already clamped by theme limits) */
  halfWidth: number[];
}

/**
 * Desfaz la?os e auto-intersec??es (swallowtail singularity / n?s)
 * em curvas de offset em 2D. Se dois segmentos se cruzarem numa curva
 * apertada, o la?o ? cortado e os pontos do n? colapsam para o ponto
 * de cruzamento exato Q, criando um canto chanfrado limpo.
 */
export function untanglePolyline2D(poly: Pt2[], isClosed: boolean = true): Pt2[] {
  const N = poly.length;
  if (N < 4) return poly.map(p => ({ ...p }));

  const pts: Pt2[] = poly.map(p => ({ x: p.x, y: p.y }));
  const maxWindow = Math.min(180, Math.max(4, Math.floor(N / 2) - 2));

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < N; i++) {
      const iNext = isClosed ? (i + 1) % N : i + 1;
      if (iNext >= N) break;
      const p1 = pts[i];
      const p2 = pts[iNext];

      const rX = p2.x - p1.x;
      const rY = p2.y - p1.y;

      for (let offset = 2; offset <= maxWindow; offset++) {
        const j = isClosed ? (i + offset) % N : i + offset;
        const jNext = isClosed ? (j + 1) % N : j + 1;
        if (jNext >= N) break;
        if (isClosed && (jNext === i || j === iNext)) continue;

        const p3 = pts[j];
        const p4 = pts[jNext];
        // Never untangle across a 3D bridge/overpass at a completely different level (> 8m)
        if (Math.abs(p1.y - p3.y) > 8.0) continue;

        const sX = p4.x - p3.x;
        const sY = p4.y - p3.y;

        const denom = rX * sY - rY * sX;
        if (Math.abs(denom) < 1e-9) continue;

        const qX = p3.x - p1.x;
        const qY = p3.y - p1.y;

        const t = (qX * sY - qY * sX) / denom;
        const u = (qX * rY - qY * rX) / denom;

        if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
          const interX = p1.x + t * rX;
          const interY = p1.y + t * rY;

          for (let step = 1; step <= offset; step++) {
            const k = isClosed ? (i + step) % N : i + step;
            if (k < N) {
              pts[k].x = interX;
              pts[k].y = interY;
            }
          }
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  return pts;
}

/**
 * Vers?o 3D para o Track3D (vetores Three.js no plano horizontal X-Z).
 * Mant?m a eleva??o Y interpolada suavemente sem picos.
 */
export function untanglePolyline3D<T extends { x: number; y: number; z: number }>(
  poly: T[],
  isClosed: boolean = true
): T[] {
  const N = poly.length;
  if (N < 4) return poly;

  const clonePt = (p: T): T => {
    if (p && typeof (p as any).clone === 'function') {
      return (p as any).clone();
    }
    return { x: p.x, y: p.y, z: p.z } as any;
  };

  const pts: T[] = poly.map(clonePt);
  const maxWindow = Math.min(180, Math.max(4, Math.floor(N / 2) - 2));

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < N; i++) {
      const iNext = isClosed ? (i + 1) % N : i + 1;
      if (iNext >= N) break;
      const p1 = pts[i];
      const p2 = pts[iNext];

      const rX = p2.x - p1.x;
      const rZ = p2.z - p1.z;

      for (let offset = 2; offset <= maxWindow; offset++) {
        const j = isClosed ? (i + offset) % N : i + offset;
        const jNext = isClosed ? (j + 1) % N : j + 1;
        if (jNext >= N) break;
        if (isClosed && (jNext === i || j === iNext)) continue;

        const p3 = pts[j];
        const p4 = pts[jNext];
        // Never untangle across a 3D bridge/overpass at a completely different level (> 8m)
        if (Math.abs(p1.y - p3.y) > 8.0) continue;

        const sX = p4.x - p3.x;
        const sZ = p4.z - p3.z;

        const denom = rX * sZ - rZ * sX;
        if (Math.abs(denom) < 1e-9) continue;

        const qX = p3.x - p1.x;
        const qZ = p3.z - p1.z;

        const t = (qX * sZ - qZ * sX) / denom;
        const u = (qX * rZ - qZ * rX) / denom;

        if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
          const interX = p1.x + t * rX;
          const interZ = p1.z + t * rZ;
          const y1 = p1.y + t * (p2.y - p1.y);
          const y2 = p3.y + u * (p4.y - p3.y);
          const interY = 0.5 * (y1 + y2);

          for (let step = 1; step <= offset; step++) {
            const k = isClosed ? (i + step) % N : i + step;
            if (k < N) {
              if (typeof (pts[k] as any).set === 'function') {
                (pts[k] as any).set(interX, interY, interZ);
              } else {
                pts[k].x = interX;
                pts[k].y = interY;
                pts[k].z = interZ;
              }
            }
          }

          // Smoothly blend elevation Y on the approach (before i+1) and exit (after j) so ramped hairpins never form a vertical step ("degrau")
          const blendSpan = Math.min(10, Math.floor(N / 8));
          for (let b = 0; b < blendSpan; b++) {
            const w = (blendSpan - b) / (blendSpan + 1);
            const kBefore = isClosed ? (i - b + N) % N : i - b;
            if (kBefore >= 0 && kBefore < N) {
              pts[kBefore].y = pts[kBefore].y * (1 - w) + interY * w;
            }
            const kAfter = isClosed ? (j + 1 + b) % N : j + 1 + b;
            if (kAfter >= 0 && kAfter < N) {
              pts[kAfter].y = pts[kAfter].y * (1 - w) + interY * w;
            }
          }
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  return pts;
}

/**
 * Quando os dois muros opostos num gancho apertado se aproximam a menos de `minGap` metros
 * (ex: 12m, onde as abas verdes exteriores de 6m se tocam), corta o bico estreito e
 * une os dois muros com uma curva suave (Bézier quadrática).
 */
export function roundTightWallCorners3D<T extends { x: number; y: number; z: number }>(
  poly: T[],
  isClosed: boolean = true,
  minGap: number = 12.0
): T[] {
  const N = poly.length;
  if (N < 10) return poly;

  const clonePt = (p: T): T => {
    if (p && typeof (p as any).clone === 'function') {
      return (p as any).clone();
    }
    return { x: p.x, y: p.y, z: p.z } as any;
  };

  const pts: T[] = poly.map(clonePt);
  const idx = (k: number) => (isClosed ? ((k % N) + N) % N : Math.max(0, Math.min(N - 1, k)));
  const maxWindow = Math.min(180, Math.max(4, Math.floor(N / 2) - 2));

  const getTanXZ = (k: number) => {
    const a = pts[idx(k - 1)];
    const b = pts[idx(k + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  };

  let i = 0;
  let guard = 0;
  while (i < N && guard < N) {
    guard++;
    const tA = getTanXZ(i);
    let bestOffset = -1;

    for (let offset = 4; offset <= maxWindow; offset++) {
      if (!isClosed && i + offset >= N) break;
      const j = idx(i + offset);
      const tB = getTanXZ(j);
      const dot = tA.x * tB.x + tA.z * tB.z;
      if (dot > -0.25) continue;

      const d = Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z);
      if (d <= minGap && d >= 1.5) {
        bestOffset = offset;
      }
    }

    if (bestOffset >= 4) {
      const A = clonePt(pts[i]);
      const j = idx(i + bestOffset);
      const B = clonePt(pts[j]);
      const V = clonePt(pts[idx(i + Math.floor(bestOffset / 2))]);

      const mx = (A.x + B.x) * 0.5;
      const my = (A.y + B.y) * 0.5;
      const mz = (A.z + B.z) * 0.5;

      // Ponto de controlo: 65% ponto médio da corda + 35% na direção do bico para uma curva U suave
      const cx = mx * 0.65 + V.x * 0.35;
      const cy = my * 0.65 + V.y * 0.35;
      const cz = mz * 0.65 + V.z * 0.35;

      for (let step = 1; step < bestOffset; step++) {
        const u = step / bestOffset;
        const inv = 1 - u;
        const px = inv * inv * A.x + 2 * inv * u * cx + u * u * B.x;
        const py = inv * inv * A.y + 2 * inv * u * cy + u * u * B.y;
        const pz = inv * inv * A.z + 2 * inv * u * cz + u * u * B.z;
        const k = idx(i + step);
        if (typeof (pts[k] as any).set === 'function') {
          (pts[k] as any).set(px, py, pz);
        } else {
          pts[k].x = px;
          pts[k].y = py;
          pts[k].z = pz;
        }
      }

      // Smoothly blend elevation Y on approach & exit of the rounded corner so no vertical step forms
      const blendSpan = Math.min(10, Math.floor(N / 8));
      for (let b = 0; b < blendSpan; b++) {
        const w = (blendSpan - b) / (blendSpan + 1);
        const kBefore = idx(i - b);
        if (isClosed || i - b >= 0) {
          pts[kBefore].y = pts[kBefore].y * (1 - w) + my * w;
        }
        const kAfter = idx(j + b);
        if (isClosed || j + b < N) {
          pts[kAfter].y = pts[kAfter].y * (1 - w) + my * w;
        }
      }

      i += bestOffset + 1;
    } else {
      i++;
    }
  }

  return pts;
}

/**
 * Mirrors Track3D exactly: tangent = next - prev, side = (-ty, tx),
 * half width clamped by theme, shoulders scaled by corridor, cos(banking).
 */
export function computeWallPolylines(
  spline: SplineNode[],
  corridor: Corridor,
  trackThemeId: string | undefined,
  isClosed: boolean = true
): WallPolylines {
  const N = spline.length;
  const themes = TRACK_THEMES as Record<string, any>;
  const theme = (trackThemeId && themes[trackThemeId]) || themes.f1_modern || themes.f1;
  const left: Pt2[] = [];
  const right: Pt2[] = [];
  const halfWidth: number[] = [];

  for (let i = 0; i < N; i++) {
    const curr = spline[i];
    const prev = isClosed ? spline[(i - 1 + N) % N] : spline[Math.max(0, i - 1)];
    const next = isClosed ? spline[(i + 1) % N] : spline[Math.min(N - 1, i + 1)];

    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty);
    let sx = 0;
    let sy = 1;
    if (tl > 1e-9) {
      tx /= tl;
      ty /= tl;
      sx = -ty;
      sy = tx;
    }

    const bankCos = curr.banking ? Math.cos((curr.banking * Math.PI) / 180) : 1;

    const roadW = curr.width || theme?.defaultRoadWidth || 16;
    const minW = theme?.minRoadWidth ?? 0;
    const maxW = theme?.maxRoadWidth ?? 1e9;
    const hw = Math.max(minW, Math.min(maxW, roadW)) / 2;
    halfWidth.push(hw);

    const dL = (hw + bermaWidth(curr, 'L') * (corridor.scaleL[i] ?? 1)) * bankCos;
    const dR = (hw + bermaWidth(curr, 'R') * (corridor.scaleR[i] ?? 1)) * bankCos;

    left.push({ x: curr.x + sx * dL, y: curr.y + sy * dL });
    right.push({ x: curr.x - sx * dR, y: curr.y - sy * dR });
  }

  const cleanLeft = untanglePolyline2D(left, isClosed);
  const cleanRight = untanglePolyline2D(right, isClosed);

  return { left: cleanLeft, right: cleanRight, halfWidth };
}

export interface WallHit {
  /** How far the point is beyond the wall face (>0 = penetration) */
  penetration: number;
  /** Unit normal pointing INTO the track */
  nx: number;
  ny: number;
}

/**
 * Tests a point against the wall polyline (segments between neighbouring nodes).
 * inwardSign = +1 for the left wall, -1 for the right wall.
 */
export function testWallPolyline(
  px: number,
  py: number,
  poly: Pt2[],
  centerIdx: number,
  window: number,
  inwardSign: 1 | -1,
  isClosed: boolean = true
): WallHit | null {
  const N = poly.length;
  if (N < 2) return null;

  let bestD2 = Infinity;
  let best: WallHit | null = null;

  for (let o = -window; o <= window; o++) {
    let k = centerIdx + o;
    if (isClosed) k = ((k % N) + N) % N;
    else if (k < 0 || k >= N - 1) continue;
    const a = poly[k];
    const b = poly[isClosed ? (k + 1) % N : k + 1];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-8) continue;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < bestD2) {
      const len = Math.sqrt(len2);
      const nx = (inwardSign * dy) / len;
      const ny = (inwardSign * -dx) / len;
      const signed = (px - cx) * nx + (py - cy) * ny;
      bestD2 = d2;
      best = { penetration: -signed, nx, ny };
    }
  }
  return best;
}
