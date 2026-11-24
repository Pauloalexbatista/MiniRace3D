import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SavedCircuit, SplineNode, RoadBranch, SceneryPatch } from '../tracks';
import { TrackThemeId } from '../trackProfile';

const STORAGE_KEY = 'minirace3d_saved_circuits';

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

export function normalizeCircuitKey(c: Partial<SavedCircuit>): string {
  return String(c?.name || c?.id || '').trim().toLowerCase();
}

function isValidCircuit(c: Partial<SavedCircuit> | null | undefined): c is SavedCircuit {
  return Boolean(c && Array.isArray(c.controlPoints) && c.controlPoints.length >= 2);
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

async function uploadDataUrlIfNeeded(
  mapImageUrl: string | null | undefined,
  fileName: string
): Promise<string | null> {
  if (!mapImageUrl) return null;
  if (!mapImageUrl.startsWith('data:image')) return mapImageUrl;
  try {
    const uploadRes = await fetch('/api/upload-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: mapImageUrl, fileName })
    });
    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      if (uploadData?.url) return String(uploadData.url);
    }
  } catch (e) {
    console.warn('Upload de mapa falhou, mantendo original:', e);
  }
  return mapImageUrl;
}

async function postCircuitsBulkWithFallback(
  items: SavedCircuit[]
): Promise<{ ok: boolean; savedCount: number }> {
  try {
    const res = await fetch('/api/circuits/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ circuits: items })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        savedCount: Number.isFinite(Number(data?.savedCount)) ? Number(data.savedCount) : items.length
      };
    }
    if (res.status !== 404) {
      return { ok: false, savedCount: 0 };
    }
  } catch {
    return { ok: false, savedCount: 0 };
  }

  // Fallback para servidores sem /api/circuits/bulk
  let savedCount = 0;
  for (const item of items) {
    try {
      const r = await fetch('/api/circuits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (r.ok) savedCount++;
    } catch {
      // Continuar com os restantes
    }
  }
  return { ok: savedCount > 0, savedCount };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error || new Error('Erro ao ler ficheiro'));
    reader.readAsText(file);
  });
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
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [serverCircuitKeys, setServerCircuitKeys] = useState<Set<string>>(() => new Set());
  const [apiAvailable, setApiAvailable] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const msgTimerRef = useRef<number | null>(null);

  const showTempMessage = useCallback((msg: string) => {
    setSaveSuccessMsg(msg);
    if (msgTimerRef.current !== null) {
      window.clearTimeout(msgTimerRef.current);
    }
    msgTimerRef.current = window.setTimeout(() => {
      setSaveSuccessMsg(null);
      msgTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (msgTimerRef.current !== null) {
        window.clearTimeout(msgTimerRef.current);
      }
    };
  }, []);

  // 1. Carregar circuitos reais da pasta 'circuits/' no disco via API
  const reloadFromDisk = useCallback(async () => {
    try {
      const res = await fetch('/api/circuits');
      if (res.ok) {
        const diskCircuits: SavedCircuit[] = await res.json();
        if (Array.isArray(diskCircuits)) {
          const validDisk = diskCircuits.filter(isValidCircuit);
          setApiAvailable(true);
          setServerCircuitKeys(new Set(validDisk.map(normalizeCircuitKey).filter(Boolean)));

          if (validDisk.length > 0) {
            setSavedCircuits(prev => {
              const map = new Map<string, SavedCircuit>();
              prev.forEach(c => {
                const key = normalizeCircuitKey(c);
                if (key) map.set(key, c);
              });
              validDisk.forEach(c => {
                const key = normalizeCircuitKey(c);
                if (!key) return;
                const existing = map.get(key);
                const existingPts = existing?.controlPoints?.length || 0;
                const diskPts = c?.controlPoints?.length || 0;
                if (existing && existingPts >= 2 && diskPts < 2) {
                  return;
                }
                map.set(key, c);
              });
              const merged = Array.from(map.values());
              merged.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.map(sanitizeForLocalStorage)));
              } catch {}
              return merged;
            });
          }
        } else {
          setApiAvailable(false);
        }
      } else {
        setApiAvailable(false);
      }
    } catch (err) {
      setApiAvailable(false);
      console.warn('API de circuitos indisponível, usando armazenamento local.', err);
    }
  }, []);

  useEffect(() => {
    reloadFromDisk();
  }, [reloadFromDisk]);

  const localOnlyCount = useMemo(() => {
    if (!apiAvailable) return 0;
    return savedCircuits.filter((c) => {
      if (!isValidCircuit(c)) return false;
      const key = normalizeCircuitKey(c);
      return Boolean(key) && !serverCircuitKeys.has(key);
    }).length;
  }, [apiAvailable, savedCircuits, serverCircuitKeys]);

  // 2. Guardar circuito atual no disco (servidor) e no localStorage
  const saveCurrentTrack = async () => {
    if (!controlPoints || controlPoints.length < 2) {
      showTempMessage('⚠️ Desenha pelo menos 2 pontos antes de gravar o circuito!');
      return;
    }
    const nameToSave = (trackName || '').trim() || 'Meu Circuito';
    const id = 'circuit_' + Date.now();
    const finalMapUrl = await uploadDataUrlIfNeeded(mapImageUrl, nameToSave);

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

    // A. Gravar em ficheiro .json no servidor
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
        circuitToSave.fileName = savedFileName;
        savedToDisk = true;
        setApiAvailable(true);
        const savedKey = normalizeCircuitKey(circuitToSave);
        if (savedKey) {
          setServerCircuitKeys(prev => {
            const next = new Set(prev);
            next.add(savedKey);
            return next;
          });
        }
      }
    } catch (e) {
      console.warn('Falha ao gravar no disco via API:', e);
    }

    // B. Atualizar estado React e localStorage
    setSavedCircuits(prev => {
      const targetKey = normalizeCircuitKey(circuitToSave);
      const existingIdx = prev.findIndex(c => normalizeCircuitKey(c) === targetKey);
      let nextList: SavedCircuit[];
      if (existingIdx !== -1) {
        nextList = [...prev];
        nextList[existingIdx] = circuitToSave;
      } else {
        nextList = [circuitToSave, ...prev];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList.map(sanitizeForLocalStorage)));
      } catch (err) {
        console.error('Falha ao escrever no localStorage:', err);
      }
      return nextList;
    });

    const msg = savedToDisk
      ? '✓ Gravado no servidor: ' + savedFileName
      : '✓ Gravado localmente: "' + nameToSave + '"';

    showTempMessage(msg);
  };

  // 2b. Sincronizar pistas locais (ou todas) com o servidor online
  const syncAllToServer = useCallback(async (forceAll = false) => {
    if (isSyncing) return;
    const validCircuits = savedCircuits.filter(isValidCircuit);
    const targets = forceAll
      ? validCircuits
      : validCircuits.filter((c) => {
          const key = normalizeCircuitKey(c);
          return Boolean(key) && !serverCircuitKeys.has(key);
        });

    if (targets.length === 0) {
      showTempMessage('✓ Todas as pistas já estão sincronizadas online!');
      return;
    }

    setIsSyncing(true);
    try {
      const prepared: SavedCircuit[] = [];
      for (const c of targets) {
        const uploadedUrl = await uploadDataUrlIfNeeded(c.mapImageUrl, c.name || 'map');
        prepared.push({
          ...c,
          mapImageUrl: uploadedUrl
        });
      }

      const { ok, savedCount } = await postCircuitsBulkWithFallback(prepared);
      if (ok && savedCount > 0) {
        await reloadFromDisk();
        showTempMessage(
          `✓ ${savedCount} ${savedCount === 1 ? 'pista enviada' : 'pistas enviadas'} para o servidor online!`
        );
      } else {
        showTempMessage('⚠️ Não foi possível enviar as pistas para o servidor.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, savedCircuits, serverCircuitKeys, reloadFromDisk, showTempMessage]);

  // 3. Apagar circuito guardado (no disco e no localStorage)
  const deleteSavedTrack = async (id: string) => {
    let deletedOnDisk = false;
    try {
      const res = await fetch('/api/circuits/' + encodeURIComponent(id), { method: 'DELETE' });
      deletedOnDisk = res.ok;
    } catch (e) {
      console.warn('Falha ao apagar circuito no disco:', e);
    }

    setSavedCircuits(prev => {
      const nextList = prev.filter(c => c.id !== id && c.fileName !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextList.map(sanitizeForLocalStorage)));
      } catch {}
      return nextList;
    });

    if (deletedOnDisk) {
      await reloadFromDisk();
    }
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

  // 4b. Exportar todas as pistas válidas num único backup JSON
  const exportAllJson = () => {
    const validCircuits = savedCircuits.filter(isValidCircuit);
    if (validCircuits.length === 0) {
      showTempMessage('⚠️ Não há pistas válidas para exportar!');
      return;
    }
    const payload = JSON.stringify({
      version: 1,
      exportedAt: Date.now(),
      circuits: validCircuits
    }, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minirace3d_backup_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showTempMessage(`✓ Backup de ${validCircuits.length} pistas transferido!`);
  };

  // 5. Importar circuito(s) a partir de ficheiro(s) .json ou pacote de backup
  const importJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    type RawEntry = { raw: any; fallbackName: string };
    const collected: RawEntry[] = [];

    for (const file of files) {
      try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        const baseFallback = file.name.replace(/\.json$/i, '').trim() || 'Circuito Importado';
        if (Array.isArray(data)) {
          data.forEach((item, idx) =>
            collected.push({ raw: item, fallbackName: `${baseFallback} ${idx + 1}` })
          );
        } else if (Array.isArray(data?.circuits)) {
          data.circuits.forEach((item: any, idx: number) =>
            collected.push({ raw: item, fallbackName: `${baseFallback} ${idx + 1}` })
          );
        } else {
          collected.push({ raw: data, fallbackName: baseFallback });
        }
      } catch {
        if (files.length === 1) {
          alert('Erro ao carregar ficheiro JSON.');
          return;
        }
      }
    }

    if (collected.length === 0) {
      alert('Erro ao carregar ficheiro(s) JSON.');
      return;
    }

    // Caso 1: apenas 1 circuito no ficheiro selecionado
    if (collected.length === 1) {
      const { raw: data, fallbackName } = collected[0];
      if (!data || !Array.isArray(data.controlPoints) || data.controlPoints.length < 2) {
        alert(
          '⚠️ Este ficheiro JSON está vazio (menos de 2 pontos de pista) e não foi importado para proteger os teus circuitos guardados.'
        );
        return;
      }

      const importedName =
        (typeof data.name === 'string' && data.name.trim()) || fallbackName;

      const existing = savedCircuits.find(
        c => normalizeCircuitKey(c) === importedName.trim().toLowerCase()
      );
      if (existing && (existing.controlPoints?.length || 0) >= 2) {
        const confirmed = window.confirm(
          `Já existe um circuito guardado chamado "${existing.name}" (${existing.controlPoints.length} pontos).\n\nQueres substituí-lo pelo ficheiro importado (${data.controlPoints.length} pontos)?`
        );
        if (!confirmed) return;
      }

      const uploadedMapUrl = await uploadDataUrlIfNeeded(data.mapImageUrl || null, importedName);
      const loaded: SavedCircuit = {
        id: 'imported_' + Date.now(),
        name: importedName,
        controlPoints: data.controlPoints,
        branches: Array.isArray(data.branches) ? data.branches : [],
        sceneryPatches: Array.isArray(data.sceneryPatches) ? data.sceneryPatches : [],
        customPitNodes: data.customPitNodes || null,
        isClosed: data.isClosed ?? true,
        mapImageUrl: uploadedMapUrl,
        mapSize: data.mapSize || 1200,
        mapOffsetX: data.mapOffsetX || 0,
        mapOffsetZ: data.mapOffsetZ || 0,
        mapRotation: data.mapRotation || 0,
        trackThemeId: data.trackThemeId || 'f1_modern',
        savedAt: Date.now()
      };

      try {
        const res = await fetch('/api/circuits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loaded)
        });
        if (res.ok) {
          await reloadFromDisk();
        }
      } catch {}

      onLoadTrack(loaded);
      return;
    }

    // Caso 2: vários circuitos (seleção múltipla ou pacote de backup)
    const validEntries = collected.filter(
      (entry) => entry.raw && Array.isArray(entry.raw.controlPoints) && entry.raw.controlPoints.length >= 2
    );
    if (validEntries.length === 0) {
      alert('⚠️ Nenhuma pista válida (mínimo 2 pontos) encontrada nos ficheiros selecionados.');
      return;
    }

    const baseNow = Date.now();
    const prepared: SavedCircuit[] = [];
    for (let i = 0; i < validEntries.length; i++) {
      const { raw, fallbackName } = validEntries[i];
      const name = (typeof raw.name === 'string' && raw.name.trim()) || fallbackName;
      const uploadedMapUrl = await uploadDataUrlIfNeeded(raw.mapImageUrl || null, name);
      prepared.push({
        id: (typeof raw.id === 'string' && raw.id.trim()) || `imported_${baseNow}_${i}`,
        name,
        controlPoints: raw.controlPoints,
        branches: Array.isArray(raw.branches) ? raw.branches : [],
        sceneryPatches: Array.isArray(raw.sceneryPatches) ? raw.sceneryPatches : [],
        customPitNodes: raw.customPitNodes || null,
        isClosed: raw.isClosed ?? true,
        mapImageUrl: uploadedMapUrl,
        mapSize: raw.mapSize || 1200,
        mapOffsetX: raw.mapOffsetX || 0,
        mapOffsetZ: raw.mapOffsetZ || 0,
        mapRotation: raw.mapRotation || 0,
        trackThemeId: raw.trackThemeId || 'f1_modern',
        savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : baseNow
      });
    }

    setSavedCircuits(prev => {
      const map = new Map<string, SavedCircuit>();
      prev.forEach(c => {
        const key = normalizeCircuitKey(c);
        if (key) map.set(key, c);
      });
      prepared.forEach(c => {
        const key = normalizeCircuitKey(c);
        if (key) map.set(key, c);
      });
      const merged = Array.from(map.values());
      merged.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.map(sanitizeForLocalStorage)));
      } catch {}
      return merged;
    });

    const { ok, savedCount } = await postCircuitsBulkWithFallback(prepared);
    if (ok) {
      await reloadFromDisk();
      showTempMessage(`✓ ${savedCount} pistas importadas e gravadas no servidor!`);
    } else {
      showTempMessage(`✓ ${prepared.length} pistas importadas localmente!`);
    }
  };

  return {
    savedCircuits,
    saveSuccessMsg,
    serverCircuitKeys,
    apiAvailable,
    localOnlyCount,
    isSyncing,
    saveCurrentTrack,
    deleteSavedTrack,
    exportJson,
    exportAllJson,
    importJson,
    syncAllToServer,
    reloadFromDisk
  };
}
