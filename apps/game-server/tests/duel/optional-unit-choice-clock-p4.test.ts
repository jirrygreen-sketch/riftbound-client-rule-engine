import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelWireCommandV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK } from "../../src/duel/command-journal-p4.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

type Profile = typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT | typeof DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK;

async function fixture(profile: Profile) {
  const catalog = await loadCardCatalogRuntime();
  for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
  let uid = 0;
  const options = { catalog, runtimeProfile: profile, matchId: `optional-choice-clock-${profile}`,
    randomIndex: () => 0, uidFactory: () => `optional-choice-clock-${++uid}`,
    roster: [{ playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
      { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b }] as const };
  return { options, recorded: createDuelRecordedRuntimeP4(options, profile) };
}

function send(recorded: ReturnType<typeof createDuelRecordedRuntimeP4>, actor: string,
  command: DuelWireCommandV3Actions1["command"], commandId: string) {
  const projection = recorded.runtime.project(actor);
  const packet = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: commandId, commandId, expectedVersion: projection.match.stateVersion, command };
  return { packet, result: recorded.runtime.dispatch(actor, packet) };
}

function playing(recorded: ReturnType<typeof createDuelRecordedRuntimeP4>, actor: string | null = "alice") {
  const projection = recorded.runtime.project(actor);
  if (projection.match.stage !== "playing") throw new Error("playing state required");
  return projection as typeof projection & { match: Extract<typeof projection.match, { stage: "playing" }> };
}

function prepare(recorded: ReturnType<typeof createDuelRecordedRuntimeP4>) {
  for (let i = 0; i < 2; i++) {
    const view = recorded.runtime.project(null);
    if (view.match.stage !== "setup") throw new Error("setup state required");
    const actor = view.match.setup.currentMulliganOwner!;
    expect(send(recorded, actor, { type: "mulligan", selectedUIDs: [] }, `mulligan-${i}`).result.ack.ok).toBe(true);
  }
  for (let i = 0; i < 2; i++) {
    const actor = playing(recorded, null).match.frame.turnPlayerId;
    const action = playing(recorded, actor).actions.find(value => value.kind === "end-turn" && value.enabled);
    if (!action || action.kind !== "end-turn") throw new Error("enabled End required");
    expect(send(recorded, actor, { type: "end-turn", windowId: action.windowId }, `end-${i}`).result.ack.ok).toBe(true);
  }
}

