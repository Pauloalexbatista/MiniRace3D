import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomPlayerInfo, VoiceServerEvent } from './types';
import type { useRaceClient } from './useRaceClient';
import { readGamepadVoiceButton } from '../gamepadInput';

const PTT_STORAGE_KEY = 'minirace3d_voice_ptt';
const VOL_STORAGE_KEY = 'minirace3d_voice_vol';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export type VoicePeerConnState = 'connecting' | 'connected' | 'failed';

export interface UseRoomVoiceOptions {
  raceClient: ReturnType<typeof useRaceClient>;
  roomCode: string | null;
  selfId: string | null;
  players: RoomPlayerInfo[];
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender | null;
  iceRestarted: boolean;
  makingOffer: boolean;
  remoteStream: MediaStream | null;
}

function loadStoredPtt(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(PTT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function loadStoredVol(): number {
  if (typeof window === 'undefined') return 0.85;
  try {
    const raw = localStorage.getItem(VOL_STORAGE_KEY);
    const n = raw !== null ? Number(raw) : 0.85;
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.85;
  } catch {
    return 0.85;
  }
}

function computeRms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const centered = (buf[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / buf.length);
}

export function useRoomVoice({ raceClient, roomCode, selfId, players }: UseRoomVoiceOptions) {
  const {
    sendVoiceJoin,
    sendVoiceLeave,
    sendVoiceMute,
    sendVoiceSignal,
    subscribeVoiceEvents,
  } = raceClient;

  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [listenOnly, setListenOnly] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [pushToTalk, setPushToTalkState] = useState<boolean>(loadStoredPtt);
  const [pttKeyActive, setPttKeyActive] = useState(false);
  const [voiceVolume, setVoiceVolumeState] = useState<number>(loadStoredVol);
  const [speakingPeers, setSpeakingPeers] = useState<Record<string, boolean>>({});
  const [peerStates, setPeerStates] = useState<Record<string, VoicePeerConnState>>({});
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioElemsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const vadCtxRef = useRef<AudioContext | null>(null);
  const vadAnalysersRef = useRef<
    Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; buf: Uint8Array<ArrayBuffer> }>
  >(new Map());

  const joinedRef = useRef(joined);
  joinedRef.current = joined;
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;
  const playersRef = useRef(players);
  playersRef.current = players;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const listenOnlyRef = useRef(listenOnly);
  listenOnlyRef.current = listenOnly;
  const isDeafenedRef = useRef(isDeafened);
  isDeafenedRef.current = isDeafened;
  const pushToTalkRef = useRef(pushToTalk);
  pushToTalkRef.current = pushToTalk;
  const pttKeyActiveRef = useRef(pttKeyActive);
  const pttGamepadActiveRef = useRef(false);
  const voiceVolumeRef = useRef(voiceVolume);
  voiceVolumeRef.current = voiceVolume;

  const isAnyPttHeld = useCallback(
    () => pttKeyActiveRef.current || pttGamepadActiveRef.current,
    []
  );

  const isLocalMicEnabled = useCallback(() => {
    if (!joinedRef.current || listenOnlyRef.current || !localStreamRef.current) return false;
    if (isMutedRef.current) return false;
    if (pushToTalkRef.current) return pttKeyActiveRef.current || pttGamepadActiveRef.current;
    return true;
  }, []);

  const syncLocalTrackEnabled = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = isLocalMicEnabled();
    for (const track of stream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }, [isLocalMicEnabled]);

  const attachVadStream = useCallback((id: string, stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!vadCtxRef.current || vadCtxRef.current.state === 'closed') {
        vadCtxRef.current = new AudioCtx();
      }
      const ctx = vadCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const prev = vadAnalysersRef.current.get(id);
      if (prev) {
        try {
          prev.source.disconnect();
        } catch {}
        vadAnalysersRef.current.delete(id);
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      vadAnalysersRef.current.set(id, {
        analyser,
        source,
        buf: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
      });
    } catch {
      // Ignore WebAudio VAD errors
    }
  }, []);

  const detachVadStream = useCallback((id: string) => {
    const entry = vadAnalysersRef.current.get(id);
    if (entry) {
      try {
        entry.source.disconnect();
      } catch {}
      vadAnalysersRef.current.delete(id);
    }
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const entry = peersRef.current.get(peerId);
      if (entry) {
        try {
          entry.pc.onicecandidate = null;
          entry.pc.ontrack = null;
          entry.pc.oniceconnectionstatechange = null;
          entry.pc.onconnectionstatechange = null;
          entry.pc.close();
        } catch {}
        peersRef.current.delete(peerId);
      }
      pendingIceRef.current.delete(peerId);
      const audioEl = audioElemsRef.current.get(peerId);
      if (audioEl) {
        try {
          audioEl.pause();
          audioEl.srcObject = null;
          audioEl.remove();
        } catch {}
        audioElemsRef.current.delete(peerId);
      }
      detachVadStream(peerId);
      setPeerStates((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setSpeakingPeers((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    },
    [detachVadStream]
  );

  const cleanupAllVoice = useCallback(() => {
    for (const peerId of Array.from(peersRef.current.keys())) {
      closePeer(peerId);
    }
    pendingIceRef.current.clear();

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      localStreamRef.current = null;
    }

    for (const id of Array.from(vadAnalysersRef.current.keys())) {
      detachVadStream(id);
    }
    if (vadCtxRef.current) {
      try {
        vadCtxRef.current.close().catch(() => {});
      } catch {}
      vadCtxRef.current = null;
    }

    setJoined(false);
    setJoining(false);
    setListenOnly(false);
    pttKeyActiveRef.current = false;
    pttGamepadActiveRef.current = false;
    setPttKeyActive(false);
    setSpeakingPeers({});
    setPeerStates({});
  }, [closePeer, detachVadStream]);

  const ensurePeerConnection = useCallback(
    (peerId: string, initiateOffer: boolean): PeerEntry | null => {
      if (!joinedRef.current || !selfIdRef.current || peerId === selfIdRef.current) return null;
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const entry: PeerEntry = {
        pc,
        audioSender: null,
        iceRestarted: false,
        makingOffer: false,
        remoteStream: null,
      };
      peersRef.current.set(peerId, entry);
      setPeerStates((prev) => ({ ...prev, [peerId]: 'connecting' }));

      const localStream = localStreamRef.current;
      const localAudioTrack = localStream?.getAudioTracks()[0] || null;
      if (localStream && localAudioTrack) {
        entry.audioSender = pc.addTrack(localAudioTrack, localStream);
      } else {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendVoiceSignal(peerId, 'ice', event.candidate.toJSON());
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        entry.remoteStream = stream;

        let audioEl = audioElemsRef.current.get(peerId);
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          audioEl.style.display = 'none';
          document.body.appendChild(audioEl);
          audioElemsRef.current.set(peerId, audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.volume = voiceVolumeRef.current;
        audioEl.muted = isDeafenedRef.current;
        audioEl.play().catch(() => {});

        attachVadStream(peerId, stream);
      };

      const updateConnStatus = () => {
        const ice = pc.iceConnectionState;
        const conn = pc.connectionState;
        if (conn === 'connected' || ice === 'connected' || ice === 'completed') {
          setPeerStates((prev) => ({ ...prev, [peerId]: 'connected' }));
        } else if (ice === 'failed' || conn === 'failed') {
          if (!entry.iceRestarted) {
            entry.iceRestarted = true;
            try {
              pc.restartIce();
            } catch {}
          } else {
            setPeerStates((prev) => ({ ...prev, [peerId]: 'failed' }));
          }
        } else if (conn === 'disconnected' || ice === 'disconnected') {
          setPeerStates((prev) => ({ ...prev, [peerId]: 'connecting' }));
        }
      };

      pc.oniceconnectionstatechange = updateConnStatus;
      pc.onconnectionstatechange = updateConnStatus;

      if (initiateOffer) {
        entry.makingOffer = true;
        pc.createOffer({ offerToReceiveAudio: true })
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription) {
              sendVoiceSignal(peerId, 'offer', pc.localDescription.toJSON());
            }
          })
          .catch(() => {})
          .finally(() => {
            entry.makingOffer = false;
          });
      }

      return entry;
    },
    [attachVadStream, sendVoiceSignal]
  );

  // Subscribe to signaling events from WebSocket
  useEffect(() => {
    return subscribeVoiceEvents(async (evt: VoiceServerEvent) => {
      if (!joinedRef.current || !selfIdRef.current) return;
      const myId = selfIdRef.current;

      if (evt.type === 'voice_peer_joined') {
        if (evt.peerId === myId) return;
        // Deterministic offerer: lower ID sends initial offer
        const shouldInitiate = myId < evt.peerId;
        ensurePeerConnection(evt.peerId, shouldInitiate);
        return;
      }

      if (evt.type === 'voice_peer_left') {
        closePeer(evt.peerId);
        return;
      }

      if (evt.type === 'voice_signal') {
        const fromId = evt.fromId;
        if (!fromId || fromId === myId) return;

        const entry = ensurePeerConnection(fromId, false);
        if (!entry) return;
        const { pc } = entry;

        try {
          if (evt.signalType === 'offer') {
            const desc = evt.data as RTCSessionDescriptionInit;
            const polite = myId > fromId;
            const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
            if (offerCollision && !polite) {
              return;
            }
            if (offerCollision && polite) {
              await pc.setLocalDescription({ type: 'rollback' });
            }
            await pc.setRemoteDescription(new RTCSessionDescription(desc));

            const queued = pendingIceRef.current.get(fromId);
            if (queued && queued.length > 0) {
              for (const cand of queued) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch {}
              }
              pendingIceRef.current.delete(fromId);
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (pc.localDescription) {
              sendVoiceSignal(fromId, 'answer', pc.localDescription.toJSON());
            }
          } else if (evt.signalType === 'answer') {
            const desc = evt.data as RTCSessionDescriptionInit;
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(desc));
              const queued = pendingIceRef.current.get(fromId);
              if (queued && queued.length > 0) {
                for (const cand of queued) {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                  } catch {}
                }
                pendingIceRef.current.delete(fromId);
              }
            }
          } else if (evt.signalType === 'ice') {
            const cand = evt.data as RTCIceCandidateInit;
            if (!cand) return;
            if (pc.remoteDescription && pc.remoteDescription.type) {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } else {
              const list = pendingIceRef.current.get(fromId) || [];
              list.push(cand);
              pendingIceRef.current.set(fromId, list);
            }
          }
        } catch {
          // Ignore transient WebRTC negotiation races
        }
      }
    });
  }, [subscribeVoiceEvents, ensurePeerConnection, closePeer, sendVoiceSignal]);

  // Sync WebRTC peer connections with room players state
  useEffect(() => {
    if (!joined || !selfId || !roomCode) return;

    const activeVoicePeerIds = new Set<string>();
    for (const p of players) {
      if (p.id !== selfId && p.connected && p.voiceJoined) {
        activeVoicePeerIds.add(p.id);
        if (!peersRef.current.has(p.id)) {
          ensurePeerConnection(p.id, selfId < p.id);
        }
      }
    }

    for (const existingPeerId of Array.from(peersRef.current.keys())) {
      if (!activeVoicePeerIds.has(existingPeerId)) {
        closePeer(existingPeerId);
      }
    }
  }, [joined, selfId, roomCode, players, ensurePeerConnection, closePeer]);

  // Keep remote <audio> volume & deafen state synced
  useEffect(() => {
    for (const audioEl of audioElemsRef.current.values()) {
      audioEl.volume = voiceVolume;
      audioEl.muted = isDeafened;
    }
  }, [voiceVolume, isDeafened]);

  // Unlock audio playback on any user interaction while in voice
  useEffect(() => {
    if (!joined) return;
    const unlockAll = () => {
      if (vadCtxRef.current && vadCtxRef.current.state === 'suspended') {
        vadCtxRef.current.resume().catch(() => {});
      }
      for (const audioEl of audioElemsRef.current.values()) {
        if (audioEl.paused && audioEl.srcObject) {
          audioEl.play().catch(() => {});
        }
      }
    };
    window.addEventListener('pointerdown', unlockAll, { passive: true });
    window.addEventListener('keydown', unlockAll);
    return () => {
      window.removeEventListener('pointerdown', unlockAll);
      window.removeEventListener('keydown', unlockAll);
    };
  }, [joined]);

  // Lightweight 10Hz Voice Activity Detection loop
  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(() => {
      const myId = selfIdRef.current;
      const nextMap: Record<string, boolean> = {};

      for (const [id, entry] of vadAnalysersRef.current.entries()) {
        if (id === myId) {
          if (!isLocalMicEnabled()) {
            nextMap[id] = false;
            continue;
          }
        }
        const rms = computeRms(entry.analyser, entry.buf);
        nextMap[id] = rms > 0.024;
      }

      setSpeakingPeers((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(nextMap);
        if (
          prevKeys.length === nextKeys.length &&
          nextKeys.every((k) => Boolean(prev[k]) === Boolean(nextMap[k]))
        ) {
          return prev;
        }
        return nextMap;
      });
    }, 100);

    return () => window.clearInterval(timer);
  }, [joined, isLocalMicEnabled]);

  // Tear down voice when leaving room
  useEffect(() => {
    if (!roomCode) {
      cleanupAllVoice();
    }
  }, [roomCode, cleanupAllVoice]);

  useEffect(() => {
    return () => {
      cleanupAllVoice();
    };
  }, [cleanupAllVoice]);

  const joinVoice = useCallback(
    async (opts?: { listenOnly?: boolean }) => {
      if (!roomCodeRef.current || !selfIdRef.current || joining) return;
      setVoiceError(null);
      setJoining(true);

      let wantListenOnly = Boolean(opts?.listenOnly);
      let stream: MediaStream | null = null;

      if (!wantListenOnly) {
        if (typeof window !== 'undefined' && !window.isSecureContext) {
          setVoiceError('O microfone requer HTTPS ou localhost. A entrar em modo Só Ouvir.');
          wantListenOnly = true;
        } else if (!navigator.mediaDevices?.getUserMedia) {
          setVoiceError('Browser sem suporte de microfone. A entrar em modo Só Ouvir.');
          wantListenOnly = true;
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
              },
              video: false,
            });
          } catch (err) {
            const name = err instanceof Error ? err.name : '';
            if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
              setVoiceError('Sem microfone detetado — entraste em modo Só Ouvir (auscultadores).');
              wantListenOnly = true;
            } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
              setVoiceError('Permissão de microfone recusada. Podes usar "Só Ouvir" ou autorizar no cadeado do browser.');
              setJoining(false);
              return;
            } else {
              setVoiceError('Não foi possível abrir o microfone — a entrar em modo Só Ouvir.');
              wantListenOnly = true;
            }
          }
        }
      }

      // Guard if room left while awaiting getUserMedia
      if (!roomCodeRef.current || !selfIdRef.current) {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        setJoining(false);
        return;
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      localStreamRef.current = stream;

      const initialMuted = wantListenOnly ? true : pushToTalkRef.current;
      joinedRef.current = true;
      listenOnlyRef.current = wantListenOnly;
      isMutedRef.current = initialMuted;
      pttKeyActiveRef.current = false;
      pttGamepadActiveRef.current = false;

      setListenOnly(wantListenOnly);
      setIsMuted(wantListenOnly ? true : false);
      setPttKeyActive(false);
      setJoined(true);
      setJoining(false);

      if (stream) {
        const myId = selfIdRef.current;
        if (myId) attachVadStream(myId, stream);
        syncLocalTrackEnabled();
      }

      sendVoiceJoin(initialMuted);

      const myId = selfIdRef.current;
      for (const p of playersRef.current) {
        if (p.id !== myId && p.connected && p.voiceJoined) {
          ensurePeerConnection(p.id, myId < p.id);
        }
      }
    },
    [joining, attachVadStream, syncLocalTrackEnabled, sendVoiceJoin, ensurePeerConnection]
  );

  const leaveVoice = useCallback(() => {
    if (joinedRef.current) {
      sendVoiceLeave();
    }
    cleanupAllVoice();
    setVoiceError(null);
  }, [sendVoiceLeave, cleanupAllVoice]);

  const toggleMute = useCallback(() => {
    if (!joinedRef.current || listenOnlyRef.current) return;
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    syncLocalTrackEnabled();
    sendVoiceMute(nextMuted || (pushToTalkRef.current && !isAnyPttHeld()));
  }, [syncLocalTrackEnabled, sendVoiceMute, isAnyPttHeld]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      isDeafenedRef.current = next;
      for (const audioEl of audioElemsRef.current.values()) {
        audioEl.muted = next;
      }
      return next;
    });
  }, []);

  const setPushToTalk = useCallback(
    (enabled: boolean) => {
      pushToTalkRef.current = enabled;
      setPushToTalkState(enabled);
      try {
        localStorage.setItem(PTT_STORAGE_KEY, enabled ? '1' : '0');
      } catch {}
      if (!enabled) {
        pttKeyActiveRef.current = false;
        pttGamepadActiveRef.current = false;
        setPttKeyActive(false);
      }
      syncLocalTrackEnabled();
      if (joinedRef.current && !listenOnlyRef.current) {
        sendVoiceMute(isMutedRef.current || (enabled && !isAnyPttHeld()));
      }
    },
    [syncLocalTrackEnabled, sendVoiceMute, isAnyPttHeld]
  );

  const setVoiceVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    voiceVolumeRef.current = clamped;
    setVoiceVolumeState(clamped);
    try {
      localStorage.setItem(VOL_STORAGE_KEY, String(clamped));
    } catch {}
    for (const audioEl of audioElemsRef.current.values()) {
      audioEl.volume = clamped;
    }
  }, []);

  // Global 'V' key for Push-to-Talk or quick Mute toggle while joined
  useEffect(() => {
    if (!joined) return;
    const isEditable = (el: EventTarget | null) => {
      const target = el as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV' || isEditable(e.target)) return;
      if (listenOnlyRef.current) return;
      if (pushToTalkRef.current) {
        if (!pttKeyActiveRef.current) {
          pttKeyActiveRef.current = true;
          setPttKeyActive(isAnyPttHeld());
          syncLocalTrackEnabled();
          sendVoiceMute(isMutedRef.current || !isAnyPttHeld());
        }
      } else if (!e.repeat) {
        toggleMute();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV') return;
      if (pushToTalkRef.current && pttKeyActiveRef.current) {
        pttKeyActiveRef.current = false;
        const stillHeld = isAnyPttHeld();
        setPttKeyActive(stillHeld);
        syncLocalTrackEnabled();
        sendVoiceMute(isMutedRef.current || !stillHeld);
      }
    };

    const onBlur = () => {
      if (pushToTalkRef.current && pttKeyActiveRef.current) {
        pttKeyActiveRef.current = false;
        const stillHeld = isAnyPttHeld();
        setPttKeyActive(stillHeld);
        syncLocalTrackEnabled();
        sendVoiceMute(isMutedRef.current || !stillHeld);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [joined, syncLocalTrackEnabled, sendVoiceMute, toggleMute, isAnyPttHeld]);

  // Gamepad Push-to-Talk / Mute toggle polling while joined
  useEffect(() => {
    if (!joined || listenOnly) return;
    let prevPressed = readGamepadVoiceButton().pressed;

    const timer = window.setInterval(() => {
      if (!joinedRef.current || listenOnlyRef.current) return;
      const { connected, pressed } = readGamepadVoiceButton();
      const effectivePressed = connected && pressed;

      if (pushToTalkRef.current) {
        if (effectivePressed !== pttGamepadActiveRef.current) {
          pttGamepadActiveRef.current = effectivePressed;
          const held = isAnyPttHeld();
          setPttKeyActive(held);
          syncLocalTrackEnabled();
          sendVoiceMute(isMutedRef.current || !held);
        }
      } else {
        if (pttGamepadActiveRef.current) {
          pttGamepadActiveRef.current = false;
        }
        if (effectivePressed && !prevPressed) {
          toggleMute();
        }
      }
      prevPressed = effectivePressed;
    }, 35);

    return () => {
      window.clearInterval(timer);
      if (pttGamepadActiveRef.current) {
        pttGamepadActiveRef.current = false;
        const stillHeld = isAnyPttHeld();
        setPttKeyActive(stillHeld);
        syncLocalTrackEnabled();
      }
    };
  }, [joined, listenOnly, syncLocalTrackEnabled, sendVoiceMute, toggleMute, isAnyPttHeld]);

  const effectiveTransmitting =
    joined && !listenOnly && !isMuted && (!pushToTalk || pttKeyActive);

  return {
    joined,
    joining,
    listenOnly,
    isMuted,
    isDeafened,
    pushToTalk,
    pttKeyActive,
    effectiveTransmitting,
    voiceVolume,
    speakingPeers,
    peerStates,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    setPushToTalk,
    setVoiceVolume,
  };
}
