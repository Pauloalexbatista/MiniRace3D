import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export type CarClass = 'f1' | 'gt' | 'rally' | 'drift';

interface CarWheelProps {
  isFront?: boolean;
  side?: number;
  carClass: CarClass;
  rimColor: string;
  spinRef?: React.RefObject<THREE.Group | null>;
  wheelRotation?: number;
}

const CarWheel = React.memo<CarWheelProps>(({
  isFront = false,
  side = 1,
  carClass,
  rimColor,
  spinRef,
  wheelRotation = 0,
}) => {
  const isF1 = carClass === 'f1';
  const tireWidth = isF1 ? (isFront ? 0.72 : 0.90) : carClass === 'drift' ? 0.42 : 0.38;
  const tireRadius = isF1 ? 0.62 : 0.44;
  const camber = carClass === 'drift' ? side * -0.08 : 0;

  return (
    <group rotation={[0, 0, camber]}>
      {/* Non-rotating Brake Rotor + Red Brembo Caliper */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[tireRadius * 0.56, tireRadius * 0.56, tireWidth * 0.35, 16]} />
        <meshStandardMaterial color="#64748b" roughness={0.35} metalness={0.85} />
      </mesh>
      <mesh position={[side * 0.06, tireRadius * 0.28, isFront ? -0.14 : 0.14]}>
        <boxGeometry args={[tireWidth * 0.45, tireRadius * 0.32, tireRadius * 0.24]} />
        <meshStandardMaterial color="#ef4444" roughness={0.3} metalness={0.4} />
      </mesh>

      {/* Rotating Tire + 5-Spoke 3D Alloy Wheel */}
      <group ref={spinRef} rotation={[wheelRotation, 0, 0]}>
        {/* Main Tire Tread */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[tireRadius, tireRadius, tireWidth * 0.88, 28]} />
          <meshStandardMaterial color="#18181b" roughness={0.88} metalness={0.05} />
        </mesh>
        {/* Rounded Tire Shoulders */}
        {[-1, 1].map((s) => (
          <mesh key={`sh_${s}`} position={[s * (tireWidth * 0.41), 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[tireRadius * 0.90, tireRadius * 0.10, 10, 24]} />
            <meshStandardMaterial color="#18181b" roughness={0.88} />
          </mesh>
        ))}

        {/* Outer Rim Lip / Color Ring */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[tireRadius * 0.73, tireRadius * 0.73, tireWidth + 0.01, 24]} />
          <meshStandardMaterial color={rimColor} roughness={0.25} metalness={0.75} />
        </mesh>

        {/* Dark Inner Wheel Barrel */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[tireRadius * 0.64, tireRadius * 0.64, tireWidth + 0.018, 20]} />
          <meshStandardMaterial color="#090d16" roughness={0.4} metalness={0.8} />
        </mesh>

        {/* 5 Sculpted 3D Spokes on Outer Face */}
        {[0, 1, 2, 3, 4].map((spIdx) => {
          const ang = (spIdx * Math.PI * 2) / 5;
          return (
            <mesh
              key={`spk_${spIdx}`}
              position={[
                side * (tireWidth * 0.49),
                Math.cos(ang) * tireRadius * 0.34,
                Math.sin(ang) * tireRadius * 0.34,
              ]}
              rotation={[ang, 0, 0]}
            >
              <boxGeometry args={[0.04, tireRadius * 0.64, tireRadius * 0.13]} />
              <meshStandardMaterial color={rimColor} roughness={0.22} metalness={0.85} />
            </mesh>
          );
        })}

        {/* Center Lock Nut */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[tireRadius * 0.18, tireRadius * 0.18, tireWidth + 0.045, 12]} />
          <meshStandardMaterial color={isF1 ? '#ef4444' : '#e2e8f0'} roughness={0.2} metalness={0.9} />
        </mesh>
      </group>
    </group>
  );
});

const FenderArches = React.memo<{ flareColor: string; flareWidth?: number }>(({ flareColor, flareWidth = 0.18 }) => (
  <>
    {[
      [-0.90, 0.43, 1.45],
      [0.90, 0.43, 1.45],
      [-0.92, 0.44, -1.25],
      [0.92, 0.44, -1.25],
    ].map(([ax, ay, az], idx) => {
      const s = ax < 0 ? -1 : 1;
      return (
        <group key={`fender_${idx}`} position={[ax, ay, az]}>
          {/* Curved outer fender arch */}
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.53, 0.53, flareWidth, 20, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color={flareColor} roughness={0.24} metalness={0.38} />
          </mesh>
          {/* Dark recessed wheel well liner */}
          <mesh position={[s * -0.02, -0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.48, 0.48, flareWidth + 0.02, 16, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#090d16" roughness={0.95} />
          </mesh>
        </group>
      );
    })}
  </>
));

interface Car3DProps {
  position: [number, number, number];
  rotation: [number, number, number]; // [pitch, yaw, roll]
  steerAngle?: number;
  wheelRotation?: number;
  steerAngleRef?: React.MutableRefObject<number>;
  wheelRotationRef?: React.MutableRefObject<number>;
  brakeIntensity?: number;
  brakeIntensityRef?: React.MutableRefObject<number>;
  headlightsOn?: boolean;
  headlightsOnRef?: React.MutableRefObject<boolean>;
  enableRealLights?: boolean;
  environmentTheme?: 'day' | 'sunset' | 'night';
  color?: string;
  secondaryColor?: string;
  carClass?: CarClass;
  isDrifting?: boolean;
}

function makeBeamGeo(rStart: number, rEnd: number, length: number): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(rEnd, rStart, length, 16, 1, true);
  geo.translate(0, length / 2, 0);
  geo.rotateX(Math.PI / 2);
  return geo;
}

const FLARE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLARE_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d2 = dot(p, p);
    if (d2 > 1.0) discard;
    float edge = smoothstep(1.0, 0.2, d2);
    float core = exp(-d2 * 7.5);
    float halo = exp(-d2 * 2.2) * 0.45;
    float strength = (core + halo) * edge * uIntensity;
    if (strength <= 0.002) discard;
    gl_FragColor = vec4(uColor * strength, strength);
  }
`;

const BEAM_VERTEX_SHADER = `
  uniform float uLength;
  varying float vAxial;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vAxial = position.z / uLength;
    vNormalView = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const BEAM_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAxial;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    float t = clamp(vAxial, 0.0, 1.0);
    float axial = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.85);
    float fresnel = pow(abs(dot(normalize(vNormalView), normalize(vViewDir))), 1.4);
    float alpha = axial * fresnel * uOpacity;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

