import {
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID,
  RULESET_ID,
  isDuelCommand,
  isDuelCommandV3Actions1,
  isDuelCommandMessageV3Actions1,
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  type ConstructedRegionSelection,
  isConstructedRegionSelection,
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
  type RoomChatMessage,
  type RoomView
} from "@riftbound/protocol";
import {
  normalizeRoomDeck,
  requirePlayerName
} from "./internal/utils";
import { normalizeServerUrl, readStoredSession } from "./internal/session";
import {
  applySession,
  clearReconnectTimer,
  openSocket,
  reconnectWithoutSession,
  scheduleReconnect,
  send,
  sendRaw,
  stopAfterSessionReplaced,
  stopForProtocolMismatch,
  startHeartbeat,
  stopHeartbeat,
  sendHello
} from "./internal/connection";
import {
  preparePendingCommandForRetry,
  retryPendingCommand,
  clearPendingCommand,
  sendTrackedCommand,
  matchesDuelContext
} from "./internal/commands";
import {
  sendTrackedRequest,
  clearPendingRequest,
  matchesCurrentRoomRequestContext,
  acceptOwnerDeckConfirmation,
  clearOwnerRoomWitness,
  matchesActiveSocketSession
} from "./internal/room-requests";
import {
  sendChat,
  syncChat,
  sendPendingChat,
  clearPendingChat
} from "./internal/chat";
import {
  acceptDuelProjection,
  clearDuelProjection,
  refuseDuelSchemaDowngrade,
  waitsForDuelAcknowledgement
} from "./internal/projections";
import { handleMessage } from "./internal/dispatch";
import {
  createInitialState,
  type GameClientEmit,
  type GameClientHandlers,
  type GameClientState,
  type GameClientStatus,
  type PendingRoomRequest,
  type StoredSession
} from "./internal/types";

export {
  type GameClientStatus,
  type RoomRequestType,
  type RoomRequestReceipt,
  type RoomRequestFailure,
  type OwnerDeckConfirmation,
  type GameClientHandlers,
  type StoredSession
} from "./internal/types";

export type CreateRoomRuleset =
  | typeof OFFICIAL_RULESET_ID
  | typeof RULESET_ID
  | typeof DUEL_RULESET_ID;

export class GameClient {
  status: GameClientStatus = "idle";

  private readonly state: GameClientState;
  private readonly emit: GameClientEmit;

  constructor(private readonly handlers: GameClientHandlers) {
    this.state = createInitialState(readStoredSession());
    this.emit = this.createEmit();
  }

  connect(input: string): void {
    const normalizedUrl = normalizeServerUrl(input);
    if (!normalizedUrl) {
      this.handlers.onError("服务地址无效，请检查后重试。");
      return;
    }

    this.state.serverUrl = normalizedUrl;
    if (this.state.session === null || this.state.session.serverUrl !== normalizedUrl) {
      this.clearDuelProjection();
      this.state.activeNamespace = null;
      this.state.legacyProjectionSeen = false;
      this.state.roomRulesetId = null;
      this.state.roomRoster = null;
    }
    this.state.intentionallyClosed = false;
    this.state.reconnectAttempt = 0;
    if (this.state.session && this.state.session.serverUrl !== normalizedUrl) {
      this.applySession(null);
      this.clearPendingCommand();
    }
    this.setHandshakeReady(false);
    this.clearOwnerRoomWitness();
    this.preparePendingCommandForRetry();
    this.state.latestProjectionVersion = null;
    this.state.roomVersion = null;
    this.state.roomStatus = null;
    this.handlers.onProjection(null);
    this.clearPendingRequest();
    this.openSocket("connecting");
  }

  resumeStoredSession(): boolean {
    if (!this.state.session) return false;
    this.connect(this.state.session.serverUrl);
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
    return this.state.serverUrl || this.state.session?.serverUrl || null;
  }

  disconnect(): void {
    this.state.intentionallyClosed = true;
    clearReconnectTimer(this.state);
    stopHeartbeat(this.state);
    this.setHandshakeReady(false);
    this.clearPendingCommand();
    this.clearPendingRequest();
    clearPendingChat(this.state, this.emit);
    this.state.roomVersion = null;
    this.state.roomStatus = null;
    this.clearOwnerRoomWitness();
    this.clearDuelProjection();
    this.state.activeNamespace = null;
    this.state.legacyProjectionSeen = false;
    this.state.roomRulesetId = null;
    this.state.roomRoster = null;
    this.handlers.onRoomView?.(null);

    const socket = this.state.socket;
    this.state.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  /** Leaves the local session without deleting decks or local preferences. */
  leaveSession(): void {
    this.disconnect();
    this.applySession(null);
  }

  sendChat(input: string): boolean {
    return sendChat(this.state, this.emit, input);
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
    if (sent && !this.state.session) this.state.expectedSessionRequest = { requestId, socketGeneration: this.state.socketGeneration };
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
    if (sent && !this.state.session) this.state.expectedSessionRequest = { requestId, socketGeneration: this.state.socketGeneration };
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
        this.state.duelProjection?.projectionSchema !== DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ||
        packet.expectedVersion !== this.state.duelProjection.match.stateVersion) {
      this.handlers.onError("牌桌状态已更新或动作协议不一致，请重新选择。");
      return false;
    }
    return this.submitDuelOperation(packet.command, packet);
  }

