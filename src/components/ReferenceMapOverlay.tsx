import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';

interface ReferenceMapOverlayProps {
  imageUrl: string | null;
  visible: boolean;
  opacity: number;
  size: number;
  offsetX: number;
  offsetZ: number;
  rotationAngle?: number;
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
  onClick
}) => {
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
    <group position={[offsetX, -0.35, offsetZ]} rotation={[0, (rotationAngle * Math.PI) / 180, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
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