export const Car3D = React.memo(React.forwardRef<THREE.Group, Car3DProps>(({
  position,
  rotation,
  steerAngle = 0,
  wheelRotation = 0,
  steerAngleRef,
  wheelRotationRef,
  brakeIntensity = 0,
  brakeIntensityRef,
  headlightsOn = true,
  headlightsOnRef,
  enableRealLights = false,
  environmentTheme = 'day',
  color = '#e11d48',
  secondaryColor = '#f8fafc',
  carClass = 'f1',
}, ref) => {
  const frontLeftWheelRef = useRef<THREE.Group>(null);
  const frontRightWheelRef = useRef<THREE.Group>(null);
  const rearLeftWheelRef = useRef<THREE.Group>(null);
  const rearRightWheelRef = useRef<THREE.Group>(null);
  const flSpinRef = useRef<THREE.Group>(null);
  const frSpinRef = useRef<THREE.Group>(null);
  const rlSpinRef = useRef<THREE.Group>(null);
  const rrSpinRef = useRef<THREE.Group>(null);

  const hlSmoothRef = useRef(headlightsOn ? 1 : 0);
  const brakeSmoothRef = useRef(brakeIntensity);
  const frontLightEffectsGroupRef = useRef<THREE.Group>(null);
  const rearBrakeFlaresGroupRef = useRef<THREE.Group>(null);
  const leftSpotRef = useRef<THREE.SpotLight>(null);
  const rightSpotRef = useRef<THREE.SpotLight>(null);
  const centerSpotRef = useRef<THREE.SpotLight>(null);
  const brakePointLightRef = useRef<THREE.PointLight>(null);

  const leftSpotTarget = useMemo(() => new THREE.Object3D(), []);
  const rightSpotTarget = useMemo(() => new THREE.Object3D(), []);
  const centerSpotTarget = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!enableRealLights) return;
    if (leftSpotRef.current) leftSpotRef.current.target = leftSpotTarget;
    if (rightSpotRef.current) rightSpotRef.current.target = rightSpotTarget;
    if (centerSpotRef.current) centerSpotRef.current.target = centerSpotTarget;
  }, [carClass, enableRealLights, leftSpotTarget, rightSpotTarget, centerSpotTarget]);

  const lightPalette = useMemo(() => {
    if (carClass === 'drift') {
      return {
        hlOff: new THREE.Color('#1e293b'),
        hlOn: new THREE.Color('#e0f2fe'),
        hlEmissive: new THREE.Color('#38bdf8'),
        spotHex: '#e0f2fe',
      };
    }
    if (carClass === 'f1') {
      return {
        hlOff: new THREE.Color('#1e293b'),
        hlOn: new THREE.Color('#f8fafc'),
        hlEmissive: new THREE.Color('#e0f2fe'),
        spotHex: '#f8fafc',
      };
    }
    return {
      hlOff: new THREE.Color('#1e293b'),
      hlOn: new THREE.Color('#fef9c3'),
      hlEmissive: new THREE.Color('#fef08a'),
      spotHex: '#fef9c3',
    };
  }, [carClass]);

  const lightAssets = useMemo(() => {
    const headlightMat = new THREE.MeshStandardMaterial({
      color: '#fef9c3',
      emissive: '#fef08a',
      emissiveIntensity: 4.0,
      roughness: 0.15,
      metalness: 0.2,
      toneMapped: false,
    });
    const rallyAuxMat = new THREE.MeshStandardMaterial({
      color: '#fef08a',
      emissive: '#fde047',
      emissiveIntensity: 4.6,
      roughness: 0.15,
      metalness: 0.2,
      toneMapped: false,
    });
    const tailRunningMat = new THREE.MeshStandardMaterial({
      color: '#991b1b',
      emissive: '#dc2626',
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.2,
      toneMapped: false,
    });
    const brakeOnlyMat = new THREE.MeshStandardMaterial({
      color: '#2a0808',
      emissive: '#ff0000',
      emissiveIntensity: 0.04,
      roughness: 0.2,
      metalness: 0.2,
      toneMapped: false,
    });

    const flarePlaneGeo = new THREE.PlaneGeometry(1, 1);
    const mainBeamGeo = makeBeamGeo(0.14, 1.85, 18);
    const rallyCornerBeamGeo = makeBeamGeo(0.10, 1.55, 13);
    const rallyRoofBeamGeo = makeBeamGeo(0.18, 2.55, 23);

    const makeFlareMat = (hex: string) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(hex) },
          uIntensity: { value: 0 },
        },
        vertexShader: FLARE_VERTEX_SHADER,
        fragmentShader: FLARE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

    const makeBeamMat = (hex: string, length: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(hex) },
          uOpacity: { value: 0 },
          uLength: { value: length },
        },
        vertexShader: BEAM_VERTEX_SHADER,
        fragmentShader: BEAM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

    const headlightFlareMat = makeFlareMat('#fef08a');
    const rallyAuxFlareMat = makeFlareMat('#fde047');
    const brakeFlareMat = makeFlareMat('#ff1a1a');

    const mainBeamMat = makeBeamMat('#fef08a', 18);
    const rallyCornerBeamMat = makeBeamMat('#fde047', 13);
    const rallyRoofBeamMat = makeBeamMat('#fef9c3', 23);

    const auxOffColor = new THREE.Color('#334155');
    const auxOnColor = new THREE.Color('#fef08a');
    const tailOffColor = new THREE.Color('#3b0a0a');
    const tailRunColor = new THREE.Color('#991b1b');
    const tailBrkColor = new THREE.Color('#ff2424');
    const tailRunEmissive = new THREE.Color('#dc2626');
    const tailBrkEmissive = new THREE.Color('#ff0000');
    const brakeOffColor = new THREE.Color('#2a0808');
    const brakeOnColor = new THREE.Color('#ff1a1a');

    return {
      headlightMat,
      rallyAuxMat,
      tailRunningMat,
      brakeOnlyMat,
      flarePlaneGeo,
      mainBeamGeo,
      rallyCornerBeamGeo,
      rallyRoofBeamGeo,
      headlightFlareMat,
      rallyAuxFlareMat,
      brakeFlareMat,
      mainBeamMat,
      rallyCornerBeamMat,
      rallyRoofBeamMat,
      auxOffColor,
      auxOnColor,
      tailOffColor,
      tailRunColor,
      tailBrkColor,
      tailRunEmissive,
      tailBrkEmissive,
      brakeOffColor,
      brakeOnColor,
    };
  }, []);

  useEffect(() => {
    return () => {
      lightAssets.headlightMat.dispose();
      lightAssets.rallyAuxMat.dispose();
      lightAssets.tailRunningMat.dispose();
      lightAssets.brakeOnlyMat.dispose();
      lightAssets.flarePlaneGeo.dispose();
      lightAssets.mainBeamGeo.dispose();
      lightAssets.rallyCornerBeamGeo.dispose();
      lightAssets.rallyRoofBeamGeo.dispose();
      lightAssets.headlightFlareMat.dispose();
      lightAssets.rallyAuxFlareMat.dispose();
      lightAssets.brakeFlareMat.dispose();
      lightAssets.mainBeamMat.dispose();
      lightAssets.rallyCornerBeamMat.dispose();
      lightAssets.rallyRoofBeamMat.dispose();
    };
  }, [lightAssets]);

  useFrame((_, delta) => {
    const steer = steerAngleRef ? steerAngleRef.current : steerAngle;
    const spin = wheelRotationRef ? wheelRotationRef.current : wheelRotation;
    if (frontLeftWheelRef.current) frontLeftWheelRef.current.rotation.y = steer;
    if (frontRightWheelRef.current) frontRightWheelRef.current.rotation.y = steer;
    if (flSpinRef.current) flSpinRef.current.rotation.x = spin;
    if (frSpinRef.current) frSpinRef.current.rotation.x = spin;
    if (rlSpinRef.current) rlSpinRef.current.rotation.x = spin;
    if (rrSpinRef.current) rrSpinRef.current.rotation.x = spin;

    const dt = Math.min(delta, 0.05);
    const targetHl = (headlightsOnRef ? headlightsOnRef.current : headlightsOn) ? 1 : 0;
    const targetBrake = Math.max(
      0,
      Math.min(1, brakeIntensityRef ? brakeIntensityRef.current : brakeIntensity)
    );

    hlSmoothRef.current = THREE.MathUtils.lerp(hlSmoothRef.current, targetHl, Math.min(1, dt * 18));
    brakeSmoothRef.current = THREE.MathUtils.lerp(brakeSmoothRef.current, targetBrake, Math.min(1, dt * 28));

    const hl = hlSmoothRef.current;
    const brk = brakeSmoothRef.current;
    const isNight = environmentTheme === 'night';
    const isSunset = environmentTheme === 'sunset';

    // 1. Headlight & Rally Aux emissive lens materials
    lightAssets.headlightMat.color.copy(lightPalette.hlOff).lerp(lightPalette.hlOn, hl);
    lightAssets.headlightMat.emissive.copy(lightPalette.hlEmissive);
    lightAssets.headlightMat.emissiveIntensity = hl * 4.0;

    lightAssets.rallyAuxMat.color.copy(lightAssets.auxOffColor).lerp(lightAssets.auxOnColor, hl);
    lightAssets.rallyAuxMat.emissiveIntensity = hl * 4.6;

    // 2. Running taillights & Brake-only strips
    lightAssets.tailRunningMat.color
      .copy(lightAssets.tailOffColor)
      .lerp(lightAssets.tailRunColor, hl)
      .lerp(lightAssets.tailBrkColor, brk);
    lightAssets.tailRunningMat.emissive
      .copy(lightAssets.tailRunEmissive)
      .lerp(lightAssets.tailBrkEmissive, brk);
    lightAssets.tailRunningMat.emissiveIntensity = 0.05 * (1 - hl) * (1 - brk) + 0.45 * hl + 5.2 * brk;

    lightAssets.brakeOnlyMat.color.copy(lightAssets.brakeOffColor).lerp(lightAssets.brakeOnColor, brk);
    lightAssets.brakeOnlyMat.emissiveIntensity = Math.max(0.04, 5.8 * brk);

    // 3. Additive lens flares & volumetric beams
    lightAssets.headlightFlareMat.uniforms.uColor.value.copy(lightPalette.hlEmissive);
    lightAssets.headlightFlareMat.uniforms.uIntensity.value = hl * (isNight ? 1.45 : isSunset ? 1.15 : 0.85);
    lightAssets.rallyAuxFlareMat.uniforms.uIntensity.value = hl * (isNight ? 1.65 : isSunset ? 1.3 : 0.95);
    lightAssets.brakeFlareMat.uniforms.uIntensity.value = brk * (isNight ? 1.8 : isSunset ? 1.5 : 1.25);

    const mainBeamOpacity = hl * (isNight ? 0.34 : isSunset ? 0.24 : 0.16);
    const rallyFloodOpacity = hl * (isNight ? 0.38 : isSunset ? 0.27 : 0.18);
    lightAssets.mainBeamMat.uniforms.uColor.value.copy(lightPalette.hlEmissive);
    lightAssets.mainBeamMat.uniforms.uOpacity.value = mainBeamOpacity;
    lightAssets.rallyCornerBeamMat.uniforms.uOpacity.value = rallyFloodOpacity;
    lightAssets.rallyRoofBeamMat.uniforms.uOpacity.value = rallyFloodOpacity;

    if (frontLightEffectsGroupRef.current) {
      frontLightEffectsGroupRef.current.visible = hl > 0.01;
    }
    if (rearBrakeFlaresGroupRef.current) {
      rearBrakeFlaresGroupRef.current.visible = brk > 0.02;
    }

    // 4. Real dynamic SpotLights & Brake PointLight (local player car only)
    if (enableRealLights) {
      const sideSpotInt =
        carClass === 'rally'
          ? hl * (isNight ? 200 : isSunset ? 150 : 110)
          : hl * (isNight ? 185 : isSunset ? 140 : 100);
      if (leftSpotRef.current) leftSpotRef.current.intensity = sideSpotInt;
      if (rightSpotRef.current) rightSpotRef.current.intensity = sideSpotInt;
      if (centerSpotRef.current) {
        centerSpotRef.current.intensity = hl * (isNight ? 250 : isSunset ? 190 : 135);
      }
      if (brakePointLightRef.current) {
        brakePointLightRef.current.intensity = brk * (isNight ? 30 : isSunset ? 22 : 16);
      }
    }
  });

  // Sculpted multi-layer 3D geometries for lower body (wide hips) + tapered greenhouse cabin (tumblehome)
  const sculptedGeos = useMemo(() => {
    const makeExtruded = (pts: [number, number][], width: number, bevelT = 0.07, bevelS = 0.05) => {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, {
        depth: width,
        bevelEnabled: true,
        bevelThickness: bevelT,
        bevelSize: bevelS,
        bevelSegments: 3,
      });
      g.rotateY(-Math.PI / 2);
      g.translate(width / 2, 0, 0);
      g.computeVertexNormals();
      return g;
    };

    // 1. GT Supercar: Sleek low nose, muscular beltline, narrow teardrop cabin
    const gtLower = makeExtruded(
      [
        [-2.22, 0.14],
        [2.24, 0.12],
        [2.34, 0.26],
        [2.22, 0.50],
        [1.55, 0.66],
        [0.82, 0.72],
        [-1.55, 0.76],
        [-2.18, 0.70],
        [-2.26, 0.38],
      ],
      1.86,
      0.09,
      0.06
    );
    const gtCabin = makeExtruded(
      [
        [-1.58, 0.68],
        [0.88, 0.66],
        [0.22, 1.15],
        [-0.68, 1.14],
      ],
      1.34,
      0.08,
      0.06
    );
    const gtGlass = makeExtruded(
      [
        [-1.48, 0.71],
        [0.82, 0.68],
        [0.20, 1.13],
        [-0.65, 1.12],
      ],
      1.38,
      0.03,
      0.02
    );

    // 2. Rally WRC Hatchback: Muscular high waist, steep hot-hatch rear tailgate
    const rallyLower = makeExtruded(
      [
        [-2.02, 0.18],
        [2.18, 0.16],
        [2.26, 0.34],
        [2.16, 0.62],
        [1.45, 0.74],
        [0.85, 0.78],
        [-1.88, 0.80],
        [-2.08, 0.44],
      ],
      1.84,
      0.08,
      0.06
    );
    const rallyCabin = makeExtruded(
      [
        [-1.82, 0.74],
        [0.86, 0.72],
        [0.28, 1.24],
        [-1.38, 1.22],
      ],
      1.38,
      0.07,
      0.05
    );
    const rallyGlass = makeExtruded(
      [
        [-1.75, 0.76],
        [0.80, 0.74],
        [0.25, 1.21],
        [-1.32, 1.19],
      ],
      1.42,
      0.03,
      0.02
    );

    // 3. Drift Pro JDM Coupe: Long low hood, sharp coupe roofline, kicked-up ducktail rear deck
    const driftLower = makeExtruded(
      [
        [-2.25, 0.13],
        [2.26, 0.12],
        [2.35, 0.25],
        [2.24, 0.48],
        [1.62, 0.62],
        [0.78, 0.68],
        [-1.48, 0.72],
        [-2.18, 0.78], // ducktail kick
        [-2.28, 0.36],
      ],
      1.88,
      0.08,
      0.06
    );
    const driftCabin = makeExtruded(
      [
        [-1.45, 0.64],
        [0.80, 0.64],
        [0.14, 1.12],
        [-0.72, 1.10],
      ],
      1.32,
      0.07,
      0.05
    );
    const driftGlass = makeExtruded(
      [
        [-1.36, 0.67],
        [0.74, 0.66],
        [0.12, 1.10],
        [-0.68, 1.08],
      ],
      1.36,
      0.03,
      0.02
    );

    // 4. F1 Nose & Sidepods sculpted profiles
    const f1Nose = makeExtruded(
      [
        [0.35, 0.04],
        [2.58, -0.10],
        [2.62, -0.01],
        [1.65, 0.22],
        [0.35, 0.36],
      ],
      0.46,
      0.05,
      0.04
    );

    // 5. Contour-hugging Racing Stripes (sit 1.4cm proud of beveled hood, roof & rear deck!)
    const gtStripe = makeExtruded(
      [
        [-2.22, 0.14],
        [2.24, 0.12],
        [2.34, 0.26],
        [2.22, 0.50],
        [1.55, 0.66],
        [0.82, 0.72],
        [-1.55, 0.76],
        [-2.18, 0.70],
        [-2.26, 0.38],
      ],
      0.13,
      0.105,
      0.01
    );
    const rallyStripe = makeExtruded(
      [
        [-2.02, 0.18],
        [2.18, 0.16],
        [2.26, 0.34],
        [2.16, 0.62],
        [1.45, 0.74],
        [0.85, 0.78],
        [-1.88, 0.80],
        [-2.08, 0.44],
      ],
      0.14,
      0.095,
      0.01
    );
    const driftStripe = makeExtruded(
      [
        [-2.25, 0.13],
        [2.26, 0.12],
        [2.35, 0.25],
        [2.24, 0.48],
        [1.62, 0.62],
        [0.78, 0.68],
        [-1.48, 0.72],
        [-2.18, 0.78],
        [-2.28, 0.36],
      ],
      0.12,
      0.095,
      0.01
    );

    return {
      gtLower, gtCabin, gtGlass, gtStripe,
      rallyLower, rallyCabin, rallyGlass, rallyStripe,
      driftLower, driftCabin, driftGlass, driftStripe,
      f1Nose,
    };
  }, []);

  const isF1 = carClass === 'f1';
  const rimColor =
    carClass === 'f1'
      ? '#ef4444'
      : carClass === 'rally'
      ? '#f8fafc'
      : carClass === 'drift'
      ? '#fbbf24'
      : '#cbd5e1';

  const wheelY = isF1 ? 0.56 : 0.42;
  const wheelX = isF1 ? 1.08 : 0.98;

  return (
    <group ref={ref} position={position} rotation={rotation}>
      {enableRealLights && (
        <>
          <primitive
            object={leftSpotTarget}
            dispose={null}
            position={carClass === 'rally' ? [-5.5, -0.8, 30] : [-2.2, -0.8, 28]}
          />
          <primitive
            object={rightSpotTarget}
            dispose={null}
            position={carClass === 'rally' ? [5.5, -0.8, 30] : [2.2, -0.8, 28]}
          />
          {carClass === 'rally' && (
            <primitive object={centerSpotTarget} dispose={null} position={[0, -1.0, 44]} />
          )}
          <spotLight
            ref={leftSpotRef}
            position={carClass === 'rally' ? [-0.72, 0.68, 2.30] : [-0.72, 0.58, 2.35]}
            color={lightPalette.spotHex}
            intensity={0}
            distance={carClass === 'rally' ? 95 : 80}
            angle={carClass === 'rally' ? 0.68 : 0.58}
            penumbra={0.65}
            decay={carClass === 'rally' ? 1.18 : 1.2}
            castShadow={false}
          />
          <spotLight
            ref={rightSpotRef}
            position={carClass === 'rally' ? [0.72, 0.68, 2.30] : [0.72, 0.58, 2.35]}
            color={lightPalette.spotHex}
            intensity={0}
            distance={carClass === 'rally' ? 95 : 80}
            angle={carClass === 'rally' ? 0.68 : 0.58}
            penumbra={0.65}
            decay={carClass === 'rally' ? 1.18 : 1.2}
            castShadow={false}
          />
          {carClass === 'rally' && (
            <spotLight
              ref={centerSpotRef}
              position={[0, 1.44, 0.45]}
              color="#fef9c3"
              intensity={0}
              distance={125}
              angle={0.64}
              penumbra={0.55}
              decay={1.15}
              castShadow={false}
            />
          )}
          <pointLight
            ref={brakePointLightRef}
            position={[0, 0.60, -2.55]}
            color="#ff1a1a"
            intensity={0}
            distance={11}
            decay={1.6}
          />
        </>
      )}
      {isF1 ? (
        /* ========================================================= */
        /* 🏎️ FÓRMULA 1 - MODERN GROUND-EFFECT GRAND PRIX CAR        */
        /* ========================================================= */
        <group position={[0, 0.42, 0]}>
          {/* 1. Carbon Floor + Venturi Side Tunnels + Bargeboards */}
          <mesh position={[0, -0.15, 0.02]} castShadow receiveShadow>
            <boxGeometry args={[1.92, 0.05, 4.18]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.3} />
          </mesh>
          {[-0.94, 0.94].map((sx, i) => (
            <mesh key={`fl_edge_${i}`} position={[sx, -0.11, -0.1]} castShadow>
              <boxGeometry args={[0.06, 0.08, 3.1]} />
              <meshStandardMaterial color="#1e293b" roughness={0.35} metalness={0.5} />
            </mesh>
          ))}

          {/* 2. Sculpted Monocoque Survival Cell */}
          <mesh position={[0, 0.14, -0.1]} castShadow receiveShadow>
            <boxGeometry args={[0.88, 0.40, 2.75]} />
            <meshStandardMaterial color={color} roughness={0.2} metalness={0.38} />
          </mesh>

          {/* 3. Sculpted Tapered Nose Cone */}
          <mesh geometry={sculptedGeos.f1Nose} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.2} metalness={0.38} />
          </mesh>
          {/* Racing Number Nose Badge */}
          <mesh position={[0, 0.17, 1.55]} rotation={[-Math.PI / 2 + 0.15, 0, 0]}>
            <planeGeometry args={[0.30, 0.45]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.3} />
          </mesh>
          {/* F1 Endurance Nose-Side LED Strips & Front Wing Lamp Strips */}
          {[-0.26, 0.26].map((nx, i) => (
            <mesh key={`f1_nl_${i}`} position={[nx, 0.11, 1.68]} material={lightAssets.headlightMat}>
              <boxGeometry args={[0.08, 0.065, 0.30]} />
            </mesh>
          ))}
          {[-0.94, 0.94].map((wx, i) => (
            <mesh key={`f1_wl_${i}`} position={[wx, -0.06, 2.62]} material={lightAssets.headlightMat}>
              <boxGeometry args={[0.18, 0.05, 0.06]} />
            </mesh>
          ))}
          <group ref={frontLightEffectsGroupRef}>
            {[-0.28, 0.28].map((nx, i) => (
              <mesh
                key={`f1_nfl_${i}`}
                position={[nx, 0.11, 1.85]}
                scale={[0.38, 0.32, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.headlightFlareMat}
              />
            ))}
            {[-0.94, 0.94].map((wx, i) => (
              <mesh
                key={`f1_wfl_${i}`}
                position={[wx, -0.06, 2.67]}
                scale={[0.52, 0.38, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.headlightFlareMat}
              />
            ))}
            {[-0.90, 0.90].map((bx, i) => (
              <mesh
                key={`f1_bm_${i}`}
                position={[bx, -0.06, 2.66]}
                rotation={[0.04, bx < 0 ? 0.03 : -0.03, 0]}
                geometry={lightAssets.mainBeamGeo}
                material={lightAssets.mainBeamMat}
              />
            ))}
          </group>

          {/* 4. Multi-Element Front Wing + Swept Endplates */}
          <group position={[0, -0.16, 2.56]}>
            <mesh castShadow>
              <boxGeometry args={[2.24, 0.045, 0.52]} />
              <meshStandardMaterial color="#0f172a" roughness={0.4} metalness={0.35} />
            </mesh>
            <mesh position={[0, 0.045, -0.06]} rotation={[-0.16, 0, 0]} castShadow>
              <boxGeometry args={[2.16, 0.035, 0.28]} />
              <meshStandardMaterial color={color} roughness={0.22} metalness={0.35} />
            </mesh>
            <mesh position={[0, 0.085, -0.14]} rotation={[-0.26, 0, 0]} castShadow>
              <boxGeometry args={[2.08, 0.03, 0.20]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.25} />
            </mesh>
            {[-1.11, 1.11].map((ex, i) => (
              <group key={`fw_ep_${i}`} position={[ex, 0.16, -0.02]}>
                <mesh rotation={[0, 0, ex < 0 ? 0.12 : -0.12]} castShadow>
                  <boxGeometry args={[0.05, 0.36, 0.64]} />
                  <meshStandardMaterial color={color} roughness={0.22} metalness={0.35} />
                </mesh>
                <mesh position={[ex < 0 ? -0.04 : 0.04, -0.12, 0.05]}>
                  <boxGeometry args={[0.10, 0.04, 0.48]} />
                  <meshStandardMaterial color="#0f172a" />
                </mesh>
              </group>
            ))}
          </group>

          {/* 5. Sculpted Downwash Sidepods + Radiator Intakes + Livery Stripe */}
          {[-1, 1].map((s) => (
            <group key={`sp_${s}`} position={[s * 0.68, 0.05, -0.12]}>
              <mesh rotation={[0.08, s * -0.06, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.56, 0.36, 2.05]} />
                <meshStandardMaterial color={color} roughness={0.2} metalness={0.38} />
              </mesh>
              {/* White/Black Aero Sidepod Stripe */}
              <mesh position={[s * 0.285, 0.04, 0.05]} rotation={[0.08, s * -0.06, 0]}>
                <boxGeometry args={[0.02, 0.10, 1.75]} />
                <meshStandardMaterial color={secondaryColor} roughness={0.3} />
              </mesh>
              {/* Dark Cooling Scoop */}
              <mesh position={[0, 0.04, 1.03]}>
                <boxGeometry args={[0.44, 0.22, 0.06]} />
                <meshStandardMaterial color="#020617" roughness={0.9} />
              </mesh>
            </group>
          ))}

          {/* 6. Cockpit + Driver Helmet + Visor + Titanium Halo */}
          <mesh position={[0, 0.35, 0.22]}>
            <boxGeometry args={[0.56, 0.16, 0.98]} />
            <meshStandardMaterial color="#020617" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.52, 0.10]} castShadow>
            <sphereGeometry args={[0.21, 20, 20]} />
            <meshStandardMaterial color="#facc15" roughness={0.14} metalness={0.65} />
          </mesh>
          <mesh position={[0, 0.54, 0.26]}>
            <boxGeometry args={[0.26, 0.09, 0.12]} />
            <meshStandardMaterial color="#090d16" roughness={0.05} metalness={0.95} />
          </mesh>
          {/* Halo Central Pylon & Curved Titanium Arch */}
          <mesh position={[0, 0.55, 0.54]} rotation={[0.45, 0, 0]} castShadow>
            <cylinderGeometry args={[0.032, 0.038, 0.30, 10]} />
            <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.64, 0.20]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.32, 0.042, 10, 22, Math.PI * 1.15]} />
            <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.7} />
          </mesh>

          {/* 7. Roll-Hoop Airbox + T-Cam + Shark Fin + Exhaust */}
          <mesh position={[0, 0.56, -0.48]} rotation={[-0.12, 0, 0]} castShadow>
            <boxGeometry args={[0.40, 0.34, 0.95]} />
            <meshStandardMaterial color={color} roughness={0.2} metalness={0.38} />
          </mesh>
          <mesh position={[0, 0.66, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.10, 12]} />
            <meshStandardMaterial color="#020617" />
          </mesh>
          {/* F1 T-Cam */}
          <mesh position={[0, 0.80, -0.18]}>
            <boxGeometry args={[0.28, 0.04, 0.08]} />
            <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.6} />
          </mesh>
          {/* Carbon Shark Fin */}
          <mesh position={[0, 0.64, -1.18]} castShadow>
            <boxGeometry args={[0.05, 0.40, 1.15]} />
            <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.4} />
          </mesh>
          {/* Central Turbo Exhaust Pipe */}
          <mesh position={[0, 0.34, -1.96]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.24, 14]} />
            <meshStandardMaterial color="#64748b" roughness={0.25} metalness={0.9} />
          </mesh>

          {/* 8. Double-Wishbone Carbon Suspension + Front Wheel Deflectors */}
          {[-1, 1].map((s) => (
            <React.Fragment key={`susp_${s}`}>
              <mesh position={[s * 0.72, 0.14, 1.45]} rotation={[0, 0, s * -0.04]}>
                <boxGeometry args={[0.82, 0.035, 0.10]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.7} />
              </mesh>
              <mesh position={[s * 0.72, -0.02, 1.45]} rotation={[0, 0, s * 0.06]}>
                <boxGeometry args={[0.82, 0.035, 0.10]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.7} />
              </mesh>
              <mesh position={[s * 0.75, 0.08, -1.25]} rotation={[0, 0, s * 0.04]}>
                <boxGeometry args={[0.84, 0.045, 0.14]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.7} />
              </mesh>
            </React.Fragment>
          ))}

          {/* 9. Sculpted DRS Rear Wing + Diffuser + FIA Rain Light */}
          <group position={[0, 0.64, -1.96]}>
            {[-0.18, 0.18].map((px, i) => (
              <mesh key={`rw_p_${i}`} position={[px, -0.26, 0.10]} rotation={[0.18, 0, 0]} castShadow>
                <boxGeometry args={[0.05, 0.52, 0.28]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} />
              </mesh>
            ))}
            <mesh position={[0, 0.04, 0.02]} castShadow>
              <boxGeometry args={[1.92, 0.055, 0.44]} />
              <meshStandardMaterial color={color} roughness={0.22} metalness={0.35} />
            </mesh>
            <mesh position={[0, 0.19, -0.14]} rotation={[0.32, 0, 0]} castShadow>
              <boxGeometry args={[1.88, 0.045, 0.24]} />
              <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.4} />
            </mesh>
            {/* DRS Actuator Pod */}
            <mesh position={[0, 0.14, -0.02]}>
              <boxGeometry args={[0.08, 0.14, 0.18]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
            {[-0.96, 0.96].map((ex, i) => (
              <React.Fragment key={`rw_ep_${i}`}>
                <mesh position={[ex, -0.04, 0]} castShadow>
                  <boxGeometry args={[0.045, 0.52, 0.62]} />
                  <meshStandardMaterial color={color} roughness={0.22} metalness={0.35} />
                </mesh>
                {/* Vertical Rear Wing Endplate LED Brake Strip */}
                <mesh position={[ex, -0.04, -0.32]} material={lightAssets.brakeOnlyMat}>
                  <boxGeometry args={[0.055, 0.38, 0.04]} />
                </mesh>
              </React.Fragment>
            ))}
          </group>
          {/* Rear Diffuser Tunnels & FIA Rain/Brake Light */}
          <mesh position={[0, -0.05, -2.02]}>
            <boxGeometry args={[1.45, 0.18, 0.16]} />
            <meshStandardMaterial color="#090d16" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.02, -2.08]} material={lightAssets.tailRunningMat}>
            <boxGeometry args={[0.14, 0.20, 0.06]} />
          </mesh>
          <group ref={rearBrakeFlaresGroupRef}>
            <mesh
              position={[0, 0.02, -2.14]}
              scale={[0.55, 0.55, 1]}
              geometry={lightAssets.flarePlaneGeo}
              material={lightAssets.brakeFlareMat}
            />
            {[-0.96, 0.96].map((ex, i) => (
              <mesh
                key={`f1_bfl_${i}`}
                position={[ex, 0.60, -2.33]}
                scale={[0.42, 0.68, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.brakeFlareMat}
              />
            ))}
          </group>
        </group>
      ) : carClass === 'rally' ? (
        /* ========================================================= */
        /* 🌲 RALLY WRC - WIDEBODY RALLY1 HATCHBACK                  */
        /* ========================================================= */
        <group position={[0, 0.02, 0]}>
          {/* Wide Lower Body + Black Tinted Greenhouse Windows + Roof Panel */}
          <mesh geometry={sculptedGeos.rallyLower} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.24} metalness={0.35} />
          </mesh>
          <mesh geometry={sculptedGeos.rallyCabin} castShadow receiveShadow>
            <meshStandardMaterial color="#090d16" roughness={0.08} metalness={0.88} />
          </mesh>
          {/* Painted Roof Cap over the Black Windows */}
          <mesh position={[0, 1.29, -0.54]} castShadow>
            <boxGeometry args={[1.32, 0.04, 1.56]} />
            <meshStandardMaterial color={color} roughness={0.24} metalness={0.35} />
          </mesh>
          {/* Twin WRC Racing Stripes (Hood + Roof + Tailgate + Side Doors) */}
          {[-0.22, 0.22].map((sx, i) => (
            <React.Fragment key={`r_str_${i}`}>
              <mesh geometry={sculptedGeos.rallyStripe} position={[sx, 0, 0]}>
                <meshStandardMaterial color={secondaryColor} roughness={0.25} />
              </mesh>
              <mesh position={[sx, 1.315, -0.54]}>
                <boxGeometry args={[0.15, 0.015, 1.56]} />
                <meshStandardMaterial color={secondaryColor} roughness={0.25} />
              </mesh>
            </React.Fragment>
          ))}
          {[-0.985, 0.985].map((dx, i) => (
            <React.Fragment key={`r_side_${i}`}>
              <mesh position={[dx, 0.36, 0.08]}>
                <boxGeometry args={[0.025, 0.09, 2.05]} />
                <meshStandardMaterial color="#f8fafc" roughness={0.25} />
              </mesh>
              <mesh position={[dx, 0.46, 0.08]}>
                <boxGeometry args={[0.025, 0.05, 1.75]} />
                <meshStandardMaterial color="#090d16" roughness={0.3} />
              </mesh>
            </React.Fragment>
          ))}

          <FenderArches flareColor={color} flareWidth={0.22} />

          {/* Rally Mudflaps behind all 4 wheels */}
          {[
            [-0.96, 0.22, 1.02],
            [0.96, 0.22, 1.02],
            [-0.98, 0.22, -1.68],
            [0.98, 0.22, -1.68],
          ].map(([mx, my, mz], i) => (
            <mesh key={`mud_${i}`} position={[mx, my, mz]}>
              <boxGeometry args={[0.28, 0.24, 0.03]} />
              <meshStandardMaterial color="#ef4444" roughness={0.6} />
            </mesh>
          ))}

          {/* Aluminium Front Skidplate + Lower Bumper Fog Lamps + Expanded 6-Lamp WRC Rally Pod */}
          <mesh position={[0, 0.18, 2.25]} rotation={[-0.25, 0, 0]} castShadow>
            <boxGeometry args={[1.45, 0.14, 0.24]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} metalness={0.8} />
          </mesh>
          {/* 2x Lower Bumper Rally Fog Lamps */}
          {[-0.70, 0.70].map((fx, i) => (
            <group key={`bfog_${i}`} position={[fx, 0.30, 2.26]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.085, 0.09, 0.09, 14]} />
                <meshStandardMaterial color="#0f172a" roughness={0.45} />
              </mesh>
              <mesh position={[0, 0, 0.04]} material={lightAssets.rallyAuxMat}>
                <sphereGeometry args={[0.072, 12, 12]} />
              </mesh>
            </group>
          ))}
          {/* Expanded Wide Carbon Hood Rally Light Pod (4 Forward + 2 Outward Cornering) */}
          <mesh position={[0, 0.71, 1.90]} castShadow>
            <boxGeometry args={[1.28, 0.15, 0.24]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} />
          </mesh>
          {[-0.42, -0.14, 0.14, 0.42].map((fx, i) => (
            <group key={`fog_${i}`} position={[fx, 0.72, 2.01]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.105, 0.11, 0.08, 14]} />
                <meshStandardMaterial color="#090d16" roughness={0.45} />
              </mesh>
              <mesh position={[0, 0, 0.03]} material={lightAssets.rallyAuxMat}>
                <sphereGeometry args={[0.095, 12, 12]} />
              </mesh>
            </group>
          ))}
          {/* 2x Angled Outer Cornering Rally Pods */}
          {[-0.67, 0.67].map((cx, i) => (
            <group key={`cpod_${i}`} position={[cx, 0.67, 1.95]} rotation={[0, cx < 0 ? -0.26 : 0.26, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.095, 0.10, 0.10, 14]} />
                <meshStandardMaterial color="#090d16" roughness={0.45} />
              </mesh>
              <mesh position={[0, 0, 0.04]} material={lightAssets.rallyAuxMat}>
                <sphereGeometry args={[0.085, 12, 12]} />
              </mesh>
            </group>
          ))}

          {/* Roof Air Scoop (shifted back to clear Roof Light Bar) + 4-Lamp Roof Light Bar + Door Number Panels */}
          <mesh position={[0, 1.34, -0.22]} castShadow>
            <boxGeometry args={[0.42, 0.11, 0.58]} />
            <meshStandardMaterial color="#0f172a" roughness={0.25} />
          </mesh>
          <mesh position={[0, 1.33, 0.16]} castShadow>
            <boxGeometry args={[1.18, 0.04, 0.10]} />
            <meshStandardMaterial color="#090d16" roughness={0.35} />
          </mesh>
          {[-0.56, 0.56].map((sx, i) => (
            <mesh key={`rbar_st_${i}`} position={[sx, 1.31, 0.16]}>
              <boxGeometry args={[0.05, 0.07, 0.12]} />
              <meshStandardMaterial color="#0f172a" roughness={0.4} />
            </mesh>
          ))}
          {[-0.42, -0.14, 0.14, 0.42].map((rx, i) => (
            <group key={`rbar_${i}`} position={[rx, 1.41, 0.20]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.085, 0.085, 0.11, 14]} />
                <meshStandardMaterial color="#0f172a" roughness={0.35} />
              </mesh>
              <mesh position={[0, 0, 0.06]} material={lightAssets.rallyAuxMat}>
                <sphereGeometry args={[0.075, 12, 12]} />
              </mesh>
            </group>
          ))}
          {[-0.99, 0.99].map((dx, i) => (
            <mesh key={`num_${i}`} position={[dx, 0.56, 0.18]}>
              <boxGeometry args={[0.03, 0.34, 0.68]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.3} />
            </mesh>
          ))}

          {/* Headlights & Grille */}
          <mesh position={[0, 0.42, 2.24]}>
            <boxGeometry args={[1.05, 0.22, 0.05]} />
            <meshStandardMaterial color="#090d16" roughness={0.8} />
          </mesh>
          {[-0.72, 0.72].map((hx, idx) => (
            <mesh key={`hl_${idx}`} position={[hx, 0.50, 2.22]} material={lightAssets.headlightMat}>
              <boxGeometry args={[0.34, 0.13, 0.08]} />
            </mesh>
          ))}

          {/* Rally Front Additive Lens Flares & Multi-Zone Volumetric Beams */}
          <group ref={frontLightEffectsGroupRef}>
            {[-0.72, 0.72].map((hx, i) => (
              <React.Fragment key={`r_hl_fx_${i}`}>
                <mesh
                  position={[hx, 0.50, 2.28]}
                  scale={[0.65, 0.55, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.headlightFlareMat}
                />
                <mesh
                  position={[hx, 0.50, 2.28]}
                  rotation={[0.055, hx < 0 ? 0.03 : -0.03, 0]}
                  geometry={lightAssets.mainBeamGeo}
                  material={lightAssets.mainBeamMat}
                />
              </React.Fragment>
            ))}
            {[-0.70, 0.70].map((fx, i) => (
              <mesh
                key={`r_bfog_fl_${i}`}
                position={[fx, 0.30, 2.37]}
                scale={[0.48, 0.48, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.rallyAuxFlareMat}
              />
            ))}
            {[-0.42, -0.14, 0.14, 0.42].map((fx, i) => (
              <mesh
                key={`r_pod_fl_${i}`}
                position={[fx, 0.72, 2.13]}
                scale={[0.55, 0.55, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.rallyAuxFlareMat}
              />
            ))}
            {[-0.28, 0.28].map((px, i) => (
              <mesh
                key={`r_pod_bm_${i}`}
                position={[px, 0.72, 2.10]}
                rotation={[0.05, px < 0 ? 0.03 : -0.03, 0]}
                geometry={lightAssets.mainBeamGeo}
                material={lightAssets.mainBeamMat}
              />
            ))}
            {[-0.67, 0.67].map((cx, i) => (
              <group key={`r_cpod_fx_${i}`} position={[cx, 0.67, 1.95]} rotation={[0.04, cx < 0 ? -0.26 : 0.26, 0]}>
                <mesh
                  position={[0, 0, 0.12]}
                  scale={[0.52, 0.52, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.rallyAuxFlareMat}
                />
                <mesh
                  position={[0, 0, 0.08]}
                  geometry={lightAssets.rallyCornerBeamGeo}
                  material={lightAssets.rallyCornerBeamMat}
                />
              </group>
            ))}
            {[-0.42, -0.14, 0.14, 0.42].map((rx, i) => (
              <mesh
                key={`r_roof_fl_${i}`}
                position={[rx, 1.41, 0.34]}
                scale={[0.50, 0.50, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.rallyAuxFlareMat}
              />
            ))}
            {[-0.28, 0.28].map((rx, i) => (
              <mesh
                key={`r_roof_bm_${i}`}
                position={[rx, 1.41, 0.55]}
                rotation={[0.075, rx < 0 ? -0.06 : 0.06, 0]}
                geometry={lightAssets.rallyRoofBeamGeo}
                material={lightAssets.rallyRoofBeamMat}
              />
            ))}
          </group>

          {/* WRC Multi-Tier Bi-Plane Roof Wing */}
          <group position={[0, 1.22, -1.82]}>
            <mesh position={[0, 0.06, 0]} castShadow>
              <boxGeometry args={[1.76, 0.05, 0.42]} />
              <meshStandardMaterial color="#0f172a" roughness={0.35} />
            </mesh>
            <mesh position={[0, -0.10, 0.04]} castShadow>
              <boxGeometry args={[1.68, 0.04, 0.34]} />
              <meshStandardMaterial color={color} roughness={0.25} />
            </mesh>
            {[-0.86, 0.86].map((wx, i) => (
              <mesh key={`wrc_w_${i}`} position={[wx, -0.04, 0]} castShadow>
                <boxGeometry args={[0.05, 0.34, 0.48]} />
                <meshStandardMaterial color={color} roughness={0.25} />
              </mesh>
            ))}
          </group>

          {/* Rear Diffuser + Taillights + High-Mount WRC 3rd Brake Strip + Twin Rally Exhaust */}
          <mesh position={[0, 0.24, -2.06]}>
            <boxGeometry args={[1.58, 0.20, 0.12]} />
            <meshStandardMaterial color="#090d16" roughness={0.6} />
          </mesh>
          {[-0.68, 0.68].map((tx, idx) => (
            <mesh key={`tl_${idx}`} position={[tx, 0.64, -2.03]} material={lightAssets.tailRunningMat}>
              <boxGeometry args={[0.42, 0.13, 0.06]} />
            </mesh>
          ))}
          <mesh position={[0, 1.17, -1.80]} material={lightAssets.brakeOnlyMat}>
            <boxGeometry args={[0.54, 0.055, 0.06]} />
          </mesh>
          <group ref={rearBrakeFlaresGroupRef}>
            {[-0.68, 0.68].map((tx, i) => (
              <mesh
                key={`r_tl_fl_${i}`}
                position={[tx, 0.64, -2.09]}
                scale={[0.85, 0.55, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.brakeFlareMat}
              />
            ))}
            <mesh
              position={[0, 1.17, -1.86]}
              scale={[0.75, 0.42, 1]}
              geometry={lightAssets.flarePlaneGeo}
              material={lightAssets.brakeFlareMat}
            />
          </group>
          {[-0.38, 0.38].map((ex, i) => (
            <mesh key={`ex_${i}`} position={[ex, 0.22, -2.12]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.16, 12]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
            </mesh>
          ))}
        </group>
      ) : carClass === 'drift' ? (
        /* ========================================================= */
        /* 🔥 DRIFT PRO - JDM WIDEBODY TUNER COUPE                   */
        /* ========================================================= */
        <group position={[0, 0.02, 0]}>
          {/* Low Widebody + Narrow Sloped JDM Greenhouse + Ducktail */}
          <mesh geometry={sculptedGeos.driftLower} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.18} metalness={0.48} />
          </mesh>
          <mesh geometry={sculptedGeos.driftCabin} castShadow receiveShadow>
            <meshStandardMaterial color="#090d16" roughness={0.08} metalness={0.88} />
          </mesh>
          {/* JDM Offset Gold/White Livery Stripes (Hood + Roof + Side Doors) */}
          {[-0.18, 0.18].map((sx, i) => (
            <React.Fragment key={`d_str_${i}`}>
              <mesh geometry={sculptedGeos.driftStripe} position={[sx, 0, 0]}>
                <meshStandardMaterial color={i === 0 ? secondaryColor : '#f8fafc'} roughness={0.22} metalness={0.4} />
              </mesh>
              <mesh position={[sx, 1.165, -0.28]}>
                <boxGeometry args={[0.13, 0.015, 0.86]} />
                <meshStandardMaterial color={i === 0 ? secondaryColor : '#f8fafc'} roughness={0.22} metalness={0.4} />
              </mesh>
            </React.Fragment>
          ))}
          {[-1.00, 1.00].map((dx, i) => (
            <mesh key={`d_side_${i}`} position={[dx, 0.42, 0.08]}>
              <boxGeometry args={[0.025, 0.08, 2.08]} />
              <meshStandardMaterial color="#fbbf24" roughness={0.25} metalness={0.5} />
            </mesh>
          ))}

          {/* Extra-Wide Riveted Overfenders */}
          <FenderArches flareColor={color} flareWidth={0.24} />

          {/* Exposed Front-Mount Intercooler (FMIC) + Blue Silicone Couplers + Splitter */}
          <mesh position={[0, 0.10, 2.32]} castShadow>
            <boxGeometry args={[2.08, 0.05, 0.38]} />
            <meshStandardMaterial color="#090d16" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.26, 2.31]}>
            <boxGeometry args={[0.88, 0.22, 0.08]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.25} metalness={0.9} />
          </mesh>
          {[-0.48, 0.48].map((ix, i) => (
            <mesh key={`ic_${i}`} position={[ix, 0.24, 2.30]}>
              <boxGeometry args={[0.10, 0.14, 0.10]} />
              <meshStandardMaterial color="#0284c7" roughness={0.3} />
            </mesh>
          ))}

          {/* Carbon Vented Hood + Angry-Eye JDM LED Headlights + Lower Bumper LED Strips */}
          <mesh position={[0, 0.64, 1.48]} rotation={[0.09, 0, 0]}>
            <boxGeometry args={[1.18, 0.03, 1.25]} />
            <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.4} />
          </mesh>
          {[-0.72, 0.72].map((hx, idx) => (
            <React.Fragment key={`d_hl_${idx}`}>
              <mesh
                position={[hx, 0.44, 2.26]}
                rotation={[0, 0, idx === 0 ? -0.12 : 0.12]}
                material={lightAssets.headlightMat}
              >
                <boxGeometry args={[0.38, 0.09, 0.08]} />
              </mesh>
              <mesh position={[hx, 0.26, 2.30]} material={lightAssets.headlightMat}>
                <boxGeometry args={[0.32, 0.05, 0.06]} />
              </mesh>
            </React.Fragment>
          ))}
          <group ref={frontLightEffectsGroupRef}>
            {[-0.72, 0.72].map((hx, i) => (
              <React.Fragment key={`d_hl_fx_${i}`}>
                <mesh
                  position={[hx, 0.44, 2.33]}
                  scale={[0.68, 0.48, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.headlightFlareMat}
                />
                <mesh
                  position={[hx, 0.26, 2.36]}
                  scale={[0.48, 0.35, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.headlightFlareMat}
                />
                <mesh
                  position={[hx, 0.44, 2.32]}
                  rotation={[0.055, hx < 0 ? 0.03 : -0.03, 0]}
                  geometry={lightAssets.mainBeamGeo}
                  material={lightAssets.mainBeamMat}
                />
              </React.Fragment>
            ))}
          </group>

          {/* Side Skirts + Neon Underglow Accent Strip */}
          {[-0.98, 0.98].map((sx, i) => (
            <React.Fragment key={`dsk_${i}`}>
              <mesh position={[sx, 0.13, 0.08]} castShadow>
                <boxGeometry args={[0.16, 0.08, 2.22]} />
                <meshStandardMaterial color="#090d16" roughness={0.4} />
              </mesh>
              <mesh position={[sx * 0.96, 0.08, 0.08]}>
                <boxGeometry args={[0.04, 0.025, 2.0]} />
                <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={2.5} />
              </mesh>
            </React.Fragment>
          ))}

          {/* JDM Smoked Tail-Light Bar + Ducktail 3rd Brake Strip + Angled Titanium Blast Pipes */}
          <mesh position={[0, 0.56, -2.23]}>
            <boxGeometry args={[1.68, 0.14, 0.05]} />
            <meshStandardMaterial color="#090d16" roughness={0.2} />
          </mesh>
          {[-0.64, -0.32, 0.32, 0.64].map((tx, idx) => (
            <mesh
              key={`dtl_${idx}`}
              position={[tx, 0.56, -2.25]}
              rotation={[Math.PI / 2, 0, 0]}
              material={lightAssets.tailRunningMat}
            >
              <cylinderGeometry args={[0.055, 0.055, 0.04, 14]} />
            </mesh>
          ))}
          <mesh position={[0, 0.78, -2.18]} material={lightAssets.brakeOnlyMat}>
            <boxGeometry args={[0.48, 0.045, 0.05]} />
          </mesh>
          <group ref={rearBrakeFlaresGroupRef}>
            {[-0.64, -0.32, 0.32, 0.64].map((tx, i) => (
              <mesh
                key={`d_tl_fl_${i}`}
                position={[tx, 0.56, -2.30]}
                scale={[0.48, 0.48, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.brakeFlareMat}
              />
            ))}
            <mesh
              position={[0, 0.78, -2.24]}
              scale={[0.72, 0.40, 1]}
              geometry={lightAssets.flarePlaneGeo}
              material={lightAssets.brakeFlareMat}
            />
          </group>
          {/* Angled Titanium Shotgun Exhausts */}
          {[0.58, 0.72].map((ex, i) => (
            <mesh key={`bpipe_${i}`} position={[ex, 0.20, -2.32]} rotation={[Math.PI / 2 - 0.18, 0, -0.15]}>
              <cylinderGeometry args={[0.065, 0.065, 0.28, 12]} />
              <meshStandardMaterial color="#38bdf8" metalness={0.95} roughness={0.15} />
            </mesh>
          ))}

          {/* Tall Chassis-Mount Drift Wing */}
          <group position={[0, 1.14, -2.14]}>
            {[-0.62, 0.62].map((px, i) => (
              <mesh key={`dw_p_${i}`} position={[px, -0.38, 0.04]} rotation={[0.14, 0, 0]} castShadow>
                <boxGeometry args={[0.04, 0.76, 0.16]} />
                <meshStandardMaterial color="#090d16" metalness={0.7} />
              </mesh>
            ))}
            <mesh castShadow>
              <boxGeometry args={[2.06, 0.05, 0.38]} />
              <meshStandardMaterial color="#090d16" roughness={0.3} metalness={0.5} />
            </mesh>
            {[-1.03, 1.03].map((wx, i) => (
              <mesh key={`dw_ep_${i}`} position={[wx, -0.02, 0]} castShadow>
                <boxGeometry args={[0.04, 0.26, 0.44]} />
                <meshStandardMaterial color={color} roughness={0.2} />
              </mesh>
            ))}
          </group>
        </group>
      ) : (
        /* ========================================================= */
        /* 🏁 GT RACING - GT3 SUPERCAR (WIDE HIPS + TEARDROP CABIN)  */
        /* ========================================================= */
        <group position={[0, 0.02, 0]}>
          {/* Lower Widebody Hips + Black Tinted Greenhouse Windows + Roof Cap */}
          <mesh geometry={sculptedGeos.gtLower} castShadow receiveShadow>
            <meshStandardMaterial color={color} roughness={0.2} metalness={0.42} />
          </mesh>
          <mesh geometry={sculptedGeos.gtCabin} castShadow receiveShadow>
            <meshStandardMaterial color="#090d16" roughness={0.08} metalness={0.88} />
          </mesh>
          {/* Painted Roof Cap over the Black Windows */}
          <mesh position={[0, 1.22, -0.23]} castShadow>
            <boxGeometry args={[1.28, 0.04, 0.92]} />
            <meshStandardMaterial color={color} roughness={0.2} metalness={0.42} />
          </mesh>

          <FenderArches flareColor={color} flareWidth={0.20} />

          {/* Full Contour-Hugging Twin GT Racing Stripes (Bumper -> Hood -> Roof -> Rear Deck + Side Doors) */}
          {[-0.17, 0.17].map((sx, i) => (
            <React.Fragment key={`str_${i}`}>
              <mesh geometry={sculptedGeos.gtStripe} position={[sx, 0, 0]}>
                <meshStandardMaterial color={secondaryColor} roughness={0.22} />
              </mesh>
              <mesh position={[sx, 1.245, -0.23]}>
                <boxGeometry args={[0.14, 0.015, 0.92]} />
                <meshStandardMaterial color={secondaryColor} roughness={0.22} />
              </mesh>
            </React.Fragment>
          ))}
          {[-0.995, 0.995].map((dx, i) => (
            <mesh key={`gt_side_${i}`} position={[dx, 0.38, 0.08]}>
              <boxGeometry args={[0.025, 0.08, 2.08]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.22} />
            </mesh>
          ))}

          {/* Carbon Front Splitter, Diveplanes (Canards) & Side Skirts */}
          <mesh position={[0, 0.11, 2.28]} castShadow>
            <boxGeometry args={[2.04, 0.05, 0.36]} />
            <meshStandardMaterial color="#090d16" roughness={0.45} />
          </mesh>
          {[-0.96, 0.96].map((sx, i) => (
            <React.Fragment key={`gt_aero_${i}`}>
              <mesh position={[sx, 0.14, 0.08]} castShadow>
                <boxGeometry args={[0.14, 0.10, 2.18]} />
                <meshStandardMaterial color="#090d16" roughness={0.45} />
              </mesh>
              <mesh position={[sx, 0.28, 2.12]} rotation={[0.25, 0, sx < 0 ? 0.3 : -0.3]}>
                <boxGeometry args={[0.16, 0.03, 0.24]} />
                <meshStandardMaterial color="#090d16" />
              </mesh>
            </React.Fragment>
          ))}

          {/* GT3 Front Grille + Matrix LED Headlights + Lower Endurance Bumper LED Bars */}
          <mesh position={[0, 0.34, 2.28]}>
            <boxGeometry args={[1.12, 0.20, 0.05]} />
            <meshStandardMaterial color="#020617" roughness={0.8} />
          </mesh>
          {[-0.74, 0.74].map((hx, idx) => (
            <React.Fragment key={`gt_hl_${idx}`}>
              <mesh position={[hx, 0.45, 2.24]} material={lightAssets.headlightMat}>
                <boxGeometry args={[0.34, 0.11, 0.08]} />
              </mesh>
              <mesh position={[hx, 0.28, 2.29]} material={lightAssets.headlightMat}>
                <boxGeometry args={[0.30, 0.055, 0.06]} />
              </mesh>
            </React.Fragment>
          ))}
          <group ref={frontLightEffectsGroupRef}>
            {[-0.74, 0.74].map((hx, i) => (
              <React.Fragment key={`gt_hl_fx_${i}`}>
                <mesh
                  position={[hx, 0.45, 2.31]}
                  scale={[0.65, 0.50, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.headlightFlareMat}
                />
                <mesh
                  position={[hx, 0.28, 2.35]}
                  scale={[0.48, 0.35, 1]}
                  geometry={lightAssets.flarePlaneGeo}
                  material={lightAssets.headlightFlareMat}
                />
                <mesh
                  position={[hx, 0.45, 2.30]}
                  rotation={[0.055, hx < 0 ? 0.03 : -0.03, 0]}
                  geometry={lightAssets.mainBeamGeo}
                  material={lightAssets.mainBeamMat}
                />
              </React.Fragment>
            ))}
          </group>

          {/* Full-Width GT3 LED Rear Lightbar + Outer Brake Clusters + 3rd Center Brake Strip + Diffuser */}
          <mesh position={[0, 0.20, -2.24]}>
            <boxGeometry args={[1.68, 0.20, 0.14]} />
            <meshStandardMaterial color="#090d16" roughness={0.55} />
          </mesh>
          {[-0.55, -0.28, 0.28, 0.55].map((fx, i) => (
            <mesh key={`fin_${i}`} position={[fx, 0.16, -2.28]}>
              <boxGeometry args={[0.03, 0.18, 0.16]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
          ))}
          {[-0.12, 0.12].map((ex, i) => (
            <mesh key={`gt_ex_${i}`} position={[ex, 0.22, -2.30]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.068, 0.068, 0.16, 14]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.92} roughness={0.18} />
            </mesh>
          ))}
          {/* Full-width glowing red GT3 lightbar */}
          <mesh position={[0, 0.58, -2.22]} material={lightAssets.tailRunningMat}>
            <boxGeometry args={[1.62, 0.07, 0.06]} />
          </mesh>
          {/* Outer GT3 Brake Lamp Clusters & High-Mount 3rd Brake Strip */}
          {[-0.66, 0.66].map((bx, i) => (
            <mesh key={`gt_brk_${i}`} position={[bx, 0.58, -2.235]} material={lightAssets.brakeOnlyMat}>
              <boxGeometry args={[0.42, 0.11, 0.06]} />
            </mesh>
          ))}
          <mesh position={[0, 0.78, -1.62]} material={lightAssets.brakeOnlyMat}>
            <boxGeometry args={[0.46, 0.045, 0.05]} />
          </mesh>
          <group ref={rearBrakeFlaresGroupRef}>
            {[-0.66, 0.66].map((bx, i) => (
              <mesh
                key={`gt_tl_fl_${i}`}
                position={[bx, 0.58, -2.29]}
                scale={[0.88, 0.55, 1]}
                geometry={lightAssets.flarePlaneGeo}
                material={lightAssets.brakeFlareMat}
              />
            ))}
            <mesh
              position={[0, 0.78, -1.68]}
              scale={[0.72, 0.40, 1]}
              geometry={lightAssets.flarePlaneGeo}
              material={lightAssets.brakeFlareMat}
            />
          </group>

          {/* Swan-Neck GT3 Carbon Rear Wing */}
          <group position={[0, 1.08, -2.04]}>
            {[-0.52, 0.52].map((px, i) => (
              <mesh key={`gt_p_${i}`} position={[px, -0.18, 0.08]} rotation={[0.22, 0, 0]} castShadow>
                <boxGeometry args={[0.05, 0.38, 0.18]} />
                <meshStandardMaterial color="#090d16" roughness={0.35} />
              </mesh>
            ))}
            <mesh castShadow>
              <boxGeometry args={[1.98, 0.055, 0.38]} />
              <meshStandardMaterial color="#090d16" roughness={0.3} metalness={0.4} />
            </mesh>
            {[-0.99, 0.99].map((wx, i) => (
              <mesh key={`gt_ep_${i}`} position={[wx, -0.04, 0]} castShadow>
                <boxGeometry args={[0.04, 0.26, 0.44]} />
                <meshStandardMaterial color={color} roughness={0.22} />
              </mesh>
            ))}
          </group>
        </group>
      )}

      {/* 4 WHEELS (with 5-spoke 3D rims, rounded tire shoulders, rotors & Brembo calipers) */}
      <group ref={frontLeftWheelRef} position={[-wheelX, wheelY, 1.45]}>
        <CarWheel isFront side={-1} carClass={carClass} rimColor={rimColor} spinRef={flSpinRef} wheelRotation={wheelRotation} />
      </group>
      <group ref={frontRightWheelRef} position={[wheelX, wheelY, 1.45]}>
        <CarWheel isFront side={1} carClass={carClass} rimColor={rimColor} spinRef={frSpinRef} wheelRotation={wheelRotation} />
      </group>
      <group ref={rearLeftWheelRef} position={[-(isF1 ? 1.12 : wheelX), wheelY, -1.25]}>
        <CarWheel side={-1} carClass={carClass} rimColor={rimColor} spinRef={rlSpinRef} wheelRotation={wheelRotation} />
      </group>
      <group ref={rearRightWheelRef} position={[isF1 ? 1.12 : wheelX, wheelY, -1.25]}>
        <CarWheel side={1} carClass={carClass} rimColor={rimColor} spinRef={rrSpinRef} wheelRotation={wheelRotation} />
      </group>
    </group>
  );
}));
