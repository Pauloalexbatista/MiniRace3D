import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  AiRacerConfig,
  CarCategory,
  CarClass,
  ChatMessage,
  CountdownSyncInfo,
  DriverProfile,
  EnvironmentTheme,
  LocalCarNetSample,
  NetCarState,
  OnlinePlayerInfo,
  RaceStandingEntry,
  ReadyProgressInfo,
  RemoteCarBufferEntry,
  RoomDetail,
  RoomInviteNotification,
  RoomSummary,
  SavedCircuit,
  SpeedPreset,
  VoiceServerEvent,
} from './types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface CreateRoomParams {
  name: string;
  carCategory: CarCategory;
  circuitId: string;
  circuitName: string;
  circuitLengthM: number;
  circuitData: SavedCircuit;
  totalLaps: number;
  speedPreset: SpeedPreset;
  environmentTheme: EnvironmentTheme;
  aiCount: number;
  profile: DriverProfile;
}

export interface RoomSettingsPatch {
  name?: string;
  carCategory?: CarCategory;
  circuitId?: string;
  circuitName?: string;
  circuitLengthM?: number;
  circuitData?: SavedCircuit;
  totalLaps?: number;
  speedPreset?: SpeedPreset;
  environmentTheme?: EnvironmentTheme;
  aiCount?: number;
}

export interface ClientPresenceInfo {
  name: string;
  carClass: CarClass;
  primaryColor: string;
  secondaryColor: string;
  screen: 'home' | 'lobby';
}

