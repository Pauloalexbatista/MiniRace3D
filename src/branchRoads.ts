import * as THREE from 'three';
import { SplineNode, RoadBranch, computeSpline } from './tracks';
import { getZone, getZoneColor } from './trackCorridor';

export interface BranchGeometries {
  roadGeo: THREE.BufferGeometry | null;
  whiteLineGeo: THREE.BufferGeometry | null;
  yellowCurbsGeo: THREE.BufferGeometry | null;
  redCurbsGeo: THREE.BufferGeometry | null;
  grassShoulderGeo: THREE.BufferGeometry | null;
  sandGeo: THREE.BufferGeometry | null;
  gravelGeo: THREE.BufferGeometry | null;
  guardrailLeftGeo: THREE.BufferGeometry | null;
  guardrailRightGeo: THREE.BufferGeometry | null;
  outlineGeo: THREE.BufferGeometry | null;
  redRibbonGeo: THREE.BufferGeometry | null;
}

export interface MainWallData {
  cleanWallL: THREE.Vector3[];
  cleanWallR: THREE.Vector3[];
  suppressWallL: boolean[];
  suppressWallR: boolean[];
  wallTL: number[];
  wallTR: number[];
  isClosed: boolean;
}

export function buildBranchGeometries(
  branches: RoadBranch[],
  asphaltColor: string = '#64748b',
  curbYellowColor: string = '#facc15',
  curbRedColor: string = '#dc2626',
  grassColor: string = '#15803d',
  sandColor: string = '#d97706',
  gravelColor: string = '#78716c',
  wallColor: string = '#f8fafc',
  barrierHeight: number = 1.4,
  barrierThickness: number = 0.85,
  mainSpline?: SplineNode[],
  controlPoints?: SplineNode[],
  mainFrames?: any[],
  mainWallData?: MainWallData,
  whiteLineColor: string = '#ffffff'
): BranchGeometries {
  const effectiveWallH = Math.max(1.4, barrierHeight);
  if (!branches || branches.length === 0) {
    return {
      roadGeo: null,
      whiteLineGeo: null,
      yellowCurbsGeo: null,
      redCurbsGeo: null,
      grassShoulderGeo: null,
      sandGeo: null,
      gravelGeo: null,
      guardrailLeftGeo: null,
      guardrailRightGeo: null,
      outlineGeo: null,
      redRibbonGeo: null
    };
  }

  const parseHex = (hex: string | undefined, fallback: string = '#ffffff'): [number, number, number] => {
    const c = new THREE.Color(hex || fallback);
    return [c.r, c.g, c.b];
  };

  const cRoad = parseHex(asphaltColor, '#64748b');
  const cWhite = parseHex(whiteLineColor, '#ffffff');
  const cYellow = parseHex(curbYellowColor, '#facc15');
  const cRed = parseHex(curbRedColor, '#dc2626');
  const cGrass = parseHex(grassColor, '#15803d');
  const cSand = parseHex(sandColor, '#d97706');
  const cGravel = parseHex(gravelColor, '#78716c');
  const cWall = parseHex(wallColor, '#f8fafc');

  const roadVerts: number[] = [];
  const roadColors: number[] = [];
  const roadIndices: number[] = [];

  const whiteLineVerts: number[] = [];
  const whiteLineColors: number[] = [];
  const whiteLineIndices: number[] = [];

  const yellowCurbsVerts: number[] = [];
  const yellowCurbsColors: number[] = [];
  const yellowCurbsIndices: number[] = [];

  const redCurbsVerts: number[] = [];
  const redCurbsColors: number[] = [];
  const redCurbsIndices: number[] = [];

  const grassVerts: number[] = [];
  const grassColors: number[] = [];
  const grassIndices: number[] = [];

  const sandVerts: number[] = [];
  const sandColors: number[] = [];
  const sandIndices: number[] = [];

  const gravelVerts: number[] = [];
  const gravelColors: number[] = [];
  const gravelIndices: number[] = [];

  const wallLVerts: number[] = [];
  const wallLColors: number[] = [];
  const wallLIndices: number[] = [];

  const wallRVerts: number[] = [];
  const wallRColors: number[] = [];
  const wallRIndices: number[] = [];

  const outlineVerts: number[] = [];

  const redRibbonVerts: number[] = [];
  const redRibbonIndices: number[] = [];
  const ribbonW = 1.8;

  let rOffset = 0;
  let bOffset = 0;
  let wLOffset = 0;
  let wROffset = 0;
  let ribOffset = 0;

function distToSeg2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

  for (const branch of branches) {
    if (!branch.points || branch.points.length < 2) continue;

    const densePoints: SplineNode[] = computeSpline(branch.points, false);

    const M = densePoints.length;
    if (M < 2) continue;

    const baseROffset = rOffset;
    const baseBOffset = bOffset;
    const baseWLOffset = wLOffset;
    const baseWROffset = wROffset;

    const suppressLArray: boolean[] = new Array(M).fill(false);
    const suppressRArray: boolean[] = new Array(M).fill(false);
    const branchWallPosL: THREE.Vector3[] = new Array(M);
    const branchWallPosR: THREE.Vector3[] = new Array(M);
    const branchRoadPosL: THREE.Vector3[] = new Array(M);
    const branchRoadPosR: THREE.Vector3[] = new Array(M);
    const branchCenterPos: THREE.Vector3[] = new Array(M);

    // Pré-calcular supressão precisa de arestas/muros ao longo de todo o ramal
    for (let i = 0; i < M; i++) {
      const curr = densePoints[i];
      const prev = densePoints[Math.max(0, i - 1)];
      const next = densePoints[Math.min(M - 1, i + 1)];

      const pCurr = new THREE.Vector3(curr.x, (curr.z ?? 0), curr.y);
      const pPrev = new THREE.Vector3(prev.x, (prev.z ?? 0), prev.y);
      const pNext = new THREE.Vector3(next.x, (next.z ?? 0), next.y);

      let tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
      if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
      const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const hw = (curr.width || 18) / 2;

      const pRoadL = pCurr.clone().add(side.clone().multiplyScalar(hw));
      const pRoadR = pCurr.clone().sub(side.clone().multiplyScalar(hw));
      const pWallCheckL = pCurr.clone().add(side.clone().multiplyScalar(hw + 6.5));
      const pWallCheckR = pCurr.clone().sub(side.clone().multiplyScalar(hw + 6.5));

      let suppL = false;
      let suppR = false;

      if (mainSpline && mainSpline.length >= 2) {
        for (let m = 0; m < mainSpline.length; m++) {
          const mNext = (m + 1) % mainSpline.length;
          const mNode = mainSpline[m];
          const mNextNode = mainSpline[mNext];
          const segHw = Math.max(mNode.width || 18, mNextNode.width || 18) / 2;

          const dRoadL = distToSeg2D(pRoadL.x, pRoadL.z, mNode.x, mNode.y, mNextNode.x, mNextNode.y);
          const dWallL = distToSeg2D(pWallCheckL.x, pWallCheckL.z, mNode.x, mNode.y, mNextNode.x, mNextNode.y);
          if (dRoadL < segHw - 0.2 || dWallL < segHw + 6.0) suppL = true;

          const dRoadR = distToSeg2D(pRoadR.x, pRoadR.z, mNode.x, mNode.y, mNextNode.x, mNextNode.y);
          const dWallR = distToSeg2D(pWallCheckR.x, pWallCheckR.z, mNode.x, mNode.y, mNextNode.x, mNextNode.y);
          if (dRoadR < segHw - 0.2 || dWallR < segHw + 6.0) suppR = true;
          if (suppL && suppR) break;
        }
      }

      suppressLArray[i] = suppL;
      suppressRArray[i] = suppR;
    }

    for (let i = 0; i < M; i++) {
      const curr = densePoints[i];
      const prev = densePoints[Math.max(0, i - 1)];
      const next = densePoints[Math.min(M - 1, i + 1)];

      const pCurr = new THREE.Vector3(curr.x, (curr.z ?? 0), curr.y);
      const pPrev = new THREE.Vector3(prev.x, (prev.z ?? 0), prev.y);
      const pNext = new THREE.Vector3(next.x, (next.z ?? 0), next.y);

      let tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
      if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);

      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const hw = (curr.width || 18) / 2;
      let pRoadL = pCurr.clone().add(side.clone().multiplyScalar(hw));
      let pRoadR = pCurr.clone().sub(side.clone().multiplyScalar(hw));

      // SOLDADURA DE EXTREMIDADES (JUNÇÃO PERFEITA NO NÓ DE CONTACTO):
      // Se este ponto do ramal é a ponta (início ou fim), procura o ponto mais próximo na pista principal
      if ((i === 0 || i === M - 1) && mainSpline && mainSpline.length >= 2) {
        let bestM = -1;
        let bestDist = Infinity;
        for (let m = 0; m < mainSpline.length; m++) {
          const d = Math.hypot(mainSpline[m].x - curr.x, mainSpline[m].y - curr.y);
          if (d < bestDist) {
            bestDist = d;
            bestM = m;
          }
        }

        // Se a ponta do ramal está próxima de um ponto da pista principal (ligação intencional):
        if (bestM >= 0 && bestDist < 15.0) {
          if (mainFrames && mainFrames[bestM]) {
            // Soldadura 100% IDÊNTICA ao asfalto da pista principal usando o mesmo frame e pos
            const mf = mainFrames[bestM];
            const mHw = mf.cross?.halfWidth ?? ((mainSpline[bestM].width || 18) / 2);
            let mSide = mf.side.clone();
            if (mSide.dot(side) < 0) {
              mSide.negate();
            }
            pRoadL = mf.pos.clone().add(mSide.clone().multiplyScalar(mHw));
            pRoadR = mf.pos.clone().sub(mSide.clone().multiplyScalar(mHw));
            side.copy(mSide);
          } else {
            const mNode = mainSpline[bestM];
            const mPrev = mainSpline[(bestM - 1 + mainSpline.length) % mainSpline.length];
            const mNext = mainSpline[(bestM + 1) % mainSpline.length];

            const pMCurr = new THREE.Vector3(mNode.x, mNode.z ?? 0, mNode.y);
            const pMPrev = new THREE.Vector3(mPrev.x, mPrev.z ?? 0, mPrev.y);
            const pMNext = new THREE.Vector3(mNext.x, mNext.z ?? 0, mNext.y);

            let mTangent = new THREE.Vector3().subVectors(pMNext, pMPrev).normalize();
            if (mTangent.lengthSq() === 0) mTangent.set(1, 0, 0);

            let mSide = new THREE.Vector3().crossVectors(mTangent, new THREE.Vector3(0, 1, 0)).normalize();
            if (mNode.banking) {
              const bRad = (mNode.banking * Math.PI) / 180;
              mSide.applyAxisAngle(mTangent, bRad);
            }

            const mHw = (mNode.width || 18) / 2;
            if (mSide.dot(side) < 0) {
              mSide.negate();
            }

            pRoadL = pMCurr.clone().add(mSide.clone().multiplyScalar(mHw));
            pRoadR = pMCurr.clone().sub(mSide.clone().multiplyScalar(mHw));
            side.copy(mSide);
          }
        }
      }

      const suppressL = suppressLArray[i];
      const suppressR = suppressRArray[i];

      // Asfalto
      branchCenterPos[i] = pCurr.clone();
      branchRoadPosL[i] = pRoadL.clone();
      branchRoadPosR[i] = pRoadR.clone();
      roadVerts.push(pRoadL.x, pRoadL.y, pRoadL.z);
      roadVerts.push(pRoadR.x, pRoadR.y, pRoadR.z);
      const cRoadNode = curr.asphaltColor ? parseHex(curr.asphaltColor, asphaltColor) : cRoad;
      roadColors.push(...cRoadNode, ...cRoadNode);

      // Faixa Vermelha de 1.8m nas bordas exteriores
      const pL_out = pRoadL.clone().add(side.clone().multiplyScalar(ribbonW));
      const pR_out = pRoadR.clone().sub(side.clone().multiplyScalar(ribbonW));
      const yOff = 0.08;
      redRibbonVerts.push(pRoadL.x, pRoadL.y + yOff, pRoadL.z);
      redRibbonVerts.push(pL_out.x, pL_out.y + yOff, pL_out.z);
      redRibbonVerts.push(pRoadR.x, pRoadR.y + yOff, pRoadR.z);
      redRibbonVerts.push(pR_out.x, pR_out.y + yOff, pR_out.z);

      // Apenas desenha arestas exteriores que NÃO estejam suprimidas
      if (i > 0) {
        const prevCurr = densePoints[i - 1];
        const pPrevC = new THREE.Vector3(prevCurr.x, prevCurr.z ?? 0, prevCurr.y);
        const prevT = new THREE.Vector3().subVectors(pCurr, pPrevC).normalize();
        const prevSide = new THREE.Vector3().crossVectors(prevT, new THREE.Vector3(0, 1, 0)).normalize();
        const prevHw = (prevCurr.width || 18) / 2;
        const prevL = pPrevC.clone().add(prevSide.clone().multiplyScalar(prevHw));
        const prevR = pPrevC.clone().sub(prevSide.clone().multiplyScalar(prevHw));

        if (!suppressLArray[i] && !suppressLArray[i - 1]) {
          outlineVerts.push(prevL.x, prevL.y + 0.04, prevL.z, pRoadL.x, pRoadL.y + 0.04, pRoadL.z);
        }
        if (!suppressRArray[i] && !suppressRArray[i - 1]) {
          outlineVerts.push(prevR.x, prevR.y + 0.04, prevR.z, pRoadR.x, pRoadR.y + 0.04, pRoadR.z);
        }
      }

      // Ler larguras de faixas (suprimidas se estiverem na zona de cruzamento/junção)
      const scaleL = suppressL ? 0 : 1;
      const scaleR = suppressR ? 0 : 1;
      const wWhiteL = getZone(curr, 'whiteLineWidth', 'L') * scaleL;
      const wWhiteR = getZone(curr, 'whiteLineWidth', 'R') * scaleR;
      const wYellowL = getZone(curr, 'curbYellowWidth', 'L') * scaleL;
      const wYellowR = getZone(curr, 'curbYellowWidth', 'R') * scaleR;
      const wRedL = getZone(curr, 'curbRedWidth', 'L') * scaleL;
      const wRedR = getZone(curr, 'curbRedWidth', 'R') * scaleR;
      const wGrassL = getZone(curr, 'grassWidth', 'L') * scaleL;
      const wGrassR = getZone(curr, 'grassWidth', 'R') * scaleR;
      const wSandL = getZone(curr, 'sandWidth', 'L') * scaleL;
      const wSandR = getZone(curr, 'sandWidth', 'R') * scaleR;
      const wGravelL = getZone(curr, 'gravelWidth', 'L') * scaleL;
      const wGravelR = getZone(curr, 'gravelWidth', 'R') * scaleR;

      const cWhiteL = parseHex(getZoneColor(curr, 'whiteLineColor', 'L', whiteLineColor), whiteLineColor);
      const cWhiteR = parseHex(getZoneColor(curr, 'whiteLineColor', 'R', whiteLineColor), whiteLineColor);
      const cYellowL = parseHex(getZoneColor(curr, 'curbYellowColor', 'L', curbYellowColor), curbYellowColor);
      const cYellowR = parseHex(getZoneColor(curr, 'curbYellowColor', 'R', curbYellowColor), curbYellowColor);
      const cRedL = parseHex(getZoneColor(curr, 'curbRedColor', 'L', curbRedColor), curbRedColor);
      const cRedR = parseHex(getZoneColor(curr, 'curbRedColor', 'R', curbRedColor), curbRedColor);
      const cGrassL = parseHex(getZoneColor(curr, 'grassColor', 'L', grassColor), grassColor);
      const cGrassR = parseHex(getZoneColor(curr, 'grassColor', 'R', grassColor), grassColor);
      const cSandL = parseHex(getZoneColor(curr, 'sandColor', 'L', sandColor), sandColor);
      const cSandR = parseHex(getZoneColor(curr, 'sandColor', 'R', sandColor), sandColor);
      const cGravelL = parseHex(getZoneColor(curr, 'gravelColor', 'L', gravelColor), gravelColor);
      const cGravelR = parseHex(getZoneColor(curr, 'gravelColor', 'R', gravelColor), gravelColor);
      const cWallL = parseHex(getZoneColor(curr, 'wallColor', 'L', wallColor), wallColor);
      const cWallR = parseHex(getZoneColor(curr, 'wallColor', 'R', wallColor), wallColor);

      // 1. Linha Branca
      const pWhiteL = pRoadL.clone().add(side.clone().multiplyScalar(wWhiteL)).add(new THREE.Vector3(0, 0.012, 0));
      const pWhiteR = pRoadR.clone().sub(side.clone().multiplyScalar(wWhiteR)).add(new THREE.Vector3(0, 0.012, 0));
      whiteLineVerts.push(pRoadL.x, pRoadL.y, pRoadL.z);
      whiteLineVerts.push(pWhiteL.x, pWhiteL.y, pWhiteL.z);
      whiteLineVerts.push(pRoadR.x, pRoadR.y, pRoadR.z);
      whiteLineVerts.push(pWhiteR.x, pWhiteR.y, pWhiteR.z);
      whiteLineColors.push(...cWhiteL, ...cWhiteL, ...cWhiteR, ...cWhiteR);

      // 2. Zebra Amarela
      const pYellowL = pWhiteL.clone().add(side.clone().multiplyScalar(wYellowL)).add(new THREE.Vector3(0, 0.016, 0));
      const pYellowR = pWhiteR.clone().sub(side.clone().multiplyScalar(wYellowR)).add(new THREE.Vector3(0, 0.016, 0));
      yellowCurbsVerts.push(pWhiteL.x, pWhiteL.y, pWhiteL.z);
      yellowCurbsVerts.push(pYellowL.x, pYellowL.y, pYellowL.z);
      yellowCurbsVerts.push(pWhiteR.x, pWhiteR.y, pWhiteR.z);
      yellowCurbsVerts.push(pYellowR.x, pYellowR.y, pYellowR.z);
      yellowCurbsColors.push(...cYellowL, ...cYellowL, ...cYellowR, ...cYellowR);

      // 3. Zebra Vermelha
      const pRedL = pYellowL.clone().add(side.clone().multiplyScalar(wRedL)).add(new THREE.Vector3(0, 0.020, 0));
      const pRedR = pYellowR.clone().sub(side.clone().multiplyScalar(wRedR)).add(new THREE.Vector3(0, 0.020, 0));
      redCurbsVerts.push(pYellowL.x, pYellowL.y, pYellowL.z);
      redCurbsVerts.push(pRedL.x, pRedL.y, pRedL.z);
      redCurbsVerts.push(pYellowR.x, pYellowR.y, pYellowR.z);
      redCurbsVerts.push(pRedR.x, pRedR.y, pRedR.z);
      redCurbsColors.push(...cRedL, ...cRedL, ...cRedR, ...cRedR);

      // 4. Relva
      const pGrassL = pRedL.clone().add(side.clone().multiplyScalar(wGrassL));
      const pGrassR = pRedR.clone().sub(side.clone().multiplyScalar(wGrassR));
      grassVerts.push(pRedL.x, pRedL.y, pRedL.z);
      grassVerts.push(pGrassL.x, pGrassL.y, pGrassL.z);
      grassVerts.push(pRedR.x, pRedR.y, pRedR.z);
      grassVerts.push(pGrassR.x, pGrassR.y, pGrassR.z);
      grassColors.push(...cGrassL, ...cGrassL, ...cGrassR, ...cGrassR);

      // 5. Areia
      const pSandL = pGrassL.clone().add(side.clone().multiplyScalar(wSandL));
      const pSandR = pGrassR.clone().sub(side.clone().multiplyScalar(wSandR));
      sandVerts.push(pGrassL.x, pGrassL.y, pGrassL.z);
      sandVerts.push(pSandL.x, pSandL.y, pSandL.z);
      sandVerts.push(pGrassR.x, pGrassR.y, pGrassR.z);
      sandVerts.push(pSandR.x, pSandR.y, pSandR.z);
      sandColors.push(...cSandL, ...cSandL, ...cSandR, ...cSandR);

      // 6. Gravilha
      const pGravelL = pSandL.clone().add(side.clone().multiplyScalar(wGravelL));
      const pGravelR = pSandR.clone().sub(side.clone().multiplyScalar(wGravelR));
      gravelVerts.push(pSandL.x, pSandL.y, pSandL.z);
      gravelVerts.push(pGravelL.x, pGravelL.y, pGravelL.z);
      gravelVerts.push(pSandR.x, pSandR.y, pSandR.z);
      gravelVerts.push(pGravelR.x, pGravelR.y, pGravelR.z);
      gravelColors.push(...cGravelL, ...cGravelL, ...cGravelR, ...cGravelR);

      // 7. Muro Esquerdo
      const pWallBaseInnerL = pGravelL.clone();
      branchWallPosL[i] = pWallBaseInnerL.clone();
      const hL = suppressL ? 0 : effectiveWallH;
      const pWallTopInnerL = pWallBaseInnerL.clone().add(new THREE.Vector3(0, hL, 0));
      const pWallTopOuterL = pWallTopInnerL.clone().add(side.clone().multiplyScalar(barrierThickness));
      const pWallBaseOuterL = pWallBaseInnerL.clone().add(side.clone().multiplyScalar(barrierThickness));
      wallLVerts.push(pWallBaseInnerL.x, pWallBaseInnerL.y, pWallBaseInnerL.z);
      wallLVerts.push(pWallTopInnerL.x, pWallTopInnerL.y, pWallTopInnerL.z);
      wallLVerts.push(pWallTopOuterL.x, pWallTopOuterL.y, pWallTopOuterL.z);
      wallLVerts.push(pWallBaseOuterL.x, pWallBaseOuterL.y, pWallBaseOuterL.z);
      wallLColors.push(...cWallL, ...cWallL, ...cWallL, ...cWallL);

      // 8. Muro Direito
      const pWallBaseInnerR = pGravelR.clone();
      branchWallPosR[i] = pWallBaseInnerR.clone();
      const hR = suppressR ? 0 : effectiveWallH;
      const pWallTopInnerR = pWallBaseInnerR.clone().add(new THREE.Vector3(0, hR, 0));
      const pWallTopOuterR = pWallTopInnerR.clone().sub(side.clone().multiplyScalar(barrierThickness));
      const pWallBaseOuterR = pWallBaseInnerR.clone().sub(side.clone().multiplyScalar(barrierThickness));
      wallRVerts.push(pWallBaseInnerR.x, pWallBaseInnerR.y, pWallBaseInnerR.z);
      wallRVerts.push(pWallTopInnerR.x, pWallTopInnerR.y, pWallTopInnerR.z);
      wallRVerts.push(pWallTopOuterR.x, pWallTopOuterR.y, pWallTopOuterR.z);
      wallRVerts.push(pWallBaseOuterR.x, pWallBaseOuterR.y, pWallBaseOuterR.z);
      wallRColors.push(...cWallR, ...cWallR, ...cWallR, ...cWallR);

      if (i < M - 1) {
        const v0 = baseROffset + i * 2;
        const v1 = v0 + 1;
        const v2 = v0 + 2;
        const v3 = v0 + 3;
        roadIndices.push(v0, v2, v1);
        roadIndices.push(v1, v2, v3);

        const b0 = baseBOffset + i * 4;
        const bn0 = b0 + 4;
        // Só gerar faces de berma se ambos os frames NÃO estiverem suprimidos:
        const addBandSide = (arr: number[], isL: boolean) => {
          if (isL) {
            if (!suppressLArray[i] && !suppressLArray[i + 1]) {
              arr.push(b0, bn0, b0 + 1);
              arr.push(b0 + 1, bn0, bn0 + 1);
            }
          } else {
            if (!suppressRArray[i] && !suppressRArray[i + 1]) {
              arr.push(b0 + 2, b0 + 3, bn0 + 2);
              arr.push(b0 + 3, bn0 + 3, bn0 + 2);
            }
          }
        };

        addBandSide(whiteLineIndices, true);
        addBandSide(whiteLineIndices, false);
        addBandSide(yellowCurbsIndices, true);
        addBandSide(yellowCurbsIndices, false);
        addBandSide(redCurbsIndices, true);
        addBandSide(redCurbsIndices, false);
        addBandSide(grassIndices, true);
        addBandSide(grassIndices, false);
        addBandSide(sandIndices, true);
        addBandSide(sandIndices, false);
        addBandSide(gravelIndices, true);
        addBandSide(gravelIndices, false);

        // Só gerar muro esquerdo se o lado esquerdo NÃO estiver suprimido em i e i+1!
        if (!suppressLArray[i] && !suppressLArray[i + 1]) {
          const wl0 = baseWLOffset + i * 4;
          const wln0 = wl0 + 4;
          wallLIndices.push(wl0, wln0, wl0 + 1);
          wallLIndices.push(wl0 + 1, wln0, wln0 + 1);
          wallLIndices.push(wl0 + 1, wln0, wln0 + 1, wl0 + 2);
          wallLIndices.push(wl0 + 2, wln0, wln0 + 2);
          wallLIndices.push(wl0 + 2, wl0 + 3, wln0 + 2);
          wallLIndices.push(wl0 + 3, wln0 + 3, wln0 + 2);
        }

        // Só gerar muro direito se o lado direito NÃO estiver suprimido em i e i+1!
        if (!suppressRArray[i] && !suppressRArray[i + 1]) {
          const wr0 = baseWROffset + i * 4;
          const wrn0 = wr0 + 4;
          wallRIndices.push(wr0, wr0 + 1, wrn0);
          wallRIndices.push(wr0 + 1, wrn0 + 1, wrn0);
          wallRIndices.push(wr0 + 1, wr0 + 2, wrn0 + 1);
          wallRIndices.push(wr0 + 2, wrn0 + 2, wrn0 + 1);
          wallRIndices.push(wr0 + 2, wr0 + 3, wrn0 + 2);
          wallRIndices.push(wr0 + 3, wrn0 + 3, wrn0 + 2);
        }

        // Faixa Vermelha de 1.8m
        const rib0 = ribOffset + i * 4;
        const ribn0 = rib0 + 4;
        if (!suppressLArray[i] && !suppressLArray[i + 1]) {
          redRibbonIndices.push(rib0, ribn0, rib0 + 1);
          redRibbonIndices.push(rib0 + 1, ribn0, ribn0 + 1);
        }
        if (!suppressRArray[i] && !suppressRArray[i + 1]) {
          redRibbonIndices.push(rib0 + 2, rib0 + 3, ribn0 + 2);
          redRibbonIndices.push(rib0 + 3, ribn0 + 3, ribn0 + 2);
        }
      }
    }

    let extraWL = 0;

    // Fechar o vértice interior das junções (ex: entrada e saída da Box) com uma curva suave em "U" + triângulo vermelho Ferrari
    if (mainWallData && mainFrames && mainFrames.length >= 3) {
      const Nmain = mainFrames.length;
      const usedMainTransitions = new Set<string>();

      const bridgeSideTransitions = (isL: boolean) => {
        const suppArr = isL ? suppressLArray : suppressRArray;
        const wallPosArr = isL ? branchWallPosL : branchWallPosR;
        const roadPosArr = isL ? branchRoadPosL : branchRoadPosR;

        for (let bIdx = 0; bIdx < M; bIdx++) {
          if (suppArr[bIdx]) continue;
          const prevSupp = bIdx > 0 && suppArr[bIdx - 1];
          const nextSupp = bIdx < M - 1 && suppArr[bIdx + 1];
          if (!prevSupp && !nextSupp) continue;

          const B_pos = wallPosArr[bIdx];
          const B_road = roadPosArr[bIdx];
          const [cr, cg, cb] = parseHex(
            getZoneColor(densePoints[bIdx], 'wallColor', isL ? 'L' : 'R', wallColor),
            wallColor
          );
          const towardIdx = prevSupp ? Math.max(0, bIdx - 1) : Math.min(M - 1, bIdx + 1);
          const bTan = new THREE.Vector3().subVectors(branchCenterPos[towardIdx], branchCenterPos[bIdx]);
          bTan.y = 0;
          if (bTan.lengthSq() < 1e-6) continue;
          bTan.normalize();

          // Procurar transição correspondente no muro da pista principal
          let bestDist = 45.0;
          let bestMIdx = -1;
          let bestSideIsL = true;

          for (let mSideFlag = 0; mSideFlag < 2; mSideFlag++) {
            const mIsL = mSideFlag === 0;
            const mSupp = mIsL ? mainWallData.suppressWallL : mainWallData.suppressWallR;
            const mWall = mIsL ? mainWallData.cleanWallL : mainWallData.cleanWallR;

            for (let m = 0; m < Nmain; m++) {
              if (mSupp[m]) continue;
              const mPrev = (m - 1 + Nmain) % Nmain;
              const mNext = (m + 1) % Nmain;
              if (!mSupp[mPrev] && !mSupp[mNext]) continue;

              const key = `${mIsL ? 'L' : 'R'}_${m}`;
              if (usedMainTransitions.has(key)) continue;

              const M_cand = mWall[m];
              const d = Math.hypot(M_cand.x - B_pos.x, M_cand.z - B_pos.z);
              if (d < bestDist) {
                bestDist = d;
                bestMIdx = m;
                bestSideIsL = mIsL;
              }
            }
          }

          if (bestMIdx < 0) continue;
          usedMainTransitions.add(`${bestSideIsL ? 'L' : 'R'}_${bestMIdx}`);

          const mWallArr = bestSideIsL ? mainWallData.cleanWallL : mainWallData.cleanWallR;
          const M_pos = new THREE.Vector3(mWallArr[bestMIdx].x, mWallArr[bestMIdx].y, mWallArr[bestMIdx].z);
          const mf = mainFrames[bestMIdx];
          const mHw = mf.cross?.halfWidth ?? 9;
          const M_road = mf.pos.clone().add(mf.side.clone().multiplyScalar(bestSideIsL ? mHw : -mHw));

          // Curva Bézier quadrática entre B_pos e M_pos apontando suavemente para o bico da junção
          const mid = new THREE.Vector3().addVectors(B_pos, M_pos).multiplyScalar(0.5);
          const ctrl = mid.clone().addScaledVector(bTan, Math.min(8.0, bestDist * 0.45));

          // Garantir que a normal aponta para fora da estrada (para dentro da ilha verde)
          const islandCenter = mid.clone().addScaledVector(bTan, -Math.max(4.0, bestDist * 0.5));
          const steps = 8;
          const curvePts: THREE.Vector3[] = [];
          for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const inv = 1 - u;
            const pt = new THREE.Vector3(
              inv * inv * B_pos.x + 2 * inv * u * ctrl.x + u * u * M_pos.x,
              inv * inv * B_pos.y + 2 * inv * u * ctrl.y + u * u * M_pos.y,
              inv * inv * B_pos.z + 2 * inv * u * ctrl.z + u * u * M_pos.z
            );
            curvePts.push(pt);
          }

          const startWIdx = wallLVerts.length / 3;
          for (let s = 0; s <= steps; s++) {
            const pt = curvePts[s];
            const pA = curvePts[Math.max(0, s - 1)];
            const pB = curvePts[Math.min(steps, s + 1)];
            const tan = new THREE.Vector3().subVectors(pB, pA);
            tan.y = 0;
            if (tan.lengthSq() < 1e-6) tan.set(1, 0, 0);
            tan.normalize();

            const outN = new THREE.Vector3(-tan.z, 0, tan.x);
            const toIsland = new THREE.Vector3().subVectors(islandCenter, pt);
            toIsland.y = 0;
            if (outN.dot(toIsland) < 0) outN.negate();

            const pTopIn = pt.clone().add(new THREE.Vector3(0, effectiveWallH, 0));
            const pTopOut = pTopIn.clone().addScaledVector(outN, barrierThickness);
            const pBaseOut = pt.clone().addScaledVector(outN, barrierThickness);

            wallLVerts.push(pt.x, pt.y, pt.z);
            wallLVerts.push(pTopIn.x, pTopIn.y, pTopIn.z);
            wallLVerts.push(pTopOut.x, pTopOut.y, pTopOut.z);
            wallLVerts.push(pBaseOut.x, pBaseOut.y, pBaseOut.z);
            wallLColors.push(cr, cg, cb, cr, cg, cb, cr, cg, cb, cr, cg, cb);

            if (s < steps) {
              const c0 = startWIdx + s * 4;
              const cn0 = c0 + 4;
              wallLIndices.push(c0, cn0, c0 + 1);
              wallLIndices.push(c0 + 1, cn0, cn0 + 1);
              wallLIndices.push(c0 + 1, cn0 + 1, c0 + 2);
              wallLIndices.push(c0 + 2, cn0 + 1, c0 + 2);
              wallLIndices.push(c0 + 2, c0 + 3, cn0 + 2);
              wallLIndices.push(c0 + 3, cn0 + 3, cn0 + 2);
            }
          }
          extraWL += (steps + 1) * 4;

          // Preencher o triângulo de entrada/saída entre a ponta da estrada e o muro curvo em Vermelho Ferrari
          const forkTip = new THREE.Vector3()
            .addVectors(B_road, M_road)
            .multiplyScalar(0.5)
            .addScaledVector(bTan, Math.max(3.0, bestDist * 0.55));
          forkTip.y += 0.018;

          const baseRedIdx = redCurbsVerts.length / 3;
          redCurbsVerts.push(forkTip.x, forkTip.y, forkTip.z);
          redCurbsColors.push(0.78, 0.005, 0.005);

          redCurbsVerts.push(B_road.x, B_road.y + 0.018, B_road.z);
          redCurbsColors.push(0.78, 0.005, 0.005);

          for (let s = 0; s <= steps; s++) {
            const pt = curvePts[s];
            redCurbsVerts.push(pt.x, pt.y + 0.018, pt.z);
            redCurbsColors.push(0.78, 0.005, 0.005);
          }

          redCurbsVerts.push(M_road.x, M_road.y + 0.018, M_road.z);
          redCurbsColors.push(0.78, 0.005, 0.005);

          // Fan de triângulos ligando forkTip (baseRedIdx) a B_road -> curvePts[0..steps] -> M_road
          for (let s = 0; s <= steps + 1; s++) {
            redCurbsIndices.push(baseRedIdx, baseRedIdx + 1 + s, baseRedIdx + 2 + s);
          }
        }
      };

      bridgeSideTransitions(true);
      bridgeSideTransitions(false);
    }

    rOffset += M * 2;
    bOffset += M * 4;
    wLOffset += M * 4 + extraWL;
    wROffset += M * 4;
    ribOffset += M * 4;
  }

  const makeGeo = (v: number[], ind: number[], col?: number[]) => {
    if (v.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(ind);
    if (col && col.length === v.length) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    g.computeVertexNormals();
    return g;
  };



  return {
    roadGeo: makeGeo(roadVerts, roadIndices, roadColors),
    whiteLineGeo: makeGeo(whiteLineVerts, whiteLineIndices, whiteLineColors),
    yellowCurbsGeo: makeGeo(yellowCurbsVerts, yellowCurbsIndices, yellowCurbsColors),
    redCurbsGeo: makeGeo(redCurbsVerts, redCurbsIndices, redCurbsColors),
    grassShoulderGeo: makeGeo(grassVerts, grassIndices, grassColors),
    sandGeo: makeGeo(sandVerts, sandIndices, sandColors),
    gravelGeo: makeGeo(gravelVerts, gravelIndices, gravelColors),
    guardrailLeftGeo: makeGeo(wallLVerts, wallLIndices, wallLColors),
    guardrailRightGeo: makeGeo(wallRVerts, wallRIndices, wallRColors),
    outlineGeo: (() => {
      if (outlineVerts.length === 0) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(outlineVerts, 3));
      return geo;
    })(),
    redRibbonGeo: makeGeo(redRibbonVerts, redRibbonIndices)
  };
}
