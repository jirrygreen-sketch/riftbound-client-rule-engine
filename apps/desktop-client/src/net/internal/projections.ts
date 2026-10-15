import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  DUEL_RULESET_ID,
  type DuelProjectionTransport
} from "@riftbound/protocol";
import { clearPendingCommand, matchesDuelContext } from "./commands";
import { matchesActiveSocketSession } from "./room-requests";
import type { GameClientEmit, GameClientState } from "./types";

export function clearDuelProjection(state: GameClientState, emit: GameClientEmit): void {
  state.duelProjection = null;
  state.duelProjectionContext = null;
  state.duelProjectionSocketGeneration = null;
  state.duelSchemaDowngradeLatched = false;
  state.duelMatchTransitionAllowed = false;
  state.retiredDuelMatchIds.clear();
  state.duelAcknowledgedClock = null;
  emit.handlers.onDuelProjection?.(null);
}

export function acceptDuelProjection(
  state: GameClientState,
  emit: GameClientEmit,
  roomId: string,
  projection: DuelProjectionTransport,
  socketGeneration: number
): void {
  const session = state.session;
  if (!matchesActiveSocketSession(state, socketGeneration, roomId) || !session ||
      (state.roomRulesetId !== null && state.roomRulesetId !== DUEL_RULESET_ID) ||
      (state.roomRoster !== null &&
        (state.roomRoster.size !== projection.match.roster.length ||
          !projection.match.roster.every(person => state.roomRoster!.has(person.playerId)))) ||
      (state.roomRulesetId === null && state.legacyProjectionSeen) ||
      (state.duelProjectionContext !== null && !matchesDuelContext(state)) ||
      projection.viewerPlayerId === null || projection.viewerPlayerId !== session.playerId ||
      !projection.match.roster.some(person => person.playerId === session.playerId)) return;

  const previous = state.duelProjection;
  const next = projection.match;
  if (previous && matchesDuelContext(state)) {
    const old = previous.match;
    if (old.matchId !== next.matchId) {
      // Only a confirmed room waiting transition can start a new match in
      // this same session; otherwise an old/different match must be ignored.
      if (!state.duelMatchTransitionAllowed || next.stateVersion !== 0 || next.eventSeq !== 0 ||
          next.stage !== "setup") return;
      if (state.retiredDuelMatchIds.has(next.matchId)) return;
      clearPendingCommand(state, emit);
    } else {
      // After a witnessed return to the lobby, an in-flight packet from the
      // ended match must not re-enable actions or consume the reset witness.
      if (state.duelMatchTransitionAllowed) return;
      // A frame whose clock trails the accepted one is stale, not a
      // contradiction: ignore it outright so an out-of-order/older-schema
      // packet can never freeze an operable V2 hand, drop its pending command
      // or request a resync. This must precede the schema gate below.
      if (next.stateVersion < old.stateVersion || next.eventSeq < old.eventSeq) return;
      if (previous.projectionSchema !== projection.projectionSchema &&
          (previous.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1 ||
           projection.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1)) {
        refuseDuelSchemaDowngrade(state, emit);
        return;
      }
      // The wire schema is monotonic within one match: a V2 frame must never
      // be replaced by a V1 frame — even at an equal clock — while a V1→V2
      // promotion at the same clock is allowed. V1/V2 shapes may diverge, so
      // an equal-or-newer-clock older-schema packet must not silently
      // overwrite the newer one.
      if (next.schemaVersion < old.schemaVersion) {
        refuseDuelSchemaDowngrade(state, emit);
        return;
      }
      if (next.stateVersion === old.stateVersion && next.eventSeq === old.eventSeq &&
          next.stage !== old.stage) return;
      // The observed setup->playing progression is monotonic within a match.
      if (old.stage === "playing" && next.stage === "setup") return;
    }
  }
  if (previous && previous.match.matchId !== next.matchId) {
    state.retiredDuelMatchIds.add(previous.match.matchId);
  }
  if (state.pendingCommand?.namespace === "legacy") clearPendingCommand(state, emit);
  if (state.duelMatchTransitionAllowed ||
      !waitsForDuelAcknowledgement(state, next.stateVersion, next.eventSeq)) {
    state.duelAcknowledgedClock = null;
  }
  if (state.activeNamespace !== "duel") {
    emit.handlers.onProjection(null);
    emit.handlers.onEvents?.([]);
    state.latestEventSeq = null;
  }
  state.activeNamespace = "duel";
  state.latestProjectionVersion = null;
  state.duelProjection = projection;
  state.duelProjectionContext = {
    roomId, playerId: session.playerId,
    resumeToken: session.resumeToken, serverUrl: session.serverUrl
  };
  state.duelProjectionSocketGeneration = socketGeneration;
  // An accepted frame restores operability (a fresh V2 after a refusal, or a
  // new match); the downgrade episode is over, so a later one may notify once.
  state.duelSchemaDowngradeLatched = false;
  state.duelMatchTransitionAllowed = false;
  emit.handlers.onDuelProjection?.(projection);
  emit.handlers.onRoom(roomId);
  emit.retryPendingCommand();
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
export function refuseDuelSchemaDowngrade(state: GameClientState, emit: GameClientEmit): void {
  state.duelProjectionSocketGeneration = null;
  clearPendingCommand(state, emit);
  if (state.duelSchemaDowngradeLatched) return;
  state.duelSchemaDowngradeLatched = true;
  emit.handlers.onError("服务端牌桌版本与当前画面不一致，已暂停操作并请求重新同步。");
  emit.syncEvents();
}

export function waitsForDuelAcknowledgement(state: GameClientState, version: number, eventSeq: number): boolean {
  const clock = state.duelAcknowledgedClock;
  return clock !== null && (version < clock.version || eventSeq < clock.eventSeq ||
    clock.requireNewer && (version === clock.version || eventSeq === clock.eventSeq));
}
