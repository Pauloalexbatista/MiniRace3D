import React from 'react';
import * as THREE from 'three';
import { Stars, Grid } from '@react-three/drei';

interface Environment3DProps {
  theme?: 'day' | 'sunset' | 'night';
  groundY?: number;
}

export const Environment3D: React.FC<Environment3DProps> = React.memo(({ theme = 'day', groundY = -1 }) => {
  const configMap = {
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
  };
  const configs = configMap[(theme as 'day' | 'sunset' | 'night')] || configMap.day;

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