export function useRaceClient(enabled = true) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [pingMs, setPingMs] = useState<number>(0);
  const [selfClientId, setSelfClientId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayerInfo[]>([]);
  const [lobbyMessages, setLobbyMessages] = useState<ChatMessage[]>([]);
  const [roomMessages, setRoomMessages] = useState<ChatMessage[]>([]);
  const [pendingInvite, setPendingInvite] = useState<RoomInviteNotification | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [currentRoom, setCurrentRoom] = useState<RoomDetail | null>(null);
  const [activeCircuit, setActiveCircuit] = useState<SavedCircuit | null>(null);
  const [aiRacers, setAiRacers] = useState<AiRacerConfig[]>([]);
  const [readyProgress, setReadyProgress] = useState<ReadyProgressInfo | null>(null);
  const [countdownSync, setCountdownSync] = useState<CountdownSyncInfo | null>(null);
  const [standings, setStandings] = useState<RaceStandingEntry[]>([]);
  const [finishDeadlineLocalMs, setFinishDeadlineLocalMs] = useState<number | null>(null);
  const [finalStandings, setFinalStandings] = useState<RaceStandingEntry[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hostNotice, setHostNotice] = useState<string | null>(null);

  const remoteCarsRef = useRef<Map<string, RemoteCarBufferEntry>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const serverOffsetRef = useRef<number>(0); // serverDateMs - performance.now()
  const hasRttSampleRef = useRef<boolean>(false);
  const lastStandingsUpdateRef = useRef<number>(0);
  const lastFinishedCountRef = useRef<number>(0);
  const lastRoomStatusRef = useRef<string>('lobby');
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const inviteNoticeTimerRef = useRef<number | null>(null);
  const activeRoomRef = useRef<RoomDetail | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const presenceRef = useRef<ClientPresenceInfo | null>(null);
  const voiceListenersRef = useRef<Set<(evt: VoiceServerEvent) => void>>(new Set());

  activeRoomRef.current = currentRoom;
  selfIdRef.current = selfId;

  const sendRaw = useCallback((payload: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnectionState('disconnected');
      return;
    }

    let disposed = false;
    let pingTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      setConnectionState('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/race`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        sendRaw({ type: 'ping', clientTime: performance.now() });
        if (presenceRef.current) {
          sendRaw({ type: 'set_presence', ...presenceRef.current });
        }
        sendRaw({ type: 'list_rooms' });

        // Attempt automatic rejoin if connection dropped during an active race
        const prevRoom = activeRoomRef.current;
        const prevSelfId = selfIdRef.current;
        if (
          prevRoom &&
          prevSelfId &&
          (prevRoom.status === 'loading' ||
            prevRoom.status === 'countdown' ||
            prevRoom.status === 'racing')
        ) {
          sendRaw({
            type: 'join_room',
            code: prevRoom.code,
            reconnectId: prevSelfId,
          });
        }
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!msg || typeof msg.type !== 'string') return;

        switch (msg.type) {
          case 'welcome': {
            if (typeof msg.clientId === 'string') {
              setSelfClientId(msg.clientId);
            }
            if (!hasRttSampleRef.current && typeof msg.serverTimeMs === 'number') {
              serverOffsetRef.current = msg.serverTimeMs - performance.now();
            }
            if (Array.isArray(msg.rooms)) setRooms(msg.rooms);
            if (Array.isArray(msg.onlinePlayers)) setOnlinePlayers(msg.onlinePlayers);
            if (Array.isArray(msg.lobbyChatHistory)) setLobbyMessages(msg.lobbyChatHistory);
            break;
          }
          case 'pong': {
            const t1 = performance.now();
            const rtt = Math.max(0, t1 - Number(msg.clientTime || t1));
            const clientMid = Number(msg.clientTime || t1) + rtt * 0.5;
            const sampleOffset = Number(msg.serverTime) - clientMid;
            if (!hasRttSampleRef.current) {
              serverOffsetRef.current = sampleOffset;
              hasRttSampleRef.current = true;
            } else {
              serverOffsetRef.current = serverOffsetRef.current * 0.75 + sampleOffset * 0.25;
            }
            setPingMs(Math.round(rtt));
            break;
          }
          case 'rooms_list': {
            if (Array.isArray(msg.rooms)) setRooms(msg.rooms);
            break;
          }
          case 'online_players': {
            if (Array.isArray(msg.players)) setOnlinePlayers(msg.players);
            break;
          }
          case 'chat_message': {
            const chatMsg = msg.message as ChatMessage | undefined;
            if (chatMsg && typeof chatMsg.text === 'string') {
              if (chatMsg.scope === 'room') {
                setRoomMessages((prev) => {
                  if (prev.some((m) => m.id === chatMsg.id)) return prev;
                  const next = [...prev, chatMsg];
                  return next.length > 60 ? next.slice(next.length - 60) : next;
                });
              } else {
                setLobbyMessages((prev) => {
                  if (prev.some((m) => m.id === chatMsg.id)) return prev;
                  const next = [...prev, chatMsg];
                  return next.length > 40 ? next.slice(next.length - 40) : next;
                });
              }
            }
            break;
          }
          case 'room_invite': {
            if (msg.roomCode && msg.fromName) {
              setPendingInvite({
                fromId: String(msg.fromId || ''),
                fromName: String(msg.fromName),
                roomCode: String(msg.roomCode),
                roomName: String(msg.roomName || 'Sala Online'),
                circuitName: String(msg.circuitName || 'Circuito'),
                carCategory: (msg.carCategory as CarCategory) || 'open',
                sentAtMs: Number(msg.sentAtMs) || Date.now(),
              });
            }
            break;
          }
          case 'invite_sent': {
            if (msg.targetName) {
              setInviteNotice(`📩 Convite enviado para ${msg.targetName}!`);
              if (inviteNoticeTimerRef.current !== null) {
                window.clearTimeout(inviteNoticeTimerRef.current);
              }
              inviteNoticeTimerRef.current = window.setTimeout(() => {
                setInviteNotice(null);
              }, 3500);
            }
            break;
          }
          case 'room_joined': {
            setSelfId(msg.selfId || null);
            setCurrentRoom(msg.room || null);
            setRoomMessages(Array.isArray(msg.chatHistory) ? msg.chatHistory : []);
            setPendingInvite(null);
            setErrorMsg(null);
            break;
          }
          case 'room_updated': {
            if (msg.room) {
              setCurrentRoom(msg.room);
            }
            break;
          }
          case 'left_room': {
            remoteCarsRef.current.clear();
            setCurrentRoom(null);
            setRoomMessages([]);
            setActiveCircuit(null);
            setAiRacers([]);
            setReadyProgress(null);
            setCountdownSync(null);
            setStandings([]);
            setFinishDeadlineLocalMs(null);
            setFinalStandings(null);
            break;
          }
          case 'voice_peer_joined':
          case 'voice_peer_left':
          case 'voice_peer_muted':
          case 'voice_signal': {
            const evt = msg as VoiceServerEvent;
            voiceListenersRef.current.forEach((cb) => cb(evt));
            break;
          }
          case 'host_changed': {
            if (msg.newHostName) {
              setHostNotice(`👑 ${msg.newHostName} assumiu o papel de anfitrião da sala.`);
              window.setTimeout(() => setHostNotice(null), 4000);
            }
            break;
          }
          case 'race_loading': {
            remoteCarsRef.current.clear();
            lastFinishedCountRef.current = 0;
            lastRoomStatusRef.current = 'loading';
            setFinalStandings(null);
            setFinishDeadlineLocalMs(null);
            setCountdownSync(null);
            setStandings([]);
            if (msg.room) setCurrentRoom(msg.room);
            if (msg.circuitData) setActiveCircuit(msg.circuitData);
            if (Array.isArray(msg.aiRacers)) setAiRacers(msg.aiRacers);
            const humans = msg.room?.connectedHumans || msg.room?.players?.length || 1;
            setReadyProgress({ readyCount: 0, totalHumans: humans, readyIds: [] });
            break;
          }
          case 'ready_progress': {
            setReadyProgress({
              readyCount: Number(msg.readyCount) || 0,
              totalHumans: Number(msg.totalHumans) || 1,
              readyIds: Array.isArray(msg.readyIds) ? msg.readyIds : [],
            });
            break;
          }
          case 'race_countdown': {
            if (msg.room) setCurrentRoom(msg.room);
            const startSrv = Number(msg.countdownStartServerMs);
            const goSrv = Number(msg.raceGoServerMs);
            if (Number.isFinite(startSrv) && Number.isFinite(goSrv)) {
              setCountdownSync({
                countdownStartLocalMs: startSrv - serverOffsetRef.current,
                raceGoLocalMs: goSrv - serverOffsetRef.current,
              });
            }
            break;
          }
          case 'room_tick': {
            const nowPerf = performance.now();
            if (msg.cars && typeof msg.cars === 'object') {
              const map = remoteCarsRef.current;
              const incomingIds = new Set<string>();
              for (const [id, rawCar] of Object.entries(msg.cars as Record<string, NetCarState>)) {
                incomingIds.add(id);
                const existing = map.get(id);
                if (existing) {
                  existing.prev = existing.curr;
                  existing.prevReceivedAtMs = existing.receivedAtMs;
                  existing.curr = rawCar;
                  existing.receivedAtMs = nowPerf;
                } else {
                  map.set(id, {
                    prev: rawCar,
                    curr: rawCar,
                    receivedAtMs: nowPerf,
                    prevReceivedAtMs: nowPerf,
                  });
                }
              }
              for (const existingId of Array.from(map.keys())) {
                if (!incomingIds.has(existingId)) {
                  map.delete(existingId);
                }
              }
            }

            if (msg.finishDeadlineMs) {
              setFinishDeadlineLocalMs(Number(msg.finishDeadlineMs) - serverOffsetRef.current);
            }

            const nextStandings: RaceStandingEntry[] = Array.isArray(msg.standings)
              ? msg.standings
              : [];
            const finishedCount = nextStandings.reduce((acc, s) => acc + (s.finished ? 1 : 0), 0);
            const statusChanged = msg.status !== lastRoomStatusRef.current;

            if (
              statusChanged ||
              finishedCount !== lastFinishedCountRef.current ||
              nowPerf - lastStandingsUpdateRef.current >= 140
            ) {
              lastStandingsUpdateRef.current = nowPerf;
              lastFinishedCountRef.current = finishedCount;
              if (statusChanged && msg.status) {
                lastRoomStatusRef.current = msg.status;
                setCurrentRoom((prev) => (prev ? { ...prev, status: msg.status } : prev));
              }
              setStandings(nextStandings);
            }
            break;
          }
          case 'race_finished': {
            const finalList: RaceStandingEntry[] = Array.isArray(msg.standings)
              ? msg.standings
              : [];
            setStandings(finalList);
            setFinalStandings(finalList);
            setCurrentRoom((prev) => (prev ? { ...prev, status: 'finished' } : prev));
            break;
          }
          case 'room_returned_lobby': {
            remoteCarsRef.current.clear();
            setActiveCircuit(null);
            setAiRacers([]);
            setReadyProgress(null);
            setCountdownSync(null);
            setStandings([]);
            setFinishDeadlineLocalMs(null);
            setFinalStandings(null);
            if (msg.room) setCurrentRoom(msg.room);
            break;
          }
          case 'error': {
            if (msg.message) {
              setErrorMsg(String(msg.message));
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnectionState('disconnected');
        const delay = Math.min(4000, 1000 * Math.pow(2, reconnectAttemptRef.current));
        reconnectAttemptRef.current = Math.min(4, reconnectAttemptRef.current + 1);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    };

    connect();
    pingTimer = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendRaw({ type: 'ping', clientTime: performance.now() });
      }
    }, 3000);

    return () => {
      disposed = true;
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      if (inviteNoticeTimerRef.current !== null) window.clearTimeout(inviteNoticeTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // Ignore close errors
      }
      wsRef.current = null;
    };
  }, [enabled, sendRaw]);

  const updatePresence = useCallback(
    (presence: ClientPresenceInfo) => {
      presenceRef.current = presence;
      sendRaw({ type: 'set_presence', ...presence });
    },
    [sendRaw]
  );

  const sendChatMessage = useCallback(
    (scope: 'lobby' | 'room', text: string) => {
      const clean = text.trim();
      if (!clean) return false;
      return sendRaw({ type: 'chat_send', scope, text: clean });
    },
    [sendRaw]
  );

  const inviteOnlinePlayer = useCallback(
    (targetClientId: string) => {
      return sendRaw({ type: 'invite_player', targetClientId });
    },
    [sendRaw]
  );

  const dismissInvite = useCallback(() => {
    setPendingInvite(null);
  }, []);

  const sendVoiceJoin = useCallback(
    (muted: boolean) => sendRaw({ type: 'voice_join', muted }),
    [sendRaw]
  );

  const sendVoiceLeave = useCallback(() => sendRaw({ type: 'voice_leave' }), [sendRaw]);

  const sendVoiceMute = useCallback(
    (muted: boolean) => sendRaw({ type: 'voice_mute', muted }),
    [sendRaw]
  );

  const sendVoiceSignal = useCallback(
    (targetId: string, signalType: 'offer' | 'answer' | 'ice', data: unknown) =>
      sendRaw({ type: 'voice_signal', targetId, signalType, data }),
    [sendRaw]
  );

  const subscribeVoiceEvents = useCallback((listener: (evt: VoiceServerEvent) => void) => {
    voiceListenersRef.current.add(listener);
    return () => {
      voiceListenersRef.current.delete(listener);
    };
  }, []);

  const refreshRooms = useCallback(() => {
    sendRaw({ type: 'list_rooms' });
  }, [sendRaw]);

  const createRoom = useCallback(
    (params: CreateRoomParams) => {
      setErrorMsg(null);
      return sendRaw({ type: 'create_room', ...params });
    },
    [sendRaw]
  );

  const joinRoom = useCallback(
    (code: string, profile: DriverProfile) => {
      setErrorMsg(null);
      return sendRaw({ type: 'join_room', code: code.trim().toUpperCase(), profile });
    },
    [sendRaw]
  );

  const leaveRoom = useCallback(() => {
    sendRaw({ type: 'leave_room' });
    remoteCarsRef.current.clear();
    setCurrentRoom(null);
    setRoomMessages([]);
    setActiveCircuit(null);
    setAiRacers([]);
    setReadyProgress(null);
    setCountdownSync(null);
    setStandings([]);
    setFinishDeadlineLocalMs(null);
    setFinalStandings(null);
  }, [sendRaw]);

  const updateProfile = useCallback(
    (profile: Partial<DriverProfile>) => {
      sendRaw({ type: 'update_profile', profile });
    },
    [sendRaw]
  );

  const setReady = useCallback(
    (isReady: boolean) => {
      sendRaw({ type: 'set_ready', isReady });
    },
    [sendRaw]
  );

  const updateRoomSettings = useCallback(
    (patch: RoomSettingsPatch) => {
      sendRaw({ type: 'update_room_settings', ...patch });
    },
    [sendRaw]
  );

  const startRace = useCallback(() => {
    setErrorMsg(null);
    sendRaw({ type: 'start_race' });
  }, [sendRaw]);

  const sendSceneReady = useCallback(() => {
    sendRaw({ type: 'scene_ready' });
  }, [sendRaw]);

  const sendCarState = useCallback(
    (sample: LocalCarNetSample) => {
      sendRaw({ type: 'car_state', ...sample });
    },
    [sendRaw]
  );

  const sendAiStates = useCallback(
    (states: NetCarState[]) => {
      sendRaw({ type: 'ai_states', states });
    },
    [sendRaw]
  );

  const returnToLobby = useCallback(() => {
    sendRaw({ type: 'return_to_lobby' });
  }, [sendRaw]);

  const clearError = useCallback(() => setErrorMsg(null), []);

  return {
    connectionState,
    pingMs,
    selfClientId,
    selfId,
    rooms,
    onlinePlayers,
    lobbyMessages,
    roomMessages,
    pendingInvite,
    inviteNotice,
    currentRoom,
    activeCircuit,
    aiRacers,
    readyProgress,
    countdownSync,
    standings,
    finishDeadlineLocalMs,
    finalStandings,
    errorMsg,
    hostNotice,
    remoteCarsRef,
    updatePresence,
    sendChatMessage,
    inviteOnlinePlayer,
    dismissInvite,
    sendVoiceJoin,
    sendVoiceLeave,
    sendVoiceMute,
    sendVoiceSignal,
    subscribeVoiceEvents,
    refreshRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    updateProfile,
    setReady,
    updateRoomSettings,
    startRace,
    sendSceneReady,
    sendCarState,
    sendAiStates,
    returnToLobby,
    clearError,
  };
}
