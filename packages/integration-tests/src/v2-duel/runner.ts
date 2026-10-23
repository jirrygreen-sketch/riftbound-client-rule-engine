import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGameServer, type GameServer } from "../../../../apps/game-server/src/server.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type {
  V2Command,
  V2CommandReceipt,
  V2Projection
} from "../../../protocol/src/v2/index.js";
import { botCommand, projectedPlayableCards } from "./bot.js";
import { V2_M1_PRECONS, type V2M1PreconId } from "./m1-precons.js";
import { auditProjectionPrivacy, type PrivacyAudit } from "./privacy.js";
import {
  V2WebSocketSession,
  V2CommandFailure,
  type V2WebSocketSessionSnapshot
} from "./ws-session.js";
import type {
  V2DuelCoverageAction,
  V2DuelRejection,
  V2DuelResult,
  V2DuelSummary
} from "./types.js";

export interface V2DuelRunOptions {
  readonly seed: string;
  readonly port?: number;
  readonly maxActions?: number;
  /** Per-command receipt budget. A timeout is retained as the game's blocked
   * observation instead of waiting through an unbounded server computation. */
  readonly actionTimeoutMs?: number;
  /** Stop before the first command whose acknowledgement exceeds this many
   * milliseconds; the incomplete attempt is retained as evidence. */
  readonly acknowledgementTimeoutMs?: number;
  readonly outputDirectory?: string;
  readonly firstPlayerPrecon?: V2M1PreconId;
  /** Which authenticated room creator is used; precon assignment never changes. */
  readonly creator?: "first" | "second";
  readonly totalTimeoutMs?: number;
}
function currentPhaseLabel(view: V2Projection): string {
  return `${view.phase}/${view.priority.window}`;
}

function blockedBeforeMatch(options: V2DuelRunOptions, started: number, reason: string): V2DuelResult {
  const playerId = "unassigned";
  const empty = Object.fromEntries([
    "play", "play-target", "rune-energy", "rune-power", "recycle", "move", "attack", "defense",
    "combat-damage", "choose-optional", "choose-mode", "choose-select-objects", "choose-order",
    "choose-number", "pass", "advance", "end-turn"
  ].map(key => [key, 0])) as Record<V2DuelCoverageAction, number>;
  return {
    seed: options.seed, firstPlayerId: playerId, firstPlayerSeat: options.creator === "second" ? "player-2" : "player-1",
    turnCount: 0, score: {}, winnerPlayerId: null, termination: "blocked", blockedReason: reason,
    rejectedCommands: {}, rejectionReasons: {}, judgeRequiredOccurrences: {}, judgeRequiredCards: [],
    judgeRequiredProjectionExposure: [], privacy: { passed: true, checkedProjections: 1, violations: [] },
    commandCount: 0, coverage: empty, trace: [],
    elapsedMs: Math.round(performance.now() - started),
    sides: [
      { playerId: "player-1", precon: options.firstPlayerPrecon ?? "rumble-sfd",
        rejectedCommandCount: 0, firstRejections: [] },
      { playerId: "player-2", precon: "fiora-sfd", rejectedCommandCount: 0, firstRejections: [] }
    ]
  };
}

interface RuntimePair {
  readonly first: V2WebSocketSession;
  readonly second: V2WebSocketSession;
  readonly firstPrecon: V2M1PreconId;
  readonly secondPrecon: V2M1PreconId;
  readonly firstView: V2Projection;
  readonly secondView: V2Projection;
  readonly receivedProjections: readonly V2Projection[];
}

function judgeRequiredCards(): ReadonlyMap<string, string> {
  return new Map([...cardProgramsById.entries()].flatMap(([id, program]) =>
    (program as unknown as CardProgram).status === "judge-required"
      ? [[id, id] as const]
      : []));
}

function cardNameFor(view: V2Projection, command: V2Command | null): string | null {
  if (!command) return null;
  const id = command.type === "play" ? command.cardObjectId
    : command.type === "activate" ? command.sourceObjectId
      : command.type === "rune-energy" || command.type === "rune-power" ? command.runeObjectId
        : command.type === "move" ? command.objectId : null;
  if (id === null) return null;
  return view.objects.find(object => object.objectId === id)?.name ?? null;
}

