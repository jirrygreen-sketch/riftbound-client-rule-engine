import { useEffect, useRef, useState } from "react";
import type {
  ClientSession,
  RoomDeckSubmission,
  RoomView
} from "@riftbound/protocol";
import type { V2CommandReceipt } from "../../../../packages/protocol/src/v2/index.js";
import type { V2CommandRequest, V2SocketFactory } from "../transport/v2";
import {
  createV2MatchSessionController,
  normalizeV2ServerUrl,
  type V2MatchSessionController,
  type V2MatchSessionSnapshot
} from "../full-product/v2/V2MatchSession";

export interface V2MatchSession {
  readonly playerId: string;
  readonly resumeToken?: string;
}

export interface UseV2MatchOptions {
  readonly enabled: boolean;
  readonly serverUrl: string | null;
  readonly roomId: string | null;
  readonly session: V2MatchSession | null;
  readonly playerName?: string;
  readonly socketFactory?: V2SocketFactory;
  readonly choiceTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly diagnosticStorage?: Storage | null;
}

export interface V2MatchClient extends V2MatchSessionSnapshot {
  readonly connectionStatus: V2MatchSessionSnapshot["state"]["connectionStatus"];
  readonly connect: () => void;
  readonly createRoom: (playerName: string) => Promise<RoomView>;
  readonly joinRoom: (roomId: string, playerName: string) => Promise<RoomView>;
  readonly submitDeck: (deck: RoomDeckSubmission) => Promise<RoomView>;
  readonly setReady: (ready: boolean) => Promise<RoomView>;
  readonly sendCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
  /** Drop the room/session and reconnect without a resume identity. */
  readonly leaveRoom: () => void;
}

const emptySnapshot: V2MatchSessionSnapshot = {
  state: {
    viewerPlayerId: null,
    projection: null,
    stateVersion: 0,
    eventSeq: 0,
    events: [],
    bufferedEvents: [],
    choice: { status: "none", choice: { status: "none" }, startedAt: null, expiresAt: null, answerable: false },
    connectionStatus: "disconnected",
    lastError: null,
    rejectedMessages: 0
  },
  room: null,
  session: null,
  pendingCommandIds: [],
  error: null,
  reconnectUrl: "",
  lastReceipt: null
};

/**
 * Legacy helper retained for callers/tests. Authority-bearing route values
 * are not read by the V2 controller; the V2 hello carries resume identity.
 */
export function buildV2RoomUrlWithIdentity(
  serverUrl: string,
  roomId: string,
  session: V2MatchSession | null
): string {
  const url = new URL(normalizeV2ServerUrl(serverUrl));
  url.searchParams.set("roomId", roomId);
  if (session?.playerId) url.searchParams.set("playerId", session.playerId);
  if (session?.resumeToken) url.searchParams.set("resumeToken", session.resumeToken);
  return url.toString();
}

/** Legacy URL composer including identity query parameters. */
export function buildV2RoomUrlWithSession(
  serverUrl: string,
  roomId: string,
  session: V2MatchSession | null
): string {
  return buildV2RoomUrlWithIdentity(serverUrl, roomId, session);
}

/** Compatibility export for the earlier hook test. */
export { buildV2RoomUrlWithSession as buildV2RoomUrl };

export function useV2Match(options: UseV2MatchOptions): V2MatchClient {
  const controllerRef = useRef<V2MatchSessionController | null>(null);
  const [snapshot, setSnapshot] = useState<V2MatchSessionSnapshot>(emptySnapshot);
  const callbacksRef = useRef<{
    createRoom: (playerName: string) => Promise<RoomView>;
    joinRoom: (roomId: string, playerName: string) => Promise<RoomView>;
    submitDeck: (deck: RoomDeckSubmission) => Promise<RoomView>;
    setReady: (ready: boolean) => Promise<RoomView>;
    sendCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
    leaveRoom: () => void;
    connect: () => void;
  }>({
    createRoom: () => Promise.reject(new Error("Protocol v2 is not connected")),
    joinRoom: () => Promise.reject(new Error("Protocol v2 is not connected")),
    submitDeck: () => Promise.reject(new Error("Protocol v2 is not connected")),
    setReady: () => Promise.reject(new Error("Protocol v2 is not connected")),
    sendCommand: () => Promise.reject(new Error("Protocol v2 is not connected")),
    leaveRoom: () => undefined,
    connect: () => undefined
  });
  useEffect(() => {
    if (!options.enabled || !options.serverUrl) {
      controllerRef.current?.stop("v2 route disabled");
      controllerRef.current = null;
      setSnapshot(emptySnapshot);
      return;
    }
    // Room/session identity is deliberately absent from the effect dependency
    // list below. The controller owns the live socket, and persisting its
    // created session back into props must not replace that socket. These
    // values are only a first-mount resume hint; transport changes rebuild.
    const initialSession: ClientSession | null =
      options.roomId && options.session?.playerId && options.session.resumeToken
      ? {
          roomId: options.roomId,
          playerId: options.session.playerId,
          resumeToken: options.session.resumeToken
        }
      : null;
    const controller = createV2MatchSessionController({
      serverUrl: options.serverUrl,
      socketFactory: options.socketFactory,
      choiceTimeoutMs: options.choiceTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs,
      diagnosticStorage: options.diagnosticStorage
    }, initialSession);
    controllerRef.current = controller;
    callbacksRef.current = {
      createRoom: playerName => controller.createRoom(playerName),
      joinRoom: (roomId, playerName) => controller.joinRoom(roomId, playerName),
      submitDeck: deck => controller.submitDeck(deck),
      setReady: ready => controller.setReady(ready),
      sendCommand: request => controller.sendCommand(request),
      leaveRoom: () => controller.discardRecoverySession(),
      connect: () => controller.connect()
    };
    const unsubscribe = controller.subscribe(setSnapshot);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop("v2 route teardown");
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    options.choiceTimeoutMs,
    options.enabled,
    options.requestTimeoutMs,
    options.serverUrl,
    options.socketFactory
  ]);

  return {
    ...snapshot,
    connectionStatus: snapshot.state.connectionStatus,
    connect: () => callbacksRef.current.connect(),
    createRoom: playerName => callbacksRef.current.createRoom(playerName),
    joinRoom: (roomId, playerName) => callbacksRef.current.joinRoom(roomId, playerName),
    submitDeck: deck => callbacksRef.current.submitDeck(deck),
    setReady: ready => callbacksRef.current.setReady(ready),
    sendCommand: request => callbacksRef.current.sendCommand(request),
    leaveRoom: () => callbacksRef.current.leaveRoom()
  };
}
