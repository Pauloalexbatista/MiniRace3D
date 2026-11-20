import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ReferenceMapOverlayProps {
  imageUrl: string | null;
  visible: boolean;
  opacity: number;
  size: number;
  offsetX: number;
  offsetZ: number;
  rotationAngle?: number;
  groundY?: number;
  onClick?: (x: number, z: number) => void;
}

export const ReferenceMapOverlay: React.FC<ReferenceMapOverlayProps> = React.memo(({
  imageUrl,
  visible,
  opacity,
  size,
  offsetX,
  offsetZ,
  rotationAngle = 0,
  groundY = -0.35,
  onClick
}) => {
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const texture = useMemo(() => {
    if (!imageUrl) return null;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(imageUrl);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (!visible || !texture) return null;

  return (
    <group position={[offsetX, groundY, offsetZ]} rotation={[0, (rotationAngle * Math.PI) / 180, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          pointerDownRef.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!pointerDownRef.current) return;
          const dist = Math.hypot(e.clientX - pointerDownRef.current.x, e.clientY - pointerDownRef.current.y);
          pointerDownRef.current = null;
          if (dist > 5) return;
          if (onClick) onClick(e.point.x, e.point.z);
        }}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
});
