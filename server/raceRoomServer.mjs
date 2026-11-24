import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ATTACHED_SYM = Symbol.for('minirace3d.raceRoomServerAttached');
const VALID_CAR_CLASSES = ['f1', 'gt', 'rally', 'drift'];
const VALID_CATEGORIES = ['f1', 'gt', 'rally', 'drift', 'open'];
const VALID_SPEED_PRESETS = ['calm', 'sport', 'extreme'];
const VALID_ENV_THEMES = ['day', 'sunset', 'night'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const AI_ROSTER = [
  { name: 'M. Verstappen', primaryColor: '#1e3a8a', secondaryColor: '#ef4444' },
  { name: 'L. Hamilton', primaryColor: '#111827', secondaryColor: '#10b981' },
  { name: 'C. Leclerc', primaryColor: '#dc2626', secondaryColor: '#f8fafc' },
  { name: 'L. Norris', primaryColor: '#f97316', secondaryColor: '#0f172a' },
  { name: 'F. Alonso', primaryColor: '#065f46', secondaryColor: '#bef264' },
  { name: 'A. Félix', primaryColor: '#0284c7', secondaryColor: '#facc15' },
  { name: 'F. Mortara', primaryColor: '#7c3aed', secondaryColor: '#f8fafc' },
  { name: 'S. Loeb', primaryColor: '#b91c1c', secondaryColor: '#fbbf24' },
  { name: 'K. Takahashi', primaryColor: '#facc15', secondaryColor: '#090d16' },
  { name: 'O. Piastri', primaryColor: '#ea580c', secondaryColor: '#38bdf8' },
  { name: 'G. Russell', primaryColor: '#0f766e', secondaryColor: '#cbd5e1' },
];

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeText(val, maxLen, fallback) {
  const str = String(val ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return str || fallback;
}

function sanitizeColor(val, fallback) {
  const s = String(val ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

function normalizeLookupKey(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.json$/i, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_');
}

function estimateCircuitLengthMeters(circuitData) {
  const pts = circuitData?.controlPoints;
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  let total = 0;
  const closed = circuitData.isClosed ?? true;
  const segCount = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += Math.hypot((b.x || 0) - (a.x || 0), (b.y || 0) - (a.y || 0));
  }
  return Math.round(total);
}

export function loadCircuitFromDisk(circuitsDir, circuitId) {
  if (!circuitsDir || !circuitId || !fs.existsSync(circuitsDir)) return null;
  const targetNorm = normalizeLookupKey(circuitId);
  try {
    const files = fs.readdirSync(circuitsDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of files) {
      const fullPath = path.join(circuitsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (
          parsed?.id === circuitId ||
          file === circuitId ||
          file === `${circuitId}.json` ||
          normalizeLookupKey(file) === targetNorm ||
          normalizeLookupKey(parsed?.name) === targetNorm
        ) {
          parsed.fileName = file;
          return parsed;
        }
      } catch {
        // Ignore malformed circuit file
      }
    }
  } catch {
    // Ignore directory read error
  }
  return null;
}

function generateRoomCode(rooms) {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${crypto.randomInt(100, 999)}`;
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore closed socket race
  }
}

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    carClass: p.carClass,
    primaryColor: p.primaryColor,
    secondaryColor: p.secondaryColor,
    isReady: p.isReady,
    sceneReady: p.sceneReady,
    connected: p.connected,
    gridSlot: p.gridSlot,
    voiceJoined: Boolean(p.voiceJoined),
    voiceMuted: Boolean(p.voiceMuted),
  };
}

function serializeRoom(room) {
  const players = Array.from(room.players.values()).map(serializePlayer);
  const connectedCount = players.filter((p) => p.connected).length;
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    carCategory: room.carCategory,
    circuitId: room.circuitId,
    circuitName: room.circuitName,
    circuitLengthM: room.circuitLengthM,
    totalLaps: room.totalLaps,
    speedPreset: room.speedPreset,
    environmentTheme: room.environmentTheme,
    aiCount: room.aiCount,
    maxHumans: room.maxHumans,
    status: room.status,
    players,
    connectedHumans: connectedCount,
    aiRacers: room.aiRacers,
    createdAt: room.createdAt,
  };
}

function serializeRoomSummary(room) {
  const players = Array.from(room.players.values());
  const connectedHumans = players.filter((p) => p.connected).length;
  const host = room.players.get(room.hostId);
  return {
    code: room.code,
    name: room.name,
    hostName: host?.name || 'Anfitrião',
    carCategory: room.carCategory,
    circuitId: room.circuitId,
    circuitName: room.circuitName,
    circuitLengthM: room.circuitLengthM,
    totalLaps: room.totalLaps,
    speedPreset: room.speedPreset,
    environmentTheme: room.environmentTheme,
    aiCount: room.aiCount,
    humanCount: connectedHumans,
    maxHumans: room.maxHumans,
    status: room.status,
    createdAt: room.createdAt,
  };
}

function computeStandings(room) {
  const entries = [];

  for (const p of room.players.values()) {
    entries.push({
      id: p.id,
      name: p.name,
      isAi: false,
      carClass: p.carClass,
      primaryColor: p.primaryColor,
      secondaryColor: p.secondaryColor,
      gridSlot: p.gridSlot,
      position: 0,
      lapNumber: p.lapNumber,
      completedLaps: p.completedLaps,
      totalLaps: room.totalLaps,
      raceProgress: p.raceProgress,
      speedKmh: Math.round(p.lastState?.speedKmh || 0),
      inPit: Boolean(p.inPit),
      engineHealth: Math.round(p.engineHealth ?? 100),
      tireHealth: Math.round(p.tireHealth ?? 100),
      finished: Boolean(p.finished),
      finishTimeMs: p.finishTimeMs ?? null,
      finishOrder: p.finishOrder ?? Number.MAX_SAFE_INTEGER,
      bestLapMs: p.bestLapMs ?? null,
      lastLapMs: p.lastLapMs ?? null,
      connected: Boolean(p.connected),
      gapToLeaderM: 0,
    });
  }

  for (const bot of room.aiRacers) {
    const st = room.aiStates.get(bot.id);
    const meta = room.aiMeta.get(bot.id);
    entries.push({
      id: bot.id,
      name: bot.name,
      isAi: true,
      carClass: bot.carClass,
      primaryColor: bot.primaryColor,
      secondaryColor: bot.secondaryColor,
      gridSlot: bot.gridSlot,
      position: 0,
      lapNumber: st?.lapNumber ?? 1,
      completedLaps: st?.completedLaps ?? 0,
      totalLaps: room.totalLaps,
      raceProgress: st?.raceProgress ?? -(4.5 + bot.gridSlot * 8 + 2.4),
      speedKmh: Math.round(st?.speedKmh || 0),
      inPit: Boolean(st?.inPit),
      engineHealth: Math.round(st?.engineHealth ?? 100),
      tireHealth: Math.round(st?.tireHealth ?? 100),
      finished: Boolean(meta?.finished ?? st?.finished),
      finishTimeMs: meta?.finishTimeMs ?? st?.finishTimeMs ?? null,
      finishOrder: meta?.finishOrder ?? Number.MAX_SAFE_INTEGER,
      bestLapMs: st?.bestLapMs ?? null,
      lastLapMs: st?.lastLapMs ?? null,
      connected: true,
      gapToLeaderM: 0,
    });
  }

  entries.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) {
      if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder;
      return (a.finishTimeMs ?? Infinity) - (b.finishTimeMs ?? Infinity);
    }
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (Math.abs(b.raceProgress - a.raceProgress) > 0.05) {
      return b.raceProgress - a.raceProgress;
    }
    return a.gridSlot - b.gridSlot;
  });

  const leaderProgress = entries[0]?.raceProgress ?? 0;
  for (let i = 0; i < entries.length; i++) {
    entries[i].position = i + 1;
    entries[i].gapToLeaderM = i === 0 ? 0 : Math.max(0, Math.round(leaderProgress - entries[i].raceProgress));
    delete entries[i].finishOrder;
  }

  return entries;
}

export function attachRaceRoomServer(httpServer, { circuitsDir } = {}) {
  if (!httpServer) return null;
  if (httpServer[ATTACHED_SYM]) {
    return httpServer[ATTACHED_SYM];
  }

  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();
  const clients = new Map(); // ws -> { id, ws, roomCode, playerId, isAlive, ... }
  const lobbyChatHistory = [];

  const createChatEntry = (scope, senderId, senderName, senderColor, text, isSystem = false) => ({
    id: `msg_${crypto.randomBytes(4).toString('hex')}`,
    scope,
    senderId,
    senderName,
    senderColor: sanitizeColor(senderColor, '#38bdf8'),
    text,
    timestampMs: Date.now(),
    isSystem,
  });

  const getOnlinePlayers = () => {
    const list = [];
    for (const c of clients.values()) {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      const roomPlayer = room && c.playerId ? room.players.get(c.playerId) : null;
      let status = c.screen === 'lobby' ? 'lobby' : 'home';
      if (room) {
        const isRacing =
          room.status === 'loading' || room.status === 'countdown' || room.status === 'racing';
        status = isRacing ? 'racing' : 'in_room';
      }
      list.push({
        id: c.id,
        name: roomPlayer?.name || c.name,
        primaryColor: roomPlayer?.primaryColor || c.primaryColor,
        secondaryColor: roomPlayer?.secondaryColor || c.secondaryColor,
        carClass: roomPlayer?.carClass || c.carClass,
        status,
        roomCode: room ? room.code : null,
        roomName: room ? room.name : null,
        connectedAt: c.connectedAt,
      });
    }
    list.sort((a, b) => a.connectedAt - b.connectedAt);
    return list;
  };

  const broadcastOnlinePlayers = (excludeWs = null) => {
    const payload = { type: 'online_players', players: getOnlinePlayers() };
    for (const c of clients.values()) {
      if (c.ws !== excludeWs) {
        sendJson(c.ws, payload);
      }
    }
  };

  const pushRoomSystemMessage = (room, text) => {
    const entry = createChatEntry('room', 'system', 'Sistema', '#38bdf8', text, true);
    room.chatHistory.push(entry);
    if (room.chatHistory.length > 60) {
      room.chatHistory.splice(0, room.chatHistory.length - 60);
    }
    broadcastToRoom(room, { type: 'chat_message', message: entry });
  };

  const getRoomSummaries = () => {
    const list = [];
    for (const room of rooms.values()) {
      const hasConnected = Array.from(room.players.values()).some((p) => p.connected);
      if (hasConnected) {
        list.push(serializeRoomSummary(room));
      }
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  };

  const broadcastToRoom = (room, payload, excludeClientWs = null) => {
    for (const player of room.players.values()) {
      if (player.connected && player.ws && player.ws !== excludeClientWs) {
        sendJson(player.ws, payload);
      }
    }
  };

  const broadcastRoomsListToLobby = () => {
    const summaryPayload = { type: 'rooms_list', rooms: getRoomSummaries() };
    for (const c of clients.values()) {
      if (!c.roomCode) {
        sendJson(c.ws, summaryPayload);
      }
    }
  };

  const startSyncedCountdown = (room) => {
    if (room.status !== 'loading') return;
    const now = Date.now();
    room.status = 'countdown';
    room.countdownStartServerMs = now + 450;
    room.raceGoServerMs = room.countdownStartServerMs + 2700;
    broadcastToRoom(room, {
      type: 'race_countdown',
      countdownStartServerMs: room.countdownStartServerMs,
      raceGoServerMs: room.raceGoServerMs,
      room: serializeRoom(room),
    });
    broadcastRoomsListToLobby();
  };

  const removeOrDisconnectPlayer = (room, playerId, forceRemove = false) => {
    const player = room.players.get(playerId);
    if (!player) return;

    const wasVoiceJoined = Boolean(player.voiceJoined);
    player.voiceJoined = false;
    player.voiceMuted = false;

    const inActiveRace =
      room.status === 'loading' || room.status === 'countdown' || room.status === 'racing';

    if (forceRemove || !inActiveRace) {
      room.players.delete(playerId);
    } else {
      player.connected = false;
      player.ws = null;
      player.disconnectedAt = Date.now();
    }

    const connectedHumans = Array.from(room.players.values()).filter((p) => p.connected);
    if (connectedHumans.length === 0) {
      rooms.delete(room.code);
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return;
    }

    if (wasVoiceJoined) {
      broadcastToRoom(room, { type: 'voice_peer_left', peerId: player.id });
    }

    if (forceRemove || !inActiveRace) {
      pushRoomSystemMessage(room, `${player.name} saiu da sala.`);
    }

    if (room.hostId === playerId) {
      const nextHost = connectedHumans[0];
      room.hostId = nextHost.id;
      broadcastToRoom(room, {
        type: 'host_changed',
        newHostId: nextHost.id,
        newHostName: nextHost.name,
      });
    }

    broadcastToRoom(room, {
      type: 'room_updated',
      room: serializeRoom(room),
    });

    // If room was waiting on scene_ready and all remaining connected humans are ready, start countdown
    if (room.status === 'loading') {
      const allReady = connectedHumans.every((p) => p.sceneReady);
      if (allReady) {
        startSyncedCountdown(room);
      }
    }

    broadcastRoomsListToLobby();
    broadcastOnlinePlayers();
  };

  const resolveCircuit = (circuitId, clientCircuitData) => {
    const disk = loadCircuitFromDisk(circuitsDir, circuitId);
    if (disk && Array.isArray(disk.controlPoints) && disk.controlPoints.length >= 2) {
      return disk;
    }
    if (
      clientCircuitData &&
      Array.isArray(clientCircuitData.controlPoints) &&
      clientCircuitData.controlPoints.length >= 2
    ) {
      return clientCircuitData;
    }
    return null;
  };

  const enforceCarClassForRoom = (room, requested) => {
    if (room.carCategory !== 'open') return room.carCategory;
    return VALID_CAR_CLASSES.includes(requested) ? requested : 'f1';
  };

  const handleMessage = (client, rawData) => {
    let msg;
    try {
      msg = JSON.parse(String(rawData));
    } catch {
      sendJson(client.ws, { type: 'error', message: 'Mensagem JSON inválida.' });
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'ping') {
      sendJson(client.ws, {
        type: 'pong',
        clientTime: msg.clientTime,
        serverTime: Date.now(),
      });
      return;
    }

    if (msg.type === 'list_rooms') {
      sendJson(client.ws, { type: 'rooms_list', rooms: getRoomSummaries() });
      sendJson(client.ws, { type: 'online_players', players: getOnlinePlayers() });
      return;
    }

    if (msg.type === 'set_presence') {
      if (msg.name !== undefined) {
        client.name = sanitizeText(msg.name, 20, client.name);
      }
      if (msg.carClass !== undefined && VALID_CAR_CLASSES.includes(msg.carClass)) {
        client.carClass = msg.carClass;
      }
      if (msg.primaryColor !== undefined) {
        client.primaryColor = sanitizeColor(msg.primaryColor, client.primaryColor);
      }
      if (msg.secondaryColor !== undefined) {
        client.secondaryColor = sanitizeColor(msg.secondaryColor, client.secondaryColor);
      }
      if (msg.screen === 'home' || msg.screen === 'lobby') {
        client.screen = msg.screen;
      }
      broadcastOnlinePlayers();
      return;
    }

    if (msg.type === 'chat_send') {
      const text = sanitizeText(msg.text, 240, '');
      if (!text) return;

      const now = Date.now();
      client.chatTimestamps = client.chatTimestamps.filter((ts) => now - ts < 4000);
      if (client.chatTimestamps.length >= 6) {
        sendJson(client.ws, {
          type: 'error',
          message: 'Estás a enviar mensagens demasiado depressa.',
        });
        return;
      }
      client.chatTimestamps.push(now);

      const useRoomScope =
        msg.scope === 'room' || (Boolean(client.roomCode) && msg.scope !== 'lobby');
      if (useRoomScope) {
        const activeRoom = client.roomCode ? rooms.get(client.roomCode) : null;
        const activePlayer = activeRoom && client.playerId ? activeRoom.players.get(client.playerId) : null;
        if (!activeRoom || !activePlayer) return;

        const entry = createChatEntry(
          'room',
          activePlayer.id,
          activePlayer.name,
          activePlayer.primaryColor,
          text,
          false
        );
        activeRoom.chatHistory.push(entry);
        if (activeRoom.chatHistory.length > 60) {
          activeRoom.chatHistory.splice(0, activeRoom.chatHistory.length - 60);
        }
        broadcastToRoom(activeRoom, { type: 'chat_message', message: entry });
      } else {
        const entry = createChatEntry(
          'lobby',
          client.id,
          client.name,
          client.primaryColor,
          text,
          false
        );
        lobbyChatHistory.push(entry);
        if (lobbyChatHistory.length > 40) {
          lobbyChatHistory.splice(0, lobbyChatHistory.length - 40);
        }
        for (const c of clients.values()) {
          if (!c.roomCode) {
            sendJson(c.ws, { type: 'chat_message', message: entry });
          }
        }
      }
      return;
    }

    if (msg.type === 'invite_player') {
      const activeRoom = client.roomCode ? rooms.get(client.roomCode) : null;
      const activePlayer = activeRoom && client.playerId ? activeRoom.players.get(client.playerId) : null;
      if (!activeRoom || !activePlayer) return;
      if (activeRoom.status !== 'lobby') {
        sendJson(client.ws, {
          type: 'error',
          message: 'Só podes enviar convites enquanto a sala está na garagem.',
        });
        return;
      }
      const targetId = typeof msg.targetClientId === 'string' ? msg.targetClientId : '';
      if (!targetId) return;
      let targetClient = null;
      for (const c of clients.values()) {
        if (c.id === targetId) {
          targetClient = c;
          break;
        }
      }
      if (!targetClient || targetClient.roomCode === activeRoom.code) return;

      const now = Date.now();
      const lastInviteMs = client.inviteTimestamps.get(targetClient.id) || 0;
      if (now - lastInviteMs < 5000) return;
      client.inviteTimestamps.set(targetClient.id, now);

      sendJson(targetClient.ws, {
        type: 'room_invite',
        fromId: client.id,
        fromName: activePlayer.name,
        roomCode: activeRoom.code,
        roomName: activeRoom.name,
        circuitName: activeRoom.circuitName,
        carCategory: activeRoom.carCategory,
        sentAtMs: now,
      });
      sendJson(client.ws, {
        type: 'invite_sent',
        targetName: targetClient.name,
      });
      return;
    }

    if (msg.type === 'create_room') {
      if (client.roomCode && rooms.has(client.roomCode)) {
        removeOrDisconnectPlayer(rooms.get(client.roomCode), client.playerId, true);
        client.roomCode = null;
        client.playerId = null;
      }

      const carCategory = VALID_CATEGORIES.includes(msg.carCategory) ? msg.carCategory : 'f1';
      const circuitData = resolveCircuit(msg.circuitId, msg.circuitData);
      if (!circuitData) {
        sendJson(client.ws, {
          type: 'error',
          message: 'Circuito inválido ou sem traçado guardado.',
        });
        return;
      }

      const code = generateRoomCode(rooms);
      const hostId = client.id;
      const hostProfile = msg.profile || {};
      const hostCarClass =
        carCategory !== 'open'
          ? carCategory
          : VALID_CAR_CLASSES.includes(hostProfile.carClass)
          ? hostProfile.carClass
          : 'f1';

      const hostPlayer = {
        id: hostId,
        name: sanitizeText(hostProfile.name, 20, client.name || 'Piloto 1'),
        carClass: hostCarClass,
        primaryColor: sanitizeColor(hostProfile.primaryColor, '#e11d48'),
        secondaryColor: sanitizeColor(hostProfile.secondaryColor, '#f8fafc'),
        isReady: false,
        sceneReady: false,
        connected: true,
        disconnectedAt: null,
        gridSlot: 0,
        voiceJoined: false,
        voiceMuted: false,
        ws: client.ws,
        lastState: null,
        lapNumber: 1,
        completedLaps: 0,
        trackS: 0,
        raceProgress: -6.9,
        inPit: false,
        engineHealth: 100,
        tireHealth: 100,
        bestLapMs: null,
        lastLapMs: null,
        finished: false,
        finishTimeMs: null,
        finishOrder: Number.MAX_SAFE_INTEGER,
      };

      const room = {
        code,
        name: sanitizeText(msg.name, 40, `Corrida de ${hostPlayer.name}`),
        hostId,
        carCategory,
        circuitId: circuitData.id || msg.circuitId || circuitData.name || code,
        circuitName: sanitizeText(circuitData.name || msg.circuitName, 40, 'Circuito'),
        circuitLengthM:
          clampInt(msg.circuitLengthM, 0, 100000, 0) || estimateCircuitLengthMeters(circuitData),
        circuitData,
        totalLaps: clampInt(msg.totalLaps, 1, 20, 3),
        speedPreset: VALID_SPEED_PRESETS.includes(msg.speedPreset) ? msg.speedPreset : 'sport',
        environmentTheme: VALID_ENV_THEMES.includes(msg.environmentTheme)
          ? msg.environmentTheme
          : 'day',
        aiCount: clampInt(msg.aiCount, 0, 11, 3),
        maxHumans: 6,
        status: 'lobby',
        players: new Map([[hostId, hostPlayer]]),
        chatHistory: [],
        aiRacers: [],
        aiStates: new Map(),
        aiMeta: new Map(),
        loadingDeadlineMs: null,
        countdownStartServerMs: null,
        raceGoServerMs: null,
        finishDeadlineMs: null,
        finishCounter: 0,
        createdAt: Date.now(),
      };

      rooms.set(code, room);
      client.roomCode = code;
      client.playerId = hostId;
      client.name = hostPlayer.name;
      client.carClass = hostPlayer.carClass;
      client.primaryColor = hostPlayer.primaryColor;
      client.secondaryColor = hostPlayer.secondaryColor;

      sendJson(client.ws, {
        type: 'room_joined',
        selfId: hostId,
        room: serializeRoom(room),
        chatHistory: room.chatHistory,
      });
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return;
    }

    if (msg.type === 'join_room') {
      const code = sanitizeText(msg.code, 12, '').toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(client.ws, {
          type: 'error',
          message: `Sala "${code}" não encontrada ou já terminou.`,
        });
        return;
      }

      // Leave previous room if any
      if (client.roomCode && client.roomCode !== code && rooms.has(client.roomCode)) {
        removeOrDisconnectPlayer(rooms.get(client.roomCode), client.playerId, true);
        client.roomCode = null;
        client.playerId = null;
      }

      // Check reconnection to an active race
      const reconnectId = typeof msg.reconnectId === 'string' ? msg.reconnectId : null;
      if (reconnectId && room.players.has(reconnectId)) {
        const existing = room.players.get(reconnectId);
        if (!existing.connected) {
          existing.connected = true;
          existing.ws = client.ws;
          existing.disconnectedAt = null;
          client.roomCode = room.code;
          client.playerId = existing.id;

          sendJson(client.ws, {
            type: 'room_joined',
            selfId: existing.id,
            room: serializeRoom(room),
            chatHistory: room.chatHistory,
          });
          if (room.status === 'loading' || room.status === 'countdown' || room.status === 'racing') {
            sendJson(client.ws, {
              type: 'race_loading',
              room: serializeRoom(room),
              circuitData: room.circuitData,
              aiRacers: room.aiRacers,
            });
            if (room.status === 'countdown' || room.status === 'racing') {
              sendJson(client.ws, {
                type: 'race_countdown',
                countdownStartServerMs: room.countdownStartServerMs,
                raceGoServerMs: room.raceGoServerMs,
                room: serializeRoom(room),
              });
            }
          }
          broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
          broadcastRoomsListToLobby();
          broadcastOnlinePlayers();
          return;
        }
      }

      if (room.status !== 'lobby') {
        sendJson(client.ws, {
          type: 'error',
          message: 'Esta corrida já arrancou! Aguarda pela próxima ronda ou cria outra sala.',
        });
        return;
      }

      const connectedCount = Array.from(room.players.values()).filter((p) => p.connected).length;
      if (connectedCount >= room.maxHumans) {
        sendJson(client.ws, {
          type: 'error',
          message: 'Sala cheia (máximo 6 jogadores humanos).',
        });
        return;
      }

      const prof = msg.profile || {};
      const playerId = client.id;
      const newPlayer = {
        id: playerId,
        name: sanitizeText(prof.name, 20, client.name || `Piloto ${room.players.size + 1}`),
        carClass: enforceCarClassForRoom(room, prof.carClass),
        primaryColor: sanitizeColor(prof.primaryColor, '#2563eb'),
        secondaryColor: sanitizeColor(prof.secondaryColor, '#f8fafc'),
        isReady: false,
        sceneReady: false,
        connected: true,
        disconnectedAt: null,
        gridSlot: room.players.size,
        voiceJoined: false,
        voiceMuted: false,
        ws: client.ws,
        lastState: null,
        lapNumber: 1,
        completedLaps: 0,
        trackS: 0,
        raceProgress: -(4.5 + room.players.size * 8 + 2.4),
        inPit: false,
        engineHealth: 100,
        tireHealth: 100,
        bestLapMs: null,
        lastLapMs: null,
        finished: false,
        finishTimeMs: null,
        finishOrder: Number.MAX_SAFE_INTEGER,
      };

      room.players.set(playerId, newPlayer);
      client.roomCode = room.code;
      client.playerId = playerId;
      client.name = newPlayer.name;
      client.carClass = newPlayer.carClass;
      client.primaryColor = newPlayer.primaryColor;
      client.secondaryColor = newPlayer.secondaryColor;

      sendJson(client.ws, {
        type: 'room_joined',
        selfId: playerId,
        room: serializeRoom(room),
        chatHistory: room.chatHistory,
      });
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) }, client.ws);
      pushRoomSystemMessage(room, `${newPlayer.name} entrou na sala.`);
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return;
    }

    if (msg.type === 'leave_room') {
      if (client.roomCode && rooms.has(client.roomCode)) {
        const room = rooms.get(client.roomCode);
        const pid = client.playerId;
        client.roomCode = null;
        client.playerId = null;
        removeOrDisconnectPlayer(room, pid, room.status === 'lobby' || room.status === 'finished');
      }
      sendJson(client.ws, { type: 'left_room' });
      sendJson(client.ws, { type: 'rooms_list', rooms: getRoomSummaries() });
      sendJson(client.ws, { type: 'online_players', players: getOnlinePlayers() });
      broadcastOnlinePlayers();
      return;
    }

    // All remaining messages require an active room & player
    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    const player = room && client.playerId ? room.players.get(client.playerId) : null;
    if (!room || !player) return;

    if (msg.type === 'update_profile') {
      if (room.status !== 'lobby') return;
      const prof = msg.profile || msg;
      if (prof.name !== undefined) {
        player.name = sanitizeText(prof.name, 20, player.name);
      }
      if (prof.carClass !== undefined) {
        player.carClass = enforceCarClassForRoom(room, prof.carClass);
      }
      if (prof.primaryColor !== undefined) {
        player.primaryColor = sanitizeColor(prof.primaryColor, player.primaryColor);
      }
      if (prof.secondaryColor !== undefined) {
        player.secondaryColor = sanitizeColor(prof.secondaryColor, player.secondaryColor);
      }
      client.name = player.name;
      client.carClass = player.carClass;
      client.primaryColor = player.primaryColor;
      client.secondaryColor = player.secondaryColor;
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return;
    }

    const launchRace = (targetRoom, requestorWs = null) => {
      if (targetRoom.status !== 'lobby') return false;
      const pts = targetRoom.circuitData?.controlPoints;
      if (!Array.isArray(pts) || pts.length < 3) {
        const errPayload = {
          type: 'error',
          message: 'O circuito selecionado precisa de pelo menos 3 pontos e traçado fechado.',
        };
        if (requestorWs) {
          sendJson(requestorWs, errPayload);
        } else {
          broadcastToRoom(targetRoom, errPayload);
        }
        return false;
      }

      const connectedPlayers = Array.from(targetRoom.players.values()).filter((p) => p.connected);
      // Put host at P1 (slot 0) and remaining humans sequentially
      connectedPlayers.sort((a, b) => (a.id === targetRoom.hostId ? -1 : b.id === targetRoom.hostId ? 1 : 0));

      connectedPlayers.forEach((p, idx) => {
        p.gridSlot = idx;
        p.sceneReady = false;
        p.lastState = null;
        p.lapNumber = 1;
        p.completedLaps = 0;
        p.trackS = 0;
        p.raceProgress = -(4.5 + idx * 8 + 2.4);
        p.inPit = false;
        p.engineHealth = 100;
        p.tireHealth = 100;
        p.bestLapMs = null;
        p.lastLapMs = null;
        p.finished = false;
        p.finishTimeMs = null;
        p.finishOrder = Number.MAX_SAFE_INTEGER;
      });

      const availableBotSlots = Math.max(0, 12 - connectedPlayers.length);
      const effectiveBots = Math.min(targetRoom.aiCount, availableBotSlots);
      const aiRacers = [];
      for (let i = 0; i < effectiveBots; i++) {
        const template = AI_ROSTER[i % AI_ROSTER.length];
        const botClass =
          targetRoom.carCategory !== 'open'
            ? targetRoom.carCategory
            : VALID_CAR_CLASSES[i % VALID_CAR_CLASSES.length];
        aiRacers.push({
          id: `ai_${i + 1}`,
          name: template.name,
          carClass: botClass,
          primaryColor: template.primaryColor,
          secondaryColor: template.secondaryColor,
          gridSlot: connectedPlayers.length + i,
          skill: clampNum(0.92 + ((i * 7) % 10) * 0.012, 0.88, 1.04, 0.96),
        });
      }

      targetRoom.aiRacers = aiRacers;
      targetRoom.aiStates.clear();
      targetRoom.aiMeta.clear();
      targetRoom.finishCounter = 0;
      targetRoom.finishDeadlineMs = null;
      targetRoom.countdownStartServerMs = null;
      targetRoom.raceGoServerMs = null;
      targetRoom.status = 'loading';
      targetRoom.loadingDeadlineMs = Date.now() + 10000;

      broadcastToRoom(targetRoom, {
        type: 'race_loading',
        room: serializeRoom(targetRoom),
        circuitData: targetRoom.circuitData,
        aiRacers: targetRoom.aiRacers,
      });
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return true;
    };

    if (msg.type === 'set_ready') {
      if (room.status !== 'lobby') return;
      player.isReady = Boolean(msg.isReady);
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });

      const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
      if (connectedPlayers.length >= 2 && connectedPlayers.every((p) => p.isReady)) {
        launchRace(room, client.ws);
      }
      return;
    }

    if (msg.type === 'update_room_settings') {
      if (room.hostId !== player.id || room.status !== 'lobby') return;
      if (msg.name !== undefined) {
        room.name = sanitizeText(msg.name, 40, room.name);
      }
      if (msg.carCategory !== undefined && VALID_CATEGORIES.includes(msg.carCategory)) {
        room.carCategory = msg.carCategory;
        if (room.carCategory !== 'open') {
          for (const p of room.players.values()) {
            p.carClass = room.carCategory;
          }
        }
      }
      if (msg.circuitId !== undefined || msg.circuitData !== undefined) {
        const nextCircuit = resolveCircuit(msg.circuitId, msg.circuitData);
        if (nextCircuit) {
          room.circuitData = nextCircuit;
          room.circuitId = nextCircuit.id || msg.circuitId || nextCircuit.name || room.circuitId;
          room.circuitName = sanitizeText(
            nextCircuit.name || msg.circuitName,
            40,
            room.circuitName
          );
          room.circuitLengthM =
            clampInt(msg.circuitLengthM, 0, 100000, 0) ||
            estimateCircuitLengthMeters(nextCircuit);
        }
      }
      if (msg.totalLaps !== undefined) {
        room.totalLaps = clampInt(msg.totalLaps, 1, 20, room.totalLaps);
      }
      if (msg.speedPreset !== undefined && VALID_SPEED_PRESETS.includes(msg.speedPreset)) {
        room.speedPreset = msg.speedPreset;
      }
      if (msg.environmentTheme !== undefined && VALID_ENV_THEMES.includes(msg.environmentTheme)) {
        room.environmentTheme = msg.environmentTheme;
      }
      if (msg.aiCount !== undefined) {
        room.aiCount = clampInt(msg.aiCount, 0, 11, room.aiCount);
      }
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
      broadcastRoomsListToLobby();
      return;
    }

    if (msg.type === 'start_race') {
      if (room.hostId !== player.id || room.status !== 'lobby') return;
      launchRace(room, client.ws);
      return;
    }

    if (msg.type === 'scene_ready') {
      if (room.status !== 'loading' && room.status !== 'countdown' && room.status !== 'racing') {
        return;
      }
      player.sceneReady = true;
      const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);
      const readyIds = connectedPlayers.filter((p) => p.sceneReady).map((p) => p.id);

      broadcastToRoom(room, {
        type: 'ready_progress',
        readyCount: readyIds.length,
        totalHumans: connectedPlayers.length,
        readyIds,
      });

      if (room.status === 'loading' && readyIds.length >= connectedPlayers.length) {
        startSyncedCountdown(room);
      }
      return;
    }

    if (msg.type === 'car_state') {
      if (room.status !== 'loading' && room.status !== 'countdown' && room.status !== 'racing') {
        return;
      }
      const state = {
        id: player.id,
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        z: Number(msg.z) || 0,
        qx: Number(msg.qx) || 0,
        qy: Number(msg.qy) || 0,
        qz: Number(msg.qz) || 0,
        qw: Number.isFinite(Number(msg.qw)) ? Number(msg.qw) : 1,
        vx: Number(msg.vx) || 0,
        vy: Number(msg.vy) || 0,
        vz: Number(msg.vz) || 0,
        steer: Number(msg.steer) || 0,
        speedKmh: Number(msg.speedKmh) || 0,
        wheelRoll: Number(msg.wheelRoll) || 0,
        braking: Boolean(msg.braking),
        headlights: msg.headlights !== undefined ? Boolean(msg.headlights) : true,
        lapNumber: clampInt(msg.lapNumber, 1, 99, player.lapNumber),
        completedLaps: clampInt(msg.completedLaps, 0, 99, player.completedLaps),
        trackS: Number(msg.trackS) || 0,
        raceProgress: Number.isFinite(Number(msg.raceProgress))
          ? Number(msg.raceProgress)
          : player.raceProgress,
        surface: typeof msg.surface === 'string' ? msg.surface : 'TRACK',
        engineHealth: clampNum(msg.engineHealth, 0, 100, player.engineHealth),
        tireHealth: clampNum(msg.tireHealth, 0, 100, player.tireHealth),
        inPit: Boolean(msg.inPit),
        bestLapMs: msg.bestLapMs ?? player.bestLapMs,
        lastLapMs: msg.lastLapMs ?? player.lastLapMs,
        finished: Boolean(msg.finished || player.finished),
        finishTimeMs: msg.finishTimeMs ?? player.finishTimeMs,
        timestampMs: Date.now(),
      };

      player.lastState = state;
      player.lapNumber = state.lapNumber;
      player.completedLaps = state.completedLaps;
      player.trackS = state.trackS;
      player.raceProgress = state.raceProgress;
      player.inPit = state.inPit;
      player.engineHealth = state.engineHealth;
      player.tireHealth = state.tireHealth;
      if (state.bestLapMs) player.bestLapMs = state.bestLapMs;
      if (state.lastLapMs) player.lastLapMs = state.lastLapMs;

      if (msg.finished && !player.finished && (room.status === 'racing' || room.status === 'countdown')) {
        player.finished = true;
        player.finishOrder = ++room.finishCounter;
        player.finishTimeMs =
          Number(msg.finishTimeMs) > 0
            ? Number(msg.finishTimeMs)
            : Math.max(1000, Date.now() - (room.raceGoServerMs || Date.now()));
        state.finished = true;
        state.finishTimeMs = player.finishTimeMs;

        const connectedHumans = Array.from(room.players.values()).filter((p) => p.connected);
        const stillRacingHumans = connectedHumans.filter((p) => !p.finished);
        if (stillRacingHumans.length > 0) {
          if (!room.finishDeadlineMs) {
            room.finishDeadlineMs = Date.now() + 30000;
          }
        } else {
          room.finishDeadlineMs = Math.min(room.finishDeadlineMs || Infinity, Date.now() + 1500);
        }
      }
      return;
    }

    if (msg.type === 'ai_states') {
      if (room.hostId !== player.id) return;
      if (room.status !== 'loading' && room.status !== 'countdown' && room.status !== 'racing') {
        return;
      }
      if (!Array.isArray(msg.states)) return;
      const now = Date.now();
      for (const st of msg.states) {
        if (!st || !st.id) continue;
        const cleanState = {
          id: String(st.id),
          x: Number(st.x) || 0,
          y: Number(st.y) || 0,
          z: Number(st.z) || 0,
          qx: Number(st.qx) || 0,
          qy: Number(st.qy) || 0,
          qz: Number(st.qz) || 0,
          qw: Number.isFinite(Number(st.qw)) ? Number(st.qw) : 1,
          vx: Number(st.vx) || 0,
          vy: Number(st.vy) || 0,
          vz: Number(st.vz) || 0,
          steer: Number(st.steer) || 0,
          speedKmh: Number(st.speedKmh) || 0,
          wheelRoll: Number(st.wheelRoll) || 0,
          braking: Boolean(st.braking),
          headlights: st.headlights !== undefined ? Boolean(st.headlights) : true,
          lapNumber: clampInt(st.lapNumber, 1, 99, 1),
          completedLaps: clampInt(st.completedLaps, 0, 99, 0),
          trackS: Number(st.trackS) || 0,
          raceProgress: Number(st.raceProgress) || 0,
          surface: typeof st.surface === 'string' ? st.surface : 'TRACK',
          engineHealth: clampNum(st.engineHealth, 0, 100, 100),
          tireHealth: clampNum(st.tireHealth, 0, 100, 100),
          inPit: Boolean(st.inPit),
          bestLapMs: st.bestLapMs ?? null,
          lastLapMs: st.lastLapMs ?? null,
          finished: Boolean(st.finished),
          finishTimeMs: st.finishTimeMs ?? null,
          isAi: true,
          timestampMs: now,
        };
        room.aiStates.set(cleanState.id, cleanState);

        if (cleanState.finished && !room.aiMeta.has(cleanState.id)) {
          room.aiMeta.set(cleanState.id, {
            finished: true,
            finishOrder: ++room.finishCounter,
            finishTimeMs:
              Number(cleanState.finishTimeMs) > 0
                ? Number(cleanState.finishTimeMs)
                : Math.max(1000, now - (room.raceGoServerMs || now)),
          });
        }
      }
      return;
    }

    if (msg.type === 'return_to_lobby') {
      if (room.hostId !== player.id) return;
      room.status = 'lobby';
      room.loadingDeadlineMs = null;
      room.countdownStartServerMs = null;
      room.raceGoServerMs = null;
      room.finishDeadlineMs = null;
      room.finishCounter = 0;
      room.aiRacers = [];
      room.aiStates.clear();
      room.aiMeta.clear();

      for (const [pid, p] of room.players.entries()) {
        if (!p.connected) {
          room.players.delete(pid);
          continue;
        }
        p.isReady = false;
        p.sceneReady = false;
        p.lastState = null;
        p.finished = false;
        p.finishTimeMs = null;
        p.finishOrder = Number.MAX_SAFE_INTEGER;
        p.lapNumber = 1;
        p.completedLaps = 0;
      }

      broadcastToRoom(room, {
        type: 'room_returned_lobby',
        room: serializeRoom(room),
      });
      broadcastRoomsListToLobby();
      broadcastOnlinePlayers();
      return;
    }

    if (msg.type === 'voice_join') {
      player.voiceJoined = true;
      player.voiceMuted = Boolean(msg.muted);
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
      broadcastToRoom(
        room,
        {
          type: 'voice_peer_joined',
          peerId: player.id,
          name: player.name,
          muted: player.voiceMuted,
        },
        client.ws
      );
      return;
    }

    if (msg.type === 'voice_leave') {
      player.voiceJoined = false;
      player.voiceMuted = false;
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
      broadcastToRoom(
        room,
        { type: 'voice_peer_left', peerId: player.id },
        client.ws
      );
      return;
    }

    if (msg.type === 'voice_mute') {
      player.voiceMuted = Boolean(msg.muted);
      broadcastToRoom(room, { type: 'room_updated', room: serializeRoom(room) });
      broadcastToRoom(
        room,
        { type: 'voice_peer_muted', peerId: player.id, muted: player.voiceMuted },
        client.ws
      );
      return;
    }

    if (msg.type === 'voice_signal') {
      if (!player.voiceJoined) return;
      if (!['offer', 'answer', 'ice'].includes(msg.signalType)) return;
      const targetId = typeof msg.targetId === 'string' ? msg.targetId : '';
      const target = targetId ? room.players.get(targetId) : null;
      if (!target || !target.connected || !target.ws || !target.voiceJoined) return;
      sendJson(target.ws, {
        type: 'voice_signal',
        fromId: player.id,
        signalType: msg.signalType,
        data: msg.data,
      });
    }
  };

  wss.on('connection', (ws) => {
    const clientId = `drv_${crypto.randomBytes(4).toString('hex')}`;
    const client = {
      id: clientId,
      ws,
      roomCode: null,
      playerId: null,
      isAlive: true,
      name: `Piloto ${crypto.randomInt(10, 99)}`,
      carClass: 'f1',
      primaryColor: '#e11d48',
      secondaryColor: '#f8fafc',
      screen: 'home',
      connectedAt: Date.now(),
      chatTimestamps: [],
      inviteTimestamps: new Map(),
    };
    clients.set(ws, client);

    sendJson(ws, {
      type: 'welcome',
      clientId,
      serverTimeMs: Date.now(),
      rooms: getRoomSummaries(),
      onlinePlayers: getOnlinePlayers(),
      lobbyChatHistory,
    });
    broadcastOnlinePlayers(ws);

    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data) => {
      handleMessage(client, data);
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (client.roomCode && rooms.has(client.roomCode)) {
        const room = rooms.get(client.roomCode);
        removeOrDisconnectPlayer(room, client.playerId, false);
      } else {
        broadcastOnlinePlayers();
      }
    });

    ws.on('error', () => {
      // Close handler performs cleanup
    });
  });

  // Only upgrade /ws/race requests; let Vite HMR or other upgrade listeners handle everything else
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== '/ws/race') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // 20 Hz authoritative room tick loop
  const tickTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'loading' && room.loadingDeadlineMs && now >= room.loadingDeadlineMs) {
        startSyncedCountdown(room);
      }
      if (room.status === 'countdown' && room.raceGoServerMs && now >= room.raceGoServerMs) {
        room.status = 'racing';
        broadcastRoomsListToLobby();
      }
      if (room.status === 'racing' && room.finishDeadlineMs && now >= room.finishDeadlineMs) {
        room.status = 'finished';
        const finalStandings = computeStandings(room);
        broadcastToRoom(room, {
          type: 'race_finished',
          standings: finalStandings,
          finishedAtMs: now,
        });
        broadcastRoomsListToLobby();
        broadcastOnlinePlayers();
        continue;
      }

      if (room.status === 'loading' || room.status === 'countdown' || room.status === 'racing') {
        const cars = {};
        for (const p of room.players.values()) {
          if (p.lastState) {
            cars[p.id] = p.lastState;
          }
        }
        for (const [botId, st] of room.aiStates.entries()) {
          cars[botId] = st;
        }
        const standings = computeStandings(room);
        broadcastToRoom(room, {
          type: 'room_tick',
          serverTimeMs: now,
          status: room.status,
          raceElapsedMs: room.raceGoServerMs ? Math.max(0, now - room.raceGoServerMs) : 0,
          finishDeadlineMs: room.finishDeadlineMs,
          standings,
          cars,
        });
      }
    }
  }, 50);

  // 10s WebSocket protocol keepalive
  const heartbeatTimer = setInterval(() => {
    for (const [ws, client] of clients.entries()) {
      if (!client.isAlive) {
        try {
          ws.terminate();
        } catch {
          // Ignore terminate errors
        }
        continue;
      }
      client.isAlive = false;
      try {
        ws.ping();
      } catch {
        // Ignore ping errors
      }
    }
  }, 10000);

  httpServer.on('close', () => {
    clearInterval(tickTimer);
    clearInterval(heartbeatTimer);
    wss.close();
  });

  const handle = { wss, rooms };
  httpServer[ATTACHED_SYM] = handle;
  return handle;
}
