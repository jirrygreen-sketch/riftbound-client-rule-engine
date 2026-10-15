import {
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID,
  PROTOCOL_VERSION,
  RULESET_ID,
  isServerMessage,
  isDuelCommand,
  isDuelCommandV3Actions1,
  isDuelCommandMessageV3Actions1,
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type ConstructedRegionSelection,
  isConstructedRegionSelection,
  isRoomChatText,
  type RoomChatMessage,
  type DuelCommandMessageV3Actions1,
  type DuelActionV3Actions1,
  type DuelProjectionTransport,
  type DuelWireCommandV3Actions1,
  type ClientSession,
  type ClientToServerMessage,
  type CommandTarget,
  type GameProjection,
  type GameEvent,
  type PlayerCommand,
  type OwnerDeckConfirmationMessage,
  type RoomDeckSubmission,
  type RoomEvent,
  type RoomView,
  type ServerToClientMessage
} from "@riftbound/protocol";

export type GameClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type RoomRequestType = "submit-deck" | "set-ready";

/**
 * A successful room request receipt after the transport has matched it to the
 * request context that was captured at send time. The session token is kept
 * private inside GameClient; these fields are the non-secret identity needed by
 * UI state machines to reject receipts from another room or actor.
 */
export interface RoomRequestReceipt {
  readonly requestId: string;
  readonly requestType: RoomRequestType;
  readonly roomId: string;
  readonly playerId: string;
  readonly socketGeneration: number;
  readonly ready?: boolean;
  readonly roomVersion?: number;
  readonly roomEventSeq?: number;
  readonly duplicate?: boolean;
}

export type RoomRequestFailure = Pick<RoomRequestReceipt,
  "requestId" | "requestType" | "roomId" | "playerId" | "socketGeneration">;

/** A validated echo bound to the actual WS generation and authenticated session. */
export interface OwnerDeckConfirmation extends OwnerDeckConfirmationMessage {
  readonly serverUrl: string;
  readonly socketGeneration: number;
}

export interface GameClientHandlers {
  onStatus: (status: GameClientStatus) => void;
  onSession: (session: ClientSession | null) => void;
  onProjection: (projection: GameProjection | null) => void;
  onDuelProjection?: (projection: DuelProjectionTransport | null) => void;
  onError: (message: string) => void;
  onRoom: (roomId: string | null) => void;
  onRoomView?: (room: RoomView | null) => void;
  onOwnerDeckConfirmation?: (confirmation: OwnerDeckConfirmation | null) => void;
  onEvents?: (events: readonly GameEvent[]) => void;
  onRoomEvents?: (events: readonly RoomEvent[]) => void;
  onRoomRequestResult?: (receipt: RoomRequestReceipt) => void;
  onRoomRequestFailure?: (request: RoomRequestFailure) => void;
  onHandshake: (ready: boolean) => void;
  onPendingCommand?: (pending: boolean) => void;
  onPendingRequest?: (pending: boolean) => void;
  onChatMessages?: (messages: readonly RoomChatMessage[]) => void;
  onChatPending?: (pending: boolean) => void;
  onChatError?: (message: string | null) => void;
}

export type CreateRoomRuleset =
  | typeof OFFICIAL_RULESET_ID
  | typeof RULESET_ID
  | typeof DUEL_RULESET_ID;

export interface StoredSession extends ClientSession {
  serverUrl: string;
}

interface PendingCommand {
  requestId: string;
  readonly commandId: string;
  readonly namespace: "legacy" | "duel";
  readonly duelCommandProfile?: typeof DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1;
  readonly command: PlayerCommand | DuelWireCommandV3Actions1;
  // Legacy commands may rebase their version/event clock onto the latest
  // confirmed legacy projection on retry; Duel commands keep them frozen.
  expectedVersion: number;
  eventSeq: number;
  readonly matchId: string | null;
  readonly roomId: string;
  readonly playerId: string;
  readonly resumeToken: string;
  readonly serverUrl: string;
  socketGeneration: number;
  readonly sentRequests: Map<string, number>;
  attempt: number;
  retryDue: boolean;
  timeoutTimer: number | null;
}

interface PendingRoomRequest extends RoomRequestFailure {
  readonly resumeToken: string;
  readonly ready?: boolean;
  timeoutTimer: number | null;
}

interface PendingChat {
  readonly messageId: string;
  readonly text: string;
  readonly session: StoredSession;
  requestId: string;
  socketGeneration: number;
  attempts: number;
  timer: number | null;
}

const STORAGE_KEY = "riftbound.desktop-client.session";
const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787/ws";
const MAX_RECONNECT_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 50_000;
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_ATTEMPTS = 3;
const ROOM_REQUEST_TIMEOUT_MS = 10_000;

export class GameClient {
  status: GameClientStatus = "idle";

  private socket: WebSocket | null = null;
  private serverUrl = "";
  private socketGeneration = 0;
  private session: StoredSession | null;
  private latestProjectionVersion: number | null = null;
  private duelProjection: DuelProjectionTransport | null = null;
  private legacyProjectionSeen = false;
  private duelProjectionContext: { roomId: string; playerId: string; resumeToken: string; serverUrl: string } | null = null;
  private duelProjectionSocketGeneration: number | null = null;
  private duelSchemaDowngradeLatched = false;
  private duelMatchTransitionAllowed = false;
  private readonly retiredDuelMatchIds = new Set<string>();
  private duelAcknowledgedClock: { version: number; eventSeq: number; requireNewer: boolean } | null = null;
  private activeNamespace: "legacy" | "duel" | null = null;
  private roomVersion: number | null = null;
  private roomStatus: RoomView["status"] | null = null;
  private roomRulesetId: RoomView["rulesetId"] | null = null;
  private roomRoster: ReadonlySet<string> | null = null;
  private roomSelfDeckSubmitted: boolean | null = null;
  private roomViewSocketGeneration: number | null = null;
  private roomViewEventSeq: number | null = null;
  private roomViewStatus: RoomView["status"] | null = null;
  private ownerDeckConfirmation: OwnerDeckConfirmation | null = null;
  private pendingOwnerDeckEcho: OwnerDeckConfirmationMessage | null = null;
  private latestEventSeq: number | null = null;
  private latestRoomEventSeq: number | null = null;
  private pendingCommand: PendingCommand | null = null;
  private pendingRoomRequest: PendingRoomRequest | null = null;
  private requestSeq = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastPongAt = 0;
  private intentionallyClosed = false;
  private handshakeReady = false;
  private helloSession: StoredSession | null = null;
  private expectedSessionRequest: { requestId: string; socketGeneration: number } | null = null;
  private chatMessages: readonly RoomChatMessage[] = [];
  private pendingChat: PendingChat | null = null;

  constructor(private readonly handlers: GameClientHandlers) {
    this.session = readStoredSession();
  }

  connect(input: string): void {
    const normalizedUrl = normalizeServerUrl(input);
    if (!normalizedUrl) {
      this.handlers.onError("服务地址无效，请检查后重试。");
      return;
    }

    this.serverUrl = normalizedUrl;
    if (this.session === null || this.session.serverUrl !== normalizedUrl) {
      this.clearDuelProjection();
      this.activeNamespace = null;
      this.legacyProjectionSeen = false;
      this.roomRulesetId = null;
      this.roomRoster = null;
    }
    this.intentionallyClosed = false;
    this.reconnectAttempt = 0;
    if (this.session && this.session.serverUrl !== normalizedUrl) {
      this.applySession(null);
      this.clearPendingCommand();
    }
    this.setHandshakeReady(false);
    this.clearOwnerRoomWitness();
    this.preparePendingCommandForRetry();
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.roomStatus = null;
    this.handlers.onProjection(null);
    this.clearPendingRequest();
    this.openSocket("connecting");
  }

  resumeStoredSession(): boolean {
    if (!this.session) return false;
    this.connect(this.session.serverUrl);
    return true;
  }