function snapshotView(sessions: readonly V2WebSocketSession[]): readonly [V2Projection, V2Projection] {
  const [first, second] = sessions;
  if (!first || !second) throw new Error("Two V2 clients are required");
  const firstView = first.snapshot.projection;
  const secondView = second.snapshot.projection;
  if (!firstView || !secondView) throw new Error("Both V2 clients must have a projection");
  return [firstView, secondView] as const;
}

async function startPair(
  url: string,
  seed: string,
  firstPrecon: V2M1PreconId,
  secondPrecon: V2M1PreconId,
  creator: "first" | "second",
  tracked: V2WebSocketSession[]
): Promise<RuntimePair> {
  const projections: V2Projection[] = [];
  const first = await V2WebSocketSession.connect(url, `${seed}-first`,
    projection => projections.push(projection));
  const second = await V2WebSocketSession.connect(url, `${seed}-second`,
    projection => projections.push(projection));
  tracked.push(first, second);
  const creatorSession = creator === "first" ? first : second;
  const joiner = creator === "first" ? second : first;
  const creatorPrecon = creator === "first" ? firstPrecon : secondPrecon;
  const joinerPrecon = creator === "first" ? secondPrecon : firstPrecon;
  await creatorSession.createRoom(`${creatorPrecon}-client`);
  const roomId = creatorSession.snapshot.session.roomId;
  await joiner.joinRoom(roomId, `${joinerPrecon}-client`);
  await first.submitDeck(V2_M1_PRECONS[firstPrecon].deck);
  await second.submitDeck(V2_M1_PRECONS[secondPrecon].deck);
  await first.setReady();
  await second.setReady();
  const views = await Promise.all([
    first.waitForProjection(() => true, "first started projection"),
    second.waitForProjection(() => true, "second started projection")
  ]) as readonly [V2Projection, V2Projection];
  return { first, second, firstPrecon, secondPrecon, firstView: views[0], secondView: views[1],
    receivedProjections: projections };
}

function chooseSession(
  pair: RuntimePair,
  playerId: string
): { readonly session: V2WebSocketSession; readonly view: V2Projection } {
  const firstPlayerId = pair.first.snapshot.session.playerId;
  return playerId === firstPlayerId
    ? { session: pair.first, view: pair.first.snapshot.projection ?? pair.firstView }
    : { session: pair.second, view: pair.second.snapshot.projection ?? pair.secondView };
}

function rejection(
  view: V2Projection,
  playerId: string,
  receipt: V2CommandReceipt,
  command: V2Command
): V2DuelRejection {
  return {
    playerId, commandId: receipt.commandId, commandType: command.type,
    code: "command-rejected", reason: receipt.rejection ?? "Command rejected",
    phase: view.phase, turnNumber: view.turnNumber, cardName: cardNameFor(view, command)
  };
}

function serializeRejection(value: V2DuelRejection): string {
  return JSON.stringify([value.phase, value.reason, value.cardName, value.commandType]);
}

function debugProgress(seed: string, value: Readonly<Record<string, unknown>>): void {
  if (process.env.V2_DUEL_DEBUG === "1") console.error(JSON.stringify({ seed, ...value }));
}

async function persistNdjson(
  directory: string,
  result: V2DuelResult
): Promise<void> {
  await mkdir(directory, { recursive: true });
  // Keep command/projection summaries and bounded rejection evidence in the
  // durable per-game record. Full WebSocket traffic remains available on the
  // returned object for a caller that explicitly wants to inspect it; embedding
  // it in every 100-game NDJSON run would make the aggregate tens of GB.
  const record = { ...result, protocolTrace: [] };
  await writeFile(path.join(directory, `${result.seed}.ndjson`), `${JSON.stringify(record)}\n`);
  await writeFile(path.join(directory, "results.ndjson"), `${JSON.stringify(record)}\n`, { flag: "a" });
}

