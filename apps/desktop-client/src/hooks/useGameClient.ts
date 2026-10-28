import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GameClient,
  readStoredSession,
  type CreateRoomRuleset,
  type GameClientStatus,
  type OwnerDeckConfirmation,
  type RoomRequestFailure,
  type RoomRequestReceipt,
  type StoredSession
} from "../net/GameClient";
import type {
  ConstructedRegionSelection,
  ClientSession,
  CommandTarget,
  GameEvent,
  GameProjection,
  DuelProjectionTransport,
  DuelCommandMessageV3Actions1,
  DuelWireCommandV3Actions1,
  PlayerCommand,
  RoomDeckSubmission,
  RoomEvent,
  RoomView,
  RoomChatMessage,
  DeckWireEntry,
  DeckZoneName
} from "@riftbound/protocol";
import { DECK_ZONES } from "../net/CardCatalogClient";
import { acceptConfirmedProjection } from "../full-product/transport";
import type { DeckByZone } from "./useCardCatalog";
import { DEFAULT_WS_SERVER_URL } from "../net/server-defaults";

const DEFAULT_SERVER_URL = DEFAULT_WS_SERVER_URL;

interface UseGameClientResult {
  status: GameClientStatus;
  handshakeReady: boolean;
  commandPending: boolean;
  requestPending: boolean;
  chatMessages: readonly RoomChatMessage[];
  chatPending: boolean;
  chatError: string | null;
  sendChat: (text: string) => boolean;
  disconnect: () => void;
  projection: GameProjection | null;
  duelProjection: DuelProjectionTransport | null;
  lastError: string | null;
  errorRevision: number;
  roomId: string | null;
  roomView: RoomView | null;
  ownerDeckConfirmation: OwnerDeckConfirmation | null;
  session: ClientSession | null;
  gameEvents: readonly GameEvent[];
  roomEvents: readonly RoomEvent[];
  storedSession: StoredSession | null;
  /**
   * Read-only mirror of the connection's current normalized server URL
   * (`GameClient.activeServerUrl`). It is refreshed on status/session events
   * and is never used to drive connection, resume, or request behavior.
   */
  activeServerUrl: string | null;
  connect: (serverUrl: string) => void;
  createRoom: (playerName: string, ruleset?: CreateRoomRuleset, region?: ConstructedRegionSelection) => void;
  joinRoom: (playerName: string, roomId: string) => void;
  submitDeck: (deck: DeckByZone) => string | null;
  setReady: (ready: boolean) => string | null;
  roomRequestReceipt: RoomRequestReceipt | null;
  roomRequestFailure: RoomRequestFailure | null;
  syncEvents: () => void;
  pass: () => void;
  playCard: (instanceId: string, targets?: readonly CommandTarget[]) => void;
  submitPlayerCommand: (command: PlayerCommand) => void;
  submitDuelCommand: (command: DuelWireCommandV3Actions1) => void;
  submitDuelCommandPacket: (packet: DuelCommandMessageV3Actions1) => boolean;
  concede: () => void;
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
  const [chatMessages, setChatMessages] = useState<readonly RoomChatMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [projection, setProjection] = useState<GameProjection | null>(null);
  const [duelProjection, setDuelProjection] = useState<DuelProjectionTransport | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomView, setRoomView] = useState<RoomView | null>(null);
  const [ownerDeckConfirmation, setOwnerDeckConfirmation] = useState<OwnerDeckConfirmation | null>(null);
  const [roomRequestReceipt, setRoomRequestReceipt] = useState<RoomRequestReceipt | null>(null);
  const [roomRequestFailure, setRoomRequestFailure] = useState<RoomRequestFailure | null>(null);
  const [gameEvents, setGameEvents] = useState<readonly GameEvent[]>([]);
  const [roomEvents, setRoomEvents] = useState<readonly RoomEvent[]>([]);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [storedSession, setStoredSession] = useState<StoredSession | null>(() =>
    readStoredSession()
  );
  const [activeServerUrl, setActiveServerUrl] = useState<string | null>(null);
  const clientRef = useRef<GameClient | null>(null);

  // Pure read-only mirror of `GameClient.activeServerUrl`, refreshed on the
  // status/session events that already re-render this hook's consumers.
  const readActiveServerUrl = () => clientRef.current?.activeServerUrl ?? null;

  const client = useMemo(() => {
    if (!clientRef.current) {
      clientRef.current = new GameClient({
        onStatus: status => {
          setStatus(status);
          setActiveServerUrl(readActiveServerUrl());
        },
        onProjection: incoming =>
          setProjection(current => acceptConfirmedProjection(current, incoming)),
        onDuelProjection: setDuelProjection,
        onError: message => {
          setLastError(message);
          setErrorRevision(revision => revision + 1);
        },
        onRoom: setRoomId,
        onRoomView: setRoomView,
        onOwnerDeckConfirmation: setOwnerDeckConfirmation,
        onRoomRequestResult: receipt => {
          setRoomRequestReceipt(receipt);
          setRoomRequestFailure(null);
        },
        onRoomRequestFailure: failure => {
          setRoomRequestFailure(failure);
        },
        onEvents: events => setGameEvents(current =>
          events.length === 0 ? [] : mergeUnique(current, events)),
        onRoomEvents: events => setRoomEvents(current =>
          events.length === 0 ? [] : mergeUnique(current, events)),
        onSession: session => {
          setSession(session);
          setStoredSession(null);
          // A repeated welcome during same-session reconnect must not erase
          // previously confirmed room/event state. A different session is
          // cleared in GameClient's own identity-boundary callbacks.
          setActiveServerUrl(readActiveServerUrl());
        },
        onHandshake: setHandshakeReady,
        onPendingCommand: setCommandPending,
        onPendingRequest: setRequestPending,
        onChatMessages: setChatMessages,
        onChatPending: setChatPending,
        onChatError: setChatError
      });
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    // Expose the restored resume target before any connection event fires.
    setActiveServerUrl(readActiveServerUrl());
    client.resumeStoredSession();
    // `readActiveServerUrl` is a stable read over `clientRef`; it is
    // intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setActiveServerUrl(readActiveServerUrl());
    },
    // `readActiveServerUrl` is a stable read over `clientRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client]
  );

  const createRoom = useCallback(
    (playerName: string, ruleset?: CreateRoomRuleset, region?: ConstructedRegionSelection) => {
      setLastError(null);
      client.createRoom(playerName, ruleset, region);
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
    (instanceId: string, targets?: readonly CommandTarget[]) => {
      client.playCard(instanceId, targets);
    },
    [client]
  );

  const submitPlayerCommand = useCallback(
    (command: PlayerCommand) => {
      client.submitPlayerCommand(command);
    },
    [client]
  );

  const submitDuelCommand = useCallback(
    (command: DuelWireCommandV3Actions1) => {
      client.submitDuelCommand(command);
    },
    [client]
  );

  const submitDuelCommandPacket = useCallback(
    (packet: DuelCommandMessageV3Actions1) => client.submitDuelCommandPacket(packet), [client]
  );

  const concede = useCallback(() => {
    client.concede();
  }, [client]);

  const respondPrompt = useCallback(
    (promptId: string, optionId: string, stateVersion?: number) => {
      client.respondPrompt(promptId, optionId, stateVersion);
    },
    [client]
  );

  const submitDeck = useCallback(
    (deck: DeckByZone) => {
      return client.submitDeckTracked(toRoomDeckSubmission(deck));
    },
    [client]
  );

  const setReady = useCallback(
    (ready: boolean) => {
      return client.setReadyTracked(ready);
    },
    [client]
  );

  const syncEvents = useCallback(() => {
    client.syncEvents();
  }, [client]);

  const clearError = useCallback(() => setLastError(null), []);
  const sendChat = useCallback((text: string) => client.sendChat(text), [client]);
  const disconnect = useCallback(() => client.leaveSession(), [client]);

  return {
    status,
    handshakeReady,
    commandPending,
    requestPending,
    chatMessages,
    chatPending,
    chatError,
    sendChat,
    disconnect,
    roomRequestReceipt,
    roomRequestFailure,
    projection,
    duelProjection,
    lastError,
    errorRevision,
    roomId,
    roomView,
    ownerDeckConfirmation,
    gameEvents,
    roomEvents,
    session,
    storedSession,
    activeServerUrl,
    connect,
    createRoom,
    joinRoom,
    submitDeck,
    setReady,
    syncEvents,
    pass,
    playCard,
    submitPlayerCommand,
    submitDuelCommand,
    submitDuelCommandPacket,
    concede,
    respondPrompt,
    clearError
  };
}
