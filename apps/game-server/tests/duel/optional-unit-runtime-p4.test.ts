import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelWireCommandV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, replayDuelCommandArchiveP4,
  digestDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK } from "../../src/duel/command-journal-p4.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

describe("actual optional Unit P4 command flow", () => {
  it.each([
    { profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, decision: "pay" },
    { profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT, decision: "decline" },
    { profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK, decision: "pay" },
    { profile: DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK, decision: "decline" },
  ] as const)("$profile keeps original $decision choice through two entries and strict replay", async ({profile, decision}) => {
    const catalog = await loadCardCatalogRuntime();
    for (const deck of Object.values(fury77RealDecks)) expect(validateCatalogDeck(catalog, deck).valid).toBe(true);
    let uid = 0, commandSeq = 0;
    const options = { catalog, matchId: `actual-optional-p4-${profile}-${decision}`, randomIndex: () => 0,
      uidFactory: () => `actual-optional-${profile}-${decision}-${++uid}`,
      roster: [{ playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
        { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b }] as const };
    let recorded = createDuelRecordedRuntimeP4(options, profile);
    const send = (actor: string, command: DuelWireCommandV3Actions1) => {
      const commandId = `actual-optional-command-${++commandSeq}`;
      const packet = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
        requestId: commandId, commandId, expectedVersion: recorded.runtime.project(actor).match.stateVersion, command };
      return { packet, result: recorded.runtime.dispatch(actor, packet) };
    };
    const playing = (actor: string | null = "alice") => {
      const view = recorded.runtime.project(actor);
      if (view.match.stage !== "playing") throw new Error("actual playing state required");
      return view as typeof view & { match: Extract<typeof view.match, { stage: "playing" }> };
    };
    for (let i = 0; i < 2; i++) {
      const view = recorded.runtime.project(null);
      if (view.match.stage !== "setup") throw new Error("actual setup required");
      expect(send(view.match.setup.currentMulliganOwner!, { type: "mulligan", selectedUIDs: [] }).result.ack.ok).toBe(true);
    }
    for (let i = 0; i < 2; i++) {
      const actor = playing(null).match.frame.turnPlayerId;
      const action = playing(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
      if (!action || action.kind !== "end-turn") throw new Error("actual enabled End required");
      expect(send(actor, { type: "end-turn", windowId: action.windowId }).result.ack.ok).toBe(true);
    }
    expect(playing().match.frame.turnNumber).toBe(3);
    const target = playing().match.players.find(player => player.playerId === "alice")!.hand!
      .find(card => card.cardId === "ogn-010-298");
    if (!target) throw new Error("actual dealt Accelerate Unit required");
    const play = playing().actions.find(action => action.kind === "play-card" && action.cardUID === target.uid && action.enabled);
    if (!play || play.kind !== "play-card") throw new Error("enabled optional Unit action required");
    const choiceVersion = playing().match.stateVersion;
    const opened = send("alice", { type: "play-card", cardUID: target.uid, windowId: play.windowId });
    expect(opened.result.ack.ok).toBe(true);
    expect(playing().match.stateVersion).toBe(choiceVersion + (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK ? 1 : 0));
    expect(playing().match.board.units).toHaveLength(0);
    expect(playing("bob").match.frame.pendingChoice).toEqual({ active: true });
    const choice = playing().match.frame.pendingChoice;
    if (!choice || !('kind' in choice) || choice.kind !== "play-choices") throw new Error("actual optional cost prompt required");
    const prompt = choice.prompts[0]!;
    const option = prompt.options.find(option => option.label === (decision === "pay" ? "支付额外费用" : "不支付额外费用"));
    if (!option) throw new Error("both optional cost decisions required");
    expect(playing().actions.filter(action => action.enabled).map(action => action.kind)).toEqual(["answer-pending-choice"]);
    const blockedRune = playing().match.resources.bases.find(base => base.playerId === "alice")!.baseRunes[0]!;
    expect(send("alice", { type: "rune-energy", uid: blockedRune.uid }).result.ack.type).toBe("blocked");
    expect(playing().match.stateVersion).toBe(choiceVersion + (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK ? 1 : 0));
    const answer = { type: "answer-pending-choice" as const, choiceId: choice.choiceId,
      answers: [{ promptId: prompt.promptId, optionIds: [option.id] }] };
    expect(send("bob", answer).result.ack.type).toBe("error");
    expect(playing().match.stateVersion).toBe(choiceVersion + (profile === DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_CLOCK ? 1 : 0));
    expect(send("alice", answer).result.ack.ok).toBe(true);
    const pending = playing().match.frame.pendingPayment;
    if (!pending?.paymentId || !pending.resolvedCost) throw new Error("real canonical pending payment required");
    const printing = catalog.publicCatalog.cards.find(card => card.id === target.cardId)!;
    expect(pending.resolvedCost.energy).toBe(printing.energy! + (decision === "pay" ? 1 : 0));
    expect(pending.resolvedCost.power).toEqual(decision === "pay" ? [{ allowedDomains: ["Fury"], amount: 1 }] : []);
    expect(playing().match.board.units).toHaveLength(0);
    expect(playing("bob").match.frame.pendingPayment).toEqual({ active: true });
    recorded = recorded.fork();
    for (let i = 0; i < pending.resolvedCost.energy; i++) {
      const action = playing().actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!action || action.kind !== "rune-energy") throw new Error("real funding Rune required");
      expect(send("alice", { type: "rune-energy", uid: action.uid }).result.ack.ok).toBe(true);
      expect(playing().match.frame.pendingPayment?.resolvedCost).toEqual(pending.resolvedCost);
      expect(playing().match.board.units).toHaveLength(0);
    }
    if (decision === "pay") {
      const runes = playing().match.resources.bases.find(base => base.playerId === "alice")!.baseRunes;
      const action = playing().actions.find(action => action.kind === "rune-power" && action.enabled &&
        runes.some(rune => rune.uid === action.uid && rune.domain === "Fury"));
      if (!action || action.kind !== "rune-power") throw new Error("actual Fury Rune power required");
      expect(send("alice", { type: "rune-power", uid: action.uid }).result.ack.ok).toBe(true);
    }
    const beforePay = playing().match.stateVersion;
    expect(beforePay).toBeGreaterThan(choiceVersion);
    expect(send("bob", { type: "pay-pending", paymentId: pending.paymentId }).result.ack.type).toBe("error");
    expect(playing().match.stateVersion).toBe(beforePay);
    const payAction = playing().actions.find(action => action.kind === "pay-pending" && action.enabled);
    if (!payAction || payAction.kind !== "pay-pending") throw new Error("source-attested Pay action required");
    const paid = send("alice", { type: "pay-pending", paymentId: payAction.paymentId });
    expect(paid.result.ack.ok).toBe(true);
    const after = playing();
    expect(after.match.frame.pendingPayment).toBeNull();
    expect(after.match.frame.pendingChoice).toBeNull();
    expect(after.match.frame.execution.status).toBe("ready");
    expect(after.match.board.units).toHaveLength(1);
    expect(after.match.board.units[0]).toMatchObject({ objectId: target.uid, readied: decision === "pay" });
    expect(after.match.players.find(player => player.playerId === "alice")!.hand!.some(card => card.uid === target.uid)).toBe(false);
    const duplicate = recorded.runtime.dispatch("alice", paid.packet);
    expect(duplicate.ack).toEqual({ ...paid.result.ack, duplicate: true });
    expect(playing()).toEqual(after);
    expect(recorded.runtime.resumePending()).toBeNull();
    // A second Unit must get its own genuine choice/task after the first
    // continuation completes. Paying the first extra cost uses three of the
    // four available Energy, so advance normally before funding the next body.
    if (decision === "pay") {
      for (let index = 0; index < 2; index++) {
        const actor = playing(null).match.frame.turnPlayerId;
        const end = playing(actor).actions.find(action => action.kind === "end-turn" && action.enabled);
        if (!end || end.kind !== "end-turn") throw new Error("normal next turn required");
        expect(send(actor, { type: "end-turn", windowId: end.windowId }).result.ack.ok).toBe(true);
      }
    }
    const nextTarget = playing().match.players[0]!.hand!.find(card => card.cardId === target.cardId)!;
    const nextPlay = playing().actions.find(action => action.kind === "play-card" && action.enabled && action.cardUID === nextTarget.uid);
    if (!nextPlay || nextPlay.kind !== "play-card") throw new Error("second optional Unit action required");
    expect(send("alice", { type: "play-card", cardUID: nextTarget.uid, windowId: nextPlay.windowId }).result.ack.ok).toBe(true);
    const nextChoice = playing().match.frame.pendingChoice;
    if (!nextChoice || !('kind' in nextChoice) || nextChoice.kind !== "play-choices") throw new Error("new choice required");
    expect(nextChoice.choiceId).not.toBe(choice.choiceId);
    const nextPrompt = nextChoice.prompts[0]!;
    const decline = nextPrompt.options.find(option => option.label === "不支付额外费用")!;
    expect(send("alice", { type: "answer-pending-choice", choiceId: nextChoice.choiceId,
      answers: [{ promptId: nextPrompt.promptId, optionIds: [decline.id] }] }).result.ack.ok).toBe(true);
    const nextPayment = playing().match.frame.pendingPayment;
    if (!nextPayment?.paymentId || !nextPayment.resolvedCost) throw new Error("second payment required");
    expect(nextPayment.paymentId).not.toBe(pending.paymentId);
    expect(nextPayment.resolvedCost).toEqual({ energy: printing.energy!, power: [] });
    for (let index = 0; index < nextPayment.resolvedCost.energy; index++) {
      const rune = playing().actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!rune || rune.kind !== "rune-energy") throw new Error("second Unit funding Rune required");
      expect(send("alice", { type: "rune-energy", uid: rune.uid }).result.ack.ok).toBe(true);
    }
    expect(send("alice", { type: "pay-pending", paymentId: nextPayment.paymentId }).result.ack.ok).toBe(true);
    expect(playing().match.board.units).toHaveLength(2);
    expect(playing().match.board.units.find(unit => unit.objectId === nextTarget.uid)?.readied).toBe(false);
    expect(playing().match.frame.pendingPayment).toBeNull();
    const archive = recorded.archive();
    const replay = replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive), profile));
    for (const viewer of ["alice", "bob", null]) expect(replay.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
    expect(replay.archive()).toEqual(archive);
  }, 90_000);
});