async function stopWithin(server: GameServer, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([server.stop(), new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`server stop timed out after ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runV2Duel(options: V2DuelRunOptions): Promise<V2DuelResult> {
  return runV2DuelInternal(options, Date.now() + (options.totalTimeoutMs ?? 120_000));
}

async function runV2DuelInternal(options: V2DuelRunOptions, deadline: number): Promise<V2DuelResult> {
  const started = performance.now();
  const port = options.port ?? 0;
  const server: GameServer = createGameServer({
    host: "127.0.0.1",
    port,
    roomIdFactory: () => options.seed
  });
  const sessions: V2WebSocketSession[] = [];
  let cleanupError: unknown;
  try {
    await server.start();
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Game server did not expose a TCP port");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const pair = await Promise.race([
      startPair(url, options.seed, options.firstPlayerPrecon ?? "rumble-sfd",
        "fiora-sfd", options.creator ?? "first", sessions),
      new Promise<null>(resolve => setTimeout(() => resolve(null),
        Math.max(1, deadline - Date.now())))
    ]);
    // Both snapshots were populated by projection callbacks before startPair
    // completed; no second projection is expected for a waiting room.
    if (pair === null) {
      const blocked = blockedBeforeMatch(options, started, "startup timed out before both private projections arrived");
      if (options.outputDirectory) await persistNdjson(options.outputDirectory, blocked);
      return blocked;
    }
    const playerIds = [pair.first.snapshot.session.playerId, pair.second.snapshot.session.playerId] as const;
    const firstPlayerId = pair.firstView.activePlayerId;
    let privacy: PrivacyAudit = { checkedProjections: 0, violations: [] };
    const judgeCards = judgeRequiredCards();
    const judgeRequiredIds = new Set(judgeCards.keys());
    const judgeExposedByPlayer = new Map(playerIds.map(playerId => [playerId, new Set<string>()]));
    const observeProjection = (projection: V2Projection): void => {
      const viewer = projection.viewerPlayerId;
      if (viewer !== playerIds[0] && viewer !== playerIds[1]) return;
      const opponent = viewer === playerIds[0] ? playerIds[1] : playerIds[0];
      privacy = auditProjectionPrivacy(projection, opponent, privacy);
      for (const cardId of projectedPlayableCards(projection, viewer)) {
        if (judgeRequiredIds.has(cardId)) judgeExposedByPlayer.get(viewer)!.add(cardId);
      }
    };
    for (const projection of pair.receivedProjections) observeProjection(projection);
    let views: readonly [V2Projection, V2Projection] = [pair.firstView, pair.secondView];
    const rejected: V2DuelRejection[] = [];
    const trace: Array<V2DuelResult["trace"][number]> = [];
    const coverage = Object.fromEntries([
      "play", "play-target", "rune-energy", "rune-power", "recycle",
      "move", "attack", "defense", "combat-damage", "choose-optional",
      "choose-mode", "choose-select-objects", "choose-order", "choose-number",
      "pass", "advance", "end-turn"
    ].map(action => [action, 0])) as Record<V2DuelCoverageAction, number>;
    const rejectionCounts: Record<string, number> = { [playerIds[0]]: 0, [playerIds[1]]: 0 };
    let actionCount = 0;
    const acknowledgementDeadline = options.acknowledgementTimeoutMs === undefined
      ? null : performance.now() + Math.max(1, options.acknowledgementTimeoutMs);
    let repeatSignature: string | null = null;
    let repeated = 0;
    let lastAcceptedSignature: string | null = null;
    let repeatedAccepted = 0;
    let blockedReason: string | null = null;
    let termination: V2DuelResult["termination"] = "guard";
    const maxActions = options.maxActions ?? 500;
    let terminalView = pair.first.snapshot.projection ?? views[0];
    const rejectedPlays = new Map<string, Set<string>>();
    const cardFacts = new Map(Object.values(V2_M1_PRECONS).flatMap(precon => precon.cards.map(card => {
      const abilities = cardProgramsById.get(card.canonicalCardId)?.abilities ?? [];
      return [card.canonicalCardId, {
        energy: card.energy ?? null,
        power: card.power ?? null,
        kind: card.cardType.toLowerCase() === "unit" ? "unit" :
          card.cardType.toLowerCase() === "gear" ? "gear" : "spell",
        hasComplexAbility: [...abilities].some(ability =>
          ability.kind === "triggered" ||
          (ability.kind === "static" && JSON.stringify(ability).includes("continuous.grant-keyword")))
      }] as const;
    })));
    while (actionCount < maxActions) {
      const live = snapshotView([pair.first, pair.second]);
      // A command receipt is authoritative even if the subsequent projection
      // broadcast is delayed. Advance only after both viewers report the same
      // acknowledged state so neither client acts on a partial frame.
      views = live;
      const current = live[0];
      if (Date.now() >= deadline) {
        blockedReason = `total runner deadline reached during ${currentPhaseLabel(current)} at state ${current.stateVersion}`;
        terminalView = current;
        break;
      }
      if (live[0].winnerPlayerId !== null || live[1].winnerPlayerId !== null) {
        termination = "winner";
        terminalView = live[0].winnerPlayerId !== null ? live[0] : live[1];
        break;
      }
      if (live[0].stateVersion !== live[1].stateVersion ||
          live[0].eventSeq !== live[1].eventSeq) {
        await Promise.all([
          pair.first.waitForProjection(value => value.stateVersion >= Math.max(live[0].stateVersion, live[1].stateVersion),
            `${options.seed} viewer convergence (first)`),
          pair.second.waitForProjection(value => value.stateVersion >= Math.max(live[0].stateVersion, live[1].stateVersion),
            `${options.seed} viewer convergence (second)`)
        ]);
        continue;
      }
      observeProjection(live[0]);
      observeProjection(live[1]);
      const actor = pickActor(
        current.activePlayerId === playerIds[1] ? [live[1], live[0]] : [live[0], live[1]],
        playerIds
      );
      if (actor === null) {
        blockedReason = `no actor exposed at ${current.phase}/${current.priority.window}, state ${current.stateVersion}`;
        break;
      }
      const selected = chooseSession(pair, actor);
      const commandId = nextCommandId(options.seed, playerIds.indexOf(actor), actionCount);
      const rejectedForActor = rejectedPlays.get(actor) ?? new Set<string>();
      const authoritativeView = playerIds.indexOf(actor) === 0 ? live[0] : live[1];
      const command = botCommand(authoritativeView, actor, commandId, rejectedForActor, cardFacts);
      const choiceDebug = authoritativeView.pendingChoice.status === "pending" ? {
        owner: authoritativeView.pendingChoice.ownerPlayerId,
        kind: authoritativeView.pendingChoice.kind,
        options: authoritativeView.pendingChoice.options?.map(option => ({
          id: option.id,
          value: option.value,
          objectId: option.objectRef?.objectId,
          zoneEntryId: option.objectRef?.zoneEntryId
        })) ?? null,
        min: authoritativeView.pendingChoice.min,
        max: authoritativeView.pendingChoice.max
      } : null;
      debugProgress(options.seed, { action: actionCount, viewer: authoritativeView.viewerPlayerId,
        stateVersion: current.stateVersion,
        phase: current.phase, turn: current.turnNumber, actor, command: command?.type ?? null,
        cardName: cardNameFor(authoritativeView, command),
        chain: { phase: authoritativeView.chain.phase, priority: authoritativeView.chain.priorityPlayerId },
        choice: choiceDebug });
      if (command === null) {
        const choice = current.pendingChoice;
        blockedReason = choice.status === "pending"
          ? `pending ${choice.kind} choice ${choice.choiceId} has no projected answer candidate for ${choice.ownerPlayerId} at ${current.phase}, state ${current.stateVersion}`
          : `no legal projected command at ${current.phase}, state ${current.stateVersion}, priority ${String(current.priority.playerId)}, active ${current.activePlayerId}`;
        break;
      }
      if (selected.session.socketReadyState !== 1) {
        blockedReason = `websocket-not-open for ${command.type} at ${current.phase}: state ${selected.session.socketReadyState}`;
        break;
      }
      actionCount += 1;
      let receipt: V2CommandReceipt;
      try {
        const remaining = acknowledgementDeadline === null ? undefined :
          Math.floor(acknowledgementDeadline - performance.now());
        if (remaining !== undefined && remaining <= 0) {
          blockedReason = `observation window exhausted before ${command.type} acknowledgement at state ${current.stateVersion}`;
          actionCount -= 1;
          break;
        }
        receipt = await selected.session.sendCommandWithin(command,
          remaining === undefined ? options.actionTimeoutMs ?? 12_000 : Math.max(1, Math.min(options.actionTimeoutMs ?? 12_000, remaining)));
      } catch (error) {
        if (error instanceof V2CommandFailure) {
          const failedView = selected.session.snapshot.projection ?? selected.view;
          const item: V2DuelRejection = {
            playerId: actor, commandId, commandType: command.type,
            code: error.code, reason: error.message, phase: current.phase,
            turnNumber: current.turnNumber, cardName: cardNameFor(selected.view, command)
          };
          rejected.push(item);
          rejectionCounts[actor] = (rejectionCounts[actor] ?? 0) + 1;
          if (command.type === "play") {
            const blocked = rejectedPlays.get(actor) ?? new Set<string>();
            blocked.add(command.cardObjectId);
            rejectedPlays.set(actor, blocked);
          }
          trace.push({ index: actionCount, playerId: actor, type: command.type,
            accepted: false, stateVersion: failedView.stateVersion, phase: current.phase,
            cardName: item.cardName, code: item.code, rejection: item.reason });
          const signature = serializeRejection(item);
          if (repeatSignature === signature) repeated += 1;
          else { repeatSignature = signature; repeated = 1; }
          if (repeated >= 2) {
            blockedReason = `repeated ${item.code} during ${item.phase}: ${item.reason}` +
              (item.cardName === null ? "" : ` (${item.cardName})`);
            break;
          }
          await Promise.all([
            pair.first.syncProjection().catch(() => undefined),
            pair.second.syncProjection().catch(() => undefined)
          ]);
          continue;
        }
        const queued = pair.first.trace().slice(-4).map(packet => packet.type);
        blockedReason = JSON.stringify({ kind: error instanceof Error && error.message.includes("timed out")
          ? "acknowledgement-timeout" : "command-transport-error", command: command.type,
          commandId, cardName: cardNameFor(selected.view, command),
          phase: current.phase, window: selected.view.priority.window,
          priority: selected.view.priority.playerId, stateVersion: current.stateVersion,
          recentPackets: queued, error: error instanceof Error ? error.message : String(error) });
        break;
      }
      trace.push({ index: actionCount, playerId: actor, type: command.type,
        accepted: receipt.accepted, stateVersion: receipt.stateVersion, phase: current.phase,
        cardName: cardNameFor(selected.view, command),
        ...(receipt.accepted ? {} : { rejection: receipt.rejection ?? "Command rejected" }) });
      debugProgress(options.seed, { action: actionCount, receipt: receipt.accepted ? "accepted" : "rejected",
        stateVersion: receipt.stateVersion, command: command.type, rejection: receipt.rejection });
      if (receipt.accepted) {
        if (command.type !== "mulligan" && command.type !== "concede" && command.type !== "choose" &&
            command.type !== "activate" && command.type !== "declare-attack" && command.type !== "declare-defense") {
          coverage[command.type] += 1;
        }
        if (command.type === "play" && (command.targets?.length ?? 0) > 0) coverage["play-target"] += 1;
        if (command.type === "choose") coverage[`choose-${pendingKind(selected.view)}` as V2DuelCoverageAction] += 1;
        if (command.type === "move") {
          const object = selected.view.objects.find(value => value.objectId === command.objectId);
          const destination = command.to.zone === "battlefield" ? command.to.locationId : null;
          const field = selected.view.battlefields.find(value => value.battlefieldId === destination);
          if (field && object && field.controllerPlayerId !== object.ownerPlayerId) coverage.attack += 1;
        }
        if (command.type === "combat-damage") coverage.defense += 1;
      }
      if (!receipt.accepted) {
        rejectionCounts[actor] = (rejectionCounts[actor] ?? 0) + 1;
        const item = rejection(selected.view, actor, receipt, command);
        rejected.push(item);
        const signature = serializeRejection(item);
        if (repeatSignature === signature) repeated += 1;
        else { repeatSignature = signature; repeated = 1; }
        if (repeated >= 2) {
          blockedReason = `repeated ${item.code} during ${item.phase}: ${item.reason}${item.cardName === null ? "" : ` (${item.cardName})`}`;
          break;
        }
        await Promise.all([
          pair.first.syncProjection(),
          pair.second.syncProjection()
        ]);
        views = snapshotView([pair.first, pair.second]);
        terminalView = views[0];
        continue;
      } else {
        repeatSignature = null;
        repeated = 0;
      }
      const next = await Promise.all([
        pair.first.waitForProjectionAfter(command.commandId, receipt),
        pair.second.waitForProjectionAfter(command.commandId, receipt)
      ]) as readonly [V2Projection, V2Projection];
      if (receipt.accepted) {
        const waitingForChoice = next[0].pendingChoice.status === "pending" &&
          next[1].pendingChoice.status === "pending";
        if (waitingForChoice) {
          // A pending receipt is accepted by the protocol but intentionally
          // keeps stateVersion stable until its owner answers the projected
          // choice. The next loop must be allowed to submit that choose command.
          lastAcceptedSignature = null;
          repeatedAccepted = 0;
        } else {
          const signature = JSON.stringify([receipt.stateVersion, next[0].stateVersion,
            command.type, cardNameFor(selected.view, command)]);
          if (signature === lastAcceptedSignature) repeatedAccepted += 1;
          else { lastAcceptedSignature = signature; repeatedAccepted = 1; }
          if (repeatedAccepted >= 2) {
            blockedReason = `accepted command did not advance authoritative state: ${command.type}` +
              (cardNameFor(selected.view, command) === null ? "" : ` (${cardNameFor(selected.view, command)})`) +
              ` at state ${receipt.stateVersion}`;
            terminalView = next[0];
            break;
          }
        }
      } else {
        lastAcceptedSignature = null;
        repeatedAccepted = 0;
      }
      if (command.type === "play" && next[0].stateVersion === current.stateVersion &&
          next[0].eventSeq === current.eventSeq) {
        const blocked = rejectedPlays.get(actor) ?? new Set<string>();
        blocked.add(command.cardObjectId);
        rejectedPlays.set(actor, blocked);
      }
      views = next;
      terminalView = next[0];
      observeProjection(next[0]);
      observeProjection(next[1]);
    }
    if (termination !== "winner") {
      if (blockedReason === null) blockedReason = `action guard ${maxActions} exhausted at state ${terminalView.stateVersion}`;
      termination = "blocked";
    }
    if (termination === "winner" && terminalView.winnerPlayerId === null) {
      blockedReason = `match protocol reached ended without winnerPlayerId at state ${terminalView.stateVersion}`;
      termination = "blocked";
    }
    const scores = Object.fromEntries(terminalView.players.map(player => [player.playerId, player.score]));
    const judgeOccurrences = Object.fromEntries(playerIds.map(playerId => {
      const cards = V2_M1_PRECONS[playerId === playerIds[0] ? pair.firstPrecon : pair.secondPrecon].cards;
      return [playerId, cards.filter(card => judgeCards.has(card.canonicalCardId)).length];
    }));
    const judgeRequiredProjectionExposure = playerIds.map(playerId =>
      ({ playerId, cardIds: [...judgeExposedByPlayer.get(playerId)!] })) as
      V2DuelResult["judgeRequiredProjectionExposure"];
    const result: V2DuelResult = {
      seed: options.seed,
      firstPlayerId,
      firstPlayerSeat: firstPlayerId === playerIds[0] ? "player-1" : "player-2",
      turnCount: terminalView.turnNumber,
      score: scores,
      winnerPlayerId: terminalView.winnerPlayerId,
      termination,
      blockedReason,
      ...(process.env.V2_DUEL_DEBUG === "1" ? {
        protocolTrace: [
          { playerId: playerIds[0], packets: pair.first.trace() },
          { playerId: playerIds[1], packets: pair.second.trace() }
        ]
      } : {}),
      rejectedCommands: rejectionCounts,
      rejectionReasons: Object.fromEntries(playerIds.map(playerId => [playerId,
        rejected.filter(item => item.playerId === playerId).slice(0, 5)])),
      judgeRequiredOccurrences: judgeOccurrences,
      judgeRequiredCards: [...new Set(V2_M1_PRECONS[pair.firstPrecon].cards.concat(V2_M1_PRECONS[pair.secondPrecon].cards)
        .filter(card => judgeCards.has(card.canonicalCardId)).map(card => card.name))],
      judgeRequiredProjectionExposure,
      privacy: { passed: privacy.violations.length === 0,
        checkedProjections: privacy.checkedProjections, violations: privacy.violations },
      commandCount: actionCount,
      coverage,
      trace,
      elapsedMs: Math.round(performance.now() - started),
      sides: [
        { playerId: playerIds[0], precon: pair.firstPrecon,
          rejectedCommandCount: rejectionCounts[playerIds[0]] ?? 0,
          firstRejections: rejected.filter(item => item.playerId === playerIds[0]).slice(0, 5) },
        { playerId: playerIds[1], precon: pair.secondPrecon,
          rejectedCommandCount: rejectionCounts[playerIds[1]] ?? 0,
          firstRejections: rejected.filter(item => item.playerId === playerIds[1]).slice(0, 5) }
      ]
    };
    if (options.outputDirectory) await persistNdjson(options.outputDirectory, result);
    return result;
  } finally {
    for (const session of sessions) session.closeImmediately();
    try {
      await stopWithin(server, 5_000);
    } catch (error) { cleanupError ??= error; }
    if (cleanupError !== undefined) throw cleanupError;
  }
}

function pendingKind(view: V2Projection): string {
  return view.pendingChoice.status === "pending" ? view.pendingChoice.kind : "optional";
}

function nextCommandId(seed: string, seat: number, actionCount: number): string {
  // Command ids must remain unique across process restarts because a fixed
  // room seed carries the authoritative idempotency history. The public wire
  // still identifies the human-readable seed/seat/action tuple.
  return `v2-${seed}-${seat}-${actionCount}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickActor(
  views: readonly [V2Projection, V2Projection],
  playerIds: readonly [string, string]
): string | null {
  const readable = views.find(view => view.pendingChoice.status === "pending") ??
    views.find(view => view.priority.playerId !== null) ?? views[0];
  const pending = readable.pendingChoice;
  if (pending.status === "pending") return pending.ownerPlayerId;
  if (readable.combat.status === "active") {
    if (readable.combat.step === "damage" && readable.combat.damage) return readable.combat.damage.expectedPlayerId;
    if (readable.priority.playerId !== null) return readable.priority.playerId;
  }
  if (readable.priority.playerId !== null) return readable.priority.playerId;
  if (readable.actionOptions.canAdvance) return readable.activePlayerId;
  if (readable.actionOptions.canEndTurn) return readable.activePlayerId;
  // A waiting Main Phase can have no current Priority until the first
  // discretionary command. The projected Turn Player remains the actor who
  // can open that work through a legal play, move, or end-turn.
  if (readable.phase === "main" && readable.chain.items.length === 0 && readable.combat.status === "none") {
    return readable.activePlayerId;
  }
  return readable.priority.playerId;
}

export async function runV2DuelBatch(options: {
  readonly games: number;
  readonly seeds?: readonly string[];
  readonly maxActions?: number;
  readonly outputDirectory?: string;
}): Promise<V2DuelSummary> {
  const seeds = options.seeds ?? Array.from({ length: options.games }, (_, index) => `RIFT-955-batch-${index}`);
  const results: V2DuelResult[] = [];
  const portBase = Number(process.env.SWARM_PORT_BASE ?? "31800");
  const portSpan = Number(process.env.SWARM_PORT_SPAN ?? "20");
  if (!Number.isSafeInteger(portBase) || portBase < 1 || portBase > 65_535 ||
      !Number.isSafeInteger(portSpan) || portSpan < 1 || portBase + portSpan - 1 > 65_535) {
    throw new RangeError("SWARM_PORT_BASE/SWARM_PORT_SPAN must describe valid TCP ports");
  }
  for (const [index, seed] of seeds.slice(0, options.games).entries()) {
    results.push(await runV2Duel({
      seed,
      port: portBase + (index % portSpan),
      creator: index % 2 === 0 ? "first" : "second",
      maxActions: options.maxActions,
      outputDirectory: options.outputDirectory
    }));
  }
  const winners = results.filter(result => result.termination === "winner").length;
  const blocked = results.filter(result => result.termination === "blocked").length;
  const guards = results.filter(result => result.termination === "guard").length;
  const firstPlayerWins = results.filter(result => result.winnerPlayerId !== null &&
    result.winnerPlayerId === result.firstPlayerId).length;
  const winsBySeat: Record<string, number> = {};
  for (const result of results) if (result.winnerPlayerId) winsBySeat[result.firstPlayerSeat] =
    (winsBySeat[result.firstPlayerSeat] ?? 0) + 1;
  const blockerDistribution: Record<string, number> = {};
  for (const result of results) if (result.blockedReason) {
    const key = result.blockedReason.split(" at state")[0]!.split(" during ")[0]!;
    blockerDistribution[key] = (blockerDistribution[key] ?? 0) + 1;
  }
  return {
    games: results.length, winners, blocked, guards,
    winnerRatio: results.length === 0 ? 0 : winners / results.length,
    winsBySeat,
    firstPlayerWins,
    firstPlayerWinRatio: winners === 0 ? 0 : firstPlayerWins / winners,
    averageTurns: results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.turnCount, 0) / results.length,
    blockerDistribution, results
  };
}
