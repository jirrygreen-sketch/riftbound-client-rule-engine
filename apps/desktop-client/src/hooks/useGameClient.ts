import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameClient,
  readStoredSession,
  type GameClientStatus,
  type StoredSession
} from "../net/GameClient";
import type {
  ClientSession,
  GameEvent,
  GameProjection,
  RoomDeckSubmission,
  RoomEvent,
  RoomView,
  DeckWireEntry,
  DeckZoneName
} from "@riftbound/protocol";
import { DECK_ZONES } from "../net/CardCatalogClient";
import type { DeckByZone } from "./useCardCatalog";

const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787";

interface UseGameClientResult {
  status: GameClientStatus;
  handshakeReady: boolean;
  commandPending: boolean;
  requestPending: boolean;
  projection: GameProjection | null;
  lastError: string | null;
  errorRevision: number;
  roomId: string | null;
  roomView: RoomView | null;
  session: ClientSession | null;
  gameEvents: readonly GameEvent[];
  roomEvents: readonly RoomEvent[];
  storedSession: StoredSession | null;
  connect: (serverUrl: string) => void;
  createRoom: (playerName: string) => void;
  joinRoom: (playerName: string, roomId: string) => void;
  submitDeck: (deck: DeckByZone) => void;
  setReady: (ready: boolean) => void;
  syncEvents: () => void;
  pass: () => void;
  playCard: (instanceId: string) => void;
  respondPrompt: (promptId: string, optionId: string, stateVersion?: number) => void;
  clearError: () => void;
}

function toRoomDeckSubmission(deck: DeckByZone): RoomDeckSubmission {
  const result: Partial<Record<DeckZoneName, DeckWireEntry[]>> = {};
  for (const zone of DECK_ZONES) {
    const entries = Object.entries(deck[zone])
      .filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isSafeInteger(entry[1]) && entry[1] > 0)
      .map(([cardId, quantity]) => ({ cardId, quantity }));
    if (entries.length > 0) result[zone] = entries;
  }
  return result;
}

function mergeUnique<T extends { seq: number }>(
  current: readonly T[],
  incoming: readonly T[]
): readonly T[] {
  const bySeq = new Map(current.map(event => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function useGameClient(): UseGameClientResult {
  const [status, setStatus] = useState<GameClientStatus>("idle");
  const [handshakeReady, setHandshakeReady] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [projection, setProjection] = useState<GameProjection | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomView, setRoomView] = useState<RoomView | null>(null);
  const [gameEvents, setGameEvents] = useState<readonly GameEvent[]>([]);
  const [roomEvents, setRoomEvents] = useState<readonly RoomEvent[]>([]);
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
        onRoomView: setRoomView,
        onEvents: events => setGameEvents(current => mergeUnique(current, events)),
        onRoomEvents: events => setRoomEvents(current => mergeUnique(current, events)),
        onSession: session => {
          setSession(session);
          setStoredSession(null);
        },
        onHandshake: setHandshakeReady,
        onPendingCommand: setCommandPending,
        onPendingRequest: setRequestPending
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
    (playerName: string, ruleset?: Parameters<GameClient["createRoom"]>[1]) => {
      setLastError(null);
      client.createRoom(playerName, ruleset);
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

  const submitDeck = useCallback(
    (deck: DeckByZone) => {
      client.submitDeck(toRoomDeckSubmission(deck));
    },
    [client]
  );

  const setReady = useCallback(
    (ready: boolean) => {
      client.setReady(ready);
    },
    [client]
  );

  const syncEvents = useCallback(() => {
    client.syncEvents();
  }, [client]);

  const clearError = useCallback(() => setLastError(null), []);

  return {
    status,
    handshakeReady,
    commandPending,
    requestPending,
    projection,
    lastError,
    errorRevision,
    roomId,
    roomView,
    gameEvents,
    roomEvents,
    session,
    storedSession,
    connect,
    createRoom,
    joinRoom,
    submitDeck,
    setReady,
    syncEvents,
    pass,
    playCard,
    respondPrompt,
    clearError
  };
}