  private submitDuelOperation(command: DuelWireCommandV3Actions1, packet?: DuelCommandMessageV3Actions1): boolean {
    const p4 = this.state.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
    if (!(p4 ? isDuelCommandV3Actions1(command) : isDuelCommand(command))) {
      this.handlers.onError("Duel 操作数据无效，操作未发送。");
      return false;
    }
    if (this.state.pendingCommand) {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    if (this.state.activeNamespace !== "duel" || !this.state.duelProjection ||
        this.state.duelProjectionSocketGeneration !== this.state.socketGeneration ||
        waitsForDuelAcknowledgement(this.state, this.state.duelProjection.match.stateVersion, this.state.duelProjection.match.eventSeq) ||
        !this.matchesDuelContext() ||
        this.state.duelProjection.match.stage === "playing" && this.state.duelProjection.match.frame.phase === "ended") {
      this.handlers.onError("尚未收到当前会话的可操作 Duel 牌桌状态。");
      return false;
    }
    // The UI presents server actions; the transport still enforces the exact
    // wire/action mapping so callers cannot submit a different UID or payment.
    if (!this.state.duelProjection.actions.some(action => action.enabled &&
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
    return sendTrackedCommand(this.state, this.emit, command, "duel", this.state.duelProjection.match.stateVersion,
      this.state.duelProjection.match.eventSeq, this.state.duelProjection.match.matchId, packet);
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
        const projection = this.state.duelProjection;
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
    if (this.state.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法提交卡组。");
      return null;
    }

    return this.sendTrackedRequest({
      type: "submit-deck",
      requestId: this.nextRequestId("submit-deck"),
      expectedRoomVersion: this.state.roomVersion,
      deck: normalized
    });
  }

  setReady(ready: boolean): boolean {
    return this.setReadyTracked(ready) !== null;
  }

  setReadyTracked(ready: boolean): string | null {
    if (this.state.roomVersion === null) {
      this.handlers.onError("尚未收到房间状态，无法切换准备状态。");
      return null;
    }
    return this.sendTrackedRequest({
      type: "set-ready",
      requestId: this.nextRequestId("set-ready"),
      expectedRoomVersion: this.state.roomVersion,
      ready
    });
  }

  syncEvents(): boolean {
    if (!this.state.session) {
      this.handlers.onError("尚未进入房间，无法同步事件。");
      return false;
    }
    return this.send({
      type: "sync-events",
      requestId: this.nextRequestId("sync-events"),
      ...(this.state.activeNamespace === "duel" || this.state.latestEventSeq === null
        ? {}
        : { afterEventSeq: this.state.latestEventSeq }),
      ...(this.state.latestRoomEventSeq === null
        ? {}
        : { afterRoomEventSeq: this.state.latestRoomEventSeq })
    });
  }

  // ---------------------------------------------------------------------------
  // Facade wiring: private methods that delegate into the extracted modules.
  // ---------------------------------------------------------------------------

  private createEmit(): GameClientEmit {
    const self = this;
    return {
      handlers: this.handlers,
      setStatus(status) { self.setStatus(status); },
      setHandshakeReady(ready) { self.setHandshakeReady(ready); },
      applySession(session) { self.applySession(session); },
      clearOwnerRoomWitness() { self.clearOwnerRoomWitness(); },
      clearPendingCommand() { self.clearPendingCommand(); },
      clearPendingRequest(failed) { self.clearPendingRequest(failed); },
      clearPendingChat() { self.clearPendingChat(); },
      clearDuelProjection() { self.clearDuelProjection(); },
      preparePendingCommandForRetry() { self.preparePendingCommandForRetry(); },
      retryPendingCommand(force) { self.retryPendingCommand(force); },
      syncChat() { self.syncChat(); },
      sendPendingChat() { return self.sendPendingChat(); },
      syncEvents() { return self.syncEvents(); },
      acceptOwnerDeckConfirmation(parsed, socketGeneration) { self.acceptOwnerDeckConfirmation(parsed, socketGeneration); },
      refuseDuelSchemaDowngrade() { self.refuseDuelSchemaDowngrade(); },
      reconnectWithoutSession() { self.reconnectWithoutSession(); },
      stopAfterSessionReplaced() { self.stopAfterSessionReplaced(); },
      stopForProtocolMismatch() { self.stopForProtocolMismatch(); },
      startHeartbeat() { self.startHeartbeat(); },
      stopHeartbeat() { self.stopHeartbeat(); },
      scheduleReconnect() { self.scheduleReconnect(); },
      openSocket(status) { self.openSocket(status); },
      sendHello() { self.sendHello(); },
      handleMessage(raw, socketGeneration) { self.handleMessage(raw, socketGeneration); },
      send(message) { return self.send(message); },
      sendRaw(message) { return self.sendRaw(message); },
      matchesActiveSocketSession(socketGeneration, roomId) { return self.matchesActiveSocketSession(socketGeneration, roomId); },
      matchesCurrentRoomRequestContext(pending) { return self.matchesCurrentRoomRequestContext(pending); },
      nextRequestId(prefix) { return self.nextRequestId(prefix); }
    };
  }

  private sendCommand(command: PlayerCommand): boolean {
    if (this.state.activeNamespace !== "legacy" || this.state.latestProjectionVersion === null) {
      this.handlers.onError("尚未收到牌桌状态，请稍后再试。");
      return false;
    }
    if (this.state.pendingCommand?.namespace === "legacy") {
      this.handlers.onError("上一条操作仍在确认中，请稍候。");
      return false;
    }
    return sendTrackedCommand(this.state, this.emit, command, "legacy", this.state.latestProjectionVersion,
      this.state.latestEventSeq ?? 0, null);
  }

  private sendTrackedRequest(message: ClientToServerMessage): string | null {
    return sendTrackedRequest(this.state, this.emit, message);
  }

  private nextRequestId(prefix: string): string {
    this.state.requestSeq += 1;
    return prefix + "-" + this.state.requestSeq;
  }

  private setStatus(status: GameClientStatus): void {
    this.state.status = status;
    this.status = status;
    this.handlers.onStatus(status);
  }

  private setHandshakeReady(ready: boolean): void {
    if (this.state.handshakeReady === ready) return;
    this.state.handshakeReady = ready;
    this.handlers.onHandshake(ready);
  }

  private applySession(session: StoredSession | null): void {
    applySession(this.state, this.emit, session);
  }

  private send(message: ClientToServerMessage): boolean {
    return send(this.state, this.emit, message);
  }

  private sendRaw(message: ClientToServerMessage): boolean {
    return sendRaw(this.state, this.emit, message);
  }

  private openSocket(status: GameClientStatus): void {
    openSocket(this.state, this.emit, status);
  }

  private sendHello(): void {
    sendHello(this.state, this.emit);
  }

  private handleMessage(raw: unknown, socketGeneration = this.state.socketGeneration): void {
    handleMessage(this.state, this.emit, raw, socketGeneration);
  }

  private startHeartbeat(): void {
    startHeartbeat(this.state, this.emit);
  }

  private stopHeartbeat(): void {
    stopHeartbeat(this.state);
  }

  private scheduleReconnect(): void {
    scheduleReconnect(this.state, this.emit);
  }

  private reconnectWithoutSession(): void {
    reconnectWithoutSession(this.state, this.emit);
  }

  private stopAfterSessionReplaced(): void {
    stopAfterSessionReplaced(this.state, this.emit);
  }

  private stopForProtocolMismatch(): void {
    stopForProtocolMismatch(this.state, this.emit);
  }

  private preparePendingCommandForRetry(): void {
    preparePendingCommandForRetry(this.state, this.emit);
  }

  private retryPendingCommand(force = false): void {
    retryPendingCommand(this.state, this.emit, force);
  }

  private clearPendingCommand(): void {
    clearPendingCommand(this.state, this.emit);
  }

  private clearPendingRequest(failed = true): void {
    clearPendingRequest(this.state, this.emit, failed);
  }

  private clearPendingChat(): void {
    clearPendingChat(this.state, this.emit);
  }

  private clearDuelProjection(): void {
    clearDuelProjection(this.state, this.emit);
  }

  private clearOwnerRoomWitness(): void {
    clearOwnerRoomWitness(this.state, this.emit);
  }

  private syncChat(): void {
    syncChat(this.state, this.emit);
  }

  private sendPendingChat(): boolean {
    return sendPendingChat(this.state, this.emit);
  }

  private acceptOwnerDeckConfirmation(
    parsed: OwnerDeckConfirmationMessage,
    socketGeneration: number
  ): void {
    acceptOwnerDeckConfirmation(this.state, this.emit, parsed, socketGeneration);
  }

  private refuseDuelSchemaDowngrade(): void {
    refuseDuelSchemaDowngrade(this.state, this.emit);
  }

  private matchesDuelContext(): boolean {
    return matchesDuelContext(this.state);
  }

  private matchesActiveSocketSession(socketGeneration: number, roomId: string): boolean {
    return matchesActiveSocketSession(this.state, socketGeneration, roomId);
  }

  private matchesCurrentRoomRequestContext(pending: PendingRoomRequest): boolean {
    return matchesCurrentRoomRequestContext(this.state, pending);
  }
}

export { readStoredSession, normalizeServerUrl };
