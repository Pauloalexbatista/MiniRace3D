import React, { useRef, useMemo } from 'react';
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
  color?: string;
  secondaryColor?: string;
  carClass?: CarClass;
  isDrifting?: boolean;
}

export const Car3D = React.memo(React.forwardRef<THREE.Group, Car3DProps>(({
  position,
  rotation,
  steerAngle = 0,
  wheelRotation = 0,
  steerAngleRef,
  wheelRotationRef,
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

  useFrame(() => {
    const steer = steerAngleRef ? steerAngleRef.current : steerAngle;
    const spin = wheelRotationRef ? wheelRotationRef.current : wheelRotation;
    if (frontLeftWheelRef.current) frontLeftWheelRef.current.rotation.y = steer;
    if (frontRightWheelRef.current) frontRightWheelRef.current.rotation.y = steer;
    if (flSpinRef.current) flSpinRef.current.rotation.x = spin;
    if (frSpinRef.current) frSpinRef.current.rotation.x = spin;
    if (rlSpinRef.current) rlSpinRef.current.rotation.x = spin;
    if (rrSpinRef.current) rrSpinRef.current.rotation.x = spin;
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
          <mesh position={[0, 0.66, -0.02]}>
            <cylinderGeometry args={[0.12, 0.12, 0.10, 12]} rotation={[Math.PI / 2, 0, 0]} />
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
              <mesh key={`rw_ep_${i}`} position={[ex, -0.04, 0]} castShadow>
                <boxGeometry args={[0.045, 0.52, 0.62]} />
                <meshStandardMaterial color={color} roughness={0.22} metalness={0.35} />
              </mesh>
            ))}
          </group>
          {/* Rear Diffuser Tunnels & Rain Light */}
          <mesh position={[0, -0.05, -2.02]}>
            <boxGeometry args={[1.45, 0.18, 0.16]} />
            <meshStandardMaterial color="#090d16" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.02, -2.08]}>
            <boxGeometry args={[0.12, 0.18, 0.06]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3.0} />
          </mesh>
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

          {/* Aluminium Front Skidplate + Bull-bar + 4-Lamp Rally Pod */}
          <mesh position={[0, 0.18, 2.25]} rotation={[-0.25, 0, 0]} castShadow>
            <boxGeometry args={[1.45, 0.14, 0.24]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.35} metalness={0.8} />
          </mesh>
          <mesh position={[0, 0.68, 1.92]}>
            <boxGeometry args={[0.96, 0.12, 0.22]} />
            <meshStandardMaterial color="#0f172a" roughness={0.4} />
          </mesh>
          {[-0.33, -0.11, 0.11, 0.33].map((fx, i) => (
            <mesh key={`fog_${i}`} position={[fx, 0.69, 2.04]}>
              <sphereGeometry args={[0.075, 12, 12]} />
              <meshStandardMaterial color="#fef08a" emissive="#fef08a" emissiveIntensity={2.8} />
            </mesh>
          ))}

          {/* Roof Air Scoop + Door Number Panels */}
          <mesh position={[0, 1.34, -0.05]} castShadow>
            <boxGeometry args={[0.42, 0.11, 0.58]} />
            <meshStandardMaterial color="#0f172a" roughness={0.25} />
          </mesh>
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
            <mesh key={`hl_${idx}`} position={[hx, 0.50, 2.22]}>
              <boxGeometry args={[0.34, 0.13, 0.08]} />
              <meshStandardMaterial color="#fef9c3" emissive="#fef08a" emissiveIntensity={2.0} />
            </mesh>
          ))}

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

          {/* Rear Diffuser + Taillights + Twin Rally Exhaust */}
          <mesh position={[0, 0.24, -2.06]}>
            <boxGeometry args={[1.58, 0.20, 0.12]} />
            <meshStandardMaterial color="#090d16" roughness={0.6} />
          </mesh>
          {[-0.68, 0.68].map((tx, idx) => (
            <mesh key={`tl_${idx}`} position={[tx, 0.64, -2.03]}>
              <boxGeometry args={[0.42, 0.13, 0.06]} />
              <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.6} />
            </mesh>
          ))}
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

          {/* Carbon Vented Hood + Angry-Eye JDM LED Headlights */}
          <mesh position={[0, 0.64, 1.48]} rotation={[0.09, 0, 0]}>
            <boxGeometry args={[1.18, 0.03, 1.25]} />
            <meshStandardMaterial color="#0f172a" roughness={0.35} metalness={0.4} />
          </mesh>
          {[-0.72, 0.72].map((hx, idx) => (
            <mesh key={`hl_${idx}`} position={[hx, 0.44, 2.26]} rotation={[0, 0, idx === 0 ? -0.12 : 0.12]}>
              <boxGeometry args={[0.38, 0.09, 0.08]} />
              <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={2.4} />
            </mesh>
          ))}

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

          {/* JDM Smoked Tail-Light Bar + Angled Titanium Blast Pipes + Chassis-Mount GT Wing */}
          <mesh position={[0, 0.56, -2.23]}>
            <boxGeometry args={[1.68, 0.14, 0.05]} />
            <meshStandardMaterial color="#090d16" roughness={0.2} />
          </mesh>
          {[-0.64, -0.32, 0.32, 0.64].map((tx, idx) => (
            <mesh key={`dtl_${idx}`} position={[tx, 0.56, -2.25]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.04, 14]} />
              <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.8} />
            </mesh>
          ))}
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

          {/* GT3 Front Grille + Matrix LED Headlights */}
          <mesh position={[0, 0.34, 2.28]}>
            <boxGeometry args={[1.12, 0.20, 0.05]} />
            <meshStandardMaterial color="#020617" roughness={0.8} />
          </mesh>
          {[-0.74, 0.74].map((hx, idx) => (
            <mesh key={`hl_${idx}`} position={[hx, 0.45, 2.24]}>
              <boxGeometry args={[0.34, 0.11, 0.08]} />
              <meshStandardMaterial color="#fef9c3" emissive="#fef08a" emissiveIntensity={2.0} />
            </mesh>
          ))}

          {/* Full-Width GT3 LED Rear Lightbar + Carbon Diffuser Strakes + Center-Exit Exhausts */}
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
          <mesh position={[0, 0.58, -2.22]}>
            <boxGeometry args={[1.62, 0.07, 0.06]} />
            <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2.8} />
          </mesh>

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