  /**
   * Read-only view of the current normalized server URL.
   *
   * Returns the target this client is connected to (or most recently
   * connected to) after `normalizeServerUrl`; before the first `connect` call
   * it falls back to the persisted resume target. It is purely descriptive —
   * it does not touch the session, resume token, reconnect, or request-witness
   * state — and never carries credentials. Returns `null` only when neither a
   * connection nor a stored session exists.
   */
  get activeServerUrl(): string | null {
    return this.serverUrl || this.session?.serverUrl || null;
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.clearPendingChat();
    this.roomVersion = null;
    this.roomStatus = null;
    this.clearOwnerRoomWitness();
    this.clearDuelProjection();
    this.activeNamespace = null;
    this.legacyProjectionSeen = false;
    this.roomRulesetId = null;
    this.roomRoster = null;
    this.handlers.onRoomView?.(null);

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  /** Leaves the local session without deleting decks or local preferences. */
  leaveSession(): void {
    this.disconnect();
    this.applySession(null);
  }

  sendChat(input: string): boolean {
    const text = input.trim();
    if (!isRoomChatText(text)) {
      this.handlers.onChatError?.("聊天内容须为 1–500 个字符。");
      return false;
    }
    if (this.pendingChat || !this.session || !this.handshakeReady || this.status !== "connected") {
      this.handlers.onChatError?.("聊天连接未就绪或上一条消息仍在确认中。");
      return false;
    }
    let messageId: string;
    try { messageId = createCommandId(); } catch {
      this.handlers.onChatError?.("无法创建消息标识，请重试。");
      return false;
    }
    this.pendingChat = { messageId, text, session: { ...this.session },
      requestId: "", socketGeneration: this.socketGeneration, attempts: 0, timer: null };
    this.handlers.onChatError?.(null);
    this.handlers.onChatPending?.(true);
    return this.sendPendingChat();
  }

  private syncChat(): void {
    if (this.session && this.handshakeReady && this.status === "connected") this.send({
      type: "room-chat-sync", requestId: this.nextRequestId("chat-sync"),
      afterChatSeq: this.chatMessages.length
    });
  }

  private sendPendingChat(): boolean {
    const pending = this.pendingChat;
    if (!pending) return false;
    if (!this.session || !sameStoredSession(pending.session, this.session)) {
      this.clearPendingChat();
      return false;
    }
    if (!this.handshakeReady || this.status !== "connected") return false;
    if (pending.attempts >= MAX_COMMAND_ATTEMPTS) {
      this.clearPendingChat();
      this.handlers.onChatError?.("聊天确认超时，消息可能已送达，请先检查聊天记录。");
      return false;
    }
    if (pending.timer !== null) clearTimer(pending.timer);
    pending.attempts += 1;
    pending.requestId = this.nextRequestId("chat-send");
    pending.socketGeneration = this.socketGeneration;
    if (!this.send({ type: "room-chat-send", requestId: pending.requestId,
      messageId: pending.messageId, text: pending.text })) {
      this.clearPendingChat();
      return false;
    }
    pending.timer = setTimer(() => {
      if (this.pendingChat !== pending) return;
      pending.timer = null;
      this.sendPendingChat();
    }, ROOM_REQUEST_TIMEOUT_MS);
    return true;
  }

  private clearPendingChat(): void {
    if (this.pendingChat?.timer !== null && this.pendingChat?.timer !== undefined)
      clearTimer(this.pendingChat.timer);
    this.pendingChat = null;
    this.handlers.onChatPending?.(false);
  }

  createRoom(
    playerName: string,
    ruleset: CreateRoomRuleset = OFFICIAL_RULESET_ID,
    constructedRegion?: ConstructedRegionSelection
  ): boolean {
    const name = requirePlayerName(playerName);
    if (!name) {
      this.handlers.onError("昵称无效，请重新输入。");
      return false;
    }

    if (constructedRegion !== undefined && (ruleset!==DUEL_RULESET_ID || !isConstructedRegionSelection(constructedRegion))) {
      this.handlers.onError("请选择赛事地区并填写有效的当地日期。"); return false;
    }
    const requestId = this.nextRequestId("create");
    const sent = this.send({ type: "create-room", requestId, playerName: name, rulesetId: ruleset, ...(constructedRegion ? {constructedRegion} : {}) });
    if (sent && !this.session) this.expectedSessionRequest = { requestId, socketGeneration: this.socketGeneration };
    return sent;
  }

  joinRoom(playerName: string, roomId: string): boolean {
    const name = requirePlayerName(playerName);
    const normalizedRoomId = roomId.trim();
    if (!name) {
      this.handlers.onError("昵称无效，请重新输入。");
      return false;
    }
    if (!normalizedRoomId) {
      this.handlers.onError("请输入房间号。");
      return false;
    }

    const requestId = this.nextRequestId("join");
    const sent = this.send({ type: "join-room", requestId, roomId: normalizedRoomId, playerName: name });
    if (sent && !this.session) this.expectedSessionRequest = { requestId, socketGeneration: this.socketGeneration };
    return sent;
  }

  pass(): boolean {
    return this.sendCommand({ type: "pass" });
  }

  playCard(instanceId: string, targets?: readonly CommandTarget[]): boolean {
    if (!instanceId) {
      this.handlers.onError("手牌实例无效，无法打出。");
      return false;
    }
    return this.sendCommand({
      type: "play-card",
      instanceId,
      ...(targets === undefined ? {} : { targets })
    });
  }

  submitPlayerCommand(command: PlayerCommand): boolean {
    return this.sendCommand(command);
  }

  submitDuelCommand(command: DuelWireCommandV3Actions1): boolean {
    return this.submitDuelOperation(command);
  }

  submitDuelCommandPacket(packet: DuelCommandMessageV3Actions1): boolean {
    if (!isDuelCommandMessageV3Actions1(packet) ||
        this.duelProjection?.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ||
        packet.expectedVersion !== this.duelProjection.match.stateVersion) {
      this.handlers.onError("牌桌状态已更新或动作协议不一致，请重新选择。");
      return false;
    }
    return this.submitDuelOperation(packet.command, packet);
  }

  private submitDuelOperation(command: DuelWireCommandV3Actions1, packet?: DuelCommandMessageV3Actions1): boolean {
    const p4 = this.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
    if (!(p4 ? isDuelCommandV3Actions1(command) : isDuelCommand(command))) {
      this.handlers.onError("Duel 操作数据无效，操作未发送。");
      return false;
    }
    if (this.pendingCommand) {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    if (this.activeNamespace !== "duel" || !this.duelProjection ||
        this.duelProjectionSocketGeneration !== this.socketGeneration ||
        this.waitsForDuelAcknowledgement(this.duelProjection.match.stateVersion, this.duelProjection.match.eventSeq) ||
        !this.matchesDuelContext() ||
        this.duelProjection.match.stage === "playing" && this.duelProjection.match.frame.phase === "ended") {
      this.handlers.onError("尚未收到当前会话的可操作 Duel 牌桌状态。");
      return false;
    }
    // The UI presents server actions; the transport still enforces the exact
    // wire/action mapping so callers cannot submit a different UID or payment.
    if (!this.duelProjection.actions.some(action => action.enabled &&
      (action.kind === "mulligan" && command.type === "mulligan" &&
        command.selectedUIDs.length <= action.maxSelections &&
        command.selectedUIDs.every(uid => action.selectableUIDs.includes(uid)) ||
       (action.kind === "rune-energy" || action.kind === "rune-power" || action.kind === "gold-power") &&
        command.type === action.kind && command.uid === action.uid ||
       action.kind === "pay-pending" && command.type === "pay-pending" &&
        command.paymentId === action.paymentId ||
       p4 && this.matchesP4Action(action, command)))) {
      this.handlers.onError("当前 Duel 操作不在服务端提供的可用选项中。");
      return false;
    }
    return this.sendTrackedCommand(command, "duel", this.duelProjection.match.stateVersion,
      this.duelProjection.match.eventSeq, this.duelProjection.match.matchId, packet);
  }

  private matchesP4Action(action: DuelActionV3Actions1, command: DuelWireCommandV3Actions1): boolean {
    if (isDuelCommand(command)) return false;
    switch (command.type) {
      case "play-card": return action.kind === "play-card" && action.cardUID === command.cardUID && action.windowId === command.windowId;
      case "activate-ability": return action.kind === "activate-ability" && action.sourceObjectId === command.sourceObjectId &&
        action.abilityOptionId === command.abilityOptionId && action.windowId === command.windowId;
      case "pass-priority": case "pass-focus": case "end-turn":
        return action.kind === command.type && action.windowId === command.windowId;
      case "standard-move": return action.kind === "standard-move" && action.windowId === command.windowId &&
        action.destinations.some(destination => destination.locationId === command.destinationLocationId &&
          command.unitUIDs.every(uid => action.selectableUnitUIDs.includes(uid) && destination.eligibleUnitUIDs.includes(uid)));
      case "answer-pending-choice": case "assign-combat-damage": {
        const projection = this.duelProjection;
        if (projection?.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 || projection.match.stage !== "playing" ||
            action.kind !== command.type || action.choiceId !== command.choiceId) return false;
        const choice = projection.match.frame.pendingChoice;
        if (!choice || !("choiceId" in choice) || choice.choiceId !== command.choiceId) return false;
        if (command.type === "assign-combat-damage") return choice.kind === "combat-allocation" &&
          command.assignments.length === choice.targets.length && command.assignments.every(assignment =>
            choice.targets.some(target => target.unitObjectId === assignment.unitObjectId)) &&
          command.assignments.reduce((sum, assignment) => sum + assignment.amount, 0) === choice.budget;
        return choice.kind !== "combat-allocation" && command.answers.length === choice.prompts.length &&
          choice.prompts.every(prompt => {
            const answer = command.answers.find(item => item.promptId === prompt.promptId);
            return answer !== undefined && answer.optionIds.length >= prompt.minSelections && answer.optionIds.length <= prompt.maxSelections &&
              answer.optionIds.every(id => prompt.options.some(option => option.id === id));
          });
      }
    }
  }

  concede(): boolean {
    return this.sendCommand({ type: "concede" });
  }

  respondPrompt(
    promptId: string,
    optionId: string,
    stateVersion?: number
  ): boolean {
    if (!promptId || !optionId) {
      this.handlers.onError("选择项无效。");
      return false;
    }
    return this.sendCommand({
      type: "respond-to-prompt",
      promptId,
      optionId,
      ...(stateVersion === undefined ? {} : { stateVersion })
    });
  }

  submitDeck(deck: RoomDeckSubmission): boolean {
    return this.submitDeckTracked(deck) !== null;
  }

  submitDeckTracked(deck: RoomDeckSubmission): string | null {
    const normalized = normalizeRoomDeck(deck);
    if (!normalized) {
      this.handlers.onError("卡组数据无效，无法提交。");
      return null;
    }
    if (this.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法提交卡组。");
      return null;
    }

    return this.sendTrackedRequest({
      type: "submit-deck",
      requestId: this.nextRequestId("submit-deck"),
      expectedRoomVersion: this.roomVersion,
      deck: normalized
    });
  }

  setReady(ready: boolean): boolean {
    return this.setReadyTracked(ready) !== null;
  }

  setReadyTracked(ready: boolean): string | null {
    if (this.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法切换准备状态。");
      return null;
    }
    return this.sendTrackedRequest({
      type: "set-ready",
      requestId: this.nextRequestId("set-ready"),
      expectedRoomVersion: this.roomVersion,
      ready
    });
  }

  syncEvents(): boolean {
    if (!this.session) {
      this.handlers.onError("尚未进入房间，无法同步事件。");
      return false;
    }
    return this.send({
      type: "sync-events",
      requestId: this.nextRequestId("sync-events"),
      ...(this.activeNamespace === "duel" || this.latestEventSeq === null
        ? {}
        : { afterEventSeq: this.latestEventSeq }),
      ...(this.latestRoomEventSeq === null
        ? {}
        : { afterRoomEventSeq: this.latestRoomEventSeq })
    });
  }

  private sendTrackedRequest(message: ClientToServerMessage): string | null {
    if (this.pendingRoomRequest !== null) {
      this.handlers.onError("上一项房间请求仍在处理中，请稍候。");
      return null;
    }
    if (message.type !== "submit-deck" && message.type !== "set-ready") {
      return this.send(message) ? requestIdOf(message) : null;
    }

    const session = this.session;
    if (!session) {
      this.handlers.onError("尚未进入房间，操作未发送。");
      return null;
    }
    const pending: PendingRoomRequest = {
      requestId: message.requestId,
      requestType: message.type,
      ...(message.type === "set-ready" ? { ready: message.ready } : {}),
      roomId: session.roomId,
      playerId: session.playerId,
      socketGeneration: this.socketGeneration,
      resumeToken: session.resumeToken,
      timeoutTimer: null
    };
    this.pendingRoomRequest = pending;
    this.handlers.onPendingRequest?.(true);
    if (!this.send(message)) {
      this.clearPendingRequest(false);
      return null;
    }
    pending.timeoutTimer = setTimer(() => {
      if (this.pendingRoomRequest !== pending) return;
      this.clearPendingRequest(true);
      this.handlers.onError("房间请求确认超时，请重试。");
    }, ROOM_REQUEST_TIMEOUT_MS);
    return message.requestId;
  }

  private sendCommand(command: PlayerCommand): boolean {
    if (this.activeNamespace !== "legacy" || this.latestProjectionVersion === null) {
      this.handlers.onError("尚未收到牌桌状态，请稍后再试。");
      return false;
    }
    if (this.pendingCommand?.namespace === "legacy") {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    return this.sendTrackedCommand(command, "legacy", this.latestProjectionVersion,
      this.latestEventSeq ?? 0, null);
  }

  private sendTrackedCommand(
    command: PlayerCommand | DuelWireCommandV3Actions1,
    namespace: PendingCommand["namespace"],
    expectedVersion: number,
    eventSeq: number,
    matchId: string | null,
    packet?: DuelCommandMessageV3Actions1
  ): boolean {
    if (this.pendingCommand) {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    const session = this.session;
    if (!session) {
      this.handlers.onError("尚未进入房间，操作未发送。");
      return false;
    }
    if (!this.handshakeReady || this.status !== "connected") {
      this.handlers.onError("连接未就绪，操作未发送。");
      return false;
    }
    let commandId: string;
    let capturedCommand: PlayerCommand | DuelWireCommandV3Actions1;
    try {
      // A command ID names one immutable operation. A caller may retain and
      // mutate an array/plan after submit, so retries must own a detached copy.
      capturedCommand = structuredClone(command);
      if (namespace === "duel" && !(this.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
        ? isDuelCommandV3Actions1(capturedCommand) : isDuelCommand(capturedCommand))) {
        this.handlers.onError("Duel 操作数据无效，操作未发送。");
        return false;
      }
      commandId = packet?.commandId ?? createCommandId();
    } catch {
      this.handlers.onError("当前环境无法复制操作或创建安全标识，请刷新后重试。");
      return false;
    }

    const requestId = packet?.requestId ?? this.nextRequestId("command");
    const pending: PendingCommand = {
      requestId,
      commandId,
      namespace,
      ...(namespace === "duel" && this.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
        ? { duelCommandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } : {}),
      command: capturedCommand,
      expectedVersion,
      eventSeq,
      matchId,
      roomId: session.roomId,
      playerId: session.playerId,
      resumeToken: session.resumeToken,
      serverUrl: session.serverUrl,
      socketGeneration: this.socketGeneration,
      sentRequests: new Map([[requestId, this.socketGeneration]]),
      attempt: 1,
      retryDue: false,
      timeoutTimer: null
    };
    this.pendingCommand = pending;
    this.handlers.onPendingCommand?.(true);
    if (!this.sendPendingCommand(pending)) {
      this.clearPendingCommand();
      return false;
    }
    this.armCommandTimeout(pending);
    return true;
  }

  private sendPendingCommand(pending: PendingCommand): boolean {
    const common = {
      requestId: pending.requestId,
      commandId: pending.commandId,
      expectedVersion: pending.expectedVersion
    };
    return pending.namespace === "duel"
      ? pending.duelCommandProfile
        ? this.send({ type: "duel-command", commandProfile: pending.duelCommandProfile, ...common, command: pending.command as DuelWireCommandV3Actions1 })
        : this.send({ type: "duel-command", ...common, command: pending.command as import("@riftbound/protocol").DuelWireCommand })
      : this.send({ type: "command", ...common, command: pending.command as PlayerCommand });
  }

  private armCommandTimeout(pending: PendingCommand): void {
    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    pending.timeoutTimer = setTimer(() => {
      if (this.pendingCommand !== pending) return;
      this.retryPendingCommand(true);
    }, COMMAND_TIMEOUT_MS);
  }

  private nextRequestId(prefix: string): string {
    this.requestSeq += 1;
    return `${prefix}-${this.requestSeq}`;
  }

  private openSocket(status: GameClientStatus): void {
    if (!this.serverUrl) return;

    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.helloSession = null;
    this.expectedSessionRequest = null;
    this.clearOwnerRoomWitness();
    this.preparePendingCommandForRetry();
    this.latestProjectionVersion = null;
    this.duelProjectionSocketGeneration = null;
    // A new socket starts a fresh episode: the next refused downgrade frame
    // gets its own single error/resync rather than inheriting a prior latch.
    this.duelSchemaDowngradeLatched = false;
    if (status === "connecting") {
      this.handlers.onProjection(null);
    }

    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.setStatus(status);

    let socket: WebSocket;
    const socketGeneration = ++this.socketGeneration;
    try {
      socket = new WebSocket(this.serverUrl);
    } catch {
      this.handlers.onError("无法连接游戏服务端，请检查地址后重试。");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) return;
      this.sendHello();
    });

    socket.addEventListener("message", event => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) return;
      this.handleMessage(event.data, socketGeneration);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) return;
      this.socket = null;
      this.stopHeartbeat();
      this.setHandshakeReady(false);
      this.clearOwnerRoomWitness();
      this.preparePendingCommandForRetry();
      this.latestProjectionVersion = null;
      this.duelProjectionSocketGeneration = null;
      this.duelSchemaDowngradeLatched = false;
      if (this.intentionallyClosed) {
        this.setStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket || this.socketGeneration !== socketGeneration) return;
      this.setHandshakeReady(false);
      this.clearOwnerRoomWitness();
      this.preparePendingCommandForRetry();
      this.duelProjectionSocketGeneration = null;
      this.duelSchemaDowngradeLatched = false;
      this.handlers.onError("无法连接游戏服务端，请检查地址或稍后重试。");
    });
  }

  private sendHello(): void {
    this.helloSession = this.session?.serverUrl === this.serverUrl ? this.session : null;
    const resume =
      this.session?.serverUrl === this.serverUrl
        ? {
            roomId: this.session.roomId,
            resumeToken: this.session.resumeToken
          }
        : {};

    this.sendRaw({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      ...resume,
      ...(resume.roomId === undefined
        ? {}
        : {
            ...(this.activeNamespace === "duel" || this.latestEventSeq === null
              ? {}
              : { afterEventSeq: this.latestEventSeq }),
            ...(this.latestRoomEventSeq === null
              ? {}
              : { afterRoomEventSeq: this.latestRoomEventSeq })
          })
    });
  }

  private handleMessage(raw: unknown, socketGeneration = this.socketGeneration): void {
    if (socketGeneration !== this.socketGeneration ||
        this.socket?.readyState !== WebSocket.OPEN) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      this.handlers.onError("服务端返回了无法识别的数据。");
      return;
    }

    if (!isServerMessage(parsed)) {
      this.handlers.onError("服务端返回了无法识别的消息。");
      return;
    }

    switch (parsed.type) {
      case "welcome": {
        if (parsed.protocolVersion !== PROTOCOL_VERSION) {
          this.stopForProtocolMismatch();
          return;
        }
        if (this.status !== "connected" && this.status !== "connecting" &&
            this.status !== "reconnecting") return;
        // An unsolicited welcome cannot substitute a new room/actor for the
        // authenticated hello. The only other welcome is the response to an
        // explicit create/join request made after the initial handshake.
        const established = this.handshakeReady;
        if (established) {
          if (this.session !== null &&
              (!parsed.session || !sameSession(this.session, parsed.session))) {
            this.stopAfterSessionReplaced();
            return;
          }
          if (this.session === null && (!parsed.session ||
              this.expectedSessionRequest?.socketGeneration !== socketGeneration)) return;
        } else if (this.helloSession !== null &&
            (!parsed.session || !sameSession(this.helloSession, parsed.session))) {
          this.stopAfterSessionReplaced();
          return;
        }

        this.reconnectAttempt = 0;
        this.lastPongAt = Date.now();
        if (parsed.session) {
          this.applySession({ ...parsed.session, serverUrl: this.serverUrl });
          this.expectedSessionRequest = null;
        } else if (this.session?.serverUrl === this.serverUrl) {
          this.applySession(null);
        }
        if (this.pendingCommand && !this.matchesPendingSession(this.pendingCommand)) {
          this.clearPendingCommand();
        }
        this.setHandshakeReady(true);
        this.startHeartbeat();
        this.setStatus("connected");
        this.retryPendingCommand();
        this.syncChat();
        this.sendPendingChat();
        return;
      }
      case "room-chat": {
        if (!this.matchesActiveSocketSession(socketGeneration, parsed.roomId)) return;
        if (parsed.afterChatSeq > this.chatMessages.length) {
          this.syncChat();
          return;
        }
        for (const message of parsed.messages) {
          const existing = this.chatMessages[message.seq - 1];
          if (existing && (existing.messageId !== message.messageId ||
              existing.playerId !== message.playerId || existing.playerName !== message.playerName ||
              existing.text !== message.text)) {
            this.handlers.onChatError?.("聊天记录校验失败，请重新连接。");
            return;
          }
        }
        if (parsed.nextChatSeq > this.chatMessages.length) {
          this.chatMessages = [...this.chatMessages,
            ...parsed.messages.filter(message => message.seq > this.chatMessages.length)];
          this.handlers.onChatMessages?.(this.chatMessages);
        }
        return;
      }
      case "room-chat-accepted": {
        const pending = this.pendingChat;
        if (!pending || !this.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
            pending.socketGeneration !== socketGeneration || parsed.requestId !== pending.requestId ||
            parsed.messageId !== pending.messageId || !this.session ||
            !sameStoredSession(pending.session, this.session)) return;
        this.clearPendingChat();
        this.handlers.onChatError?.(null);
        if (parsed.seq > this.chatMessages.length) this.syncChat();
        return;
      }
      case "request-result": {
        const pendingRoomRequest = this.pendingRoomRequest;
        if (
          pendingRoomRequest &&
          pendingRoomRequest.requestId === parsed.requestId &&
          pendingRoomRequest.socketGeneration === socketGeneration &&
          this.matchesCurrentRoomRequestContext(pendingRoomRequest)
        ) {
          this.clearPendingRequest(false);
          this.handlers.onRoomRequestResult?.({
            requestId: pendingRoomRequest.requestId,
            requestType: pendingRoomRequest.requestType,
            roomId: pendingRoomRequest.roomId,
            playerId: pendingRoomRequest.playerId,
            socketGeneration: pendingRoomRequest.socketGeneration,
            ...(pendingRoomRequest.ready === undefined
              ? {} : { ready: pendingRoomRequest.ready }),
            ...(parsed.roomVersion === undefined ? {} : { roomVersion: parsed.roomVersion }),
            ...(parsed.roomEventSeq === undefined ? {} : { roomEventSeq: parsed.roomEventSeq }),
            ...(parsed.duplicate === undefined ? {} : { duplicate: parsed.duplicate })
          });
        }
        const pending = this.pendingCommand;
        if (pending && this.matchesPendingReceipt(pending, parsed, socketGeneration)) {
          this.clearPendingCommand();
          // A receipt is not a projection. Do not allow another command against
          // the pre-acknowledgement version until an authoritative update arrives.
          if (pending.namespace === "duel") {
            if (this.duelProjection?.match.matchId === pending.matchId &&
                (this.duelProjection.match.stateVersion < parsed.appliedVersion! ||
                 this.duelProjection.match.eventSeq < parsed.eventSeq! ||
                 this.duelProjection.match.stateVersion <= pending.expectedVersion ||
                 this.duelProjection.match.eventSeq <= pending.eventSeq)) {
              this.duelAcknowledgedClock = {
                version: Math.max(parsed.appliedVersion!, pending.expectedVersion),
                eventSeq: Math.max(parsed.eventSeq!, pending.eventSeq),
                requireNewer: parsed.appliedVersion! <= pending.expectedVersion || parsed.eventSeq! <= pending.eventSeq,
              };
            }
          } else if (parsed.appliedVersion !== undefined) {
            this.latestProjectionVersion = null;
          }
        }
        return;
      }
      case "room":
        if (!this.matchesActiveSocketSession(socketGeneration, parsed.room.roomId) ||
            !parsed.room.players.some(player => player.id === this.session?.playerId)) return;
        // A room transition is a witness only when a previously observed
        // playing/ended room advances its version to waiting in this session.
        // A lone waiting packet or match ID cannot authorize a reset to v0.
        if ((this.roomVersion !== null && parsed.room.roomVersion < this.roomVersion) ||
            (this.latestRoomEventSeq !== null &&
              parsed.room.roomEventSeq < this.latestRoomEventSeq)) return;
        if (this.activeNamespace === "duel" && this.duelProjection &&
            (parsed.room.rulesetId !== DUEL_RULESET_ID ||
              parsed.room.players.length !== this.duelProjection.match.roster.length ||
              !parsed.room.players.every(player => this.duelProjection!.match.roster.some(
                seat => seat.playerId === player.id)))) {
          // Contradictory authenticated room evidence makes the cached hand and
          // its pending command unsafe, even if the Duel DTO arrived first.
          this.stopAfterSessionReplaced();
          return;
        }
        if (this.roomRulesetId !== null && parsed.room.rulesetId !== this.roomRulesetId) return;
        if (this.duelProjection && this.roomStatus !== null &&
            this.roomStatus !== "waiting" && parsed.room.status === "waiting" &&
            this.roomVersion !== null && parsed.room.roomVersion > this.roomVersion) {
          this.duelMatchTransitionAllowed = true;
          this.duelProjectionSocketGeneration = null;
          this.duelAcknowledgedClock = null;
          this.clearPendingCommand();
        }
        this.roomVersion = parsed.room.roomVersion;
        this.roomStatus = parsed.room.status;
        this.roomRulesetId = parsed.room.rulesetId;
        this.roomRoster = new Set(parsed.room.players.map(player => player.id));
        this.roomSelfDeckSubmitted = parsed.room.players.find(player => player.id === this.session?.playerId)!.deckSubmitted;
        this.roomViewSocketGeneration = socketGeneration;
        this.roomViewEventSeq = parsed.room.roomEventSeq;
        this.roomViewStatus = parsed.room.status;
        this.latestRoomEventSeq = Math.max(
          this.latestRoomEventSeq ?? parsed.room.roomEventSeq, parsed.room.roomEventSeq
        );
        // A new authoritative room clock or cleared public flag invalidates a
        // prior echo; only a fresh private message for this exact clock can
        // restore the owner witness. RoomView alone never proves deck identity.
        if (this.ownerDeckConfirmation && (
          this.ownerDeckConfirmation.roomVersion !== parsed.room.roomVersion ||
          this.ownerDeckConfirmation.roomEventSeq !== parsed.room.roomEventSeq ||
          (this.ownerDeckConfirmation.deck !== null) !== this.roomSelfDeckSubmitted
        )) this.clearOwnerDeckConfirmation();
        this.handlers.onRoom(parsed.room.roomId);
        this.handlers.onRoomView?.(parsed.room);
        const staged = this.pendingOwnerDeckEcho;
        this.pendingOwnerDeckEcho = null;
        if (staged !== null) this.acceptOwnerDeckConfirmation(staged, socketGeneration);
        return;
      case "owner-deck-confirmation": {
        // A playing/ended broadcast can send its private echo immediately
        // before the new room snapshot. Queue only for this authenticated seat;
        // never expose staged content to UI or any ACK handler.
        const aheadOfRoom = this.matchesActiveSocketSession(socketGeneration, parsed.roomId) &&
          this.session?.playerId === parsed.playerId &&
          this.roomViewSocketGeneration === socketGeneration &&
          this.roomRulesetId === parsed.rulesetId &&
          this.roomVersion !== null && parsed.roomVersion > this.roomVersion &&
          parsed.roomEventSeq >= (this.roomViewEventSeq ?? 0);
        if (aheadOfRoom) {
          this.pendingOwnerDeckEcho = parsed;
          return;
        }
        this.acceptOwnerDeckConfirmation(parsed, socketGeneration);
        return;
      }
      case "projection":
        if (!this.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
            !parsed.projection.players.some(player => player.id === this.session?.playerId) ||
            (parsed.projection.actionOptions !== undefined &&
              parsed.projection.actionOptions.viewerPlayerId !== this.session?.playerId)) return;
        // The namespaces have unrelated version/event clocks. Do not allow a
        // stray legacy packet to replace an authenticated Duel in this room.
        if (this.activeNamespace === "duel" || this.roomRulesetId === DUEL_RULESET_ID) return;
        if (this.latestProjectionVersion !== null &&
            (parsed.projection.version < this.latestProjectionVersion ||
             parsed.projection.eventSeq < (this.latestEventSeq ?? 0))) return;
        this.activeNamespace = "legacy";
        this.legacyProjectionSeen = true;
        this.latestProjectionVersion = parsed.projection.version;
        this.latestEventSeq = Math.max(this.latestEventSeq ?? 0, parsed.projection.eventSeq);
        this.handlers.onProjection(parsed.projection);
        this.handlers.onRoom(parsed.roomId);
        this.retryPendingCommand();
        return;
      case "duel-projection":
        this.acceptDuelProjection(parsed.roomId, parsed.projection, socketGeneration);
        return;
      case "events": {
        if (!this.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
            this.activeNamespace === "duel" ||
            (this.latestEventSeq !== null && parsed.nextEventSeq < this.latestEventSeq)) return;
        this.latestEventSeq = Math.max(
          this.latestEventSeq ?? parsed.afterEventSeq,
          parsed.nextEventSeq
        );
        this.handlers.onEvents?.(parsed.events);
        return;
      }
      case "room-events": {
        if (!this.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
            (this.latestRoomEventSeq !== null &&
              parsed.nextRoomEventSeq < this.latestRoomEventSeq)) return;
        this.latestRoomEventSeq = Math.max(
          this.latestRoomEventSeq ?? parsed.afterRoomEventSeq,
          parsed.nextRoomEventSeq
        );
        this.handlers.onRoomEvents?.(parsed.events);
        return;
      }
      case "error":
        this.handleServerError(parsed, socketGeneration);
        return;
      case "pong":
        this.lastPongAt = Date.now();
        return;
    }
  }

  private handleServerError(
    message: Extract<ServerToClientMessage, { type: "error" }>,
    socketGeneration: number
  ): void {
    if (this.pendingChat && message.requestId === this.pendingChat.requestId &&
        socketGeneration === this.pendingChat.socketGeneration &&
        !["session-replaced", "invalid-token", "room-not-found"].includes(message.code)) {
      this.clearPendingChat();
      this.handlers.onChatError?.(message.code === "capacity-exceeded"
        ? "房间聊天记录已满。" : "聊天消息未被接受，请检查内容后重试。");
      return;
    }
    const pending = this.pendingCommand;
    if (
      this.pendingRoomRequest !== null &&
      message.requestId === this.pendingRoomRequest.requestId &&
      this.matchesCurrentRoomRequestContext(this.pendingRoomRequest)
    ) {
      this.clearPendingRequest(true);
    }
    const pendingAffected =
      pending !== null && this.matchesPendingSession(pending) &&
      (message.requestId !== undefined &&
        pending.sentRequests.get(message.requestId) === socketGeneration ||
        message.code === "session-replaced" ||
        message.code === "invalid-token" ||
        message.code === "room-not-found");

    if (pendingAffected) this.clearPendingCommand();

    switch (message.code) {
      case "invalid-token":
      case "room-not-found":
        this.handlers.onError("原房间已不可用，正在准备新的房间连接。");
        this.reconnectWithoutSession();
        return;
      case "session-replaced":
        this.handlers.onError("当前连接已被新的会话替换，已停止自动重连。");
        this.stopAfterSessionReplaced();
        return;
      case "stale-version":
        if (pendingAffected) {
          if (pending?.namespace === "duel") {
            this.duelAcknowledgedClock = {
              version: Math.max(this.duelAcknowledgedClock?.version ?? 0, this.duelProjection?.match.stateVersion ?? 0),
              eventSeq: Math.max(this.duelAcknowledgedClock?.eventSeq ?? 0, this.duelProjection?.match.eventSeq ?? 0),
              requireNewer: true,
            };
          } else this.latestProjectionVersion = null;
        }
        this.handlers.onError("牌桌状态已更新，请重试刚才的操作。");
        return;
      case "idempotency-conflict":
        this.handlers.onError("该操作与已发送的操作冲突，请重试。");
        return;
      case "handshake-required":
        this.handlers.onError("连接尚未就绪，请重试。");
        return;
      case "protocol-error":
        this.handlers.onError("客户端与服务端通信不兼容，请检查版本。");
        return;
      case "room-full":
        this.handlers.onError("房间人数已满，无法加入。");
        return;
      case "invalid-deck":
        this.handlers.onError("卡组未通过服务端校验，请调整后再提交。");
        return;
      case "already-in-room":
        this.handlers.onError("当前连接已经进入房间。");
        return;
      case "invalid_command":
        this.handlers.onError("当前操作不符合规则，请重试。");
        return;
      case "not_your_turn":
        this.handlers.onError("尚未轮到你的回合。");
        return;
      case "prompt_required":
        this.handlers.onError("请先响应当前选择。");
        return;
      case "prompt_not_found":
      case "prompt_expired":
        this.handlers.onError("该选择已失效，请等待牌桌更新。");
        return;
      case "invalid_prompt_answer":
        this.handlers.onError("当前选择无效，请重新选择。");
        return;
      case "card_not_found":
        this.handlers.onError("该卡牌已不在手牌中。");
        return;
      case "not_enough_mana":
        this.handlers.onError("资源不足，无法执行该操作。");
        return;
      case "game_ended":
        this.handlers.onError("对局已经结束。");
        return;
      case "command-rejected":
        this.handlers.onError(pendingAffected && pending?.namespace === "duel" &&
          pending.command.type === "play-card" && message.message === "法术付款仍在等待资源"
          ? "请获取资源并支付当前施放费用，完成后进入响应时点。"
          : "服务端未接受该操作，请重试。");
        return;
      case "capacity-exceeded":
        this.handlers.onError("服务端当前繁忙，请稍后重试。");
        return;
      default:
        this.handlers.onError("操作失败，请稍后重试。");
    }
  }

  private acceptOwnerDeckConfirmation(
    parsed: OwnerDeckConfirmationMessage,
    socketGeneration: number
  ): void {
    // Echo is state proof, never an ACK: do not mutate either pending request,
    // command namespace, retry or the recorded request-result here.
    if (!this.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
        this.roomViewSocketGeneration !== socketGeneration ||
        this.session?.playerId !== parsed.playerId ||
        this.roomRulesetId !== parsed.rulesetId ||
        this.roomStatus !== this.roomViewStatus ||
        this.roomVersion !== parsed.roomVersion ||
        this.roomViewEventSeq !== parsed.roomEventSeq ||
        this.roomSelfDeckSubmitted !== (parsed.deck !== null)) return;
    const confirmation: OwnerDeckConfirmation = {
      ...parsed,
      deck: parsed.deck === null ? null : structuredClone(parsed.deck),
      catalog: { ...parsed.catalog },
      serverUrl: this.serverUrl,
      socketGeneration
    };
    this.ownerDeckConfirmation = confirmation;
    this.handlers.onOwnerDeckConfirmation?.(confirmation);
  }

  private clearOwnerDeckConfirmation(): void {
    if (this.ownerDeckConfirmation === null) return;
    this.ownerDeckConfirmation = null;
    this.handlers.onOwnerDeckConfirmation?.(null);
  }

  private clearOwnerRoomWitness(): void {
    this.clearOwnerDeckConfirmation();
    this.pendingOwnerDeckEcho = null;
    this.roomSelfDeckSubmitted = null;
    this.roomViewSocketGeneration = null;
    this.roomViewEventSeq = null;
    this.roomViewStatus = null;
  }

  private matchesActiveSocketSession(socketGeneration: number, roomId: string): boolean {
    return socketGeneration === this.socketGeneration &&
      this.status === "connected" && this.handshakeReady &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.session !== null && this.session.roomId === roomId &&
      this.session.playerId.length > 0 && this.session.resumeToken.length > 0 &&
      this.session.serverUrl === this.serverUrl &&
      (this.roomRoster === null || this.roomRoster.has(this.session.playerId));
  }

  private matchesDuelContext(): boolean {
    const context = this.duelProjectionContext;
    return context !== null && this.session !== null &&
      this.session.roomId === context.roomId &&
      this.session.playerId === context.playerId &&
      this.session.resumeToken === context.resumeToken &&
      this.session.serverUrl === context.serverUrl &&
      (this.roomRoster === null || this.roomRoster.has(context.playerId));
  }

  private clearDuelProjection(): void {
    this.duelProjection = null;
    this.duelProjectionContext = null;
    this.duelProjectionSocketGeneration = null;
    this.duelSchemaDowngradeLatched = false;
    this.duelMatchTransitionAllowed = false;
    this.retiredDuelMatchIds.clear();
    this.duelAcknowledgedClock = null;
    this.handlers.onDuelProjection?.(null);
  }

  private acceptDuelProjection(roomId: string, projection: DuelProjectionTransport, socketGeneration: number): void {
    const session = this.session;
    if (!this.matchesActiveSocketSession(socketGeneration, roomId) || !session ||
        (this.roomRulesetId !== null && this.roomRulesetId !== DUEL_RULESET_ID) ||
        (this.roomRoster !== null &&
          (this.roomRoster.size !== projection.match.roster.length ||
            !projection.match.roster.every(person => this.roomRoster!.has(person.playerId)))) ||
        (this.roomRulesetId === null && this.legacyProjectionSeen) ||
        (this.duelProjectionContext !== null && !this.matchesDuelContext()) ||
        projection.viewerPlayerId === null || projection.viewerPlayerId !== session.playerId ||
        !projection.match.roster.some(person => person.playerId === session.playerId)) return;

    const previous = this.duelProjection;
    const next = projection.match;
    if (previous && this.matchesDuelContext()) {
      const old = previous.match;
      if (old.matchId !== next.matchId) {
        // Only a confirmed room waiting transition can start a new match in
        // this same session; otherwise an old/different match must be ignored.
        if (!this.duelMatchTransitionAllowed || next.stateVersion !== 0 || next.eventSeq !== 0 ||
            next.stage !== "setup") return;
        if (this.retiredDuelMatchIds.has(next.matchId)) return;
        this.clearPendingCommand();
      } else {
        // After a witnessed return to the lobby, an in-flight packet from the
        // ended match must not re-enable actions or consume the reset witness.
        if (this.duelMatchTransitionAllowed) return;
        // A frame whose clock trails the accepted one is stale, not a
        // contradiction: ignore it outright so an out-of-order/older-schema
        // packet can never freeze an operable V2 hand, drop its pending command
        // or request a resync. This must precede the schema gate below.
        if (next.stateVersion < old.stateVersion || next.eventSeq < old.eventSeq) return;
        if (previous.projectionSchema !== projection.projectionSchema &&
            (previous.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ||
             projection.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1)) {
          this.refuseDuelSchemaDowngrade();
          return;
        }
        // The wire schema is monotonic within one match: a V2 frame must never
        // be replaced by a V1 frame — even at an equal clock — while a V1→V2
        // promotion at the same clock is allowed. V1/V2 shapes may diverge, so
        // an equal-or-newer-clock older-schema packet must not silently
        // overwrite the newer one.
        if (next.schemaVersion < old.schemaVersion) {
          this.refuseDuelSchemaDowngrade();
          return;
        }
        if (next.stateVersion === old.stateVersion && next.eventSeq === old.eventSeq &&
            next.stage !== old.stage) return;
        // The observed setup->playing progression is monotonic within a match.
        if (old.stage === "playing" && next.stage === "setup") return;
      }
    }
    if (previous && previous.match.matchId !== next.matchId) {
      this.retiredDuelMatchIds.add(previous.match.matchId);
    }
    if (this.pendingCommand?.namespace === "legacy") this.clearPendingCommand();
    if (this.duelMatchTransitionAllowed ||
        !this.waitsForDuelAcknowledgement(next.stateVersion, next.eventSeq)) {
      this.duelAcknowledgedClock = null;
    }
    if (this.activeNamespace !== "duel") {
      this.handlers.onProjection(null);
      this.handlers.onEvents?.([]);
      this.latestEventSeq = null;
    }
    this.activeNamespace = "duel";
    this.latestProjectionVersion = null;
    this.duelProjection = projection;
    this.duelProjectionContext = {
      roomId, playerId: session.playerId,
      resumeToken: session.resumeToken, serverUrl: session.serverUrl
    };
    this.duelProjectionSocketGeneration = socketGeneration;
    // An accepted frame restores operability (a fresh V2 after a refusal, or a
    // new match); the downgrade episode is over, so a later one may notify once.
    this.duelSchemaDowngradeLatched = false;
    this.duelMatchTransitionAllowed = false;
    this.handlers.onDuelProjection?.(projection);
    this.handlers.onRoom(roomId);
    this.retryPendingCommand();
  }

  /**
   * A same-match frame carrying an older wire schema is refused outright: its
   * shape no longer agrees with the frame already on screen, so it can neither
   * replace the display nor be trusted as the server's current clock.
   *
   * The last accepted frame is kept for display, but it stops being operable:
   * dropping `duelProjectionSocketGeneration` fails the same generation gate
   * that the reconnect path uses, so `submitDuelCommand` refuses every command
   * built on this now-stale frame. The in-flight command was constructed
   * against a clock the server has just contradicted and is dropped rather
   * than replayed.
   *
   * Because the server contradicted the very frame it is authoritative for,
   * ask it once for an authoritative resync over the existing `sync-events`
   * path (a Duel room answers it by re-sending this seat's projection).
   *
   * The notify/resync request is guarded by a dedicated one-shot latch rather
   * than by current operability: the first refused frame of an episode is
   * surfaced with one error and one resync request even when the generation
   * was already dropped (a reconnect, where the very first downgrade frame used
   * to pass silently). Every later refused frame in the same episode is
   * swallowed, so a server stuck on the older schema cannot drive a resync
   * storm. Accepting a fresh V2 frame clears the latch, ending the episode.
   */
  private refuseDuelSchemaDowngrade(): void {
    this.duelProjectionSocketGeneration = null;
    this.clearPendingCommand();
    if (this.duelSchemaDowngradeLatched) return;
    this.duelSchemaDowngradeLatched = true;
    this.handlers.onError("服务端牌桌版本与当前画面不一致，已暂停操作并请求重新同步。");
    this.syncEvents();
  }

  private waitsForDuelAcknowledgement(version: number, eventSeq: number): boolean {
    const clock = this.duelAcknowledgedClock;
    return clock !== null && (version < clock.version || eventSeq < clock.eventSeq ||
      clock.requireNewer && (version === clock.version || eventSeq === clock.eventSeq));
  }

  private matchesPendingSession(pending: PendingCommand): boolean {
    return this.session?.roomId === pending.roomId &&
      this.session.playerId === pending.playerId &&
      this.session.resumeToken === pending.resumeToken &&
      this.session.serverUrl === pending.serverUrl &&
      this.serverUrl === pending.serverUrl;
  }

  private matchesPendingReceipt(
    pending: PendingCommand,
    receipt: Extract<ServerToClientMessage, { type: "request-result" }>,
    socketGeneration: number
  ): boolean {
    if (!this.matchesPendingSession(pending) ||
        this.status !== "connected" || !this.handshakeReady ||
        this.socket?.readyState !== WebSocket.OPEN ||
        socketGeneration !== this.socketGeneration ||
        pending.sentRequests.get(receipt.requestId) !== socketGeneration ||
        receipt.commandId !== pending.commandId ||
        receipt.appliedVersion === undefined || receipt.eventSeq === undefined ||
        receipt.appliedVersion < pending.expectedVersion ||
        receipt.eventSeq < pending.eventSeq ||
        this.activeNamespace !== pending.namespace) return false;
    if (pending.namespace === "duel") {
      return this.duelProjection?.match.matchId === pending.matchId && this.matchesDuelContext();
    }
    return true;
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || !this.serverUrl) return;

    this.reconnectAttempt += 1;
    const capped = Math.min(
      500 * 2 ** Math.max(0, this.reconnectAttempt - 1),
      MAX_RECONNECT_DELAY_MS
    );
    const jitter = Math.floor(Math.random() * 250);
    const delay = capped + jitter;

    this.clearReconnectTimer();
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimer(() => {
      this.openSocket("reconnecting");
    }, delay);
  }

  private reconnectWithoutSession(): void {
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.setHandshakeReady(false);
    this.clearOwnerRoomWitness();
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.applySession(null);
    this.clearDuelProjection();
    this.activeNamespace = null;
    this.handlers.onProjection(null);
    this.stopHeartbeat();
    this.intentionallyClosed = false;
    this.reconnectAttempt = 0;
    this.openSocket("reconnecting");
  }

  private stopAfterSessionReplaced(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearOwnerRoomWitness();
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.applySession(null);
    this.handlers.onProjection(null);

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  private stopForProtocolMismatch(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setHandshakeReady(false);
    this.clearOwnerRoomWitness();
    this.clearPendingCommand();
    this.clearPendingRequest();
    this.latestProjectionVersion = null;
    this.roomVersion = null;
    this.latestEventSeq = null;
    this.latestRoomEventSeq = null;
    this.handlers.onError("客户端与服务端版本不兼容，请更新后重试。");
    this.clearDuelProjection();
    this.activeNamespace = null;
    this.handlers.onProjection(null);

    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        this.socket.close();
        return;
      }
      this.sendRaw({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearIntervalTimer(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private preparePendingCommandForRetry(): void {
    if (this.pendingChat?.timer !== null && this.pendingChat?.timer !== undefined) {
      clearTimer(this.pendingChat.timer);
      this.pendingChat.timer = null;
    }
    // Room requests are deliberately not retried on a replacement socket: a
    // late receipt must never be associated with a new socket/session context.
    this.clearPendingRequest();
    const pending = this.pendingCommand;
    if (!pending) return;

    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    pending.timeoutTimer = null;
    pending.retryDue = true;
  }

  private retryPendingCommand(force = false): void {
    const pending = this.pendingCommand;
    if (!pending || (!force && !pending.retryDue)) return;
    if (!this.matchesPendingSession(pending)) {
      this.clearPendingCommand();
      return;
    }
    if (this.status !== "connected" || !this.handshakeReady ||
        this.socket?.readyState !== WebSocket.OPEN ||
        this.activeNamespace !== pending.namespace) return;
    if (pending.namespace === "duel") {
      if (!this.matchesDuelContext() ||
          this.duelProjectionSocketGeneration !== this.socketGeneration ||
          this.duelProjection?.match.matchId !== pending.matchId) return;
    } else {
      // A legacy retry must wait for a fresh legacy projection and then rebase
      // onto the server's latest confirmed version/event cursor. Duel commands
      // never do this: their version/clock stays frozen at the original send.
      if (this.latestProjectionVersion === null) return;
      pending.expectedVersion = this.latestProjectionVersion;
      pending.eventSeq = this.latestEventSeq ?? pending.eventSeq;
    }

    if (pending.attempt >= MAX_COMMAND_ATTEMPTS) {
      this.clearPendingCommand();
      this.handlers.onError("操作确认超时，请重试。");
      return;
    }
    pending.attempt += 1;
    pending.retryDue = false;
    pending.requestId = this.nextRequestId("command");
    pending.socketGeneration = this.socketGeneration;
    pending.sentRequests.set(pending.requestId, this.socketGeneration);
    if (!this.sendPendingCommand(pending)) {
      this.preparePendingCommandForRetry();
      return;
    }
    this.armCommandTimeout(pending);
  }

  private clearPendingCommand(): void {
    const pending = this.pendingCommand;
    if (!pending) return;

    this.pendingCommand = null;
    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    this.handlers.onPendingCommand?.(false);
  }

  private matchesCurrentRoomRequestContext(pending: PendingRoomRequest): boolean {
    return pending.socketGeneration === this.socketGeneration &&
      this.status === "connected" && this.handshakeReady &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.session?.roomId === pending.roomId &&
      this.session.playerId === pending.playerId &&
      this.session.resumeToken === pending.resumeToken &&
      this.session.serverUrl === this.serverUrl;
  }

  private clearPendingRequest(failed = true): void {
    const pending = this.pendingRoomRequest;
    if (!pending) return;
    this.pendingRoomRequest = null;
    if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
    this.handlers.onPendingRequest?.(false);
    if (failed) {
      this.handlers.onRoomRequestFailure?.({
        requestId: pending.requestId,
        requestType: pending.requestType,
        roomId: pending.roomId,
        playerId: pending.playerId,
        socketGeneration: pending.socketGeneration
      });
    }
  }

  private setStatus(status: GameClientStatus): void {
    this.status = status;
    this.handlers.onStatus(status);
  }

  private setHandshakeReady(ready: boolean): void {
    if (this.handshakeReady === ready) return;
    this.handshakeReady = ready;
    this.handlers.onHandshake(ready);
  }

  private send(message: ClientToServerMessage): boolean {
    if (
      this.status !== "connected" ||
      !this.handshakeReady ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      this.handlers.onError("连接未就绪，操作未发送。");
      return false;
    }
    return this.sendRaw(message);
  }

  private sendRaw(message: ClientToServerMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.handlers.onError("连接未就绪，操作未发送。");
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private applySession(session: StoredSession | null): void {
    const previous = this.session;
    if (previous?.roomId !== session?.roomId ||
        previous?.playerId !== session?.playerId ||
        previous?.resumeToken !== session?.resumeToken ||
        previous?.serverUrl !== session?.serverUrl) {
      this.clearPendingCommand();
      this.clearDuelProjection();
      this.activeNamespace = null;
      this.legacyProjectionSeen = false;
      this.roomVersion = null;
      this.roomStatus = null;
      this.clearOwnerRoomWitness();
      this.roomRulesetId = null;
      this.roomRoster = null;
      this.latestProjectionVersion = null;
      this.latestEventSeq = null;
      this.latestRoomEventSeq = null;
      this.clearPendingRequest();
      this.clearPendingChat();
      this.chatMessages = [];
      this.handlers.onChatMessages?.([]);
      this.handlers.onChatError?.(null);
      this.handlers.onProjection(null);
      if (previous !== null) {
        this.handlers.onEvents?.([]);
        this.handlers.onRoomEvents?.([]);
      }
    }
    this.session = session;
    writeSession(session);
    this.handlers.onSession(session);
    this.handlers.onRoom(session?.roomId ?? null);
    this.handlers.onRoomView?.(null);
  }
}

function sameSession(left: ClientSession, right: ClientSession): boolean {
  return left.roomId === right.roomId && left.playerId === right.playerId &&
    left.resumeToken === right.resumeToken;
}

function sameStoredSession(left: StoredSession, right: StoredSession): boolean {
  return sameSession(left, right) && left.serverUrl === right.serverUrl;
}

function requestIdOf(message: ClientToServerMessage): string | null {
  return "requestId" in message && typeof message.requestId === "string"
    ? message.requestId
    : null;
}

function normalizeRoomDeck(deck: RoomDeckSubmission): RoomDeckSubmission | null {
  if (typeof deck !== "object" || deck === null) return null;
  const result: Record<string, { cardId: string; quantity: number }[]> = {};
  for (const [zone, entries] of Object.entries(deck)) {
    if (!Array.isArray(entries)) return null;
    const normalizedEntries: { cardId: string; quantity: number }[] = [];
    for (const entry of entries) {
      if (
        typeof entry?.cardId !== "string" ||
        !entry.cardId ||
        typeof entry.quantity !== "number" ||
        !Number.isSafeInteger(entry.quantity) ||
        entry.quantity <= 0
      ) return null;
      normalizedEntries.push({ cardId: entry.cardId, quantity: entry.quantity });
    }
    result[zone] = normalizedEntries;
  }
  return result;
}

function requirePlayerName(input: string): string | null {
  const name = input.trim();
  if (!name || name.length > 32) return null;
  return name;
}

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return globalThis.crypto.randomUUID();
}

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.playerId !== "string" ||
      typeof value.resumeToken !== "string" ||
      typeof value.roomId !== "string" ||
      typeof value.serverUrl !== "string"
    ) {
      return null;
    }
    return {
      playerId: value.playerId,
      resumeToken: value.resumeToken,
      roomId: value.roomId,
      serverUrl: value.serverUrl
    };
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Resume storage is best-effort; the server can always issue a fresh session.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim() || DEFAULT_SERVER_URL;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `ws://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }

  if (!url.hostname) return null;

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  } else if (!/\/ws\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  }
  url.hash = "";
  return url.toString();
}

function setTimer(callback: () => void, delay: number): number {
  return globalThis.setTimeout(callback, delay) as unknown as number;
}

function clearTimer(handle: number): void {
  globalThis.clearTimeout(handle);
}

function setInterval(callback: () => void, delay: number): number {
  return globalThis.setInterval(callback, delay) as unknown as number;
}

function clearIntervalTimer(handle: number): void {
  globalThis.clearInterval(handle);
}
