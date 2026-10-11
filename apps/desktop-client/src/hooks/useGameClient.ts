import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameClient,
  readStoredSession,
  type GameClientStatus,
  type StoredSession
} from "../net/GameClient";
import type { ClientSession, GameProjection } from "@riftbound/protocol";

const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787";

interface UseGameClientResult {
  status: GameClientStatus;
  handshakeReady: boolean;
  commandPending: boolean;
  projection: GameProjection | null;
  lastError: string | null;
  errorRevision: number;
  roomId: string | null;
  session: ClientSession | null;
  storedSession: StoredSession | null;
  connect: (serverUrl: string) => void;
  createRoom: (playerName: string) => void;
  joinRoom: (playerName: string, roomId: string) => void;
  pass: () => void;
  playCard: (instanceId: string) => void;
  respondPrompt: (promptId: string, optionId: string, stateVersion?: number) => void;
  clearError: () => void;
}

export function useGameClient(): UseGameClientResult {
  const [status, setStatus] = useState<GameClientStatus>("idle");
  const [handshakeReady, setHandshakeReady] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [projection, setProjection] = useState<GameProjection | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [storedSession, setStoredSession] = useState<StoredSession | null>(() =>
    readStoredSession()
  );
  const clientRef = useRef<GameClient | null>(null);

  const client = useMemo(() => {
    if (!clientRef.current) {
      clientRef.current = new GameClient({
        onStatus: setStatus,
        onProjection: setProjection,
        onError: message => {
          setLastError(message);
          setErrorRevision(revision => revision + 1);
        },
        onRoom: setRoomId,
        onSession: session => {
          setSession(session);
          setStoredSession(null);
        },
        onHandshake: setHandshakeReady,
        onPendingCommand: setCommandPending
      });
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    client.resumeStoredSession();
  }, [client]);

  useEffect(() => {
    return () => {
      client.disconnect();
    };
  }, [client]);

  const connect = useCallback(
    (serverUrl: string) => {
      setLastError(null);
      setProjection(null);
      setStoredSession(null);
      client.connect(serverUrl.trim() || DEFAULT_SERVER_URL);
    },
    [client]
  );

  const createRoom = useCallback(
    (playerName: string) => {
      setLastError(null);
      client.createRoom(playerName);
    },
    [client]
  );

  const joinRoom = useCallback(
    (playerName: string, targetRoomId: string) => {
      setLastError(null);
      client.joinRoom(playerName, targetRoomId);
    },
    [client]
  );

  const pass = useCallback(() => {
    client.pass();
  }, [client]);

  const playCard = useCallback(
    (instanceId: string) => {
      client.playCard(instanceId);
    },
    [client]
  );

  const respondPrompt = useCallback(
    (promptId: string, optionId: string, stateVersion?: number) => {
      client.respondPrompt(promptId, optionId, stateVersion);
    },
    [client]
  );

  const clearError = useCallback(() => setLastError(null), []);

  return {
    status,
    handshakeReady,
    commandPending,
    projection,
    lastError,
    errorRevision,
    roomId,
    session,
    storedSession,
    connect,
    createRoom,
    joinRoom,
    pass,
    playCard,
    respondPrompt,
    clearError
  };
}
