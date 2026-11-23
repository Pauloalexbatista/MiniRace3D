import React, { useEffect, useState, useCallback } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { TrackEditorMode } from './modes/TrackEditorMode';
import { RaceMode } from './modes/RaceMode';
import { useRaceClient } from './multiplayer/useRaceClient';
import type { CarClass } from './multiplayer/types';

type AppMode = 'home' | 'editor' | 'race';

function readStoredPresenceProfile(): {
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
} {
  try {
    const raw = localStorage.getItem('minirace3d_driver_profile');
    if (raw) {
      const parsed = JSON.parse(raw);
      const cls: CarClass =
        parsed.carClass === 'f1' ||
        parsed.carClass === 'gt' ||
        parsed.carClass === 'rally' ||
        parsed.carClass === 'drift'
          ? parsed.carClass
          : 'f1';
      return {
        name: String(parsed.name || 'Piloto').slice(0, 20),
        carClass: cls,
        primaryColor: typeof parsed.primaryColor === 'string' ? parsed.primaryColor : '#e11d48',
        secondaryColor: typeof parsed.secondaryColor === 'string' ? parsed.secondaryColor : '#f8fafc',
      };
    }
  } catch {
    // Ignore storage read errors
  }
  return {
    name: 'Piloto',
    carClass: 'f1',
    primaryColor: '#e11d48',
    secondaryColor: '#f8fafc',
  };
}

function readInitialRoute(): { mode: AppMode; roomCode: string | null } {
  if (typeof window === 'undefined') return { mode: 'home', roomCode: null };
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room')?.trim().toUpperCase() || null;
  const modeParam = params.get('mode')?.toLowerCase();
  if (room) return { mode: 'race', roomCode: room };
  if (modeParam === 'editor') return { mode: 'editor', roomCode: null };
  if (modeParam === 'race') return { mode: 'race', roomCode: null };
  return { mode: 'home', roomCode: null };
}

export default function App() {
  const initial = readInitialRoute();
  const [appMode, setAppMode] = useState<AppMode>(initial.mode);
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(initial.roomCode);
  const [savedCircuitsCount, setSavedCircuitsCount] = useState<number>(0);

  // Keep live WebSocket session active in HomeScreen and RaceMode
  const raceClient = useRaceClient(appMode !== 'editor');
  const { updatePresence } = raceClient;

  useEffect(() => {
    if (appMode !== 'home') return;
    const prof = readStoredPresenceProfile();
    updatePresence({ ...prof, screen: 'home' });
  }, [appMode, updatePresence]);

  const navigateToMode = useCallback((nextMode: AppMode) => {
    setAppMode(nextMode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (nextMode === 'home') {
        url.searchParams.delete('mode');
        url.searchParams.delete('room');
      } else {
        url.searchParams.set('mode', nextMode);
        if (nextMode !== 'race') url.searchParams.delete('room');
      }
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  useEffect(() => {
    if (appMode !== 'home') return;
    let cancelled = false;

    async function loadCount() {
      const keys = new Set<string>();
      try {
        const res = await fetch('/api/circuits');
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            list.forEach((c: any) => keys.add(String(c.name || c.id).toLowerCase()));
          }
        }
      } catch {
        // Fallback below
      }
      try {
        const raw = localStorage.getItem('minirace3d_saved_circuits');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((c: any) => keys.add(String(c.name || c.id).toLowerCase()));
          }
        }
      } catch {
        // Ignore storage errors
      }
      if (!cancelled) setSavedCircuitsCount(keys.size);
    }

    loadCount();
    return () => {
      cancelled = true;
    };
  }, [appMode]);

  if (appMode === 'editor') {
    return (
      <TrackEditorMode
        onBackToHome={() => navigateToMode('home')}
        onGoToRace={() => navigateToMode('race')}
      />
    );
  }

  if (appMode === 'race') {
    return (
      <RaceMode
        raceClient={raceClient}
        initialRoomCode={initialRoomCode}
        onClearInitialRoomCode={() => setInitialRoomCode(null)}
        onBackToHome={() => navigateToMode('home')}
        onGoToEditor={() => navigateToMode('editor')}
      />
    );
  }

  return (
    <HomeScreen
      onSelectEditor={() => navigateToMode('editor')}
      onSelectRace={() => navigateToMode('race')}
      savedCircuitsCount={savedCircuitsCount}
      activeRoomsCount={raceClient.rooms.length}
      onlinePlayersCount={raceClient.onlinePlayers.length}
      connectionState={raceClient.connectionState}
    />
  );
}
