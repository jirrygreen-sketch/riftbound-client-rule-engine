import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelWireCommandV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4,
  digestDuelCommandArchiveP4, replayDuelCommandArchiveP4,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN } from "../../src/duel/command-journal-p4.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

describe("optional Unit physical Chain P8 owner", () => {
  it.each(["pay", "decline"] as const)("uses native Chain, actual total cost and physical entry for %s", async decision => {
    const catalog = await loadCardCatalogRuntime();
    for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
    let uid = 0, commandSeq = 0;
    const options = { catalog, matchId: `physical-p8-${decision}`,
      randomIndex: () => 0, uidFactory: () => `physical-p8-${decision}-${++uid}`,
      roster: [{ playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
        { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b }] as const };
    let recorded = createDuelRecordedRuntimeP4(options, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN);
    let owner = recorded.runtime;
    const restart = () => {
      const before = [owner.project(null), owner.project("alice"), owner.project("bob")];
      const archive = recorded.archive();
      expect(archive.schemaVersion).toBe(8);
      recorded = replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(options,
        digestDuelCommandArchiveP4(archive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN));
      owner = recorded.runtime;
      expect(recorded.archive().journal).toEqual(archive.journal);
      expect([owner.project(null), owner.project("alice"), owner.project("bob")]).toEqual(before);
    };
    const playing = (actor: string | null = "alice") => {
      const projection = owner.project(actor);
      if (projection.match.stage !== "playing") throw new TypeError("actual playing state required");
      return projection as typeof projection & { match: Extract<typeof projection.match, { stage: "playing" }> };
    };
    let lastPacket: unknown;
    const send = (actor: string, command: DuelWireCommandV3Actions1) => {
      const commandId = `physical-p8-command-${++commandSeq}`;
      const packet = { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
        requestId: commandId, commandId, expectedVersion: owner.project(actor).match.stateVersion, command };
      lastPacket = packet;
      try { return owner.dispatch(actor, packet); }
      catch (error) { throw new Error(`physical command ${commandId}: ${command.type}`, { cause: error }); }
    };
    for (let count = 0; count < 2; count++) {
      const setup = owner.project(null).match;
      if (setup.stage !== "setup") throw new TypeError("setup required");
      expect(send(setup.setup.currentMulliganOwner!, { type: "mulligan", selectedUIDs: [] }).ack.ok).toBe(true);
    }
    for (let count = 0; count < 2; count++) {
      const actor = playing(null).match.frame.turnPlayerId;
      const end = playing(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
      if (!end || end.kind !== "end-turn") throw new TypeError("real End action required");
      expect(send(actor, { type: "end-turn", windowId: end.windowId }).ack.ok).toBe(true);
    }
    expect(playing().match.frame.turnNumber).toBe(3);
    const target = playing().match.players.find(player => player.playerId === "alice")!.hand!
      .find(card => card.cardId === "ogn-010-298");
    if (!target) throw new TypeError("actual Fury Accelerate printing required");
    const play = playing().actions.find(action => action.kind === "play-card" && action.enabled && action.cardUID === target.uid);
    if (!play || play.kind !== "play-card") throw new TypeError("real Play action required");
    const before = playing().match.stateVersion;
    expect(send("alice", { type: "play-card", cardUID: target.uid, windowId: play.windowId }).ack.ok).toBe(true);
    expect(playing().match.stateVersion).toBe(before + 2);
    expect(playing().match.players.find(player => player.playerId === "alice")!.hand!.some(card => card.uid === target.uid)).toBe(false);
    expect(playing().match.frame.chain).toMatchObject({ active: true, itemCount: 1, pendingCount: 1 });
    expect(playing().match.board.units.some(unit => unit.objectId === target.uid)).toBe(false);
    expect(playing("bob").match.frame.pendingChoice).toEqual({ active: true });
    restart();
    const choice = playing().match.frame.pendingChoice;
    if (!choice || !("kind" in choice) || choice.kind !== "play-choices") throw new TypeError("physical Chain choice required");
    const prompt = choice.prompts[0]!;
    const option = prompt.options.find(value => value.label ===
      (decision === "pay" ? "支付额外费用" : "不支付额外费用"));
    if (!option) throw new TypeError("actual option required");
    expect(playing().actions.filter(action => action.enabled).map(action => action.kind)).toEqual(["answer-pending-choice"]);
    const choiceVersion = playing().match.stateVersion;
    const validAnswer = { type: "answer-pending-choice" as const, choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: [option.id] }] };
    const staleId = `physical-p8-command-${++commandSeq}`;
    expect(owner.dispatch("alice", { type: "duel-command",
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: staleId, commandId: staleId, expectedVersion: choiceVersion - 1,
      command: validAnswer }).ack.type).toBe("error");
    expect(send("bob", validAnswer).ack.type).toBe("error");
    expect(send("alice", { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: ["foreign-option"] }] }).ack.type).toBe("error");
    expect(send("alice", { type: "answer-pending-choice", choiceId: choice.choiceId,
      answers: [{ promptId: "copied-prompt", optionIds: [option.id] }] }).ack.type).toBe("error");
    const preChoiceRune = playing().match.resources.bases.find(base => base.playerId === "alice")!.baseRunes[0]!;
    expect(send("alice", { type: "rune-energy", uid: preChoiceRune.uid }).ack.type).toBe("blocked");
    expect(playing().match.stateVersion).toBe(choiceVersion);
    expect(send("alice", validAnswer).ack.ok).toBe(true);
    const pending = playing().match.frame.pendingPayment;
    if (!pending?.paymentId || !pending.resolvedCost) throw new TypeError("required payment missing");
    expect(pending.resolvedCost).toEqual(decision === "pay"
      ? { energy: 3, power: [{ allowedDomains: ["Fury"], amount: 1 }] }
      : { energy: 2, power: [] });
    restart();
    const paymentVersion = playing().match.stateVersion;
    expect(send("bob", { type: "pay-pending", paymentId: pending.paymentId }).ack.type).toBe("blocked");
    expect(send("alice", { type: "pay-pending", paymentId: pending.paymentId }).ack.type).toBe("blocked");
    expect(playing().match.stateVersion).toBe(paymentVersion);
    for (let count = 0; count < pending.resolvedCost.energy; count++) {
      const rune = playing().actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!rune || rune.kind !== "rune-energy") throw new TypeError("real energy Rune required");
      expect(send("alice", { type: "rune-energy", uid: rune.uid }).ack.ok).toBe(true);
      if (count === 0) {
        const version = playing().match.stateVersion;
        expect(owner.dispatch("alice", lastPacket).ack.duplicate).toBe(true);
        expect(playing().match.stateVersion).toBe(version);
      }
    }
    if (decision === "pay") {
      const runes = playing().match.resources.bases.find(base => base.playerId === "alice")!.baseRunes;
      const rune = playing().actions.find(action => action.kind === "rune-power" && action.enabled &&
        runes.some(value => value.uid === action.uid && value.domain === "Fury"));
      if (!rune || rune.kind !== "rune-power") throw new TypeError("real Fury Rune required");
      expect(send("alice", { type: "rune-power", uid: rune.uid }).ack.ok).toBe(true);
    }
    const payment = playing().actions.find(action => action.kind === "pay-pending" && action.enabled);
    if (!payment || payment.kind !== "pay-pending") throw new TypeError("pay action required");
    expect(send("alice", { type: "pay-pending", paymentId: payment.paymentId }).ack.ok).toBe(true);
    const completedVersion = playing().match.stateVersion;
    expect(owner.dispatch("alice", lastPacket).ack.duplicate).toBe(true);
    expect(playing().match.stateVersion).toBe(completedVersion);
    expect(playing().match.board.units.filter(unit => unit.objectId === target.uid)).toHaveLength(1);
    expect(playing().match.board.units.find(unit => unit.objectId === target.uid)?.readied).toBe(decision === "pay");
    expect(playing().match.frame.chain.active).toBe(false);
    expect(playing().match.frame.execution.status).toBe("ready");
  // Each case strictly replays the growing private journal at several payment
  // checkpoints. The same unchanged assertions take 33-38s on the native Mac.
  }, 120_000);
});
