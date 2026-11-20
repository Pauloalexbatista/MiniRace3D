import { useState, useEffect, useCallback } from 'react';
import { SavedCircuit, SplineNode, RoadBranch, SceneryPatch } from '../tracks';
import { TrackThemeId } from '../trackProfile';

const STORAGE_KEY = 'minirace3d_saved_circuits';
const DRAFT_KEY = 'minirace3d_current_draft';

export interface CircuitStorageState {
  trackName: string;
  controlPoints: SplineNode[];
  branches: RoadBranch[];
  sceneryPatches?: SceneryPatch[];
  customPitNodes: SplineNode[] | null;
  isClosed: boolean;
  mapImageUrl: string | null;
  mapSize: number;
  mapOffsetX: number;
  mapOffsetZ: number;
  mapRotation: number;
  trackThemeId: TrackThemeId;
}

export interface UseCircuitStorageOptions extends CircuitStorageState {
  onLoadTrack: (circuit: SavedCircuit) => void;
}

// Limpa URLs base64 gigantes antes de meter no localStorage para evitar QuotaExceededError
function sanitizeForLocalStorage(circuit: SavedCircuit): SavedCircuit {
  if (circuit.mapImageUrl && circuit.mapImageUrl.startsWith('data:image')) {
    return {
      ...circuit,
      mapImageUrl: null // Guarda no disco completo, mas alivia o localStorage de 5MB
    };
  }
  return circuit;
}

