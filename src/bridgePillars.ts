import * as THREE from 'three';
import { SplineNode, RoadBranch, computeSpline } from './tracks';

export interface BridgePillarData {
  position: THREE.Vector3;
  height: number;
  rotationY: number;
  width: number;
  depth: number;
}

/**
 * Finds 2D line segment intersection between (p1->p2) and (q1->q2).
 * Returns { t, u } if they intersect, or null.
 */
function lineSegmentIntersection2D(
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  q1: { x: number; z: number },
  q2: { x: number; z: number }
): { t: number; u: number; x: number; z: number } | null {
  const dx1 = p2.x - p1.x;
  const dz1 = p2.z - p1.z;
  const dx2 = q2.x - q1.x;
  const dz2 = q2.z - q1.z;

  const denom = dx1 * dz2 - dz1 * dx2;
  if (Math.abs(denom) < 1e-6) return null; // parallel

  const t = ((q1.x - p1.x) * dz2 - (q1.z - p1.z) * dx2) / denom;
  const u = ((q1.x - p1.x) * dz1 - (q1.z - p1.z) * dx1) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      t,
      u,
      x: p1.x + t * dx1,
      z: p1.z + t * dz1
    };
  }
  return null;
}

interface LowerRoadSegment {
  roadKey: string;
  segIdx: number;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  side: THREE.Vector3;
  distL: number;
  distR: number;
}

/**
 * Deteta com precisão matemática todas as estradas (pista principal, ramais, box)
 * que passam sob viadutos elevados.
 * Coloca os pilares exteriores estritamente fora dos muros exteriores das estradas,
 * e pilares centrais apenas no separador entre pistas se houver espaço seguro.
 */