describe("optional Unit canonical choice clock P4", () => {
  it.skip("keeps historical schema 6 choice opening on the old clock [legacy-replay-e2cbcdf]", async () => {
    const { recorded } = await fixture(DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT);
    prepare(recorded);
    const target = playing(recorded).match.players.find(player => player.playerId === "alice")!.hand!
      .find(card => card.cardId === "ogn-010-298");
    if (!target) throw new Error("Accelerate Unit required");
    const action = playing(recorded).actions.find(value => value.kind === "play-card" && value.cardUID === target.uid && value.enabled);
    if (!action || action.kind !== "play-card") throw new Error("enabled optional Unit action required");
    const before = playing(recorded).match.stateVersion;
    expect(send(recorded, "alice", { type: "play-card", cardUID: target.uid, windowId: action.windowId }, "old-play").result.ack.ok).toBe(true);
    expect(playing(recorded).match.stateVersion).toBe(before);
    expect(recorded.archive().schemaVersion).toBe(6);
  // The full replay trace has exceeded 90s and 140s+ under shared-runner
  // load; keep every assertion and give the runner clock the same headroom
  // as the 300s P4 command-flow tests.
  }, 300_000);

  it.each(["pay", "decline"] as const)("advances one canonical clock and preserves %s through replay", async decision => {
    const { options, recorded: initial } = await fixture(DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK);
    let recorded = initial;
    prepare(recorded);
    const target = playing(recorded).match.players.find(player => player.playerId === "alice")!.hand!
      .find(card => card.cardId === "ogn-010-298");
    if (!target) throw new Error("Accelerate Unit required");
    const action = playing(recorded).actions.find(value => value.kind === "play-card" && value.cardUID === target.uid && value.enabled);
    if (!action || action.kind !== "play-card") throw new Error("enabled optional Unit action required");
    const before = playing(recorded).match.stateVersion;
    const beforeCarriers = JSON.stringify({ board: playing(recorded).match.board,
      resources: playing(recorded).match.resources, players: playing(recorded).match.players,
      scoring: playing(recorded).match.scoring, unitMeta: playing(recorded).match.unitMeta });
    const wrongActorPacket = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "wrong-actor", commandId: "wrong-actor", expectedVersion: before,
      command: { type: "play-card" as const, cardUID: target.uid, windowId: action.windowId } };
    expect(recorded.runtime.dispatch("bob", wrongActorPacket).ack.type).toBe("error");
    expect(playing(recorded).match.stateVersion).toBe(before);
    const wrongWindow = send(recorded, "alice", { type: "play-card", cardUID: target.uid, windowId: `${action.windowId}:stale` }, "wrong-window");
    expect(wrongWindow.result.ack.type).toBe("error");
    expect(playing(recorded).match.stateVersion).toBe(before);
    const stalePacket = { ...wrongActorPacket, requestId: "stale-version", commandId: "stale-version", expectedVersion: before - 1,
      command: { ...wrongActorPacket.command, windowId: action.windowId } };
    expect(recorded.runtime.dispatch("alice", stalePacket).ack.type).toBe("error");
    expect(playing(recorded).match.stateVersion).toBe(before);
    const opened = send(recorded, "alice", { type: "play-card", cardUID: target.uid, windowId: action.windowId }, "new-play");
    expect(opened.result.ack, JSON.stringify(opened.result.ack)).toMatchObject({ ok: true });
    expect(playing(recorded).match.stateVersion).toBe(before + 1);
    expect(playing(recorded).match.eventSeq).toBe(before + 1);
    expect(JSON.stringify({ board: playing(recorded).match.board,
      resources: playing(recorded).match.resources, players: playing(recorded).match.players,
      scoring: playing(recorded).match.scoring, unitMeta: playing(recorded).match.unitMeta })).toBe(beforeCarriers);
    expect(playing(recorded).match.board.units).toHaveLength(0);
    expect(playing(recorded, "bob").match.frame.pendingChoice).toEqual({ active: true });
    const duplicate = recorded.runtime.dispatch("alice", opened.packet);
    expect(duplicate.ack).toMatchObject({ ok: true, duplicate: true });
    expect(playing(recorded).match.stateVersion).toBe(before + 1);
    expect(recorded.archive().schemaVersion).toBe(7);
    const pendingArchive = recorded.archive();
    const pendingReplay = replayDuelCommandArchiveP4(pendingArchive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(pendingArchive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK));
    expect(() => replayDuelCommandArchiveP4(pendingArchive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(pendingArchive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT)))
      .toThrow(/profile mismatch/);
    for (const viewer of ["alice", "bob", null]) expect(pendingReplay.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
    const choice = playing(recorded).match.frame.pendingChoice;
    if (!choice || !("kind" in choice) || choice.kind !== "play-choices") throw new Error("choice required");
    const prompt = choice.prompts[0]!;
    const option = prompt.options.find(value => value.label === (decision === "pay" ? "支付额外费用" : "不支付额外费用"));
    if (!option) throw new Error("requested optional choice required");
    const answered = send(recorded, "alice", { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: [option.id] }] }, `answer-${decision}`);
    expect(answered.result.ack.ok).toBe(true);
    const payment = playing(recorded).match.frame.pendingPayment;
    if (!payment || !payment.paymentId || !payment.resolvedCost) throw new Error("canonical pending payment required");
    const midArchive = recorded.archive();
    const midReplay = replayDuelCommandArchiveP4(midArchive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(midArchive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK));
    for (const viewer of ["alice", "bob", null]) expect(midReplay.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
    for (let index = 0; index < payment.resolvedCost.energy; index++) {
      const rune = playing(recorded).actions.find(value => value.kind === "rune-energy" && value.enabled);
      if (!rune || rune.kind !== "rune-energy") throw new Error("funding Rune required");
      expect(send(recorded, "alice", { type: "rune-energy", uid: rune.uid }, `energy-${decision}-${index}`).result.ack.ok).toBe(true);
    }
    if (decision === "pay") {
      const runes = playing(recorded).match.resources.bases.find(base => base.playerId === "alice")!.baseRunes;
      const power = playing(recorded).actions.find(value => value.kind === "rune-power" && value.enabled &&
        runes.some(rune => rune.uid === value.uid && rune.domain === "Fury"));
      if (!power || power.kind !== "rune-power") throw new Error("Fury funding Rune required");
      expect(send(recorded, "alice", { type: "rune-power", uid: power.uid }, `power-${decision}`).result.ack.ok).toBe(true);
    }
    const pay = playing(recorded).actions.find(value => value.kind === "pay-pending" && value.enabled);
    if (!pay || pay.kind !== "pay-pending") throw new Error("Pay action required");
    expect(send(recorded, "alice", { type: "pay-pending", paymentId: pay.paymentId }, `pay-${decision}`).result.ack.ok).toBe(true);
    expect(playing(recorded).match.frame.pendingChoice).toBeNull();
    expect(playing(recorded).match.frame.pendingPayment).toBeNull();
    expect(playing(recorded).match.board.units).toHaveLength(1);
    const finalArchive = recorded.archive();
    const finalReplay = replayDuelCommandArchiveP4(finalArchive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(finalArchive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK));
    for (const viewer of ["alice", "bob", null]) expect(finalReplay.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
  }, 300_000);
});