export function useCircuitStorage({
  trackName,
  controlPoints,
  branches,
  sceneryPatches = [],
  customPitNodes,
  isClosed,
  mapImageUrl,
  mapSize,
  mapOffsetX,
  mapOffsetZ,
  mapRotation,
  trackThemeId,
  onLoadTrack
}: UseCircuitStorageOptions) {
  const [savedCircuits, setSavedCircuits] = useState<SavedCircuit[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // 1. Carregar circuitos reais da pasta 'circuits/' no disco via API do Vite
  const reloadFromDisk = useCallback(async () => {
    try {
      const res = await fetch('/api/circuits');
      if (res.ok) {
        const diskCircuits: SavedCircuit[] = await res.json();
        if (Array.isArray(diskCircuits) && diskCircuits.length > 0) {
          setSavedCircuits(prev => {
            const map = new Map<string, SavedCircuit>();
            diskCircuits.forEach(c => {
              const key = (c.name || c.id).toLowerCase();
              map.set(key, c);
            });
            prev.forEach(c => {
              const key = (c.name || c.id).toLowerCase();
              if (!map.has(key)) map.set(key, c);
            });
            const merged = Array.from(map.values());
            merged.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.map(sanitizeForLocalStorage)));
            } catch {}
            return merged;
          });
        }
      }
    } catch (err) {
      console.warn('API de circuitos indisponível, usando armazenamento local.', err);
    }
  }, []);

  useEffect(() => {
    reloadFromDisk();
  }, [reloadFromDisk]);

  // 2. Guardar circuito atual no disco (pasta circuits/) e no localStorage
  const saveCurrentTrack = async () => {
    const nameToSave = (trackName || '').trim() || 'Meu Circuito';
    const id = 'circuit_' + Date.now();
    let finalMapUrl = mapImageUrl;

    // Se tiver imagem base64 gigante, faz upload para public/maps/ no disco
    if (mapImageUrl && mapImageUrl.startsWith('data:image')) {
      try {
        const uploadRes = await fetch('/api/upload-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: mapImageUrl, fileName: nameToSave })
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.url) {
            finalMapUrl = uploadData.url;
          }
        }
      } catch (e) {
        console.warn('Upload de mapa falhou, mantendo original:', e);
      }
    }

    const circuitToSave: SavedCircuit = {
      id,
      name: nameToSave,
      controlPoints,
      branches,
      sceneryPatches,
      customPitNodes,
      isClosed,
      mapImageUrl: finalMapUrl,
      mapSize,
      mapOffsetX,
      mapOffsetZ,
      mapRotation,
      trackThemeId: trackThemeId as any,
      savedAt: Date.now()
    };

    // A. Gravar em ficheiro .json na pasta circuits/ no disco
    let savedToDisk = false;
    let savedFileName = nameToSave + '.json';
    try {
      const res = await fetch('/api/circuits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(circuitToSave)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.filename) savedFileName = data.filename;
        savedToDisk = true;
      }
    } catch (e) {
      console.warn('Falha ao gravar no disco via API:', e);
    }

    // B. Atualizar estado React e localStorage
    setSavedCircuits(prev => {
      const existingIdx = prev.findIndex(c => c.name.toLowerCase() === nameToSave.toLowerCase());
      let nextList: SavedCircuit[];
      if (existingIdx !== -1) {
        nextList = [...prev];
        nextList[existingIdx] = circuitToSave;
      } else {
        nextList = [circuitToSave, ...prev];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList.map(sanitizeForLocalStorage)));
        localStorage.setItem(DRAFT_KEY, JSON.stringify(sanitizeForLocalStorage(circuitToSave)));
      } catch (err) {
        console.error('Falha ao escrever no localStorage:', err);
      }
      return nextList;
    });

    const msg = savedToDisk
      ? '✓ Gravado no ficheiro: circuits/' + savedFileName
      : '✓ Gravado: "' + nameToSave + '"';

    setSaveSuccessMsg(msg);
    setTimeout(() => setSaveSuccessMsg(null), 4000);
  };

  // 3. Apagar circuito guardado (no disco e no localStorage)
  const deleteSavedTrack = async (id: string) => {
    try {
      await fetch('/api/circuits/' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (e) {
      console.warn('Falha ao apagar circuito no disco:', e);
    }

    setSavedCircuits(prev => {
      const nextList = prev.filter(c => c.id !== id && (c as any).fileName !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList.map(sanitizeForLocalStorage)));
      } catch {}
      return nextList;
    });
  };

  // 4. Exportar circuito atual em ficheiro .json para download direto
  const exportJson = () => {
    const data = JSON.stringify({
      name: trackName,
      controlPoints,
      branches,
      sceneryPatches,
      customPitNodes,
      isClosed,
      mapImageUrl,
      mapSize,
      mapOffsetX,
      mapOffsetZ,
      mapRotation,
      trackThemeId,
      savedAt: Date.now()
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (trackName || 'circuito').replace(/[^a-z0-9_-]/gi, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 5. Importar circuito a partir de ficheiro .json
  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.controlPoints && Array.isArray(data.controlPoints)) {
          const loaded: SavedCircuit = {
            id: 'imported_' + Date.now(),
            name: data.name || file.name.replace(/\.json$/i, ''),
            controlPoints: data.controlPoints,
            branches: Array.isArray(data.branches) ? data.branches : [],
            sceneryPatches: Array.isArray(data.sceneryPatches) ? data.sceneryPatches : [],
            customPitNodes: data.customPitNodes || null,
            isClosed: data.isClosed ?? true,
            mapImageUrl: data.mapImageUrl || null,
            mapSize: data.mapSize || 1200,
            mapOffsetX: data.mapOffsetX || 0,
            mapOffsetZ: data.mapOffsetZ || 0,
            mapRotation: data.mapRotation || 0,
            trackThemeId: data.trackThemeId || 'f1_modern',
            savedAt: Date.now()
          };

          try {
            await fetch('/api/circuits', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(loaded)
            });
            reloadFromDisk();
          } catch {}

          onLoadTrack(loaded);
        }
      } catch (err) {
        alert('Erro ao carregar ficheiro JSON.');
      }
    };
    reader.readAsText(file);
  };

  // 6. Auto-save rascunho contínuo
  useEffect(() => {
    if (controlPoints.length > 0) {
      const draft: SavedCircuit = {
        id: 'draft',
        name: trackName,
        controlPoints,
        branches,
        sceneryPatches,
        customPitNodes,
        isClosed,
        mapImageUrl,
        mapSize,
        mapOffsetX,
        mapOffsetZ,
        mapRotation,
        trackThemeId: trackThemeId as any,
        savedAt: Date.now()
      };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(sanitizeForLocalStorage(draft)));
      } catch {}
    }
  }, [controlPoints, branches, sceneryPatches, customPitNodes, trackName, isClosed, mapImageUrl, mapSize, mapOffsetX, mapOffsetZ, mapRotation, trackThemeId]);

  // 7. Recuperar rascunho ou primeiro circuito guardado ao iniciar
  useEffect(() => {
    let cancelled = false;
    async function initTrack() {
      try {
        // Tenta rascunho primeiro
        const rawDraft = localStorage.getItem(DRAFT_KEY);
        if (rawDraft) {
          const draft = JSON.parse(rawDraft) as SavedCircuit;
          if (draft && draft.controlPoints && draft.controlPoints.length >= 2) {
            if (!cancelled) onLoadTrack(draft);
            return;
          }
        }

        // Se não houver rascunho, carrega os circuitos da pasta circuits/ no disco
        const res = await fetch('/api/circuits');
        if (res.ok) {
          const diskList: SavedCircuit[] = await res.json();
          if (Array.isArray(diskList) && diskList.length > 0) {
            const preferred = diskList.find(c => c.name.toLowerCase().includes('estoril')) || diskList[0];
            if (!cancelled) onLoadTrack(preferred);
            return;
          }
        }

        // Fallback para localStorage
        const rawSaved = localStorage.getItem(STORAGE_KEY);
        if (rawSaved) {
          const list = JSON.parse(rawSaved) as SavedCircuit[];
          if (Array.isArray(list) && list.length > 0 && list[0].controlPoints && list[0].controlPoints.length >= 2) {
            if (!cancelled) onLoadTrack(list[0]);
            return;
          }
        }
      } catch (e) {
        console.error('Erro na inicialização de pistas:', e);
      }
    }

    initTrack();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    savedCircuits,
    saveSuccessMsg,
    saveCurrentTrack,
    deleteSavedTrack,
    exportJson,
    importJson,
    reloadFromDisk
  };
}
