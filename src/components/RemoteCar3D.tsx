import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RigidBody, CuboidCollider, RapierRigidBody } from '@react-three/rapier';
import { Car3D, CarClass } from './Car3D';
import { DriverNameplateSprite } from './DriverNameplate';
import type { RemoteCarBufferEntry } from '../multiplayer/types';

const ZERO_VEC3: [number, number, number] = [0, 0, 0];
const REMOTE_COLLIDER_ARGS: [number, number, number] = [0.92, 0.24, 1.90];
const REMOTE_COLLIDER_POS: [number, number, number] = [0, 0.96, 0.05];
const REMOTE_VISUAL_POS: [number, number, number] = [0, 0.02, 0];

export interface RemoteCar3DProps {
  driverId: string;
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
  initialPose: { pos: [number, number, number]; yaw: number };
  remoteCarsRef: React.MutableRefObject<Map<string, RemoteCarBufferEntry>>;
  positionRank?: number;
  isAi?: boolean;
  inPit?: boolean;
  finished?: boolean;
  connected?: boolean;
  environmentTheme?: 'day' | 'sunset' | 'night';
}

export const RemoteCar3D: React.FC<RemoteCar3DProps> = React.memo(({
  driverId,
  name,
  carClass,
  primaryColor,
  secondaryColor,
  initialPose,
  remoteCarsRef,
  positionRank,
  isAi = false,
  inPit = false,
  finished = false,
  connected = true,
  environmentTheme = 'day',
}) => {
  const rbRef = useRef<RapierRigidBody>(null);
  const steerRef = useRef(0);
  const wheelRollRef = useRef(0);
  const brakeRef = useRef(0);
  const headlightsRef = useRef(true);
  const attackModeRef = useRef(false);
  const initializedRef = useRef(false);
  const velRef = useRef({ x: 0, y: 0, z: 0 });
  const bodyUserData = useMemo(
    () => ({ surface: 'CAR', driverId, vel: velRef.current }),
    [driverId]
  );

  const currPos = useMemo(
    () => new THREE.Vector3(initialPose.pos[0], initialPose.pos[1], initialPose.pos[2]),
    []
  );
  const currQuat = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), initialPose.yaw),
    []
  );
  const targetPos = useMemo(() => new THREE.Vector3(), []);
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);

  const initialEuler = useMemo(() => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), initialPose.yaw);
    const e = new THREE.Euler().setFromQuaternion(q);
    return [e.x, e.y, e.z] as [number, number, number];
  }, [initialPose.yaw]);

  useFrame((_, delta) => {
    const rb = rbRef.current;
    if (!rb) return;
    const entry = remoteCarsRef.current.get(driverId);
    if (!entry) return;

    const dt = Math.min(delta, 0.05);
    const c = entry.curr;
    const extrapSec = Math.min(0.10, Math.max(0, (performance.now() - entry.receivedAtMs) / 1000));

    targetPos.set(
      c.x + c.vx * extrapSec,
      c.y + c.vy * extrapSec,
      c.z + c.vz * extrapSec
    );
    targetQuat.set(c.qx, c.qy, c.qz, c.qw).normalize();

    if (!initializedRef.current || currPos.distanceTo(targetPos) > 25) {
      currPos.copy(targetPos);
      currQuat.copy(targetQuat);
      initializedRef.current = true;
    } else {
      const alpha = 1 - Math.exp(-16 * dt);
      currPos.lerp(targetPos, alpha);
      currQuat.slerp(targetQuat, alpha);
    }

    rb.setNextKinematicTranslation({ x: currPos.x, y: currPos.y, z: currPos.z });
    rb.setNextKinematicRotation({ x: currQuat.x, y: currQuat.y, z: currQuat.z, w: currQuat.w });

    velRef.current.x = c.vx || 0;
    velRef.current.y = c.vy || 0;
    velRef.current.z = c.vz || 0;

    steerRef.current = THREE.MathUtils.lerp(steerRef.current, c.steer || 0, Math.min(1, dt * 14));
    wheelRollRef.current += ((c.speedKmh || 0) / 3.6) * dt * 1.5;
    brakeRef.current = c.braking ? 1 : 0;
    headlightsRef.current = c.headlights !== undefined ? Boolean(c.headlights) : true;
    attackModeRef.current = Boolean(c.attackModeActive);
  });

  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      position={initialPose.pos}
      rotation={initialEuler}
      colliders={false}
      userData={bodyUserData}
    >
      <CuboidCollider
        args={REMOTE_COLLIDER_ARGS}
        position={REMOTE_COLLIDER_POS}
        friction={0.0}
        restitution={0.12}
      />
      <group position={REMOTE_VISUAL_POS}>
        <Car3D
          position={ZERO_VEC3}
          rotation={ZERO_VEC3}
          steerAngleRef={steerRef}
          wheelRotationRef={wheelRollRef}
          brakeIntensityRef={brakeRef}
          headlightsOnRef={headlightsRef}
          attackModeActiveRef={attackModeRef}
          enableRealLights={false}
          environmentTheme={environmentTheme}
          color={primaryColor}
          secondaryColor={secondaryColor}
          carClass={carClass}
        />
      </group>
      <DriverNameplateSprite
        name={name}
        primaryColor={primaryColor}
        positionRank={positionRank}
        isAi={isAi}
        inPit={inPit}
        finished={finished}
        connected={connected}
      />
    </RigidBody>
  );
});
