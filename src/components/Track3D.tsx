// Html removed to avoid React 19 removeChild collision
﻿import React, { useMemo, useEffect, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { SplineNode, RoadBranch, computePitStopZones, computeSpline, buildSplineArcSampler } from '../tracks';
import { SurfaceType } from '../physics';
import { buildBranchGeometries } from '../branchRoads';
import { buildUnifiedRoadNetwork } from '../roadFusion';
import { subscribeTelemetry, getTelemetry } from '../telemetryStore';

const StartGantryLights: React.FC = React.memo(() => {
  const telemetry = useSyncExternalStore(subscribeTelemetry, getTelemetry);
  const { raceStartPhase, startLightsLit } = telemetry;
  const xs = [-2.1, -0.7, 0.7, 2.1];

  return (
    <>
      {xs.map((lx, idx) => {
        const isGreenSlot = idx === 3;
        const lit = isGreenSlot
          ? raceStartPhase === 'green'
          : raceStartPhase === 'lights' && startLightsLit >= idx + 1;
        const color = lit ? (isGreenSlot ? '#10b981' : '#ef4444') : '#1e293b';
        const emissive = lit ? color : '#000000';
        const intensity = lit ? (isGreenSlot ? 3.2 : 3.0) : 0.05;

        return (
          <React.Fragment key={`light_${idx}`}>
            <mesh position={[lx, 6.05, 0.37]}>
              <circleGeometry args={[0.28, 20]} />
              <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} />
            </mesh>
            <mesh position={[lx, 6.05, -0.37]} rotation={[0, Math.PI, 0]}>
              <circleGeometry args={[0.28, 20]} />
              <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} />
            </mesh>
          </React.Fragment>
        );
      })}
    </>
  );
});

let nextGeoId = 1;
const geoIds = new WeakMap<THREE.BufferGeometry, number>();
function getGeoKey(geo?: THREE.BufferGeometry | null): number {
  if (!geo) return 0;
  let id = geoIds.get(geo);
  if (!id) {
    id = nextGeoId++;
    geoIds.set(geo, id);
  }
  return id;
}

function sanitizeGeoForRapier(geo?: THREE.BufferGeometry | null, isWall = false): THREE.BufferGeometry | null {
  if (!geo) return null;
  const pos = geo.getAttribute('position');
  if (!pos || pos.count < 3) return null;
  const idx = geo.getIndex();
  const vertCount = pos.count;
  const validIndices: number[] = [];

  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(vertCount / 3);
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (a >= vertCount || b >= vertCount || c >= vertCount) continue;

    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) continue;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const lenSq = nx * nx + ny * ny + nz * nz;
    if (lenSq < 1e-8) continue;
    if (!isWall && Math.abs(ny) < 0.15 * Math.sqrt(lenSq)) continue;

    validIndices.push(a, b, c);
  }

  if (validIndices.length < 3) return null;
  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', pos.clone());
  clean.setIndex(validIndices);
  return clean;
}

function pushConformedStrip(
  verts: number[],
  uvs: number[],
  indices: number[],
  sampler: ReturnType<typeof buildSplineArcSampler>,
  sNear: number,
  sFar: number,
  latLeft: number,
  latRight: number,
  yLift: number,
  steps: number = 1
) {
  const baseV = verts.length / 3;
  for (let i = 0; i <= steps; i++) {
    const vFrac = i / steps;
    const sCurr = sNear + vFrac * (sFar - sNear);
    const sp = sampler.sampleAt(sCurr);
    const bankLift = Math.abs(sp.bankSin) * (sp.width * 0.5);

    const xL = sp.x + sp.lx * latLeft;
    const zL = sp.z + sp.lz * latLeft;
    const yL = sp.y + bankLift - latLeft * sp.bankSin + yLift;

    const xR = sp.x + sp.lx * latRight;
    const zR = sp.z + sp.lz * latRight;
    const yR = sp.y + bankLift - latRight * sp.bankSin + yLift;

    verts.push(xL, yL, zL);
    uvs.push(0, vFrac);
    verts.push(xR, yR, zR);
    uvs.push(1, vFrac);
  }
  for (let i = 0; i < steps; i++) {
    const a = baseV + i * 2;
    const b = baseV + (i + 1) * 2;
    // (a=NearLeft, a+1=NearRight, b=FarLeft, b+1=FarRight) -> +Y facing & text upright toward driver
    indices.push(a, a + 1, b);
    indices.push(a + 1, b + 1, b);
  }
}

function makeBoxApproachTexture(distLabel: string, arrowTilt: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 512);
    // Crisp high-contrast asphalt pad
    ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
    ctx.fillRect(16, 16, 480, 480);

    // Thick high-vis amber/yellow frame + top/bottom stripes
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 22;
    ctx.strokeRect(22, 22, 468, 468);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(22, 22, 468, 28);
    ctx.fillRect(22, 462, 468, 28);

    // Direction arrow near top (angled slightly toward pit side if requested)
    ctx.save();
    ctx.translate(256, 130);
    ctx.rotate(arrowTilt);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(0, -68);
    ctx.lineTo(74, 4);
    ctx.lineTo(32, 4);
    ctx.lineTo(32, 58);
    ctx.lineTo(-32, 58);
    ctx.lineTo(-32, 4);
    ctx.lineTo(-74, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Huge white "BOX" lettering + distance badge
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 132px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BOX', 256, 275);

    ctx.fillStyle = '#fde047';
    ctx.font = '900 92px system-ui, -apple-system, sans-serif';
    ctx.fillText(distLabel, 256, 400);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function makePitExitTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 18);
    ctx.fillRect(0, 110, 512, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 58px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SAÍDA BOX', 256, 66);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const TrimeshColliderWrap: React.FC<{
  enabled: boolean;
  geo?: THREE.BufferGeometry | null;
  surface?: SurfaceType | 'WALL';
  children: React.ReactNode;
}> = ({ enabled, geo, surface, children }) => {
  const cleanGeo = useMemo(
    () => (enabled ? sanitizeGeoForRapier(geo, surface === 'WALL') : null),
    [enabled, geo, surface]
  );
  const rbUserData = useMemo(() => (surface ? { surface } : undefined), [surface]);

  useEffect(() => {
    return () => {
      cleanGeo?.dispose();
    };
  }, [cleanGeo]);

  if (enabled && cleanGeo) {
    return (
      <>
        {children}
        <RigidBody
          key={getGeoKey(geo)}
          type="fixed"
          colliders="trimesh"
          includeInvisible
          friction={0.0}
          restitution={0.05}
          userData={rbUserData}
        >
          <mesh geometry={cleanGeo} visible={false} />
        </RigidBody>
      </>
    );
  }
  return <>{children}</>;
};

const numberTextures = new Map<number, THREE.CanvasTexture>();
function getNumberSpriteTexture(num: number): THREE.CanvasTexture {
  if (numberTextures.has(num)) return numberTextures.get(num)!;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num.toString(), 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  numberTextures.set(num, tex);
  return tex;
}

import { untanglePolyline3D, roundTightWallCorners3D } from '../wallGeometry';
import { computeCorridor, getZone, bermaWidth } from '../trackCorridor';
import { TRACK_THEMES, TrackThemeId, calculateCrossSection } from '../trackProfile';
import { computeBridgePillars } from '../bridgePillars';