export function computeBridgePillars(
  frames: Array<{
    pos: THREE.Vector3;
    side: THREE.Vector3;
    tangent: THREE.Vector3;
    width: number;
  }>,
  spline: SplineNode[],
  isClosed: boolean,
  wallOuterDistL?: number[],
  wallOuterDistR?: number[],
  branches?: RoadBranch[],
  pitSpline?: SplineNode[],
  groundY: number = -0.12,
  showEmbankments: boolean = true
): {
  pillarGeo: THREE.BufferGeometry | null;
  crossBeamGeo: THREE.BufferGeometry | null;
  overpassMask: boolean[];
} {
  const N = frames.length;
  const overpassMask: boolean[] = new Array(N).fill(false);
  if (N < 10) return { pillarGeo: null, crossBeamGeo: null, overpassMask };

  // 1. Coletar todos os segmentos de estradas inferiores que podem passar por baixo da ponte
  const allLowerSegments: LowerRoadSegment[] = [];

  // 1.1 Pista Principal
  const numMainSegments = isClosed ? N : N - 1;
  for (let j = 0; j < numMainSegments; j++) {
    const jNext = (j + 1) % N;
    const f1 = frames[j];
    const f2 = frames[jNext];
    const dL = (wallOuterDistL && wallOuterDistL[j]) ? wallOuterDistL[j] : (f1.width / 2) + 7.5;
    const dR = (wallOuterDistR && wallOuterDistR[j]) ? wallOuterDistR[j] : (f1.width / 2) + 7.5;
    allLowerSegments.push({
      roadKey: 'main',
      segIdx: j,
      p1: f1.pos,
      p2: f2.pos,
      side: f1.side,
      distL: dL,
      distR: dR
    });
  }

  // 1.2 Ramais / Estradas Secundárias (Branches)
  if (branches && branches.length > 0) {
    branches.forEach((b, bIdx) => {
      if (!b.points || b.points.length < 2) return;
      let dense: SplineNode[] = [];
      if (b.points.length === 2) {
        const pA = b.points[0];
        const pB = b.points[1];
        const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
        const steps = Math.max(6, Math.ceil(dist / 4));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          dense.push({
            x: pA.x + (pB.x - pA.x) * t,
            y: pA.y + (pB.y - pA.y) * t,
            z: (pA.z ?? 0) + ((pB.z ?? 0) - (pA.z ?? 0)) * t,
            width: (pA.width ?? 18) + ((pB.width ?? 18) - (pA.width ?? 18)) * t,
            banking: 0
          });
        }
      } else {
        dense = computeSpline(b.points, false);
      }
      const M = dense.length;
      for (let k = 0; k < M - 1; k++) {
        const pA = dense[k];
        const pB = dense[k + 1];
        const p1 = new THREE.Vector3(pA.x, pA.z ?? 0, pA.y);
        const p2 = new THREE.Vector3(pB.x, pB.z ?? 0, pB.y);
        const tangent = new THREE.Vector3().subVectors(p2, p1).normalize();
        const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
        const hw = (pA.width || 18) / 2;
        allLowerSegments.push({
          roadKey: `branch_${b.id || bIdx}`,
          segIdx: k,
          p1,
          p2,
          side,
          distL: hw + 6.0,
          distR: hw + 6.0
        });
      }
    });
  }

  // 1.3 Pit Lane (Boxes)
  if (pitSpline && pitSpline.length >= 2) {
    for (let k = 0; k < pitSpline.length - 1; k++) {
      const pA = pitSpline[k];
      const pB = pitSpline[k + 1];
      const p1 = new THREE.Vector3(pA.x, pA.z ?? 0, pA.y);
      const p2 = new THREE.Vector3(pB.x, pB.z ?? 0, pB.y);
      const tangent = new THREE.Vector3().subVectors(p2, p1).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const hw = (pA.width || 8.5) / 2;
      allLowerSegments.push({
        roadKey: 'pit',
        segIdx: k,
        p1,
        p2,
        side,
        distL: hw + 5.0,
        distR: hw + 5.0
      });
    }
  }

  interface ExactCrossing {
    upperIdx: number;
    roadKey: string;
    segIdx: number;
    crossingPoint2D: { x: number; z: number };
    upperY: number;
    lowerY: number;
    lowerSegment: LowerRoadSegment;
  }

  const exactCrossings: ExactCrossing[] = [];
  const minClearance = 1.8;

  for (let i = 0; i < numMainSegments; i++) {
    const iNext = (i + 1) % N;
    const fA1 = frames[i];
    const fA2 = frames[iNext];

    // Só segmentos elevados podem ser viadutos
    if (fA1.pos.y < groundY + 1.55 && fA2.pos.y < groundY + 1.55) continue;

    for (const seg of allLowerSegments) {
      if (seg.roadKey === 'main') {
        const ringDiff = isClosed ? Math.min(Math.abs(i - seg.segIdx), N - Math.abs(i - seg.segIdx)) : Math.abs(i - seg.segIdx);
        if (ringDiff <= 8) continue;
      }

      const inter = lineSegmentIntersection2D(
        { x: fA1.pos.x, z: fA1.pos.z },
        { x: fA2.pos.x, z: fA2.pos.z },
        { x: seg.p1.x, z: seg.p1.z },
        { x: seg.p2.x, z: seg.p2.z }
      );

      if (inter) {
        const yA = fA1.pos.y * (1 - inter.t) + fA2.pos.y * inter.t;
        const yB = seg.p1.y * (1 - inter.u) + seg.p2.y * inter.u;

        if (yA > yB + minClearance) {
          const isSameCrossing = exactCrossings.some(c =>
            c.roadKey === seg.roadKey &&
            Math.abs(c.segIdx - seg.segIdx) <= 2 &&
            (isClosed ? Math.min(Math.abs(c.upperIdx - i), N - Math.abs(c.upperIdx - i)) : Math.abs(c.upperIdx - i)) <= 2
          );

          if (!isSameCrossing) {
            exactCrossings.push({
              upperIdx: i,
              roadKey: seg.roadKey,
              segIdx: seg.segIdx,
              crossingPoint2D: { x: inter.x, z: inter.z },
              upperY: yA,
              lowerY: yB,
              lowerSegment: seg
            });
          }
        }
      }
    }
  }

  const pillarBoxes: THREE.Matrix4[] = [];
  const beamBoxes: THREE.Matrix4[] = [];

  const distToSegXZ = (px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) return { d: Math.hypot(px - a.x, pz - a.z), t: 0 };
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
    return { d: Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz)), t };
  };

  // Garantir que QUALQUER segmento elevado (acima de outra estrada inferior em > 2.5m)
  // cuja faixa de ASFALTO sobreponha em 2D a faixa de asfalto inferior seja marcado como viaduto (overpassMask = true),
  // mesmo quando os eixos centrais não se cruzam diretamente — sem nunca invadir curvas vizinhas!
  for (let i = 0; i < N; i++) {
    const fi = frames[i];
    if (fi.pos.y < groundY + 2.85) continue;
    const hwi = fi.width * 0.5;
    for (let j = 0; j < numMainSegments; j++) {
      const ringDiff = isClosed
        ? Math.min(Math.abs(i - j), N - Math.abs(i - j))
        : Math.abs(i - j);
      if (ringDiff <= 35) continue;
      const fj = frames[j];
      const fjNext = frames[(j + 1) % N];
      const hwj = fj.width * 0.5;
      const { d, t } = distToSegXZ(fi.pos.x, fi.pos.z, fj.pos, fjNext.pos);
      const lowerY = fj.pos.y + t * (fjNext.pos.y - fj.pos.y);
      if (fi.pos.y > lowerY + 2.5 && d < hwi + hwj + 1.0) {
        overpassMask[i] = true;
        break;
      }
    }
  }

  if (exactCrossings.length > 0) {
    // 2. Agrupar cruzamentos ao longo do mesmo viaduto
    interface BridgeSpanGroup {
      upperIdxMin: number;
      upperIdxMax: number;
      upperIndices: number[];
      crossings: ExactCrossing[];
      upperY: number;
      lowerYMin: number;
    }

    const spanGroups: BridgeSpanGroup[] = [];

    for (const cross of exactCrossings) {
      let matchedGroup: BridgeSpanGroup | null = null;
      for (const group of spanGroups) {
        const uMid = group.upperIndices[Math.floor(group.upperIndices.length / 2)];
        const diff = isClosed
          ? Math.min(Math.abs(cross.upperIdx - uMid), N - Math.abs(cross.upperIdx - uMid))
          : Math.abs(cross.upperIdx - uMid);
        if (diff <= 25) {
          matchedGroup = group;
          break;
        }
      }

      if (matchedGroup) {
        matchedGroup.upperIndices.push(cross.upperIdx);
        matchedGroup.crossings.push(cross);
        matchedGroup.upperY = Math.max(matchedGroup.upperY, cross.upperY);
        matchedGroup.lowerYMin = Math.min(matchedGroup.lowerYMin, cross.lowerY);
        matchedGroup.upperIdxMin = Math.min(matchedGroup.upperIdxMin, cross.upperIdx);
        matchedGroup.upperIdxMax = Math.max(matchedGroup.upperIdxMax, cross.upperIdx);
      } else {
        spanGroups.push({
          upperIdxMin: cross.upperIdx,
          upperIdxMax: cross.upperIdx,
          upperIndices: [cross.upperIdx],
          crossings: [cross],
          upperY: cross.upperY,
          lowerYMin: cross.lowerY
        });
      }
    }

    // 3. overpassMask cobre TODO o vão do viaduto sobre todas as estradas inferiores
    for (const group of spanGroups) {
      const margin = 5;
      for (let u = group.upperIdxMin - margin; u <= group.upperIdxMax + margin; u++) {
        const idx = (u + N) % N;
        if (frames[idx].pos.y > group.lowerYMin + 1.0) {
          overpassMask[idx] = true;
        }
      }
      for (const cross of group.crossings) {
        for (let i = 0; i < N; i++) {
          const ringDiff = isClosed
            ? Math.min(Math.abs(i - cross.upperIdx), N - Math.abs(i - cross.upperIdx))
            : Math.abs(i - cross.upperIdx);
          if (ringDiff > 20) continue;
          const d = Math.hypot(frames[i].pos.x - cross.crossingPoint2D.x, frames[i].pos.z - cross.crossingPoint2D.z);
          if (d <= 22.0 && frames[i].pos.y > group.lowerYMin + 1.2) {
            overpassMask[i] = true;
          }
        }
      }
    }

    // 4. Calcular pilares e vigas para cada vão de viaduto
    for (const group of spanGroups) {
      const avgUpperIdx = group.upperIndices[Math.floor(group.upperIndices.length / 2)];
      const fUpper = frames[avgUpperIdx];
      const bridgeSide = fUpper.side.clone().normalize();
      const upperDeckY = group.upperY - 1.1;
      const baseGroundY = Math.min(-1.0, group.lowerYMin - 4.0);
      const pillarHeight = Math.max(2.0, upperDeckY - baseGroundY);

    // Centro médio dos cruzamentos
    let avgCrossX = 0;
    let avgCrossZ = 0;
    for (const c of group.crossings) {
      avgCrossX += c.crossingPoint2D.x;
      avgCrossZ += c.crossingPoint2D.z;
    }
    avgCrossX /= group.crossings.length;
    avgCrossZ /= group.crossings.length;
    // Centro e direção da ponte superior no cruzamento
    const fUpperPos = new THREE.Vector3(fUpper.pos.x, baseGroundY, fUpper.pos.z);
    const bridgeCenterPoint = new THREE.Vector3(avgCrossX, baseGroundY, avgCrossZ);
    // Projetar bridgeCenterPoint na linha central da pista superior para garantir alinhamento exato com a viga
    const toCenter = new THREE.Vector3().subVectors(bridgeCenterPoint, fUpperPos);
    const forwardProj = toCenter.dot(fUpper.tangent);
    const bridgeSpanCenter = fUpperPos.clone().add(fUpper.tangent.clone().multiplyScalar(forwardProj));

    // Agrupar cruzamentos por estrada inferior (roadKey)
    const roadsMap = new Map<string, ExactCrossing[]>();
    for (const c of group.crossings) {
      if (!roadsMap.has(c.roadKey)) roadsMap.set(c.roadKey, []);
      roadsMap.get(c.roadKey)!.push(c);
    }

    interface RoadSpan {
      roadKey: string;
      minOffset: number;
      maxOffset: number;
      centerOffset: number;
    }
    const roadSpans: RoadSpan[] = [];

    roadsMap.forEach((crossList, rKey) => {
      let rMin = Infinity;
      let rMax = -Infinity;
      let cSum = 0;

      for (const cross of crossList) {
        const seg = cross.lowerSegment;
        // Ponto de interseção real na estrada inferior
        const crossP = new THREE.Vector3(cross.crossingPoint2D.x, baseGroundY, cross.crossingPoint2D.z);
        const pLeft = crossP.clone().add(seg.side.clone().multiplyScalar(seg.distL));
        const pRight = crossP.clone().sub(seg.side.clone().multiplyScalar(seg.distR));

        const projC = new THREE.Vector3(crossP.x - bridgeSpanCenter.x, 0, crossP.z - bridgeSpanCenter.z).dot(bridgeSide);
        const projL = new THREE.Vector3(pLeft.x - bridgeSpanCenter.x, 0, pLeft.z - bridgeSpanCenter.z).dot(bridgeSide);
        const projR = new THREE.Vector3(pRight.x - bridgeSpanCenter.x, 0, pRight.z - bridgeSpanCenter.z).dot(bridgeSide);

        rMin = Math.min(rMin, projL, projR);
        rMax = Math.max(rMax, projL, projR);
        cSum += projC;
      }

      roadSpans.push({
        roadKey: rKey,
        minOffset: rMin,
        maxOffset: rMax,
        centerOffset: cSum / crossList.length
      });
    });

    roadSpans.sort((a, b) => a.centerOffset - b.centerOffset);

    // Colocar dois pórticos de apoio ao longo da ponte superior (um ANTES e outro DEPOIS da pista inferior),
    // estritamente fora da largura + bermas + muros de todas as estradas inferiores!
    const bridgeTangent = new THREE.Vector3(fUpper.tangent.x, 0, fUpper.tangent.z).normalize();
    const halfBridgeDeck = (fUpper.width || 18) / 2;
    const outerMargin = 2.6;
    const pillarRadius = 0.95;

    let needForward = 0;
    let needBackward = 0;
    for (const c of group.crossings) {
      const seg = c.lowerSegment;
      const segSide = new THREE.Vector3(seg.side.x, 0, seg.side.z).normalize();
      const crossP = new THREE.Vector3(c.crossingPoint2D.x, 0, c.crossingPoint2D.z);
      const alongCenter = new THREE.Vector3(
        crossP.x - bridgeSpanCenter.x,
        0,
        crossP.z - bridgeSpanCenter.z
      ).dot(bridgeTangent);

      const cosAngle = Math.max(0.35, Math.abs(bridgeTangent.dot(segSide)));
      const clearDist = (Math.max(seg.distL, seg.distR) + outerMargin + halfBridgeDeck * Math.abs(bridgeSide.dot(segSide))) / cosAngle;

      needForward = Math.max(needForward, alongCenter + clearDist);
      needBackward = Math.max(needBackward, -alongCenter + clearDist);
    }

    const deckPillarOffset = Math.max(2.0, halfBridgeDeck - 1.2);
    for (const fwdOff of [-needBackward, needForward]) {
      const bentCenter = bridgeSpanCenter.clone().add(bridgeTangent.clone().multiplyScalar(fwdOff));
      const pLeft = bentCenter.clone().add(bridgeSide.clone().multiplyScalar(deckPillarOffset));
      pLeft.y = baseGroundY + pillarHeight / 2;

      const pRight = bentCenter.clone().add(bridgeSide.clone().multiplyScalar(-deckPillarOffset));
      pRight.y = baseGroundY + pillarHeight / 2;

      pillarBoxes.push(new THREE.Matrix4().compose(
        pLeft,
        new THREE.Quaternion(),
        new THREE.Vector3(pillarRadius * 2, pillarHeight, pillarRadius * 2)
      ));

      pillarBoxes.push(new THREE.Matrix4().compose(
        pRight,
        new THREE.Quaternion(),
        new THREE.Vector3(pillarRadius * 2, pillarHeight, pillarRadius * 2)
      ));

      const beamCenter = new THREE.Vector3().addVectors(pLeft, pRight).multiplyScalar(0.5);
      beamCenter.y = upperDeckY - 0.45;
      const beamSpan = pLeft.distanceTo(pRight) + 2.0;

      const beamDir = new THREE.Vector3().subVectors(pLeft, pRight).normalize();
      const rotY = Math.atan2(beamDir.x, beamDir.z);
      const qBeam = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);

      beamBoxes.push(new THREE.Matrix4().compose(
        beamCenter,
        qBeam,
        new THREE.Vector3(1.0, 0.9, beamSpan)
      ));
    }
  }
  }

  // 5. Pilares automáticos ao longo da estrada elevada (APENAS quando taludes verdes estão desligados)
  let elevDistAcc = 26;
  for (let i = 0; !showEmbankments && i < N; i++) {
    const f = frames[i];
    if (i > 0) {
      elevDistAcc += f.pos.distanceTo(frames[i - 1].pos);
    }
    // Só coloca pilares quando a estrada está realmente elevada acima do nível base
    if (f.pos.y <= groundY + 2.15) {
      elevDistAcc = 26;
      continue;
    }
    if (overpassMask[i] || elevDistAcc < 26) continue;

    const pOffset = Math.max(1.5, (f.width / 2) - 2.2);
    const pL = f.pos.clone().add(f.side.clone().multiplyScalar(pOffset));
    const pR = f.pos.clone().sub(f.side.clone().multiplyScalar(pOffset));
    const hitsAnyLower = allLowerSegments.some(seg =>
      (seg.p1.y + seg.p2.y) * 0.5 < f.pos.y - 1.5 &&
      (distToSegXZ(pL.x, pL.z, seg.p1, seg.p2).d < Math.max(seg.distL, seg.distR) + 1.5 ||
       distToSegXZ(pR.x, pR.z, seg.p1, seg.p2).d < Math.max(seg.distL, seg.distR) + 1.5)
    );
    if (hitsAnyLower) continue;

    elevDistAcc = 0;
    const footY = groundY - 0.5;
    // Os pilares param na viga transversal (y - 1.35), nunca furando o asfalto nem o betão!
    const hL = Math.max(0.5, pL.y - 1.35 - footY);
    const hR = Math.max(0.5, pR.y - 1.35 - footY);

    pillarBoxes.push(new THREE.Matrix4().compose(
      new THREE.Vector3(pL.x, footY + hL * 0.5, pL.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1.15, hL, 1.15)
    ));
    pillarBoxes.push(new THREE.Matrix4().compose(
      new THREE.Vector3(pR.x, footY + hR * 0.5, pR.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1.15, hR, 1.15)
    ));

    const bSpan = pL.distanceTo(pR) + 1.4;
    const bCenter = pL.clone().add(pR).multiplyScalar(0.5).add(new THREE.Vector3(0, -1.35, 0));
    const dirXZ = new THREE.Vector3(pR.x - pL.x, 0, pR.z - pL.z).normalize();
    const qB = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirXZ);
    beamBoxes.push(new THREE.Matrix4().compose(bCenter, qB, new THREE.Vector3(0.95, 0.6, bSpan)));
  }

  if (pillarBoxes.length === 0 && beamBoxes.length === 0) {
    return { pillarGeo: null, crossBeamGeo: null, overpassMask };
  }

  // Merge Pillar Cylinders
  const cylinderBase = new THREE.CylinderGeometry(0.5, 0.55, 1.0, 16);
  const pillarVerts: number[] = [];
  const pillarNormals: number[] = [];
  const pillarIndices: number[] = [];
  const posAttr = cylinderBase.getAttribute('position');
  const normAttr = cylinderBase.getAttribute('normal');
  const idxAttr = cylinderBase.getIndex()!;

  let vertOffset = 0;
  for (const mat of pillarBoxes) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mat);
    for (let v = 0; v < posAttr.count; v++) {
      const p = new THREE.Vector3(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v)).applyMatrix4(mat);
      const n = new THREE.Vector3(normAttr.getX(v), normAttr.getY(v), normAttr.getZ(v)).applyNormalMatrix(normalMatrix).normalize();
      pillarVerts.push(p.x, p.y, p.z);
      pillarNormals.push(n.x, n.y, n.z);
    }
    for (let k = 0; k < idxAttr.count; k++) {
      pillarIndices.push(vertOffset + idxAttr.getX(k));
    }
    vertOffset += posAttr.count;
  }

  const pillarGeo = new THREE.BufferGeometry();
  pillarGeo.setAttribute('position', new THREE.Float32BufferAttribute(pillarVerts, 3));
  pillarGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pillarNormals, 3));
  pillarGeo.setIndex(pillarIndices);

  // Merge Beams and Abutments
  const boxBase = new THREE.BoxGeometry(1, 1, 1);
  const beamVerts: number[] = [];
  const beamNormals: number[] = [];
  const beamIndices: number[] = [];
  const bPosAttr = boxBase.getAttribute('position');
  const bNormAttr = boxBase.getAttribute('normal');
  const bIdxAttr = boxBase.getIndex()!;

  vertOffset = 0;
  for (const mat of beamBoxes) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mat);
    for (let v = 0; v < bPosAttr.count; v++) {
      const p = new THREE.Vector3(bPosAttr.getX(v), bPosAttr.getY(v), bPosAttr.getZ(v)).applyMatrix4(mat);
      const n = new THREE.Vector3(bNormAttr.getX(v), bNormAttr.getY(v), bNormAttr.getZ(v)).applyNormalMatrix(normalMatrix).normalize();
      beamVerts.push(p.x, p.y, p.z);
      beamNormals.push(n.x, n.y, n.z);
    }
    for (let k = 0; k < bIdxAttr.count; k++) {
      beamIndices.push(vertOffset + bIdxAttr.getX(k));
    }
    vertOffset += bPosAttr.count;
  }

  const crossBeamGeo = new THREE.BufferGeometry();
  crossBeamGeo.setAttribute('position', new THREE.Float32BufferAttribute(beamVerts, 3));
  crossBeamGeo.setAttribute('normal', new THREE.Float32BufferAttribute(beamNormals, 3));
  crossBeamGeo.setIndex(beamIndices);

  return { pillarGeo, crossBeamGeo, overpassMask };
}
