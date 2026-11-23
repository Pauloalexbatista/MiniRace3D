import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Stars, Grid } from '@react-three/drei';

interface Environment3DProps {
  theme?: 'day' | 'sunset' | 'night';
  groundY?: number;
}

const ENV_CONFIG_MAP = {
  day: {
    bg: '#93c5fd', // Soft SketchUp sky blue
    ground: '#38a169', // Lush grass green
    sunColor: '#fffbeb',
    sunPos: [200, 350, 150] as [number, number, number],
    sunIntensity: 1.9,
    ambientColor: '#f8fafc',
    ambientIntensity: 0.85,
    gridColor: '#2f855a'
  },
  sunset: {
    // Suave fim de dia (Golden Hour agradável, sem saturação agressiva)
    bg: '#fed7aa', // Céu suave pêssego/dourado
    ground: '#437356', // Relva natural com tom quente
    sunColor: '#fb923c', // Luz solar dourada quente
    sunPos: [250, 120, -180] as [number, number, number],
    sunIntensity: 2.0,
    ambientColor: '#ffedd5',
    ambientIntensity: 0.9,
    gridColor: '#365d45'
  },
  night: {
    // Corrida Noturna estilo F1 (Singapura/Bahrain) - Alta visibilidade com holofotes
    bg: '#0a0f1d', // Céu azul escuro noturno com estrelas
    ground: '#111827', // Terreno escuro elegante
    sunColor: '#93c5fd', // Luz lunar / iluminação de circuito
    sunPos: [80, 280, 80] as [number, number, number],
    sunIntensity: 1.4,
    ambientColor: '#475569', // Luz de preenchimento clara para não ficar escuro
    ambientIntensity: 1.1,
    gridColor: '#1e293b'
  }
} as const;

export const Environment3D: React.FC<Environment3DProps> = React.memo(({ theme = 'day', groundY = -1 }) => {
  const configs = ENV_CONFIG_MAP[(theme as 'day' | 'sunset' | 'night')] || ENV_CONFIG_MAP.day;
  const { gl, scene } = useThree();

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    const disposables: Array<{ dispose: () => void }> = [];

    const skyColor = theme === 'night' ? '#0b1426' : theme === 'sunset' ? '#fdba74' : '#7dd3fc';
    const horizonColor = theme === 'night' ? '#1e293b' : theme === 'sunset' ? '#fb923c' : '#e0f2fe';
    const groundColor = theme === 'night' ? '#0f172a' : theme === 'sunset' ? '#3f4f44' : '#334155';

    const domeGeo = new THREE.SphereGeometry(20, 16, 12);
    const domeMat = new THREE.MeshBasicMaterial({ color: skyColor, side: THREE.BackSide });
    envScene.add(new THREE.Mesh(domeGeo, domeMat));
    disposables.push(domeGeo, domeMat);

    const bandGeo = new THREE.CylinderGeometry(18, 18, 5, 24, 1, true);
    const bandMat = new THREE.MeshBasicMaterial({ color: horizonColor, side: THREE.BackSide });
    const bandMesh = new THREE.Mesh(bandGeo, bandMat);
    bandMesh.position.y = 0.5;
    envScene.add(bandMesh);
    disposables.push(bandGeo, bandMat);

    const floorGeo = new THREE.CircleGeometry(19, 16);
    const floorMat = new THREE.MeshBasicMaterial({ color: groundColor, side: THREE.DoubleSide });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -2.5;
    envScene.add(floorMesh);
    disposables.push(floorGeo, floorMat);

    if (theme === 'night') {
      const stripGeo = new THREE.PlaneGeometry(14, 2.2);
      const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.8, 4.4), side: THREE.DoubleSide });
      disposables.push(stripGeo, stripMat);
      for (const [lx, ly, lz, ry] of [
        [-8, 10, -8, Math.PI / 4],
        [8, 10, -8, -Math.PI / 4],
        [-8, 10, 8, -Math.PI / 4],
        [8, 10, 8, Math.PI / 4],
      ]) {
        const m = new THREE.Mesh(stripGeo, stripMat);
        m.position.set(lx, ly, lz);
        m.rotation.set(Math.PI / 3, ry, 0);
        envScene.add(m);
      }
    } else {
      const sunGeo = new THREE.CircleGeometry(theme === 'sunset' ? 4.2 : 3.0, 16);
      const sunMat = new THREE.MeshBasicMaterial({
        color: theme === 'sunset' ? new THREE.Color(5.0, 3.2, 1.5) : new THREE.Color(4.5, 4.4, 4.0),
        side: THREE.DoubleSide,
      });
      const sunMesh = new THREE.Mesh(sunGeo, sunMat);
      sunMesh.position.set(...configs.sunPos).normalize().multiplyScalar(14);
      sunMesh.lookAt(0, 0, 0);
      envScene.add(sunMesh);
      disposables.push(sunGeo, sunMat);
    }

    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    const typedScene = scene as THREE.Scene & { environmentIntensity?: number };
    typedScene.environmentIntensity = theme === 'night' ? 0.72 : theme === 'sunset' ? 0.82 : 0.85;

    for (const d of disposables) d.dispose();
    pmrem.dispose();

    return () => {
      if (scene.environment === envRT.texture) {
        scene.environment = null;
      }
      envRT.dispose();
    };
  }, [gl, scene, theme, configs.sunPos]);

  return (
    <>
      <color attach="background" args={[configs.bg]} />
      {/* Nevoeiro suave apenas no horizonte longínquo (2500m - 6000m) para NUNCA cortar a pista */}
      <fog attach="fog" args={[configs.bg, 2500, 6500]} />

      {/* Main Sun / Key Light */}
      <directionalLight
        position={configs.sunPos}
        intensity={configs.sunIntensity}
        color={configs.sunColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={2500}
        shadow-camera-left={-600}
        shadow-camera-right={600}
        shadow-camera-top={600}
        shadow-camera-bottom={-600}
        shadow-bias={-0.0005}
      />

      {/* Ambient & Sky Fill Light */}
      <ambientLight intensity={configs.ambientIntensity} color={configs.ambientColor} />
      <hemisphereLight
        args={[configs.bg, configs.ground, theme === 'night' ? 0.8 : 0.45]}
      />

      {/* Night Sky Stars */}
      {theme === 'night' && <Stars radius={500} depth={80} count={3500} factor={4} saturation={0.2} fade speed={1} />}

      {/* Terreno / Plano de chão colocado sempre abaixo da cota mínima da pista */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY - 0.2, 0]} receiveShadow>
        <planeGeometry args={[5000, 5000]} />
        <meshStandardMaterial color={configs.ground} roughness={0.95} metalness={0} />
      </mesh>

      {/* Grelha arquitetural SketchUp */}
      <Grid
        position={[0, groundY - 0.15, 0]}
        args={[4000, 4000]}
        cellSize={25}
        cellThickness={0.7}
        cellColor={configs.gridColor}
        sectionSize={125}
        sectionThickness={1.4}
        sectionColor={configs.gridColor}
        fadeDistance={1800}
        fadeStrength={1.2}
      />
    </>
  );
});