interface Track3DProps {
  branches?: RoadBranch[];
  selectedBranchNode?: { branchId: string; nodeIndex: number } | null;
  onSelectBranchNode?: (branchId: string, nodeIndex: number) => void;
  onMoveBranchNode?: (branchId: string, nodeIndex: number, newX: number, newY: number) => void;
  showLayers?: boolean;
  spline: SplineNode[];
  controlPoints: SplineNode[];
  selectedPointIndex?: number | null;
  onSelectPoint?: (index: number) => void;
  onMovePoint?: (index: number, newX: number, newY: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  showControlPoints?: boolean;
  theme?: 'day' | 'sunset' | 'night';
  trackThemeId?: TrackThemeId;
  showEdges?: boolean;
  showOutlines?: boolean;
  showGuardrails?: boolean;
  showEmbankments?: boolean;
  showRedRibbon?: boolean;
  isClosed?: boolean;
  pitSpline?: SplineNode[];
  enablePhysics?: boolean;
  groundY?: number;
}

export const Track3D: React.FC<Track3DProps> = ({
  spline,
  controlPoints,
  selectedPointIndex,
  onSelectPoint,
  onMovePoint,
  onDragStateChange,
  showControlPoints = true,
  theme = 'day',
  trackThemeId = 'f1_modern',
  showEdges = true,
  showOutlines,
  showGuardrails = true,
  showEmbankments = true,
  showRedRibbon = true,
  showLayers = false,
  isClosed = true,
  pitSpline,
  branches = [],
  selectedBranchNode,
  onSelectBranchNode,
  onMoveBranchNode,
  enablePhysics = false,
  groundY = -1,
}) => {
  const themeConfig = TRACK_THEMES[trackThemeId] || TRACK_THEMES.f1_modern || TRACK_THEMES['f1'];
  const asphaltColor = themeConfig.asphaltColor;
  const pitAsphaltColor = themeConfig.pitAsphaltColor;
  const grassColor = themeConfig.grassColor;
  const embankColor = themeConfig.embankColor;
  const wallColor = themeConfig.wallColor;
  const outlineColor = themeConfig.outlineColor;
  type DragNodeState =
    | { kind: 'main'; index: number; y: number; startX: number; startY: number; moved: boolean }
    | { kind: 'branch'; branchId: string; nodeIndex: number; y: number; startX: number; startY: number; moved: boolean };
  const [draggingNode, setDraggingNode] = React.useState<DragNodeState | null>(null);
  const dragNodeRef = React.useRef<DragNodeState | null>(null);

  React.useEffect(() => {
    if (!draggingNode) return;
    const handleWinPointerUp = () => {
      if (!dragNodeRef.current) return;
      dragNodeRef.current = null;
      setDraggingNode(null);
      onDragStateChange?.(false);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('pointerup', handleWinPointerUp);
    return () => window.removeEventListener('pointerup', handleWinPointerUp);
  }, [draggingNode, onDragStateChange]);


  // branchGeos moved below geometries useMemo to receive geometries.frames directly

  const geometries = useMemo(() => {
    if (spline.length < 2) return null;

    const N = spline.length;
    const barrierHeight = themeConfig.barrierHeight;
    const wallThickness = themeConfig.barrierThickness;

    // Buffers das 15 Zonas
    const roadVerts: number[] = [];
    const roadColors: number[] = [];
    const roadIndices: number[] = [];
    const bridgeRoadIndices: number[] = [];
    const bridgeWhiteIndices: number[] = [];
    const bridgeYellowIndices: number[] = [];
    const bridgeRedIndices: number[] = [];
    const bridgeGrassIndices: number[] = [];
    const bridgeSandIndices: number[] = [];
    const bridgeGravelIndices: number[] = [];
    const bridgeWallLIndices: number[] = [];
    const bridgeWallRIndices: number[] = [];

    const whiteLineVerts: number[] = [];
    const whiteLineColors: number[] = [];
    const whiteLineIndices: number[] = [];

    const yellowCurbsVerts: number[] = [];
    const yellowCurbsColors: number[] = [];
    const yellowCurbsIndices: number[] = [];

    const redCurbsVerts: number[] = [];
    const redCurbsColors: number[] = [];
    const redCurbsIndices: number[] = [];

    const grassShoulderVerts: number[] = [];
    const grassShoulderColors: number[] = [];
    const grassShoulderIndices: number[] = [];

    const sandVerts: number[] = [];
    const sandColors: number[] = [];
    const sandIndices: number[] = [];

    const gravelVerts: number[] = [];
    const gravelColors: number[] = [];
    const gravelIndices: number[] = [];

    const embankmentVerts: number[] = [];
    const embankmentIndices: number[] = [];

    const guardrailLeftVerts: number[] = [];
    const guardrailLeftColors: number[] = [];
    const guardrailLeftIndices: number[] = [];
    const guardrailRightVerts: number[] = [];
    const guardrailRightColors: number[] = [];
    const guardrailRightIndices: number[] = [];

    const edgeLines: number[] = [];

    // Local frames
    const frames: {
      pos: THREE.Vector3;
      side: THREE.Vector3;
      up: THREE.Vector3;
      tangent: THREE.Vector3;
      dist: number;
      width: number;
      isExtendedTight: boolean;
      isApexTight: boolean;
      cross: {
        halfWidth: number;
        shoulderWidth: number;
        whiteLineWidth: number;
        yellowCurbWidth: number;
        redCurbWidth: number;
        grassWidth: number;
        sandWidth: number;
        gravelWidth: number;
        barrierThickness: number;
        barrierHeight: number;
      };
    }[] = [];

    for (let i = 0; i < N; i++) {
      const curr = spline[i];
      const prev = isClosed ? spline[(i - 1 + N) % N] : spline[Math.max(0, i - 1)];
      const next = isClosed ? spline[(i + 1) % N] : spline[Math.min(N - 1, i + 1)];

      const pCurr = new THREE.Vector3(curr.x, curr.z, curr.y);
      const pPrev = new THREE.Vector3(prev.x, prev.z, prev.y);
      const pNext = new THREE.Vector3(next.x, next.z, next.y);

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

      // Compensação de elevação no banking:
      // Se a pista inclinar com o eixo central em pCurr.y, o lado rebaixado afunda abaixo do chão (Y < 0).
      // Elevamos o centro exatamente o valor do afundamento lateral máximo para que a cota mínima nunca fique abaixo da cota do terreno (pCurr.y >= 0).
      if (curr.banking) {
        const bankingRad = Math.abs((curr.banking * Math.PI) / 180);
        // Distância do centro até à borda exterior da gravilha/muro
        const maxHalfW = cross.halfWidth + (cross.shoulderWidth || 8.0) + (cross.barrierThickness || 1.0);
        const yDrop = Math.sin(bankingRad) * maxHalfW;
        pCurr.y += yDrop;
      }

      frames.push({
        pos: pCurr,
        side,
        up,
        tangent,
        dist: curr.distFromStart ?? (i * 4),
        width: cross.halfWidth * 2,
        isExtendedTight: curr.isExtendedTight || false,
        isApexTight: curr.isApexTight || false,
        cross
      });
    }

    // Corredor partilhado com a física: muros SEMPRE presentes, bermas encolhem
    const corridor = computeCorridor(spline, isClosed);
    const scaleLArray = corridor.scaleL;
    const scaleRArray = corridor.scaleR;
    const suppressWallL: boolean[] = new Array(N).fill(false);
    const suppressWallR: boolean[] = new Array(N).fill(false);
    const suppressCurbsL: boolean[] = new Array(N).fill(false);
    const suppressCurbsR: boolean[] = new Array(N).fill(false);

    const distToSeg2D = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
      const dx = bx - ax;
      const dz = bz - az;
      const lenSq = dx * dx + dz * dz;
      if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
      return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    };

    // Detetar e abrir bermas/muros da pista principal onde qualquer ramal/estrada ou box se liga!
    for (let i = 0; i < N; i++) {
      const f = frames[i];
      const hw = f.cross.halfWidth;
      const pL = f.pos.clone().add(f.side.clone().multiplyScalar(hw));
      const pR = f.pos.clone().sub(f.side.clone().multiplyScalar(hw));
      const pWallCheckL = f.pos.clone().add(f.side.clone().multiplyScalar(hw + 6.5));
      const pWallCheckR = f.pos.clone().sub(f.side.clone().multiplyScalar(hw + 6.5));

      // 1. Verificar proximidade a ramais (branches) ao longo de TODA a extensão
      if (branches && branches.length > 0) {
        for (const b of branches) {
          if (!b.points || b.points.length < 2) continue;
          for (let k = 0; k < b.points.length - 1; k++) {
            const pA = b.points[k];
            const pB = b.points[k + 1];
            const bHw = Math.max(pA.width || 18, pB.width || 18) / 2;

            const dL = distToSeg2D(pL.x, pL.z, pA.x, pA.y, pB.x, pB.y);
            const dWallL = distToSeg2D(pWallCheckL.x, pWallCheckL.z, pA.x, pA.y, pB.x, pB.y);
            if (dL < bHw - 0.2 || dWallL < bHw + 6.0) {
              suppressWallL[i] = true;
              suppressCurbsL[i] = true;
              scaleLArray[i] = 0;
            }

            const dR = distToSeg2D(pR.x, pR.z, pA.x, pA.y, pB.x, pB.y);
            const dWallR = distToSeg2D(pWallCheckR.x, pWallCheckR.z, pA.x, pA.y, pB.x, pB.y);
            if (dR < bHw - 0.2 || dWallR < bHw + 6.0) {
              suppressWallR[i] = true;
              suppressCurbsR[i] = true;
              scaleRArray[i] = 0;
            }
          }
        }
      }

      // 2. Verificar proximidade à Pit Lane
      if (pitSpline && pitSpline.length >= 2) {
        for (let k = 0; k < pitSpline.length - 1; k++) {
          const pA = pitSpline[k];
          const pB = pitSpline[k + 1];
          const pitHw = Math.max(pA.width || 8.5, pB.width || 8.5) / 2;

          const dL = distToSeg2D(pL.x, pL.z, pA.x, pA.y, pB.x, pB.y);
          if (dL < pitHw + 3.0) {
            suppressWallL[i] = true;
            suppressCurbsL[i] = true;
            scaleLArray[i] = 0;
          }

          const dR = distToSeg2D(pR.x, pR.z, pA.x, pA.y, pB.x, pB.y);
          if (dR < pitHw + 3.0) {
            suppressWallR[i] = true;
            suppressCurbsR[i] = true;
            scaleRArray[i] = 0;
          }
        }
      }
    }

    // Pit lane entry / exit detection
    let pPitEntry: THREE.Vector3 | null = null;
    let pPitExit: THREE.Vector3 | null = null;
    let pitIsOnLeftSide = false;
    let pitEntryTrackIdx = -1;
    let pitExitTrackIdx = -1;
    let pitZoneLength = 0;

    if (pitSpline && pitSpline.length >= 2) {
      pPitEntry = new THREE.Vector3(pitSpline[0].x, pitSpline[0].z, pitSpline[0].y);
      pPitExit = new THREE.Vector3(pitSpline[pitSpline.length - 1].x, pitSpline[pitSpline.length - 1].z, pitSpline[pitSpline.length - 1].y);

      let minDStart = Infinity;
      let minDEnd = Infinity;
      for (let i = 0; i < N; i++) {
        const dS = frames[i].pos.distanceTo(pPitEntry);
        if (dS < minDStart) { minDStart = dS; pitEntryTrackIdx = i; }
        const dE = frames[i].pos.distanceTo(pPitExit);
        if (dE < minDEnd) { minDEnd = dE; pitExitTrackIdx = i; }
      }

      if (pitEntryTrackIdx >= 0 && pitExitTrackIdx >= 0) {
        const entryFrame = frames[pitEntryTrackIdx];
        const toPit = new THREE.Vector3().subVectors(pPitEntry, entryFrame.pos);
        pitIsOnLeftSide = toPit.dot(entryFrame.side) > 0;
        let startIdx = pitEntryTrackIdx;
        let len = (pitExitTrackIdx - pitEntryTrackIdx + N) % N;
        if (len > N / 2) {
          startIdx = pitExitTrackIdx;
          len = (pitEntryTrackIdx - pitExitTrackIdx + N) % N;
        }
        pitEntryTrackIdx = startIdx;
        pitZoneLength = len;

        // FUSÃO & ABERTURA DA PISTA NA BOX:
        // Suprimir muros da pista principal apenas na extensão da reta da box
        for (let p = 0; p <= pitZoneLength; p++) {
          const frameIdx = (pitEntryTrackIdx + p) % N;
          if (pitIsOnLeftSide) {
            suppressWallL[frameIdx] = true;
          } else {
            suppressWallR[frameIdx] = true;
          }
        }
      }
    }



    const parseColorRGB = (colorStr: string | undefined, defaultHex: string): [number, number, number] => {
      const c = new THREE.Color(colorStr || defaultHex);
      return [c.r, c.g, c.b];
    };


    // Pre-cálculo e deslaçamento das polilinhas exteriores dos muros
    const rawRoadL: THREE.Vector3[] = [];
    const rawRoadR: THREE.Vector3[] = [];
    const rawWallBaseInnerL: THREE.Vector3[] = [];
    const rawWallBaseInnerR: THREE.Vector3[] = [];
    const wallOuterDistL: number[] = [];
    const wallOuterDistR: number[] = [];
    for (let i = 0; i < N; i++) {
      const f = frames[i];
      const hw = f.cross.halfWidth;
      rawRoadL.push(f.pos.clone().add(f.side.clone().multiplyScalar(hw)));
      rawRoadR.push(f.pos.clone().sub(f.side.clone().multiplyScalar(hw)));
      let sL = scaleLArray[i];
      let sR = scaleRArray[i];
      if (suppressCurbsL[i]) sL = 0;
      if (suppressCurbsR[i]) sR = 0;
      if (pitEntryTrackIdx >= 0 && pitZoneLength > 0) {
        const relIdx = (i - pitEntryTrackIdx + N) % N;
        if (relIdx <= pitZoneLength) {
          if (pitIsOnLeftSide) sL = 0;
          else sR = 0;
        }
      }
      const distL = hw + (getZone(spline[i], 'whiteLineWidth', 'L') + getZone(spline[i], 'curbYellowWidth', 'L') + getZone(spline[i], 'curbRedWidth', 'L') + getZone(spline[i], 'grassWidth', 'L') + getZone(spline[i], 'sandWidth', 'L') + getZone(spline[i], 'gravelWidth', 'L')) * sL + corridor.wallTL[i];
      const distR = hw + (getZone(spline[i], 'whiteLineWidth', 'R') + getZone(spline[i], 'curbYellowWidth', 'R') + getZone(spline[i], 'curbRedWidth', 'R') + getZone(spline[i], 'grassWidth', 'R') + getZone(spline[i], 'sandWidth', 'R') + getZone(spline[i], 'gravelWidth', 'R')) * sR + corridor.wallTR[i];
      wallOuterDistL.push(distL);
      wallOuterDistR.push(distR);
      rawWallBaseInnerL.push(f.pos.clone().add(f.side.clone().multiplyScalar(distL - corridor.wallTL[i])));
      rawWallBaseInnerR.push(f.pos.clone().sub(f.side.clone().multiplyScalar(distR - corridor.wallTR[i])));
    }
    const cleanRoadL = untanglePolyline3D(rawRoadL, isClosed);
    const cleanRoadR = untanglePolyline3D(rawRoadR, isClosed);
    const cleanWallL = roundTightWallCorners3D(untanglePolyline3D(rawWallBaseInnerL, isClosed), isClosed, 12.0);
    const cleanWallR = roundTightWallCorners3D(untanglePolyline3D(rawWallBaseInnerR, isClosed), isClosed, 12.0);

    // Smooth wall base Y along each side so sloped hairpins never form a vertical step ("degrau")
    const smoothWallY = (wallPts: THREE.Vector3[]) => {
      const len = wallPts.length;
      if (len < 5) return;
      for (let pass = 0; pass < 6; pass++) {
        const nextY = new Array<number>(len);
        for (let i = 0; i < len; i++) {
          if (!isClosed && (i === 0 || i === len - 1)) {
            nextY[i] = wallPts[i].y;
            continue;
          }
          const prev = wallPts[(i - 1 + len) % len];
          const curr = wallPts[i];
          const next = wallPts[(i + 1) % len];
          const dP = Math.hypot(curr.x - prev.x, curr.z - prev.z);
          const dN = Math.hypot(next.x - curr.x, next.z - curr.z);
          const wP = dP < 10.0 ? 0.25 : 0;
          const wN = dN < 10.0 ? 0.25 : 0;
          nextY[i] = prev.y * wP + curr.y * (1 - wP - wN) + next.y * wN;
        }
        for (let i = 0; i < len; i++) wallPts[i].y = nextY[i];
      }
    };
    smoothWallY(cleanWallL);
    smoothWallY(cleanWallR);

    const { pillarGeo, crossBeamGeo, overpassMask: rawOverpassMask } = computeBridgePillars(
      frames,
      spline,
      isClosed,
      wallOuterDistL,
      wallOuterDistR,
      branches,
      pitSpline,
      groundY,
      showEmbankments
    );
    const isBridgeOverpass = rawOverpassMask;

    // Gera??o dos v?rtices de cada uma das 15 zonas
    for (let i = 0; i < N; i++) {
      const f = frames[i];
      const hw = f.cross.halfWidth;
      let sL = scaleLArray[i];
      let sR = scaleRArray[i];
      if (suppressCurbsL[i]) sL = 0;
      if (suppressCurbsR[i]) sR = 0;
      if (pitEntryTrackIdx >= 0 && pitZoneLength > 0) {
        const relIdx = (i - pitEntryTrackIdx + N) % N;
        if (relIdx <= pitZoneLength) {
          if (pitIsOnLeftSide) sL = 0;
          else sR = 0;
        }
      }
      const wallTL = corridor.wallTL[i];
      const wallTR = corridor.wallTR[i];

      const wWhiteL = getZone(spline[i], 'whiteLineWidth', 'L') * sL;
      const wWhiteR = getZone(spline[i], 'whiteLineWidth', 'R') * sR;
      const wYellowL = getZone(spline[i], 'curbYellowWidth', 'L') * sL;
      const wYellowR = getZone(spline[i], 'curbYellowWidth', 'R') * sR;
      const wRedL = getZone(spline[i], 'curbRedWidth', 'L') * sL;
      const wRedR = getZone(spline[i], 'curbRedWidth', 'R') * sR;
      const wGrassL = getZone(spline[i], 'grassWidth', 'L') * sL;
      const wGrassR = getZone(spline[i], 'grassWidth', 'R') * sR;
      const wSandL = getZone(spline[i], 'sandWidth', 'L') * sL;
      const wSandR = getZone(spline[i], 'sandWidth', 'R') * sR;
      const wGravelL = getZone(spline[i], 'gravelWidth', 'L') * sL;
      const wGravelR = getZone(spline[i], 'gravelWidth', 'R') * sR;

      // 1. Asfalto Central (suporta cores por nó com gradiente suave)
      const pRoadL = rawRoadL[i];
      const pRoadR = rawRoadR[i];
      const pBermStartL = cleanRoadL[i];
      const pBermStartR = cleanRoadR[i];
      const pWallBaseInnerL = new THREE.Vector3(cleanWallL[i].x, cleanWallL[i].y, cleanWallL[i].z);
      const pWallBaseInnerR = new THREE.Vector3(cleanWallR[i].x, cleanWallR[i].y, cleanWallR[i].z);

      const isPinchedL =
        !suppressWallL[i] &&
        (pBermStartL.distanceToSquared(pRoadL) > 0.02 ||
          pWallBaseInnerL.distanceToSquared(rawWallBaseInnerL[i]) > 0.02 ||
          pWallBaseInnerL.clone().sub(pBermStartL).dot(f.side) <= 0.2);
      const isPinchedR =
        !suppressWallR[i] &&
        (pBermStartR.distanceToSquared(pRoadR) > 0.02 ||
          pWallBaseInnerR.distanceToSquared(rawWallBaseInnerR[i]) > 0.02 ||
          pBermStartR.clone().sub(pWallBaseInnerR).dot(f.side) <= 0.2);

      roadVerts.push(pBermStartL.x, pBermStartL.y, pBermStartL.z);
      roadVerts.push(pBermStartR.x, pBermStartR.y, pBermStartR.z);
      const cRoad = parseColorRGB(spline[i].asphaltColor, asphaltColor);
      roadColors.push(...cRoad, ...cRoad);
      const cWhite = parseColorRGB(spline[i].whiteLineColor, '#ffffff');
      whiteLineColors.push(...cWhite, ...cWhite, ...cWhite, ...cWhite);
      const cPinchRed: [number, number, number] = [0.78, 0.005, 0.005];
      const cYellowBase = parseColorRGB(spline[i].curbYellowColor, themeConfig.curbWarningColor);
      const cRedBase = parseColorRGB(spline[i].curbRedColor, themeConfig.curbApexColor);
      const cGrassBase = parseColorRGB(spline[i].grassColor, grassColor);
      const cSandBase = parseColorRGB(spline[i].sandColor, themeConfig.sandColor || '#d97706');
      const cGravelBase = parseColorRGB(spline[i].gravelColor, themeConfig.gravelColor || '#78716c');

      const cYellowL = cYellowBase;
      const cYellowR = cYellowBase;
      yellowCurbsColors.push(...cYellowL, ...cYellowL, ...cYellowR, ...cYellowR);

      const cRedL = cRedBase;
      const cRedR = cRedBase;
      redCurbsColors.push(...cRedL, ...cRedL, ...cRedR, ...cRedR);

      const cGrassL = cGrassBase;
      const cGrassR = cGrassBase;
      grassShoulderColors.push(...cGrassL, ...cGrassL, ...cGrassR, ...cGrassR);

      const cSandL = cSandBase;
      const cSandR = cSandBase;
      sandColors.push(...cSandL, ...cSandL, ...cSandR, ...cSandR);

      const cGravelL = cGravelBase;
      const cGravelR = cGravelBase;
      gravelColors.push(...cGravelL, ...cGravelL, ...cGravelR, ...cGravelR);

      const cWall = parseColorRGB(spline[i].wallColor, wallColor);
      guardrailLeftColors.push(...cWall, ...cWall, ...cWall, ...cWall);
      guardrailRightColors.push(...cWall, ...cWall, ...cWall, ...cWall);

      const totalBermL = Math.max(0.0001, wWhiteL + wYellowL + wRedL + wGrassL + wSandL + wGravelL);
      const totalBermR = Math.max(0.0001, wWhiteR + wYellowR + wRedR + wGrassR + wSandR + wGravelR);

      const fWhiteL = wWhiteL / totalBermL;
      const fYellowL = (wWhiteL + wYellowL) / totalBermL;
      const fRedL = (wWhiteL + wYellowL + wRedL) / totalBermL;
      const fGrassL = (wWhiteL + wYellowL + wRedL + wGrassL) / totalBermL;
      const fSandL = (wWhiteL + wYellowL + wRedL + wGrassL + wSandL) / totalBermL;

      const fWhiteR = wWhiteR / totalBermR;
      const fYellowR = (wWhiteR + wYellowR) / totalBermR;
      const fRedR = (wWhiteR + wYellowR + wRedR) / totalBermR;
      const fGrassR = (wWhiteR + wYellowR + wRedR + wGrassR) / totalBermR;
      const fSandR = (wWhiteR + wYellowR + wRedR + wGrassR + wSandR) / totalBermR;

      // Interpolar TODAS as camadas entre a borda deslaçada (pBermStart) e o muro deslaçado (pWallBaseInner)
      // 2. Linha Branca
      const pWhiteL = pBermStartL.clone().lerp(pWallBaseInnerL, fWhiteL).add(f.up.clone().multiplyScalar(0.012));
      const pWhiteR = pBermStartR.clone().lerp(pWallBaseInnerR, fWhiteR).add(f.up.clone().multiplyScalar(0.012));
      whiteLineVerts.push(pBermStartL.x, pBermStartL.y, pBermStartL.z);
      whiteLineVerts.push(pWhiteL.x, pWhiteL.y, pWhiteL.z);
      whiteLineVerts.push(pBermStartR.x, pBermStartR.y, pBermStartR.z);
      whiteLineVerts.push(pWhiteR.x, pWhiteR.y, pWhiteR.z);

      // 3. Berma (faixa 1)
      const pYellowL = pBermStartL.clone().lerp(pWallBaseInnerL, fYellowL).add(f.up.clone().multiplyScalar(0.014));
      const pYellowR = pBermStartR.clone().lerp(pWallBaseInnerR, fYellowR).add(f.up.clone().multiplyScalar(0.014));
      yellowCurbsVerts.push(pWhiteL.x, pWhiteL.y, pWhiteL.z);
      yellowCurbsVerts.push(pYellowL.x, pYellowL.y, pYellowL.z);
      yellowCurbsVerts.push(pWhiteR.x, pWhiteR.y, pWhiteR.z);
      yellowCurbsVerts.push(pYellowR.x, pYellowR.y, pYellowR.z);

      // 4. Berma (faixa 2)
      const pRedL = pBermStartL.clone().lerp(pWallBaseInnerL, fRedL).add(f.up.clone().multiplyScalar(0.014));
      const pRedR = pBermStartR.clone().lerp(pWallBaseInnerR, fRedR).add(f.up.clone().multiplyScalar(0.014));
      redCurbsVerts.push(pYellowL.x, pYellowL.y, pYellowL.z);
      redCurbsVerts.push(pRedL.x, pRedL.y, pRedL.z);
      redCurbsVerts.push(pYellowR.x, pYellowR.y, pYellowR.z);
      redCurbsVerts.push(pRedR.x, pRedR.y, pRedR.z);

      // 5. Berma (faixa 3)
      const pGrassL = pBermStartL.clone().lerp(pWallBaseInnerL, fGrassL);
      const pGrassR = pBermStartR.clone().lerp(pWallBaseInnerR, fGrassR);
      grassShoulderVerts.push(pRedL.x, pRedL.y, pRedL.z);
      grassShoulderVerts.push(pGrassL.x, pGrassL.y, pGrassL.z);
      grassShoulderVerts.push(pRedR.x, pRedR.y, pRedR.z);
      grassShoulderVerts.push(pGrassR.x, pGrassR.y, pGrassR.z);

      // 6. Berma (faixa 4)
      const pSandL = pBermStartL.clone().lerp(pWallBaseInnerL, fSandL);
      const pSandR = pBermStartR.clone().lerp(pWallBaseInnerR, fSandR);
      sandVerts.push(pGrassL.x, pGrassL.y, pGrassL.z);
      sandVerts.push(pSandL.x, pSandL.y, pSandL.z);
      sandVerts.push(pGrassR.x, pGrassR.y, pGrassR.z);
      sandVerts.push(pSandR.x, pSandR.y, pSandR.z);

      // 7. Berma (faixa 5 até ao muro)
      const pGravelL = pWallBaseInnerL.clone();
      const pGravelR = pWallBaseInnerR.clone();
      gravelVerts.push(pSandL.x, pSandL.y, pSandL.z);
      gravelVerts.push(pGravelL.x, pGravelL.y, pGravelL.z);
      gravelVerts.push(pSandR.x, pSandR.y, pSandR.z);
      gravelVerts.push(pGravelR.x, pGravelR.y, pGravelR.z);

      // 8. Muros de Betão (Fundidos no contorno limpo e arredondado)
      const wallHL = barrierHeight;
      const wallHR = barrierHeight;

      const pWallTopInnerL = pWallBaseInnerL.clone().add(new THREE.Vector3(0, wallHL, 0));
      const pWallTopOuterL = pWallTopInnerL.clone().add(f.side.clone().multiplyScalar(wallTL));
      const pWallBaseOuterL = pWallBaseInnerL.clone().add(f.side.clone().multiplyScalar(wallTL));

      guardrailLeftVerts.push(pWallBaseInnerL.x, pWallBaseInnerL.y, pWallBaseInnerL.z);
      guardrailLeftVerts.push(pWallTopInnerL.x, pWallTopInnerL.y, pWallTopInnerL.z);
      guardrailLeftVerts.push(pWallTopOuterL.x, pWallTopOuterL.y, pWallTopOuterL.z);
      guardrailLeftVerts.push(pWallBaseOuterL.x, pWallBaseOuterL.y, pWallBaseOuterL.z);

      const pWallTopInnerR = pWallBaseInnerR.clone().add(new THREE.Vector3(0, wallHR, 0));
      const pWallTopOuterR = pWallTopInnerR.clone().sub(f.side.clone().multiplyScalar(wallTR));
      const pWallBaseOuterR = pWallBaseInnerR.clone().sub(f.side.clone().multiplyScalar(wallTR));

      guardrailRightVerts.push(pWallBaseInnerR.x, pWallBaseInnerR.y, pWallBaseInnerR.z);
      guardrailRightVerts.push(pWallTopInnerR.x, pWallTopInnerR.y, pWallTopInnerR.z);
      guardrailRightVerts.push(pWallTopOuterR.x, pWallTopOuterR.y, pWallTopOuterR.z);
      guardrailRightVerts.push(pWallBaseOuterR.x, pWallBaseOuterR.y, pWallBaseOuterR.z);

      // 9. Talude / Terreno Exterior
      const isOverpass = isBridgeOverpass[i];
      const isElevated = f.pos.y > 0.5;

      let pEmbankL: THREE.Vector3;
      let pEmbankR: THREE.Vector3;

      if (isOverpass) {
        pEmbankL = pWallBaseOuterL.clone().add(new THREE.Vector3(0, -0.8, 0));
        pEmbankR = pWallBaseOuterR.clone().add(new THREE.Vector3(0, -0.8, 0));
      } else {
        const heightAboveFloor = Math.max(0, f.pos.y - groundY);
        const baseSlope = isElevated || heightAboveFloor > 1.0 ? Math.min(22, 6.0 + heightAboveFloor * 1.1) : 6.0;

        const computeSafeEmbankPoint = (
          pWallOuter: THREE.Vector3,
          outDirX: number,
          outDirZ: number,
          desiredSlope: number
        ): THREE.Vector3 => {
          let maxSafe = desiredSlope;
          for (let j = 0; j < N; j++) {
            const ringDiff = isClosed ? Math.min(Math.abs(i - j), N - Math.abs(i - j)) : Math.abs(i - j);
            if (ringDiff <= 10) continue;
            const q = frames[j];
            const dx = q.pos.x - pWallOuter.x;
            const dz = q.pos.z - pWallOuter.z;
            const roadClear = q.cross.halfWidth + 8.5;
            if (Math.abs(dx) > desiredSlope + roadClear || Math.abs(dz) > desiredSlope + roadClear) continue;
            const along = dx * outDirX + dz * outDirZ;
            const perp = Math.abs(dx * -outDirZ + dz * outDirX);
            if (along > -roadClear && along < maxSafe + roadClear && perp < roadClear) {
              maxSafe = Math.min(maxSafe, Math.max(0, along - roadClear));
            }
          }
          if (maxSafe < 1.5 && f.pos.y > groundY + 2.0) {
            return pWallOuter.clone().add(new THREE.Vector3(0, -0.8, 0));
          }
          return new THREE.Vector3(
            pWallOuter.x + outDirX * maxSafe,
            groundY - 0.25,
            pWallOuter.z + outDirZ * maxSafe
          );
        };

        let dirL = f.side;
        if (isPinchedL) {
          const wPrev = cleanWallL[(i - 1 + N) % N];
          const wNext = cleanWallL[(i + 1) % N];
          const wx = wNext.x - wPrev.x;
          const wz = wNext.z - wPrev.z;
          const wLen = Math.hypot(wx, wz);
          if (wLen > 0.001) {
            dirL = new THREE.Vector3(-wz / wLen, 0, wx / wLen);
          }
        }
        const slopeDistL = isPinchedL ? Math.min(baseSlope, 3.5) : baseSlope;
        pEmbankL = computeSafeEmbankPoint(pWallBaseOuterL, dirL.x, dirL.z, slopeDistL);

        let dirR = f.side;
        if (isPinchedR) {
          const wPrev = cleanWallR[(i - 1 + N) % N];
          const wNext = cleanWallR[(i + 1) % N];
          const wx = wNext.x - wPrev.x;
          const wz = wNext.z - wPrev.z;
          const wLen = Math.hypot(wx, wz);
          if (wLen > 0.001) {
            dirR = new THREE.Vector3(-wz / wLen, 0, wx / wLen);
          }
        }
        const slopeDistR = isPinchedR ? Math.min(baseSlope, 3.5) : baseSlope;
        pEmbankR = computeSafeEmbankPoint(pWallBaseOuterR, -dirR.x, -dirR.z, slopeDistR);
      }

      embankmentVerts.push(pWallBaseOuterL.x, pWallBaseOuterL.y, pWallBaseOuterL.z);
      embankmentVerts.push(pEmbankL.x, pEmbankL.y, pEmbankL.z);
      embankmentVerts.push(pWallBaseOuterR.x, pWallBaseOuterR.y, pWallBaseOuterR.z);
      embankmentVerts.push(pEmbankR.x, pEmbankR.y, pEmbankR.z);

    }

    // Indexação dos Quads ao longo da pista
    const maxSegments = isClosed ? N : N - 1;
    for (let i = 0; i < maxSegments; i++) {
      const nextIdx = (i + 1) % N;
      const f = frames[i];
      const fNext = frames[nextIdx];

      // Road (2 vértices por frame: 0=L, 1=R)
      const r0 = 2 * i;
      const rn0 = 2 * nextIdx;
      roadIndices.push(r0, rn0, r0 + 1);
      roadIndices.push(r0 + 1, rn0, rn0 + 1);
      const isBridgeSeg = isBridgeOverpass[i] || isBridgeOverpass[nextIdx];
      if (isBridgeSeg) {
        bridgeRoadIndices.push(r0, rn0, r0 + 1);
        bridgeRoadIndices.push(r0 + 1, rn0, rn0 + 1);
      }

      // Bandas (4 vértices por frame: 0=L_in, 1=L_out, 2=R_in, 3=R_out)
      const b0 = 4 * i;
      const bn0 = 4 * nextIdx;

      // Linha Branca & Zebras Esquerdas
      if (!suppressCurbsL[i] && !suppressCurbsL[nextIdx]) {
        whiteLineIndices.push(b0, bn0, b0 + 1);
        whiteLineIndices.push(b0 + 1, bn0, bn0 + 1);
        yellowCurbsIndices.push(b0, bn0, b0 + 1);
        yellowCurbsIndices.push(b0 + 1, bn0, bn0 + 1);
        redCurbsIndices.push(b0, bn0, b0 + 1);
        redCurbsIndices.push(b0 + 1, bn0, bn0 + 1);
        grassShoulderIndices.push(b0, bn0, b0 + 1);
        grassShoulderIndices.push(b0 + 1, bn0, bn0 + 1);
        sandIndices.push(b0, bn0, b0 + 1);
        sandIndices.push(b0 + 1, bn0, bn0 + 1);
        gravelIndices.push(b0, bn0, b0 + 1);
        gravelIndices.push(b0 + 1, bn0, bn0 + 1);
        if (isBridgeSeg) {
          bridgeWhiteIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
          bridgeYellowIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
          bridgeRedIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
          bridgeGrassIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
          bridgeSandIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
          bridgeGravelIndices.push(b0, bn0, b0 + 1, b0 + 1, bn0, bn0 + 1);
        }
      }

      // Linha Branca & Zebras Direitas
      if (!suppressCurbsR[i] && !suppressCurbsR[nextIdx]) {
        whiteLineIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        whiteLineIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        yellowCurbsIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        yellowCurbsIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        redCurbsIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        redCurbsIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        grassShoulderIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        grassShoulderIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        sandIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        sandIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        gravelIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        gravelIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
        if (isBridgeSeg) {
          bridgeWhiteIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
          bridgeYellowIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
          bridgeRedIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
          bridgeGrassIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
          bridgeSandIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
          bridgeGravelIndices.push(b0 + 2, b0 + 3, bn0 + 2, b0 + 3, bn0 + 3, bn0 + 2);
        }
      }

      // Embankment: Only generate if neither of the frames is on a bridge overpass
      if (!isBridgeOverpass[i] && !isBridgeOverpass[nextIdx]) {
        embankmentIndices.push(b0, bn0, b0 + 1);
        embankmentIndices.push(b0 + 1, bn0, bn0 + 1);
        embankmentIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        embankmentIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
      }

      // Fechar a "manta verde" / talude nos encontros de ponte para não se ver o interior oco:
      // Se um frame tem talude de terra e o outro entra no viaduto/ponte, geramos uma parede vertical transversal de fecho.
      if (!isBridgeOverpass[i] && isBridgeOverpass[nextIdx] && f.pos.y > groundY + 0.85) {
        // Encontro à entrada do viaduto: fechar corte transversal no frame i
        // Lado esquerdo: pWallBaseOuterL(b0) -> pEmbankL(b0+1) descendo até ao chão
        embankmentIndices.push(b0, b0 + 1, b0 + 2);
        embankmentIndices.push(b0 + 2, b0 + 1, b0 + 3);
      } else if (isBridgeOverpass[i] && !isBridgeOverpass[nextIdx] && fNext.pos.y > groundY + 0.85) {
        // Encontro à saída do viaduto: fechar corte transversal no frame nextIdx
        embankmentIndices.push(bn0, bn0 + 2, bn0 + 1);
        embankmentIndices.push(bn0 + 2, bn0 + 3, bn0 + 1);
      }

      const l0 = 4 * i;
      const ln0 = 4 * nextIdx;
      if (!suppressWallL[i] && !suppressWallL[nextIdx]) {
        guardrailLeftIndices.push(l0, ln0, l0 + 1);
        guardrailLeftIndices.push(l0 + 1, ln0, ln0 + 1);
        guardrailLeftIndices.push(l0 + 1, ln0 + 1, l0 + 2);
        guardrailLeftIndices.push(l0 + 2, ln0 + 1, ln0 + 2);
        guardrailLeftIndices.push(l0 + 2, ln0 + 2, l0 + 3);
        guardrailLeftIndices.push(l0 + 3, ln0 + 2, ln0 + 3);
        if (isBridgeSeg) {
          bridgeWallLIndices.push(
            l0, ln0, l0 + 1, l0 + 1, ln0, ln0 + 1,
            l0 + 1, ln0 + 1, l0 + 2, l0 + 2, ln0 + 1, ln0 + 2,
            l0 + 2, ln0 + 2, l0 + 3, l0 + 3, ln0 + 2, ln0 + 3
          );
        }
      }

      // Muro Direito: Apenas gerado se NÃO estiver suprimido no bico agudo
      const wr0 = 4 * i;
      const wrn0 = 4 * nextIdx;
      if (!suppressWallR[i] && !suppressWallR[nextIdx]) {
        guardrailRightIndices.push(wr0, wr0 + 1, wrn0);
        guardrailRightIndices.push(wr0 + 1, wrn0 + 1, wrn0);
        guardrailRightIndices.push(wr0 + 1, wr0 + 2, wrn0 + 1);
        guardrailRightIndices.push(wr0 + 2, wrn0 + 2, wrn0 + 1);
        guardrailRightIndices.push(wr0 + 2, wr0 + 3, wrn0 + 2);
        guardrailRightIndices.push(wr0 + 3, wrn0 + 3, wrn0 + 2);
        if (isBridgeSeg) {
          bridgeWallRIndices.push(
            wr0, wr0 + 1, wrn0, wr0 + 1, wrn0 + 1, wrn0,
            wr0 + 1, wr0 + 2, wrn0 + 1, wr0 + 2, wrn0 + 2, wrn0 + 1,
            wr0 + 2, wr0 + 3, wrn0 + 2, wr0 + 3, wrn0 + 3, wrn0 + 2
          );
        }
      }

      // Outlines (SketchUp): Linhas limpas sem nós cruzados nos bicos
      const pRoadLeft = new THREE.Vector3(roadVerts[r0 * 3], roadVerts[r0 * 3 + 1], roadVerts[r0 * 3 + 2]);
      const pRoadRight = new THREE.Vector3(roadVerts[(r0 + 1) * 3], roadVerts[(r0 + 1) * 3 + 1], roadVerts[(r0 + 1) * 3 + 2]);
      const pNextRoadLeft = new THREE.Vector3(roadVerts[rn0 * 3], roadVerts[rn0 * 3 + 1], roadVerts[rn0 * 3 + 2]);
      const pNextRoadRight = new THREE.Vector3(roadVerts[(rn0 + 1) * 3], roadVerts[(rn0 + 1) * 3 + 1], roadVerts[(rn0 + 1) * 3 + 2]);

      // APENAS AS ARESTAS EXTERIORES DA ESTRADA (Vermelho Vivo) - Nunca desenha arestas no meio de junções
      if (!suppressWallL[i] && !suppressWallL[nextIdx]) {
        edgeLines.push(
          pRoadLeft.x, pRoadLeft.y + 0.04, pRoadLeft.z,
          pNextRoadLeft.x, pNextRoadLeft.y + 0.04, pNextRoadLeft.z
        );
      }
      if (!suppressWallR[i] && !suppressWallR[nextIdx]) {
        edgeLines.push(
          pRoadRight.x, pRoadRight.y + 0.04, pRoadRight.z,
          pNextRoadRight.x, pNextRoadRight.y + 0.04, pNextRoadRight.z
        );
      }
    }

    const createGeo = (v: number[], ind: number[], colors?: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      if (colors && colors.length === v.length) {
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      }
      geo.setIndex(ind);
      geo.computeVertexNormals();
      return geo;
    };

    const roadGeo = createGeo(roadVerts, roadIndices, roadColors);
    if (roadColors.length === roadVerts.length) {
      roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(roadColors, 3));
    }
    const bridgeRoadGeo = bridgeRoadIndices.length > 0 ? createGeo(roadVerts, bridgeRoadIndices, roadColors) : null;
    const bridgeWhiteGeo = bridgeWhiteIndices.length > 0 ? createGeo(whiteLineVerts, bridgeWhiteIndices, whiteLineColors) : null;
    const bridgeYellowGeo = bridgeYellowIndices.length > 0 ? createGeo(yellowCurbsVerts, bridgeYellowIndices, yellowCurbsColors) : null;
    const bridgeRedGeo = bridgeRedIndices.length > 0 ? createGeo(redCurbsVerts, bridgeRedIndices, redCurbsColors) : null;
    const bridgeGrassGeo = bridgeGrassIndices.length > 0 ? createGeo(grassShoulderVerts, bridgeGrassIndices, grassShoulderColors) : null;
    const bridgeSandGeo = bridgeSandIndices.length > 0 ? createGeo(sandVerts, bridgeSandIndices, sandColors) : null;
    const bridgeGravelGeo = bridgeGravelIndices.length > 0 ? createGeo(gravelVerts, bridgeGravelIndices, gravelColors) : null;
    const bridgeWallLGeo = bridgeWallLIndices.length > 0 ? createGeo(guardrailLeftVerts, bridgeWallLIndices, guardrailLeftColors) : null;
    const bridgeWallRGeo = bridgeWallRIndices.length > 0 ? createGeo(guardrailRightVerts, bridgeWallRIndices, guardrailRightColors) : null;

    // 9.5 Túnel Opcional por Ponto (funciona a qualquer elevação: -16m, 0m, +40m...)
    const tunnelVerts: number[] = [];
    const tunnelIndices: number[] = [];
    const tunnelPortalVerts: number[] = [];
    const tunnelPortalIndices: number[] = [];
    const candidateTunnelLights: { pos: THREE.Vector3; rotY: number }[] = [];
    const tunnelLightVerts: number[] = [];
    const tunnelLightIndices: number[] = [];

    const appendTunnelFromFrames = (
      srcFrames: Array<{ pos: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; tangent: THREE.Vector3 }>,
      tunnelMask: boolean[],
      wLArr: number[],
      wRArr: number[],
      closed: boolean
    ) => {
      const len = srcFrames.length;
      if (len < 2 || !tunnelMask.some(Boolean)) return;

      const maxSeg = closed ? len : len - 1;
      const segActive: boolean[] = new Array(maxSeg);
      let anySeg = false;
      for (let i = 0; i < maxSeg; i++) {
        const nextIdx = (i + 1) % len;
        const active = Boolean(tunnelMask[i] && tunnelMask[nextIdx]);
        segActive[i] = active;
        if (active) anySeg = true;
      }
      if (!anySeg) return;

      const baseV = tunnelVerts.length / 3;
      const getCrossPts = (idx: number) => {
        const f = srcFrames[idx];
        const wL = wLArr[idx];
        const wR = wRArr[idx];
        return [
          f.pos.clone().addScaledVector(f.side, wL).addScaledVector(f.up, -0.5),
          f.pos.clone().addScaledVector(f.side, wL * 0.92).addScaledVector(f.up, 7.8),
          f.pos.clone().addScaledVector(f.up, 9.8),
          f.pos.clone().addScaledVector(f.side, -wR * 0.92).addScaledVector(f.up, 7.8),
          f.pos.clone().addScaledVector(f.side, -wR).addScaledVector(f.up, -0.5),
        ];
      };

      for (let i = 0; i < len; i++) {
        const pts = getCrossPts(i);
        for (const p of pts) tunnelVerts.push(p.x, p.y, p.z);
        if (tunnelMask[i] && i % 10 === 0) {
          const f = srcFrames[i];
          const rotY = Math.atan2(f.tangent.x, f.tangent.z);
          candidateTunnelLights.push({ pos: f.pos.clone().addScaledVector(f.up, 8.6), rotY });
        }
      }

      const pushPortal = (idx: number, dirSign: number) => {
        const f = srcFrames[idx];
        const wL = wLArr[idx];
        const wR = wRArr[idx];
        const inner = getCrossPts(idx);
        const outer = [
          f.pos.clone().addScaledVector(f.side, wL + 1.1).addScaledVector(f.up, -0.5),
          f.pos.clone().addScaledVector(f.side, wL * 0.92 + 1.1).addScaledVector(f.up, 7.8 + 1.1),
          f.pos.clone().addScaledVector(f.up, 9.8 + 1.1),
          f.pos.clone().addScaledVector(f.side, -(wR * 0.92 + 1.1)).addScaledVector(f.up, 7.8 + 1.1),
          f.pos.clone().addScaledVector(f.side, -(wR + 1.1)).addScaledVector(f.up, -0.5),
        ];
        const tanOff = f.tangent.clone().multiplyScalar(dirSign * 0.7);
        const pBase = tunnelPortalVerts.length / 3;
        // Ring 0 (0..4): outer mouth inner pts; Ring 1 (5..9): outer mouth outer pts
        for (const p of inner) tunnelPortalVerts.push(p.x + tanOff.x, p.y + tanOff.y, p.z + tanOff.z);
        for (const p of outer) tunnelPortalVerts.push(p.x + tanOff.x, p.y + tanOff.y, p.z + tanOff.z);
        // Ring 2 (10..14): flush inner pts; Ring 3 (15..19): flush outer pts
        for (const p of inner) tunnelPortalVerts.push(p.x, p.y, p.z);
        for (const p of outer) tunnelPortalVerts.push(p.x, p.y, p.z);

        for (let k = 0; k < 4; k++) {
          const i0 = pBase + k;
          const i1 = pBase + k + 1;
          const o0 = pBase + 5 + k;
          const o1 = pBase + 5 + k + 1;
          const fi0 = pBase + 10 + k;
          const fi1 = pBase + 10 + k + 1;
          const fo0 = pBase + 15 + k;
          const fo1 = pBase + 15 + k + 1;
          // Front collar face
          tunnelPortalIndices.push(i0, o0, i1, i1, o0, o1);
          // Back collar face
          tunnelPortalIndices.push(fi0, fi1, fo0, fi1, fo1, fo0);
          // Outer rim
          tunnelPortalIndices.push(o0, fo0, o1, o1, fo0, fo1);
          // Inner rim
          tunnelPortalIndices.push(i0, i1, fi0, i1, fi1, fi0);
        }
      };

      for (let i = 0; i < maxSeg; i++) {
        if (!segActive[i]) continue;
        const nextIdx = (i + 1) % len;

        const a = baseV + i * 5;
        const b = baseV + nextIdx * 5;
        for (let k = 0; k < 4; k++) {
          tunnelIndices.push(a + k, b + k, a + k + 1);
          tunnelIndices.push(a + k + 1, b + k, b + k + 1);
        }

        if (i % 4 === 0) {
          const fA = srcFrames[i];
          const fB = srcFrames[nextIdx];
          const vBase = tunnelLightVerts.length / 3;
          const stripW = 1.1;
          const l1 = fA.pos.clone().addScaledVector(fA.side, stripW).addScaledVector(fA.up, 9.45);
          const r1 = fA.pos.clone().addScaledVector(fA.side, -stripW).addScaledVector(fA.up, 9.45);
          const l2 = fB.pos.clone().addScaledVector(fB.side, stripW).addScaledVector(fB.up, 9.45);
          const r2 = fB.pos.clone().addScaledVector(fB.side, -stripW).addScaledVector(fB.up, 9.45);
          tunnelLightVerts.push(l1.x, l1.y, l1.z, r1.x, r1.y, r1.z, l2.x, l2.y, l2.z, r2.x, r2.y, r2.z);
          tunnelLightIndices.push(vBase, vBase + 2, vBase + 1, vBase + 1, vBase + 2, vBase + 3);
        }

        const isRunStart = closed ? !segActive[(i - 1 + maxSeg) % maxSeg] : (i === 0 || !segActive[i - 1]);
        const isRunEnd = closed ? !segActive[(i + 1) % maxSeg] : (i === maxSeg - 1 || !segActive[i + 1]);
        if (isRunStart) pushPortal(i, -1);
        if (isRunEnd) pushPortal(nextIdx, 1);
      }
    };

    const mainTunnelMask = spline.map((s) => Boolean(s.isTunnel));
    const mainTunnelWL = wallOuterDistL.map((d, i) => Math.max(frames[i].cross.halfWidth + 0.5, d));
    const mainTunnelWR = wallOuterDistR.map((d, i) => Math.max(frames[i].cross.halfWidth + 0.5, d));
    appendTunnelFromFrames(frames, mainTunnelMask, mainTunnelWL, mainTunnelWR, isClosed);

    if (branches && branches.length > 0) {
      for (const b of branches) {
        if (!b.points || b.points.length < 2 || !b.points.some((p) => p.isTunnel)) continue;
        const dense = computeSpline(b.points, false);
        const M = dense.length;
        if (M < 2) continue;
        const bFrames: Array<{ pos: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; tangent: THREE.Vector3 }> = [];
        const bWL: number[] = [];
        const bWR: number[] = [];
        const bMask: boolean[] = [];
        for (let i = 0; i < M; i++) {
          const curr = dense[i];
          const prev = dense[Math.max(0, i - 1)];
          const next = dense[Math.min(M - 1, i + 1)];
          const pCurr = new THREE.Vector3(curr.x, curr.z ?? 0, curr.y);
          const pPrev = new THREE.Vector3(prev.x, prev.z ?? 0, prev.y);
          const pNext = new THREE.Vector3(next.x, next.z ?? 0, next.y);
          let tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
          if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
          let up = new THREE.Vector3(0, 1, 0);
          let side = new THREE.Vector3().crossVectors(tangent, up).normalize();
          if (side.lengthSq() === 0) side.set(0, 0, 1);
          up = new THREE.Vector3().crossVectors(side, tangent).normalize();
          const hw = (curr.width || 18) / 2;
          if (curr.banking) {
            const bankingRad = (curr.banking * Math.PI) / 180;
            side.applyAxisAngle(tangent, bankingRad);
            up.applyAxisAngle(tangent, bankingRad);
            pCurr.y += Math.abs(Math.sin(bankingRad)) * hw;
          }
          bFrames.push({ pos: pCurr, side, up, tangent });
          bWL.push(hw + bermaWidth(curr, 'L') + getZone(curr, 'wallThickness', 'L'));
          bWR.push(hw + bermaWidth(curr, 'R') + getZone(curr, 'wallThickness', 'R'));
          bMask.push(Boolean(curr.isTunnel));
        }
        appendTunnelFromFrames(bFrames, bMask, bWL, bWR, false);
      }
    }

    const tunnelLights =
      candidateTunnelLights.length <= 16
        ? candidateTunnelLights
        : Array.from({ length: 16 }, (_, k) =>
            candidateTunnelLights[Math.min(candidateTunnelLights.length - 1, Math.floor((k * candidateTunnelLights.length) / 16))]
          );

    const tunnelGeo = tunnelIndices.length > 0 ? createGeo(tunnelVerts, tunnelIndices) : null;
    const tunnelPortalGeo = tunnelPortalIndices.length > 0 ? createGeo(tunnelPortalVerts, tunnelPortalIndices) : null;
    const tunnelLightGeo = tunnelLightIndices.length > 0 ? createGeo(tunnelLightVerts, tunnelLightIndices) : null;

    const whiteLineGeo = createGeo(whiteLineVerts, whiteLineIndices, whiteLineColors);
    const yellowCurbsGeo = createGeo(yellowCurbsVerts, yellowCurbsIndices, yellowCurbsColors);
    const redCurbsGeo = createGeo(redCurbsVerts, redCurbsIndices, redCurbsColors);
    const grassShoulderGeo = createGeo(grassShoulderVerts, grassShoulderIndices, grassShoulderColors);
    const sandGeo = createGeo(sandVerts, sandIndices, sandColors);
    const gravelGeo = createGeo(gravelVerts, gravelIndices, gravelColors);
    const embankmentGeo = createGeo(embankmentVerts, embankmentIndices);
    const guardrailLeftGeo = createGeo(guardrailLeftVerts, guardrailLeftIndices, guardrailLeftColors);
    const guardrailRightGeo = createGeo(guardrailRightVerts, guardrailRightIndices, guardrailRightColors);

    // Faixa Vermelha de 1.8m nas bordas exteriores do asfalto (bem visível)
    const redRibbonVerts: number[] = [];
    const redRibbonIndices: number[] = [];
    const ribbonW = 1.8;
    for (let i = 0; i < N; i++) {
      const nextIdx = (i + 1) % N;
      const f = frames[i];
      const hw = f.cross.halfWidth;
      const pL = f.pos.clone().add(f.side.clone().multiplyScalar(hw));
      const pR = f.pos.clone().sub(f.side.clone().multiplyScalar(hw));
      const pL_out = pL.clone().add(f.side.clone().multiplyScalar(ribbonW));
      const pR_out = pR.clone().sub(f.side.clone().multiplyScalar(ribbonW));

      const yOff = 0.08;
      redRibbonVerts.push(pL.x, pL.y + yOff, pL.z);
      redRibbonVerts.push(pL_out.x, pL_out.y + yOff, pL_out.z);
      redRibbonVerts.push(pR.x, pR.y + yOff, pR.z);
      redRibbonVerts.push(pR_out.x, pR_out.y + yOff, pR_out.z);

      const b0 = 4 * i;
      const bn0 = 4 * nextIdx;
      if (!suppressWallL[i] && !suppressWallL[nextIdx]) {
        redRibbonIndices.push(b0, bn0, b0 + 1);
        redRibbonIndices.push(b0 + 1, bn0, bn0 + 1);
      }
      if (!suppressWallR[i] && !suppressWallR[nextIdx]) {
        redRibbonIndices.push(b0 + 2, b0 + 3, bn0 + 2);
        redRibbonIndices.push(b0 + 3, bn0 + 3, bn0 + 2);
      }
    }
    const redRibbonGeo = new THREE.BufferGeometry();
    redRibbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(redRibbonVerts, 3));
    redRibbonGeo.setIndex(redRibbonIndices);
    redRibbonGeo.computeVertexNormals();

    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeLines, 3));

    const startF = frames[0];
    const startArchPos = startF.pos.clone().add(new THREE.Vector3(0, 0.1, 0));
    const archRotationY = Math.atan2(startF.tangent.x, startF.tangent.z);
    const startRoadWidth = startF.cross.halfWidth * 2;
    const startPostOffsetL = startF.cross.halfWidth + (spline[0] ? bermaWidth(spline[0], 'L') + getZone(spline[0], 'wallThickness', 'L') : 5.5) + 1.4;
    const startPostOffsetR = -(startF.cross.halfWidth + (spline[0] ? bermaWidth(spline[0], 'R') + getZone(spline[0], 'wallThickness', 'R') : 5.5) + 1.4);

    const finishF = frames[N - 1];
    const finishArchPos = finishF.pos.clone().add(new THREE.Vector3(0, 0.1, 0));
    const finishArchRotationY = Math.atan2(finishF.tangent.x, finishF.tangent.z);
    const finishRoadWidth = finishF.cross.halfWidth * 2;

    return {
      frames,
      pitEntryTrackIdx,
      pitExitTrackIdx,
      pitIsOnLeftSide,
      pitZoneLength,
      roadGeo,
      bridgeRoadGeo,
      bridgeWhiteGeo,
      bridgeYellowGeo,
      bridgeRedGeo,
      bridgeGrassGeo,
      bridgeSandGeo,
      bridgeGravelGeo,
      bridgeWallLGeo,
      bridgeWallRGeo,
      isBridgeOverpass,
      whiteLineGeo,
      yellowCurbsGeo,
      redCurbsGeo,
      grassShoulderGeo,
      sandGeo,
      gravelGeo,
      embankmentGeo,
      guardrailLeftGeo,
      guardrailRightGeo,
      pillarGeo,
      crossBeamGeo,
      tunnelGeo,
      tunnelPortalGeo,
      tunnelLightGeo,
      tunnelLights,
      outlineGeo,
      redRibbonGeo,
      startArchPos,
      archRotationY,
      startRoadWidth,
      startPostOffsetL,
      startPostOffsetR,
      finishArchPos,
      finishArchRotationY,
      finishRoadWidth,
      mainWallData: {
        cleanWallL,
        cleanWallR,
        suppressWallL,
        suppressWallR,
        wallTL: corridor.wallTL,
        wallTR: corridor.wallTR,
        isClosed,
      }
    };
  }, [spline, isClosed, pitSpline, branches, trackThemeId, showEmbankments, groundY]);

  const boxPaintTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 512, 512);
      // Bold high-contrast dark pad for maximum legibility on asphalt
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(14, 14, 484, 484);

      // Thick orange/yellow border & hazard stripes
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 24;
      ctx.strokeRect(20, 20, 472, 472);
      for (let x = 24; x < 488; x += 52) {
        ctx.fillStyle = (Math.floor(x / 52) % 2 === 0) ? '#f59e0b' : '#fde047';
        ctx.fillRect(x, 22, 42, 26);
        ctx.fillRect(x, 464, 42, 26);
      }

      // Large arrow pointing into pit lane
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(256, 68);
      ctx.lineTo(352, 158);
      ctx.lineTo(296, 158);
      ctx.lineTo(296, 214);
      ctx.lineTo(216, 214);
      ctx.lineTo(216, 158);
      ctx.lineTo(160, 158);
      ctx.closePath();
      ctx.fill();

      // Huge crisp "BOX" lettering + "ENTRADA"
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 148px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BOX', 256, 312);

      ctx.fillStyle = '#fbbf24';
      ctx.font = '900 62px system-ui, -apple-system, sans-serif';
      ctx.fillText('ENTRADA', 256, 420);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const boxExitTex = useMemo(() => makePitExitTexture(), []);

  const boxApproachTextures = useMemo(() => ({
    left300: makeBoxApproachTexture('300m', -0.35),
    left200: makeBoxApproachTexture('200m', -0.35),
    left100: makeBoxApproachTexture('100m', -0.35),
    right300: makeBoxApproachTexture('300m', 0.35),
    right200: makeBoxApproachTexture('200m', 0.35),
    right100: makeBoxApproachTexture('100m', 0.35),
  }), []);

  // F1 Staggered Starting Grid Markings on the asphalt behind Start/Finish
  const startingGridData = useMemo(() => {
    if (!spline || spline.length < 6) return null;
    const sampler = buildSplineArcSampler(spline, isClosed);
    if (sampler.totalLen < 60) return null;

    const wVerts: number[] = [];
    const wUvs: number[] = [];
    const wIndices: number[] = [];
    const yVerts: number[] = [];
    const yUvs: number[] = [];
    const yIndices: number[] = [];

    const slotSpacing = 8.0;
    const boxLen = 5.2;
    const lineW = 0.28;
    const maxSlots = isClosed
      ? Math.min(12, Math.floor((sampler.totalLen * 0.45) / slotSpacing))
      : Math.min(8, Math.floor((sampler.totalLen - 25) / slotSpacing));

    for (let k = 0; k < maxSlots; k++) {
      // Closed track: P1..P12 behind Start/Finish (s < 0); Open track: staggered forward from start
      const sFront = isClosed ? -(4.5 + k * slotSpacing) : 12.0 + (maxSlots - 1 - k) * slotSpacing;
      const sp = sampler.sampleAt(sFront);
      const roadW = sp.width || 18;
      const boxW = Math.max(2.3, Math.min(3.5, roadW * 0.24));
      const latOffset = (k % 2 === 0 ? 1 : -1) * Math.min(4.2, roadW * 0.23);
      const latL = latOffset + boxW * 0.5;
      const latR = latOffset - boxW * 0.5;

      // White front stop bar + left rail + right rail forming classic F1 [───] grid box
      pushConformedStrip(wVerts, wUvs, wIndices, sampler, sFront - lineW, sFront, latL, latR, 0.058, 1);
      pushConformedStrip(wVerts, wUvs, wIndices, sampler, sFront - boxLen, sFront, latL, latL - lineW, 0.058, 2);
      pushConformedStrip(wVerts, wUvs, wIndices, sampler, sFront - boxLen, sFront, latR + lineW, latR, 0.058, 2);

      // Yellow FIA front-axle guide tick
      pushConformedStrip(
        yVerts,
        yUvs,
        yIndices,
        sampler,
        sFront + 0.14,
        sFront + 0.38,
        latOffset + boxW * 0.34,
        latOffset - boxW * 0.34,
        0.060,
        1
      );
    }

    if (wIndices.length === 0) return null;
    const whiteGeo = new THREE.BufferGeometry();
    whiteGeo.setAttribute('position', new THREE.Float32BufferAttribute(wVerts, 3));
    whiteGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2));
    whiteGeo.setIndex(wIndices);
    whiteGeo.computeVertexNormals();

    const yellowGeo = new THREE.BufferGeometry();
    yellowGeo.setAttribute('position', new THREE.Float32BufferAttribute(yVerts, 3));
    yellowGeo.setAttribute('uv', new THREE.Float32BufferAttribute(yUvs, 2));
    yellowGeo.setIndex(yIndices);
    yellowGeo.computeVertexNormals();

    return { whiteGeo, yellowGeo };
  }, [spline, isClosed]);

  // Pit-Entry + 3x 100m Approach Warning ("BOX 300m / 200m / 100m") + Pit-Exit Decals
  const pitApproachDecals = useMemo(() => {
    const items: Array<{ key: string; geo: THREE.BufferGeometry; kind: 'entry' | 'exit' | '300m' | '200m' | '100m'; isLeft: boolean }> = [];
    if (!spline || spline.length < 6) return items;

    const mainSampler = buildSplineArcSampler(spline, isClosed);
    if (mainSampler.totalLen < 40) return items;

    const candidatePaths: Array<{ id: string; dense: SplineNode[] }> = [];
    if (branches && branches.length > 0) {
      for (const b of branches) {
        if (!b.points || b.points.length < 2) continue;
        const dense = b.points.length < 16 ? computeSpline(b.points, false) : b.points;
        if (dense.length >= 2) candidatePaths.push({ id: b.id, dense });
      }
    }
    if (candidatePaths.length === 0 && pitSpline && pitSpline.length >= 2) {
      candidatePaths.push({ id: 'pit_main', dense: pitSpline });
    }

    const buildPadGeo = (
      sampler: ReturnType<typeof buildSplineArcSampler>,
      sNear: number,
      sFar: number,
      centerLat: number,
      padWidth: number,
      yLift: number,
      steps: number
    ) => {
      const verts: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      pushConformedStrip(
        verts,
        uvs,
        indices,
        sampler,
        sNear,
        sFar,
        centerLat + padWidth * 0.5,
        centerLat - padWidth * 0.5,
        yLift,
        steps
      );
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    for (const pathItem of candidatePaths) {
      let dense = pathItem.dense;
      const sFirst = mainSampler.nearestS(dense[0].x, dense[0].y);
      const sLast = mainSampler.nearestS(dense[dense.length - 1].x, dense[dense.length - 1].y);

      if (isClosed) {
        const fwdDist = (sLast - sFirst + mainSampler.totalLen) % mainSampler.totalLen;
        if (fwdDist > mainSampler.totalLen * 0.5) {
          dense = [...dense].reverse();
        }
      }

      const sEntry = mainSampler.nearestS(dense[0].x, dense[0].y);
      const sampleEntry = mainSampler.sampleAt(sEntry);

      // Determine whether the pit lane peels off to Driver Left (+1) or Driver Right (-1)
      let dirScore = 0;
      const lookCount = Math.min(dense.length - 1, Math.max(2, Math.floor(dense.length * 0.25)));
      for (let li = 1; li <= lookCount; li++) {
        const dx = dense[li].x - dense[0].x;
        const dz = dense[li].y - dense[0].y;
        dirScore += dx * sampleEntry.lx + dz * sampleEntry.lz;
      }
      const isLeft = dirScore >= 0;
      const sideSign = isLeft ? 1 : -1;

      // 3x "BOX" approach markings every 100m before pit entry (300m, 200m, 100m)
      const approachSteps: Array<{ offset: number; kind: '300m' | '200m' | '100m' }> = [
        { offset: 300, kind: '300m' },
        { offset: 200, kind: '200m' },
        { offset: 100, kind: '100m' },
      ];
      for (const ap of approachSteps) {
        if (!isClosed && sEntry - ap.offset < 4) continue;
        const sMid = sEntry - ap.offset;
        const sp = mainSampler.sampleAt(sMid);
        const roadW = sp.width || 18;
        const padW = Math.min(7.5, roadW * 0.44);
        const latCenter = sideSign * Math.min(roadW * 0.22, roadW * 0.5 - padW * 0.5 - 0.6);
        const geo = buildPadGeo(mainSampler, sMid - 3.7, sMid + 3.7, latCenter, padW, 0.065, 3);
        items.push({ key: `${pathItem.id}_ap_${ap.kind}`, geo, kind: ap.kind, isLeft });
      }

      // Bold Pit-Entry pad inside the pit entrance mouth
      const branchSampler = buildSplineArcSampler(dense, false);
      if (branchSampler.totalLen >= 6) {
        const startDist = Math.min(6.0, branchSampler.totalLen * 0.12);
        const endDist = Math.min(branchSampler.totalLen - 1.5, startDist + 9.0);
        if (endDist > startDist + 2.0) {
          const spEntry = branchSampler.sampleAt((startDist + endDist) * 0.5);
          const padW = Math.min(8.5, Math.max(4.0, (spEntry.width || 12) * 0.68));
          const entryGeo = buildPadGeo(branchSampler, startDist, endDist, 0, padW, 0.068, 4);
          items.push({ key: `${pathItem.id}_entry`, geo: entryGeo, kind: 'entry', isLeft });
        }

        // Bold Pit-Exit line near end of pit road
        const exitEnd = branchSampler.totalLen - 1.0;
        const exitStart = Math.max(2.0, exitEnd - 2.4);
        if (exitEnd > exitStart + 0.5) {
          const spExit = branchSampler.sampleAt((exitStart + exitEnd) * 0.5);
          const exitW = Math.max(4.0, (spExit.width || 12) * 0.85);
          const exitGeo = buildPadGeo(branchSampler, exitStart, exitEnd, 0, exitW, 0.066, 2);
          items.push({ key: `${pathItem.id}_exit`, geo: exitGeo, kind: 'exit', isLeft });
        }
      }
    }

    return items;
  }, [spline, isClosed, branches, pitSpline]);

  const pitStopTex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 512, 1024);
      // Translucent yellow pit-stop bay background
      ctx.fillStyle = 'rgba(250, 204, 21, 0.55)';
      ctx.fillRect(14, 14, 484, 996);

      // Solid yellow outer border frame
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 24;
      ctx.strokeRect(12, 12, 488, 1000);

      // Entry & Exit hazard chevrons
      const drawChevrons = (yStart: number) => {
        for (let x = 24; x < 488; x += 48) {
          ctx.fillStyle = Math.floor(x / 48) % 2 === 0 ? '#0f172a' : '#facc15';
          ctx.fillRect(x, yStart, 44, 48);
        }
      };
      drawChevrons(28);
      drawChevrons(948);

      // Bold white wheel-stop bars in center
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(36, 496, 440, 10);
      ctx.fillRect(36, 518, 440, 10);

      // Crisp PIT STOP • BOX • 3s lettering
      ctx.save();
      ctx.translate(256, 300);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PIT STOP • BOX', 0, -24);
      ctx.fillStyle = '#dc2626';
      ctx.font = '900 42px system-ui, sans-serif';
      ctx.fillText('PARAR 3s (100%)', 0, 34);
      ctx.restore();

      ctx.save();
      ctx.translate(256, 724);
      ctx.rotate(Math.PI);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 54px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PIT STOP • BOX', 0, -24);
      ctx.fillStyle = '#dc2626';
      ctx.font = '900 42px system-ui, sans-serif';
      ctx.fillText('PARAR 3s (100%)', 0, 34);
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const pitStopZoneGeo = useMemo(() => {
    const zones = computePitStopZones(branches, pitSpline);
    if (zones.length === 0) return null;

    const verts: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (const zone of zones) {
      const pts = zone.pts;
      if (pts.length < 2) continue;
      const baseV = verts.length / 3;
      const len = Math.max(1, zone.length);

      for (let i = 0; i < pts.length; i++) {
        const curr = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        let tx = next.x - prev.x;
        let tz = next.y - prev.y;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const sx = -tz;
        const sz = tx;

        const hw = Math.max(2.5, Math.min(curr.width * 0.44, curr.width * 0.5 - 0.6));
        const y = curr.z + 0.06;
        const vCoord = curr.dist / len;

        verts.push(curr.x + sx * hw, y, curr.y + sz * hw);
        uvs.push(0, vCoord);
        verts.push(curr.x - sx * hw, y, curr.y - sz * hw);
        uvs.push(1, vCoord);
      }

      for (let i = 0; i < pts.length - 1; i++) {
        const a = baseV + i * 2;
        const b = baseV + (i + 1) * 2;
        indices.push(a, a + 1, b);
        indices.push(a + 1, b + 1, b);
      }
    }

    if (indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [branches, pitSpline]);

  const fusedNetwork = useMemo(() => {
    const hasBranches = branches && branches.length > 0;
    const hasPit = pitSpline && pitSpline.length >= 2;
    if (!hasBranches && !hasPit) return null;
    return buildUnifiedRoadNetwork(spline, isClosed, branches, 1.8, pitSpline, {
      asphaltColor,
      whiteLineColor: '#ffffff',
      curbYellowColor: themeConfig.curbWarningColor,
      curbRedColor: themeConfig.curbApexColor,
      grassColor,
      sandColor: themeConfig.sandColor || '#d97706',
      gravelColor: themeConfig.gravelColor || '#78716c',
      wallColor,
      wallWidth: themeConfig.barrierThickness ?? 0.8,
      wallHeight: themeConfig.barrierHeight ?? 1.25,
      groundY,
      overpassMask: geometries?.isBridgeOverpass,
      mainHalfWidths: geometries?.frames.map(f => f.cross.halfWidth),
    });
  }, [spline, isClosed, branches, pitSpline, asphaltColor, grassColor, wallColor, themeConfig, groundY, geometries?.isBridgeOverpass, geometries?.frames]);

  const branchGeos = useMemo(() => {
    if (fusedNetwork || !branches || branches.length === 0) return null;
    return buildBranchGeometries(
      branches,
      asphaltColor,
      themeConfig.curbWarningColor,
      themeConfig.curbApexColor,
      grassColor,
      themeConfig.sandColor,
      themeConfig.gravelColor,
      wallColor,
      themeConfig.barrierHeight,
      themeConfig.barrierThickness,
      spline,
      controlPoints,
      geometries?.frames,
      geometries?.mainWallData
    );
  }, [fusedNetwork, branches, asphaltColor, themeConfig, grassColor, wallColor, spline, controlPoints, geometries]);

  // Pit Lane Geometries:
  // 1. Seamless road asphalt (overlapping tangent entry & exit)
  // 2. White limit lines
  // 3. Central dividing pit wall (with aerodynamic tapered impact wedges at both ends)
  const pitGeometries = useMemo(() => {
    if (!pitSpline || pitSpline.length < 2 || !geometries) return null;
    const N = pitSpline.length;
    const { frames, pitEntryTrackIdx, pitIsOnLeftSide, pitZoneLength } = geometries;

    const roadVerts: number[] = [];
    const roadIndices: number[] = [];
    const bridgeRoadIndices: number[] = [];
    const bridgeWhiteIndices: number[] = [];
    const bridgeYellowIndices: number[] = [];
    const bridgeRedIndices: number[] = [];
    const bridgeGrassIndices: number[] = [];
    const bridgeSandIndices: number[] = [];
    const bridgeGravelIndices: number[] = [];
    const bridgeWallLIndices: number[] = [];
    const bridgeWallRIndices: number[] = [];

    const whiteLineVerts: number[] = [];
    const whiteLineIndices: number[] = [];

    const dividerWallVerts: number[] = [];
    const dividerWallIndices: number[] = [];
    const dividerOutlineVerts: number[] = [];

    const pitOutlineVerts: number[] = [];

    const pitOuterWallVerts: number[] = [];
    const pitOuterWallIndices: number[] = [];
    const pitOuterWallOutlineVerts: number[] = [];

    const pitShoulderVerts: number[] = [];
    const pitShoulderIndices: number[] = [];

    // Temporary storage for outer wall segment connection
    const outerWallProfiles: {
      pBaseInner: THREE.Vector3;
      pTopInner: THREE.Vector3;
      pTopOuter: THREE.Vector3;
      pBaseOuter: THREE.Vector3;
    }[] = [];

    // 1. Build Pit Lane Road Mesh & Solid Outer Wall
    for (let i = 0; i < N; i++) {
      const curr = pitSpline[i];
      const prev = pitSpline[Math.max(0, i - 1)];
      const next = pitSpline[Math.min(N - 1, i + 1)];

      const pCurr = new THREE.Vector3(curr.x, curr.z + 0.025, curr.y);
      const pPrev = new THREE.Vector3(prev.x, prev.z + 0.025, prev.y);
      const pNext = new THREE.Vector3(next.x, next.z + 0.025, next.y);

      let tangent = new THREE.Vector3().subVectors(pNext, pPrev).normalize();
      if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);

      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();

      const hw = (curr.width || 8.5) / 2;
      const pL = pCurr.clone().add(side.clone().multiplyScalar(hw));
      const pR = pCurr.clone().sub(side.clone().multiplyScalar(hw));

      roadVerts.push(pL.x, pL.y, pL.z);
      roadVerts.push(pR.x, pR.y, pR.z);

      // White lines on pit edges (0.4m)
      const wWidth = 0.4;
      const pWhiteLOuter = pL.clone().add(side.clone().multiplyScalar(wWidth)).add(new THREE.Vector3(0, 0.015, 0));
      const pWhiteROuter = pR.clone().sub(side.clone().multiplyScalar(wWidth)).add(new THREE.Vector3(0, 0.015, 0));

      whiteLineVerts.push(pL.x, pL.y + 0.01, pL.z);
      whiteLineVerts.push(pWhiteLOuter.x, pWhiteLOuter.y, pWhiteLOuter.z);
      whiteLineVerts.push(pR.x, pR.y + 0.01, pR.z);
      whiteLineVerts.push(pWhiteROuter.x, pWhiteROuter.y, pWhiteROuter.z);

      // Determine Outer Side (facing away from main track)
      let minTrackDistSq = Infinity;
      let nearestFrame = frames[0];
      for (let fIdx = 0; fIdx < frames.length; fIdx++) {
        const f = frames[fIdx];
        const dSq = (f.pos.x - pCurr.x) ** 2 + (f.pos.z - pCurr.z) ** 2;
        if (dSq < minTrackDistSq) {
          minTrackDistSq = dSq;
          nearestFrame = f;
        }
      }
      const distL = pL.distanceTo(nearestFrame.pos);
      const distR = pR.distanceTo(nearestFrame.pos);
      const isLOuter = distL > distR;
      const pOuterEdge = isLOuter ? pL : pR;
      const outerSideDir = isLOuter ? side.clone() : side.clone().negate();

      // Outer Shoulder (1.8m grass/shoulder between road edge and wall base)
      const shoulderW = 1.8;
      const pOuterBaseInner = pOuterEdge.clone().add(outerSideDir.clone().multiplyScalar(shoulderW));

      pitShoulderVerts.push(pOuterEdge.x, pOuterEdge.y, pOuterEdge.z);
      pitShoulderVerts.push(pOuterBaseInner.x, pOuterBaseInner.y, pOuterBaseInner.z);

      // Solid Concrete Outer Pit Wall (1.25m height, 0.65m thickness)
      let wallH = 1.25;
      if (i < 3) wallH = 1.25 * (i / 3);
      else if (i > N - 4) wallH = 1.25 * ((N - 1 - i) / 3);

      const pTopInner = pOuterBaseInner.clone().add(new THREE.Vector3(0, wallH, 0));
      const pTopOuter = pTopInner.clone().add(outerSideDir.clone().multiplyScalar(0.65));
      const pBaseOuter = pOuterBaseInner.clone().add(outerSideDir.clone().multiplyScalar(0.65));

      outerWallProfiles.push({ pBaseInner: pOuterBaseInner, pTopInner, pTopOuter, pBaseOuter });

      pitOuterWallVerts.push(pOuterBaseInner.x, pOuterBaseInner.y, pOuterBaseInner.z);
      pitOuterWallVerts.push(pTopInner.x, pTopInner.y, pTopInner.z);
      pitOuterWallVerts.push(pTopOuter.x, pTopOuter.y, pTopOuter.z);
      pitOuterWallVerts.push(pBaseOuter.x, pBaseOuter.y, pBaseOuter.z);

      if (i < N - 1) {
        roadIndices.push(2 * i, 2 * (i + 1), 2 * i + 1);
        roadIndices.push(2 * i + 1, 2 * (i + 1), 2 * (i + 1) + 1);

        const w0 = 4 * i;
        const wn0 = 4 * (i + 1);
        whiteLineIndices.push(w0, wn0, w0 + 1);
        whiteLineIndices.push(w0 + 1, wn0, wn0 + 1);
        whiteLineIndices.push(w0 + 2, w0 + 3, wn0 + 2);
        whiteLineIndices.push(w0 + 3, wn0 + 3, wn0 + 2);

        // Shoulder indices
        const sh0 = 2 * i;
        const shN0 = 2 * (i + 1);
        pitShoulderIndices.push(sh0, shN0, sh0 + 1);
        pitShoulderIndices.push(sh0 + 1, shN0, shN0 + 1);

        // Outer wall quad indices
        const ow0 = 4 * i;
        const own0 = 4 * (i + 1);
        // Face interior
        pitOuterWallIndices.push(ow0, own0, ow0 + 1);
        pitOuterWallIndices.push(ow0 + 1, own0, own0 + 1);
        // Top cap
        pitOuterWallIndices.push(ow0 + 1, own0 + 1, ow0 + 2);
        pitOuterWallIndices.push(ow0 + 2, own0 + 1, own0 + 2);
        // Face exterior
        pitOuterWallIndices.push(ow0 + 2, ow0 + 3, own0 + 2);
        pitOuterWallIndices.push(ow0 + 3, own0 + 3, own0 + 2);

        // SketchUp Outlines on pit road edges
        const nextCurr = pitSpline[i + 1];
        const nextNext = pitSpline[Math.min(N - 1, i + 2)];
        const nextPos = new THREE.Vector3(nextCurr.x, nextCurr.z + 0.025, nextCurr.y);
        const nextTangent = new THREE.Vector3().subVectors(
          new THREE.Vector3(nextNext.x, nextNext.z + 0.025, nextNext.y),
          pCurr
        ).normalize();
        const nextSide = new THREE.Vector3().crossVectors(nextTangent, up).normalize();
        const nextHw = (nextCurr.width || 8.5) / 2;
        const nextPL = nextPos.clone().add(nextSide.clone().multiplyScalar(nextHw));
        const nextPR = nextPos.clone().sub(nextSide.clone().multiplyScalar(nextHw));

        pitOutlineVerts.push(
          pL.x, pL.y + 0.03, pL.z, nextPL.x, nextPL.y + 0.03, nextPL.z,
          pR.x, pR.y + 0.03, pR.z, nextPR.x, nextPR.y + 0.03, nextPR.z
        );
      }
    }

    // Outer wall top outlines
    for (let i = 0; i < N - 1; i++) {
      const pA = outerWallProfiles[i];
      const pB = outerWallProfiles[i + 1];
      pitOuterWallOutlineVerts.push(
        pA.pTopInner.x, pA.pTopInner.y + 0.02, pA.pTopInner.z,
        pB.pTopInner.x, pB.pTopInner.y + 0.02, pB.pTopInner.z,
        pA.pTopOuter.x, pA.pTopOuter.y + 0.02, pA.pTopOuter.z,
        pB.pTopOuter.x, pB.pTopOuter.y + 0.02, pB.pTopOuter.z
      );
    }

    // 2. Build Central Dividing Pit Wall (Between Track Straight & Pit Straight)
    if (pitEntryTrackIdx >= 0 && pitZoneLength > 0) {
      const pitSideSign = pitIsOnLeftSide ? 1 : -1;
      const dividerWallThickness = 0.75;
      const dividerFullHeight = 1.25;

      const islandCrossSections: {
        center: THREE.Vector3;
        side: THREE.Vector3;
        height: THREE.Vector3;
        hVal: number;
      }[] = [];

      const numMainFrames = frames.length;
      for (let progress = 0; progress <= pitZoneLength; progress++) {
        const uZone = progress / pitZoneLength;
        if (uZone >= 0.22 && uZone <= 0.78) {
          const frameIdx = (pitEntryTrackIdx + progress) % numMainFrames;
          const f = frames[frameIdx];

          const pitIdx = Math.min(pitSpline.length - 1, Math.max(0, Math.floor(uZone * (pitSpline.length - 1))));
          const pPit = pitSpline[pitIdx];
          const pPitPos = new THREE.Vector3(pPit.x, pPit.z, pPit.y);

          const pMainEdge = f.pos.clone().add(f.side.clone().multiplyScalar(f.cross.halfWidth * pitSideSign));
          const hwPit = (pPit.width || 8.5) / 2;
          const pPitInnerEdge = pPitPos.clone().sub(f.side.clone().multiplyScalar(hwPit * pitSideSign));

          const gap = pMainEdge.distanceTo(pPitInnerEdge);
          if (gap >= 2.0) {
            const center = pMainEdge.clone().add(pPitInnerEdge).multiplyScalar(0.5);

            let hVal = dividerFullHeight;
            if (uZone < 0.25) {
              const t = (uZone - 0.16) / 0.09;
              hVal = dividerFullHeight * Math.max(0.04, t * t * (3 - 2 * t));
            } else if (uZone > 0.75) {
              const t = (0.84 - uZone) / 0.09;
              hVal = dividerFullHeight * Math.max(0.04, t * t * (3 - 2 * t));
            }

            islandCrossSections.push({
              center,
              side: f.side.clone().multiplyScalar(pitSideSign),
              height: new THREE.Vector3(0, hVal, 0),
              hVal
            });
          }
        }
      }

      if (islandCrossSections.length >= 2) {
        for (let s = 0; s < islandCrossSections.length; s++) {
          const cs = islandCrossSections[s];
          const halfT = dividerWallThickness / 2;

          const pBaseInner = cs.center.clone().sub(cs.side.clone().multiplyScalar(halfT));
          const pTopInner = pBaseInner.clone().add(cs.height);
          const pTopOuter = cs.center.clone().add(cs.side.clone().multiplyScalar(halfT)).add(cs.height);
          const pBaseOuter = cs.center.clone().add(cs.side.clone().multiplyScalar(halfT));

          dividerWallVerts.push(pBaseInner.x, pBaseInner.y, pBaseInner.z);
          dividerWallVerts.push(pTopInner.x, pTopInner.y, pTopInner.z);
          dividerWallVerts.push(pTopOuter.x, pTopOuter.y, pTopOuter.z);
          dividerWallVerts.push(pBaseOuter.x, pBaseOuter.y, pBaseOuter.z);

          if (s < islandCrossSections.length - 1) {
            const v0 = 4 * s;
            const vn0 = 4 * (s + 1);

            dividerWallIndices.push(v0, vn0, v0 + 1);
            dividerWallIndices.push(v0 + 1, vn0, vn0 + 1);

            dividerWallIndices.push(v0 + 1, vn0 + 1, v0 + 2);
            dividerWallIndices.push(v0 + 2, vn0 + 1, vn0 + 2);

            dividerWallIndices.push(v0 + 2, v0 + 3, vn0 + 2);
            dividerWallIndices.push(v0 + 3, vn0 + 3, vn0 + 2);

            const nextCS = islandCrossSections[s + 1];
            const nextPBaseInner = nextCS.center.clone().sub(nextCS.side.clone().multiplyScalar(halfT));
            const nextPTopInner = nextPBaseInner.clone().add(nextCS.height);
            const nextPTopOuter = nextCS.center.clone().add(nextCS.side.clone().multiplyScalar(halfT)).add(nextCS.height);

            dividerOutlineVerts.push(
              pTopInner.x, pTopInner.y + 0.02, pTopInner.z,
              nextPTopInner.x, nextPTopInner.y + 0.02, nextPTopInner.z,

              pTopOuter.x, pTopOuter.y + 0.02, pTopOuter.z,
              nextPTopOuter.x, nextPTopOuter.y + 0.02, nextPTopOuter.z
            );
          }
        }
      }
    } // End of divider wall guard

    const createGeo = (v: number[], ind: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.setIndex(ind);
      geo.computeVertexNormals();
      return geo;
    };

    return {
      roadGeo: createGeo(roadVerts, roadIndices),
      whiteLineGeo: createGeo(whiteLineVerts, whiteLineIndices),
      dividerWallGeo: createGeo(dividerWallVerts, dividerWallIndices),
      dividerOutlineGeo: (() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(dividerOutlineVerts, 3));
        return geo;
      })(),
      pitOutlineGeo: (() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pitOutlineVerts, 3));
        return geo;
      })(),
      pitOuterWallGeo: createGeo(pitOuterWallVerts, pitOuterWallIndices),
      pitOuterWallOutlineGeo: (() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pitOuterWallOutlineVerts, 3));
        return geo;
      })(),
      pitShoulderGeo: createGeo(pitShoulderVerts, pitShoulderIndices)
    };
  }, [pitSpline, geometries]);

