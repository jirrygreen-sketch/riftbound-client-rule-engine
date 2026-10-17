import { useCallback, useEffect, useRef, useState } from "react";
import { V2ClientStateStore, type V2ClientState } from "../state/v2";
import {
  V2Transport,
  type V2CommandRequest,
  type V2TransportEvent
} from "../transport/v2";
import {
  PROTOCOL_V2_VERSION,
  type V2CommandReceipt
} from "../../../../packages/protocol/src/v2/index.js";

export interface V2MatchSession {
  readonly playerId: string;
  readonly resumeToken?: string;
}

export interface UseV2MatchOptions {
  readonly enabled: boolean;
  readonly serverUrl: string | null;
  readonly roomId: string | null;
  readonly session: V2MatchSession | null;
  readonly socketFactory?: ConstructorParameters<typeof V2Transport>[0]["socketFactory"];
  readonly choiceTimeoutMs?: number;
}

export interface V2MatchClient {
  readonly state: V2ClientState;
  readonly pendingCommandIds: readonly string[];
  readonly error: string | null;
  readonly sendCommand: (request: V2CommandRequest) => Promise<V2CommandReceipt>;
  readonly reconnectUrl: string | null;
}

/** Build the authenticated room URL consumed by the v2 transport. */
export function buildV2RoomUrl(
  serverUrl: string,
  roomId: string,
  session: V2MatchSession | null
): string {
  const base = new URL(serverUrl, "http://localhost");
  base.searchParams.set("roomId", roomId);
  if (session?.playerId) base.searchParams.set("playerId", session.playerId);
  if (session?.resumeToken) base.searchParams.set("resumeToken", session.resumeToken);
  return base.toString();
}

/**
 * Owns the v2 transport lifecycle for one mounted match route. The store is
 * updated only from transport notifications; command requests never mutate a
 * projection locally.
 */
export function useV2Match(options: UseV2MatchOptions): V2MatchClient {
  const transportRef = useRef<V2Transport | null>(null);
  const storeRef = useRef<V2ClientStateStore | null>(null);
  const [state, setState] = useState<V2ClientState>(() =>
    new V2ClientStateStore({ viewerPlayerId: options.session?.playerId ?? null, choiceTimeoutMs: options.choiceTimeoutMs }).state
  );
  const [pendingCommandIds, setPendingCommandIds] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectUrl, setReconnectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!options.enabled || !options.serverUrl || !options.roomId || !options.session?.playerId) {
      transportRef.current?.disconnect("v2 route disabled");
      transportRef.current = null;
      storeRef.current = null;
      setPendingCommandIds([]);
      setReconnectUrl(null);
      setState(new V2ClientStateStore({
        viewerPlayerId: options.session?.playerId ?? null,
        choiceTimeoutMs: options.choiceTimeoutMs
      }).state);
      return;
    }

    const url = buildV2RoomUrl(options.serverUrl, options.roomId, options.session);
    const store = new V2ClientStateStore({
      viewerPlayerId: options.session.playerId,
      choiceTimeoutMs: options.choiceTimeoutMs
    });
    const transport = new V2Transport({ url, socketFactory: options.socketFactory });
    const onEvent = (event: V2TransportEvent): void => {
      switch (event.type) {
        case "status":
          store.setConnectionStatus(event.status);
          break;
        case "projection":
          store.apply({ type: "projection", protocolVersion: PROTOCOL_V2_VERSION, projection: event.projection });
          break;
        case "event":
          store.apply({ type: "event", protocolVersion: PROTOCOL_V2_VERSION, event: event.event });
          break;
        case "receipt":
          store.apply({ ...event.receipt });
          break;
        case "error":
          setError(event.error.message);
          break;
      }
      setState(store.state);
      setPendingCommandIds(transport.pendingCommandIds);
    };
    const unsubscribeTransport = transport.subscribe(onEvent);
    const unsubscribeStore = store.subscribe(next => setState(next));
    transportRef.current = transport;
    storeRef.current = store;
    setError(null);
    setReconnectUrl(transport.resumeUrl());
    transport.connect();

    return () => {
      unsubscribeTransport();
      unsubscribeStore();
      transport.disconnect("v2 route teardown");
      if (transportRef.current === transport) transportRef.current = null;
      if (storeRef.current === store) storeRef.current = null;
    };
  }, [
    options.choiceTimeoutMs,
    options.enabled,
    options.roomId,
    options.serverUrl,
    options.session?.playerId,
    options.session?.resumeToken,
    options.socketFactory
  ]);

  useEffect(() => {
    const timer = setInterval(() => storeRef.current?.refreshChoice(), 500);
    return () => clearInterval(timer);
  }, []);

  const sendCommand = useCallback(async (request: V2CommandRequest): Promise<V2CommandReceipt> => {
    const transport = transportRef.current;
    if (!transport) throw new Error("Protocol v2 is not connected");
    const receipt = transport.sendCommand(request);
    setPendingCommandIds(transport.pendingCommandIds);
    try {
      return await receipt;
    } finally {
      setPendingCommandIds(transport.pendingCommandIds);
      setState(storeRef.current?.state ?? state);
    }
  }, [state]);

  return { state, pendingCommandIds, error, sendCommand, reconnectUrl };
}