function disposeGeometriesIn(obj: object | null | undefined) {
  if (!obj) return;
  const seen = new Set<THREE.BufferGeometry>();
  for (const val of Object.values(obj)) {
    if (val instanceof THREE.BufferGeometry && !seen.has(val)) {
      seen.add(val);
      val.dispose();
    }
  }
}

  useEffect(() => () => disposeGeometriesIn(geometries), [geometries]);
  useEffect(() => () => disposeGeometriesIn(fusedNetwork), [fusedNetwork]);
  useEffect(() => () => disposeGeometriesIn(branchGeos), [branchGeos]);
  useEffect(() => () => disposeGeometriesIn(pitGeometries), [pitGeometries]);
  useEffect(() => () => { boxPaintTex.dispose(); }, [boxPaintTex]);
  useEffect(() => () => { boxExitTex.dispose(); }, [boxExitTex]);
  useEffect(() => () => {
    Object.values(boxApproachTextures).forEach((t) => t.dispose());
  }, [boxApproachTextures]);
  useEffect(() => () => {
    startingGridData?.whiteGeo.dispose();
    startingGridData?.yellowGeo.dispose();
  }, [startingGridData]);
  useEffect(() => () => {
    pitApproachDecals.forEach((d) => d.geo.dispose());
  }, [pitApproachDecals]);
  useEffect(() => () => { pitStopTex.dispose(); }, [pitStopTex]);
  useEffect(() => () => { pitStopZoneGeo?.dispose(); }, [pitStopZoneGeo]);


  return (
    <group>


      {/* Estradas Secundarias / Ramais (quando não há rede fundida) */}
      {!fusedNetwork && branchGeos && branchGeos.roadGeo && (
        <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.roadGeo} surface="TRACK">
          <mesh geometry={branchGeos.roadGeo} receiveShadow castShadow>
            <meshStandardMaterial
              color='#ffffff' vertexColors
              roughness={0.8}
              metalness={theme === 'night' ? 0.2 : 0.05}
              polygonOffset
              polygonOffsetFactor={1}
              side={THREE.DoubleSide}
            />
          </mesh>
        </TrimeshColliderWrap>
      )}


      {geometries && (
        <>
      {!fusedNetwork && branchGeos && branchGeos.whiteLineGeo && (
        <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.whiteLineGeo} surface="CURB">
          <mesh geometry={branchGeos.whiteLineGeo} receiveShadow>
            <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
          </mesh>
        </TrimeshColliderWrap>
      )}

      {/* 1. Asfalto Único Fundido (Visual + Colisor Rapier) + Colisores Regulares */}
      {fusedNetwork ? (
        <>
          <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.fusedAsphaltGeo} surface="TRACK">
            <mesh geometry={fusedNetwork.fusedAsphaltGeo} receiveShadow>
              <meshStandardMaterial
                color='#ffffff' vertexColors
                roughness={0.8}
                metalness={theme === 'night' ? 0.2 : 0.05}
                side={THREE.DoubleSide}
              />
            </mesh>
          </TrimeshColliderWrap>
          {geometries.bridgeRoadGeo && (
            <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeRoadGeo} surface="TRACK">
              <mesh geometry={geometries.bridgeRoadGeo} receiveShadow castShadow>
                <meshStandardMaterial
                  color='#ffffff' vertexColors
                  roughness={0.8}
                  metalness={theme === 'night' ? 0.2 : 0.05}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </TrimeshColliderWrap>
          )}
        </>
      ) : (
        <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.roadGeo} surface="TRACK">
          <mesh geometry={geometries.roadGeo} receiveShadow castShadow>
            <meshStandardMaterial
              color='#ffffff' vertexColors
              roughness={0.8}
              metalness={theme === 'night' ? 0.2 : 0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
        </TrimeshColliderWrap>
      )}

      {/* Zona Amarela de Reparação / Pit Stop (50m centrada no ponto médio da Box) */}
      {pitStopZoneGeo && (
        <mesh geometry={pitStopZoneGeo} receiveShadow>
          <meshStandardMaterial
            map={pitStopTex}
            transparent
            roughness={0.55}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Grelha de Partida F1 Escalonada (Atrás da Linha de Meta) */}
      {startingGridData && (
        <group>
          <mesh geometry={startingGridData.whiteGeo} renderOrder={1}>
            <meshStandardMaterial
              color="#f8fafc"
              roughness={0.55}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh geometry={startingGridData.yellowGeo} renderOrder={2}>
            <meshStandardMaterial
              color="#facc15"
              emissive="#facc15"
              emissiveIntensity={0.2}
              roughness={0.5}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-3}
              polygonOffsetUnits={-3}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {/* Arestas Pretas Estilo SketchUp do Circuito e Ramais */}
      {showEdges && (
        fusedNetwork ? (
          <lineSegments geometry={fusedNetwork.outlineGeo}>
            <lineBasicMaterial color={outlineColor} linewidth={1} />
          </lineSegments>
        ) : (
          <>
            <lineSegments geometry={geometries.outlineGeo}>
              <lineBasicMaterial color={outlineColor} linewidth={1} />
            </lineSegments>
            {branchGeos && branchGeos.outlineGeo && (
              <lineSegments geometry={branchGeos.outlineGeo}>
                <lineBasicMaterial color={outlineColor} linewidth={1} />
              </lineSegments>
            )}
          </>
        )
      )}

      {showLayers && (
        <>
          {fusedNetwork ? (
            <>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.whiteLineGeo} surface="CURB">
                <mesh geometry={fusedNetwork.whiteLineGeo} receiveShadow>
                  <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.yellowCurbsGeo} surface="CURB_WIDE">
                <mesh geometry={fusedNetwork.yellowCurbsGeo} receiveShadow>
                  <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.redCurbsGeo} surface="CURB_APEX">
                <mesh geometry={fusedNetwork.redCurbsGeo} receiveShadow>
                  <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.grassShoulderGeo} surface="GRASS">
                <mesh geometry={fusedNetwork.grassShoulderGeo} receiveShadow>
                  <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.sandGeo} surface="SAND">
                <mesh geometry={fusedNetwork.sandGeo} receiveShadow>
                  <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.gravelGeo} surface="GRAVEL">
                <mesh geometry={fusedNetwork.gravelGeo} receiveShadow>
                  <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                </mesh>
              </TrimeshColliderWrap>
              {showEmbankments && (
                <mesh geometry={fusedNetwork.embankmentGeo} receiveShadow>
                  <meshStandardMaterial color={embankColor} roughness={0.95} side={THREE.DoubleSide} />
                </mesh>
              )}
              {showGuardrails && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={fusedNetwork.wallGeo} surface="WALL">
                  <mesh geometry={fusedNetwork.wallGeo} castShadow receiveShadow>
                    <meshStandardMaterial
                      color={wallColor}
                      roughness={0.3}
                      metalness={0.08}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeWhiteGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeWhiteGeo} surface="CURB">
                  <mesh geometry={geometries.bridgeWhiteGeo} receiveShadow>
                    <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeYellowGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeYellowGeo} surface="CURB_WIDE">
                  <mesh geometry={geometries.bridgeYellowGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeRedGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeRedGeo} surface="CURB_APEX">
                  <mesh geometry={geometries.bridgeRedGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeGrassGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeGrassGeo} surface="GRASS">
                  <mesh geometry={geometries.bridgeGrassGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeSandGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeSandGeo} surface="SAND">
                  <mesh geometry={geometries.bridgeSandGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {geometries.bridgeGravelGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeGravelGeo} surface="GRAVEL">
                  <mesh geometry={geometries.bridgeGravelGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {showGuardrails && geometries.bridgeWallLGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeWallLGeo} surface="WALL">
                  <mesh geometry={geometries.bridgeWallLGeo} castShadow receiveShadow>
                    <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {showGuardrails && geometries.bridgeWallRGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.bridgeWallRGeo} surface="WALL">
                  <mesh geometry={geometries.bridgeWallRGeo} castShadow receiveShadow>
                    <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
            </>
          ) : (
            <>
          {/* CAMADAS DAS ESTRADAS SECUNDÁRIAS / RAMAIS (Zebras, Relva, Areia, Gravilha e Muros) */}
          {branchGeos && (
            <>
              {branchGeos.yellowCurbsGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.yellowCurbsGeo} surface="CURB_WIDE">
                  <mesh geometry={branchGeos.yellowCurbsGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {branchGeos.redCurbsGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.redCurbsGeo} surface="CURB_APEX">
                  <mesh geometry={branchGeos.redCurbsGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {branchGeos.grassShoulderGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.grassShoulderGeo} surface="GRASS">
                  <mesh geometry={branchGeos.grassShoulderGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {branchGeos.sandGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.sandGeo} surface="SAND">
                  <mesh geometry={branchGeos.sandGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {branchGeos.gravelGeo && (
                <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.gravelGeo} surface="GRAVEL">
                  <mesh geometry={branchGeos.gravelGeo} receiveShadow>
                    <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
                  </mesh>
                </TrimeshColliderWrap>
              )}
              {showGuardrails && (
                <group>
                  {branchGeos.guardrailLeftGeo && (
                    <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.guardrailLeftGeo} surface="WALL">
                      <mesh geometry={branchGeos.guardrailLeftGeo} castShadow receiveShadow>
                        <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
                      </mesh>
                    </TrimeshColliderWrap>
                  )}
                  {branchGeos.guardrailRightGeo && (
                    <TrimeshColliderWrap enabled={enablePhysics} geo={branchGeos.guardrailRightGeo} surface="WALL">
                      <mesh geometry={branchGeos.guardrailRightGeo} castShadow receiveShadow>
                        <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
                      </mesh>
                    </TrimeshColliderWrap>
                  )}
                </group>
              )}
            </>
          )}
          {/* 2. Faixa Branca Contínua */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.whiteLineGeo} surface="CURB">
            <mesh geometry={geometries.whiteLineGeo} receiveShadow>
              <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 3. Faixas Amarelas de Aviso de Curva */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.yellowCurbsGeo} surface="CURB_WIDE">
            <mesh geometry={geometries.yellowCurbsGeo} receiveShadow>
              <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 4. Faixas Vermelhas de Ápice */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.redCurbsGeo} surface="CURB_APEX">
            <mesh geometry={geometries.redCurbsGeo} receiveShadow>
              <meshStandardMaterial vertexColors roughness={0.4} metalness={0.2} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 5. Chão Contínuo de Relva */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.grassShoulderGeo} surface="GRASS">
            <mesh geometry={geometries.grassShoulderGeo} receiveShadow>
              <meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 6. Escapatória de Areia */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.sandGeo} surface="SAND">
            <mesh geometry={geometries.sandGeo} receiveShadow>
              <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 7. Caixa de Gravilha */}
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.gravelGeo} surface="GRAVEL">
            <mesh geometry={geometries.gravelGeo} receiveShadow>
              <meshStandardMaterial vertexColors roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>

          {/* 6. Talude Descendente fora do muro */}
          {showEmbankments && (
            <mesh geometry={geometries.embankmentGeo} receiveShadow>
              <meshStandardMaterial color={embankColor} roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
          )}

          {/* 7. Muros Sólidos Contínuos (Fundidos perfeitamente com a Box - ZERO buracos!) */}
          {showGuardrails && (
            <group>
              <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.guardrailLeftGeo} surface="WALL">
                <mesh geometry={geometries.guardrailLeftGeo} castShadow receiveShadow>
                  <meshStandardMaterial
                    color={wallColor}
                    roughness={0.3}
                    metalness={0.08}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </TrimeshColliderWrap>
              <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.guardrailRightGeo} surface="WALL">
                <mesh geometry={geometries.guardrailRightGeo} castShadow receiveShadow>
                  <meshStandardMaterial
                    color={wallColor}
                    roughness={0.3}
                    metalness={0.08}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </TrimeshColliderWrap>
            </group>
          )}
            </>
          )}
        </>
      )}

      {/* 6.2 Pilares Estruturais Robustos de Betão & Vigas de Apoio de Viaduto (BRANCO PURO) */}
      {geometries.pillarGeo && (
        <mesh geometry={geometries.pillarGeo} castShadow receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.08} />
        </mesh>
      )}
      {geometries.crossBeamGeo && (
        <mesh geometry={geometries.crossBeamGeo} castShadow receiveShadow>
          <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.08} />
        </mesh>
      )}

      {/* 6.3 Túnel Opcional por Ponto + Pórticos + Luzes LED e Iluminação Interior */}
      {geometries.tunnelGeo && (
        <group>
          <TrimeshColliderWrap enabled={enablePhysics} geo={geometries.tunnelGeo} surface="WALL">
            <mesh geometry={geometries.tunnelGeo} castShadow receiveShadow>
              <meshStandardMaterial color="#1e293b" roughness={0.75} metalness={0.15} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>
          {geometries.tunnelPortalGeo && (
            <mesh geometry={geometries.tunnelPortalGeo} castShadow receiveShadow>
              <meshStandardMaterial color="#94a3b8" roughness={0.65} metalness={0.1} side={THREE.DoubleSide} />
            </mesh>
          )}
          {geometries.tunnelLightGeo && (
            <mesh geometry={geometries.tunnelLightGeo}>
              <meshStandardMaterial color="#fef08a" emissive="#fef08a" emissiveIntensity={2.6} side={THREE.DoubleSide} />
            </mesh>
          )}
          {geometries.tunnelLights.map((tl, idx) => (
            <pointLight
              key={`tlight_${idx}`}
              position={[tl.pos.x, tl.pos.y - 0.6, tl.pos.z]}
              color="#fef3c7"
              intensity={45}
              distance={42}
              decay={1.6}
            />
          ))}
        </group>
      )}

      {/* 8. Pit Lane (Boxes) + Muros Exteriores & Divisor (fallback se não houver rede fundida) */}
      {!fusedNetwork && pitGeometries && (
        <group>
          <TrimeshColliderWrap enabled={enablePhysics} geo={pitGeometries.roadGeo} surface="TRACK">
            <mesh geometry={pitGeometries.roadGeo} receiveShadow castShadow>
              <meshStandardMaterial
                color={asphaltColor}
                roughness={0.7}
                metalness={0.1}
                polygonOffset
                polygonOffsetFactor={-1}
                side={THREE.DoubleSide}
              />
            </mesh>
          </TrimeshColliderWrap>
          <TrimeshColliderWrap enabled={enablePhysics} geo={pitGeometries.whiteLineGeo} surface="CURB">
            <mesh geometry={pitGeometries.whiteLineGeo} receiveShadow>
              <meshStandardMaterial color="#ffffff" roughness={0.4} metalness={0.1} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>
          <TrimeshColliderWrap enabled={enablePhysics} geo={pitGeometries.pitShoulderGeo} surface="GRASS">
            <mesh geometry={pitGeometries.pitShoulderGeo} receiveShadow>
              <meshStandardMaterial color={grassColor} roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>
          <TrimeshColliderWrap enabled={enablePhysics} geo={pitGeometries.pitOuterWallGeo} surface="WALL">
            <mesh geometry={pitGeometries.pitOuterWallGeo} castShadow receiveShadow>
              <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>
          <TrimeshColliderWrap enabled={enablePhysics} geo={pitGeometries.dividerWallGeo} surface="WALL">
            <mesh geometry={pitGeometries.dividerWallGeo} castShadow receiveShadow>
              <meshStandardMaterial color={wallColor} roughness={0.3} metalness={0.08} side={THREE.DoubleSide} />
            </mesh>
          </TrimeshColliderWrap>
        </group>
      )}

      {/* 10. Pórtico de Partida / Meta GP (Postes sempre fora dos muros + Linha Axadrezada + Semáforo) */}
      <group position={geometries.startArchPos} rotation={[0, geometries.archRotationY, 0]}>
        {(() => {
          const span = geometries.startPostOffsetL - geometries.startPostOffsetR;
          const midX = (geometries.startPostOffsetL + geometries.startPostOffsetR) * 0.5;
          const sqCount = Math.max(8, Math.round(geometries.startRoadWidth / 1.1));
          const sqW = geometries.startRoadWidth / sqCount;
          return (
            <>
              {/* Linha da Meta Axadrezada */}
              {Array.from({ length: sqCount }).map((_, idx) => {
                const x = -geometries.startRoadWidth / 2 + sqW * (idx + 0.5);
                return (
                  <React.Fragment key={`chk_${idx}`}>
                    <mesh position={[x, -0.05, -0.55]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                      <planeGeometry args={[sqW, 1.1]} />
                      <meshStandardMaterial color={idx % 2 === 0 ? '#ffffff' : '#111827'} roughness={0.6} />
                    </mesh>
                    <mesh position={[x, -0.05, 0.55]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                      <planeGeometry args={[sqW, 1.1]} />
                      <meshStandardMaterial color={idx % 2 === 0 ? '#111827' : '#ffffff'} roughness={0.6} />
                    </mesh>
                  </React.Fragment>
                );
              })}

              {/* Postes Laterais FORA dos Muros */}
              <mesh position={[geometries.startPostOffsetL, 3.4, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.7, 7.2, 0.7]} />
                <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.5} />
              </mesh>
              <mesh position={[geometries.startPostOffsetR, 3.4, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.7, 7.2, 0.7]} />
                <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.5} />
              </mesh>

              {/* Viga Superior do Pórtico */}
              <mesh position={[midX, 6.8, 0]} castShadow receiveShadow>
                <boxGeometry args={[span + 0.8, 0.9, 1.1]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.4} />
              </mesh>
              <mesh position={[midX, 7.3, 0]} castShadow>
                <boxGeometry args={[span + 0.8, 0.2, 1.15]} />
                <meshStandardMaterial color="#ef4444" roughness={0.3} />
              </mesh>

              {/* Painel de Luzes de Partida F1 (3 Vermelhas -> Verde) */}
              <mesh position={[0, 6.05, 0]} castShadow>
                <boxGeometry args={[6.4, 0.85, 0.7]} />
                <meshStandardMaterial color="#020617" roughness={0.3} metalness={0.6} />
              </mesh>
              <StartGantryLights />
            </>
          );
        })()}
      </group>

      {/* 11. Marcações da BOX (Avisos BOX 300m / 200m / 100m na pista + Entrada e Saída da Box) */}
      {pitApproachDecals.map((item) => {
        let tex: THREE.CanvasTexture;
        let emissiveColor = '#facc15';
        let emissiveInt = 0.2;
        if (item.kind === 'entry') {
          tex = boxPaintTex;
          emissiveColor = '#f59e0b';
          emissiveInt = 0.22;
        } else if (item.kind === 'exit') {
          tex = boxExitTex;
          emissiveColor = '#38bdf8';
          emissiveInt = 0.15;
        } else if (item.kind === '300m') {
          tex = item.isLeft ? boxApproachTextures.left300 : boxApproachTextures.right300;
        } else if (item.kind === '200m') {
          tex = item.isLeft ? boxApproachTextures.left200 : boxApproachTextures.right200;
        } else {
          tex = item.isLeft ? boxApproachTextures.left100 : boxApproachTextures.right100;
        }
        return (
          <mesh key={item.key} geometry={item.geo} renderOrder={2}>
            <meshStandardMaterial
              map={tex}
              transparent
              roughness={0.5}
              emissive={emissiveColor}
              emissiveIntensity={emissiveInt}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-3}
              polygonOffsetUnits={-3}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}

      </>
      )}

      
          {/* Ground Drag Interception Plane: only intercepts when actively dragging */}
          {draggingNode !== null && (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, draggingNode.y - 0.01, 0]}
              onPointerMove={(e) => {
                const active = dragNodeRef.current;
                if (!active) return;
                e.stopPropagation();
                if (!active.moved) {
                  if (Math.hypot(e.clientX - active.startX, e.clientY - active.startY) <= 4) return;
                  active.moved = true;
                }
                if (active.kind === 'main') {
                  onMovePoint?.(active.index, e.point.x, e.point.z);
                } else {
                  onMoveBranchNode?.(active.branchId, active.nodeIndex, e.point.x, e.point.z);
                }
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                const active = dragNodeRef.current;
                if (!active) return;
                dragNodeRef.current = null;
                setDraggingNode(null);
                onDragStateChange?.(false);
                document.body.style.cursor = 'default';
                if (!active.moved) {
                  if (active.kind === 'main') onSelectPoint?.(active.index);
                  else onSelectBranchNode?.(active.branchId, active.nodeIndex);
                }
              }}
            >
              <planeGeometry args={[20000, 20000]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          )}

          {/* Pontos Interativos dos Ramais */}
          {showControlPoints && branches && (() => {
            let nextSeqNum = controlPoints.length + 1;
            const isSameAsMain = (p: SplineNode) =>
              controlPoints.some(cp => Math.hypot(cp.x - p.x, cp.y - p.y) < 1.0);

            return branches.map((branch) =>
              branch.points.map((bp, bpIdx) => {
                // Se este ponto e uma ligacao a um ponto existente da pista principal, nao duplica a esfera nem o numero
                if (isSameAsMain(bp)) return null;

                const seqNum = nextSeqNum++;
                const isSelected = selectedBranchNode?.branchId === branch.id && selectedBranchNode?.nodeIndex === bpIdx;
                const bpZ = bp.z ?? 0;
                const nodeColor = isSelected ? '#00f3ff' : (bp.isTunnel ? '#a855f7' : '#f59e0b');
                return (
                  <group
                    key={`branch_${branch.id}_${bpIdx}`}
                    position={[bp.x, bpZ, bp.y]}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      const drag: DragNodeState = {
                        kind: 'branch',
                        branchId: branch.id,
                        nodeIndex: bpIdx,
                        y: bpZ,
                        startX: e.clientX,
                        startY: e.clientY,
                        moved: false
                      };
                      dragNodeRef.current = drag;
                      setDraggingNode(drag);
                      onDragStateChange?.(true);
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      const active = dragNodeRef.current;
                      if (!active) {
                        onSelectBranchNode?.(branch.id, bpIdx);
                        return;
                      }
                      dragNodeRef.current = null;
                      setDraggingNode(null);
                      onDragStateChange?.(false);
                      document.body.style.cursor = 'default';
                      if (!active.moved) {
                        onSelectBranchNode?.(branch.id, bpIdx);
                      }
                    }}
                    onPointerOver={(e) => {
                      e.stopPropagation();
                      document.body.style.cursor = 'grab';
                    }}
                    onPointerOut={(e) => {
                      e.stopPropagation();
                      if (!dragNodeRef.current) document.body.style.cursor = 'default';
                    }}
                  >
                    <mesh>
                      <sphereGeometry args={[isSelected ? 4.2 : 3.0, 20, 20]} />
                      <meshStandardMaterial
                        color={nodeColor}
                        emissive={nodeColor}
                        emissiveIntensity={isSelected ? 1.8 : 0.8}
                      />
                    </mesh>

                    {/* Badge Numerico Sequencial da Estrada */}
                    <sprite position={[0, 7.5, 0]} scale={[9, 9, 1]}>
                      <spriteMaterial map={getNumberSpriteTexture(seqNum)} transparent depthTest={false} />
                    </sprite>
                    {isSelected && (
                      <mesh rotation={[-Math.PI / 2, 0, 0]}>
                        <ringGeometry args={[5.5, 7.0, 32]} />
                        <meshBasicMaterial color="#00f3ff" side={THREE.DoubleSide} />
                      </mesh>
                    )}
                    {Math.abs(bpZ) > 0.3 && (
                      <mesh position={[0, -bpZ / 2, 0]}>
                        <cylinderGeometry args={[0.25, 0.25, Math.abs(bpZ), 8]} />
                        <meshBasicMaterial color={isSelected ? '#00f3ff' : (bp.isTunnel ? '#a855f7' : '#f59e0b')} transparent opacity={0.65} />
                      </mesh>
                    )}
                  </group>
                );
              })
            );
          })()}

          {/* 11. Pontos de Controlo / Nos CAD Interativos com Arrastamento e Numeracao */}
      {showControlPoints && (
        <group>
          {controlPoints.map((cp, idx) => {
            const isSelected = selectedPointIndex === idx;
            const cpZ = cp.z ?? 0;
            const nodeColor = isSelected
              ? '#00f3ff'
              : (idx === 0 ? '#10b981' : (cp.isTunnel ? '#a855f7' : (idx === controlPoints.length - 1 && !isClosed ? '#ef4444' : '#f59e0b')));
            return (
              <group
                key={idx}
                position={[cp.x, cpZ, cp.y]}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  const drag: DragNodeState = {
                    kind: 'main',
                    index: idx,
                    y: cpZ,
                    startX: e.clientX,
                    startY: e.clientY,
                    moved: false
                  };
                  dragNodeRef.current = drag;
                  setDraggingNode(drag);
                  onDragStateChange?.(true);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  const active = dragNodeRef.current;
                  if (!active) {
                    onSelectPoint?.(idx);
                    return;
                  }
                  dragNodeRef.current = null;
                  setDraggingNode(null);
                  onDragStateChange?.(false);
                  document.body.style.cursor = 'default';
                  if (!active.moved) {
                    onSelectPoint?.(idx);
                  }
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = 'grab';
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  if (!dragNodeRef.current) document.body.style.cursor = 'default';
                }}
              >
                <mesh>
                  <sphereGeometry args={[isSelected ? 4.5 : 3.0, 20, 20]} />
                  <meshStandardMaterial
                    color={nodeColor}
                    emissive={nodeColor}
                    emissiveIntensity={isSelected ? 1.8 : 0.8}
                  />
                </mesh>

                
                {/* Badge Numerico Sequencial */}
                <sprite position={[0, 7.5, 0]} scale={[9, 9, 1]}>
                  <spriteMaterial map={getNumberSpriteTexture(idx + 1)} transparent depthTest={false} />
                </sprite>


                {isSelected && (
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[5.5, 7.0, 32]} />
                    <meshBasicMaterial color="#00f3ff" side={THREE.DoubleSide} />
                  </mesh>
                )}

                {Math.abs(cpZ) > 0.3 && (
                  <mesh position={[0, -cpZ / 2, 0]}>
                    <cylinderGeometry args={[0.25, 0.25, Math.abs(cpZ), 8]} />
                    <meshBasicMaterial color={isSelected ? '#00f3ff' : (cp.isTunnel ? '#a855f7' : '#f59e0b')} transparent opacity={0.65} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
      )}
    </group>
  );
};