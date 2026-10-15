import { describe, expect, it } from "vitest";
import {
  adoptAdmittedDuelPlayingSessionV2, applyDuelSpellResourceCommandV2,
  finalizeDuelSpellCardPlayV2, inspectDuelSpellResolutionBindingV2,
  passDuelSpellPriorityV2, playDuelSpellCardV2, resolveDuelSpellCardPlayV2,
  resumeDuelSpellEffectV2,
  projectCanonicalDuelMatchV2,
  type DuelSpellCardPlayResultV2,
} from "@riftbound/engine-core/duel";
import { costFixture } from "./fixtures/p4-spell-service-fixture.js";

describe("P4 Spell native handoff", () => {
  it("does not execute accessors or toJSON while copying private dispatcher DATA", async () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "head", { enumerable: true,
      get() { getterCalls += 1; return "untrusted"; } });
    const withGetter = await costFixture(false, false, () => accessor);
    expect(() => withGetter.spell.privateFingerprintData()).toThrow(/accessor/);
    expect(getterCalls).toBe(0);
    let toJsonCalls = 0;
    const withToJson = await costFixture(false, false, () => ({
      toJSON() { toJsonCalls += 1; return { injected: true }; },
    }));
    expect(() => withToJson.spell.privateFingerprintData()).toThrow(/must be DATA/);
    expect(toJsonCalls).toBe(0);
  });

  it("freezes detached dispatcher DATA and rejects sparse or opaque inputs", async () => {
    const owner = { commands: [{ commandId: "pending", outcome: null }] };
    const f = await costFixture(false, false, () => owner);
    const copied = f.spell.privateFingerprintData().owner as typeof owner;
    owner.commands[0]!.commandId = "changed";
    expect(copied.commands[0]!.commandId).toBe("pending");
    expect(Object.isFrozen(copied.commands[0])).toBe(true);
    for (const input of [new Array(2), new Date(), { pointer: Symbol("opaque") }]) {
      const invalid = await costFixture(false, false, () => input);
      expect(() => invalid.spell.privateFingerprintData()).toThrow();
    }
  });

  it("registers actual pending Chain work after payment commits and retires on exact resolution", async () => {
    const f = await costFixture();
    const session = f.spell.createSession(adoptAdmittedDuelPlayingSessionV2(f.main));
    const binding = inspectDuelSpellResolutionBindingV2(session);
    expect(binding.chainId).toBeTruthy();
    expect(f.spell.privateFingerprintData().resolutionBinding).toEqual({
      chainId: binding.chainId, executorId: binding.executorId,
    });
    let result = playDuelSpellCardV2(session, "alice", {
      commandId: "spell-command", expectedVersion: f.main.stateVersion, command: { cardUID: f.uid },
    });
    expect(result.outcome.status).toBe("pending");
    expect(result.outcome.status === "pending" && result.outcome.step).toBe("payment");
    f.spell.handoff(result);
    const pending = f.journal.readCostCensus()!;
    expect(pending.sources.some(source => source.carrier === "runtime-effect" &&
      source.ledger === "chain" && source.status === "pending" && source.sourceUID === f.uid)).toBe(true);
    const pendingContext = { matchId: f.head().matchId, dataVersion: f.head().dataVersion,
      catalogDigest: f.head().catalogDigest, turn: f.head().frame.turnNumber,
      taskId: `duel-v2:${f.head().matchId}:turn-${f.head().frame.turnNumber}:spell:response`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: f.head().stateVersion, eventSeq: f.head().eventSeq } };
    f.journal.bindContext(pendingContext);
    expect(f.journal.read(pendingContext)).toBeNull();
    const bob = f.head().players.find(player => player.playerId === "bob")!.hand[0]!;
    const response = f.spell.verifiedCostSource({ kind: "card-play", subjectId: bob.cardId,
      transactionId: JSON.stringify([f.head().matchId, f.head().stateVersion, "bob", "response",
        bob.uid, f.head().physicalCardsByUID[bob.uid]!.zoneEpoch]) });
    expect(response.candidates.some(candidate => candidate.sourceUid.startsWith("effect:") &&
      candidate.sourceEpoch === f.epoch + 1)).toBe(true);
    const privateCensus = f.spell.privateFingerprintData();
    expect(JSON.stringify(projectCanonicalDuelMatchV2(f.head(), "bob"))).not.toContain("programReference");
    expect(JSON.stringify(projectCanonicalDuelMatchV2(f.head(), "bob"))).not.toContain("journalRevision");
    expect(privateCensus.costCensus).toBeDefined();
    expect(f.journal.listCommits().some(commit => commit.transitions.some(step =>
      step.uid === f.uid && step.from.kind === "hand" && step.to.kind === "chain" &&
      step.fromZoneEpoch === f.epoch && step.toZoneEpoch === f.epoch + 1))).toBe(true);
    const rune = result.session.commandSession.match.resources.bases[0]!.baseRunes.find(item => item.readied)!;
    result = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "rune-energy", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "rune-energy", uid: rune.uid },
    });
    expect(result.outcome.status).toBe("pending");
    f.spell.handoff(result);
    result = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "pay", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "pay-pending", paymentId: `spell-payment:${JSON.stringify(["alice", "spell-command"])}` },
    });
    expect(result.outcome.status).toBe("pending");
    f.spell.handoff(result);
    result = finalizeDuelSpellCardPlayV2(result.session, "alice");
    expect(result.outcome).toMatchObject({ status: "pending", step: "priority" });
    f.spell.handoff(result);
    result = passDuelSpellPriorityV2(result.session, "alice");
    f.spell.handoff(result);
    result = passDuelSpellPriorityV2(result.session, "bob");
    f.spell.handoff(result);
    result = resolveDuelSpellCardPlayV2(result.session, "alice");
    f.spell.handoff(result);
    expect(f.head().players[0]!.trash.some(card => card.uid === f.uid)).toBe(true);
    expect(f.journal.readCostCensus()!.sources.some(source => source.carrier === "runtime-effect" &&
      source.sourceUID === f.uid)).toBe(false);
    expect(f.notificationCount()).toBe(1);
    expect(result.outcome.status === "pending" ? result.outcome.reason : "applied").toBe("applied");
    expect(f.head().players[0]!.trash.some(card => card.uid === f.uid)).toBe(true);
    expect(f.journal.readCostCensus()!.sources.some(source => source.carrier === "runtime-effect" &&
      source.sourceUID === f.uid)).toBe(false);
    expect(f.notificationCount()).toBe(1);
    expect(f.spell.privateFingerprintData().notified).toBeDefined();
    const notification = f.lastNotification()!;
    expect(f.spell.privateFingerprintData().notified).toEqual([{
      key: notification.ticket.idempotencyKey,
      stateVersion: notification.commandSession.match.stateVersion,
      eventSeq: notification.commandSession.match.eventSeq,
      business: JSON.stringify([notification.ticket.idempotencyKey, notification.ticket.itemId,
        notification.cardUID, notification.cardId, notification.controller, notification.sourceEpoch]),
      acknowledged: true,
    }]);
    f.spell.coreServices.dispatcher.notifyCommitted!(notification);
    expect(f.notificationCount()).toBe(1);
    expect(() => f.spell.coreServices.dispatcher.notifyCommitted!({ ...notification,
      proof: { ...notification.proof } })).toThrow(/untrusted-proof/);
    expect(() => f.spell.coreServices.dispatcher.notifyCommitted!({ ...notification,
      chain: { ...notification.chain } })).toThrow();
    expect(f.notificationCount()).toBe(1);
  });

  it("retries an applied command ACK without repeating the native effect or notification", async () => {
    const f = await costFixture(false, true);
    let result = playDuelSpellCardV2(f.spell.createSession(adoptAdmittedDuelPlayingSessionV2(f.main)),
      "alice", { commandId: "spell-command", expectedVersion: f.main.stateVersion,
        command: { cardUID: f.uid } });
    f.spell.handoff(result);
    const rune = result.session.commandSession.match.resources.bases[0]!.baseRunes.find(item => item.readied)!;
    result = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "rune-energy", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "rune-energy", uid: rune.uid } });
    f.spell.handoff(result);
    result = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "pay", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "pay-pending", paymentId: `spell-payment:${JSON.stringify(["alice", "spell-command"])}` } });
    f.spell.handoff(result);
    result = finalizeDuelSpellCardPlayV2(result.session, "alice"); f.spell.handoff(result);
    result = passDuelSpellPriorityV2(result.session, "alice"); f.spell.handoff(result);
    result = passDuelSpellPriorityV2(result.session, "bob"); f.spell.handoff(result);
    result = resolveDuelSpellCardPlayV2(result.session, "alice");
    f.spell.handoff(result);
    expect(result.outcome).toMatchObject({ status: "pending", reason: "command-receipt-unconfirmed" });
    expect(f.notificationCount()).toBe(1);
    const after = f.head();
    result = resumeDuelSpellEffectV2(result.session);
    f.spell.handoff(result);
    expect(result.outcome.status).toBe("applied");
    expect(f.head()).toBe(after);
    expect(f.notificationCount()).toBe(1);
  });

  it("preserves a pending unknown runtime effect in the private cost census", async () => {
    const f = await costFixture();
    const source = f.journal.readCostCensus()!.sources.find(item => item.uid === f.uid)!;
    const context = { matchId: f.main.matchId, dataVersion: f.main.dataVersion,
      catalogDigest: f.main.catalogDigest, turn: f.main.frame.turnNumber,
      taskId: `duel-v2:${f.main.matchId}:turn-${f.main.frame.turnNumber}:spell:pending-cost`,
      phase: "main" as const, event: "main" as const,
      clock: { stateVersion: f.main.stateVersion, eventSeq: f.main.eventSeq } };
    f.journal.registerRuntimeEffect({ ledger: "effectQueue", operationId: "main-a", context,
      entry: { effectId: "unknown-pending-cost-effect", eventId: "main-a", kind: "queued-effect",
        sourceUID: f.uid, sourceZoneEpoch: f.epoch, cardId: source.cardId,
        controllerPlayerId: source.controllerPlayerId, zone: source.zone,
        programReference: source.programReference! } });
    expect(f.journal.readCostCensus()!.sources.some(item => item.effectId === "unknown-pending-cost-effect" &&
      item.status === "pending")).toBe(true);
    expect(f.journal.read(context)).toBeNull();
    expect(() => f.spell.verifiedCostSource(f.request)).toThrow(/unresolved runtime cost relevance/);
  });

  it("rejects stale or copied Chain registration without changing census", async () => {
    const f = await costFixture();
    const session = f.spell.createSession(adoptAdmittedDuelPlayingSessionV2(f.main));
    const result: DuelSpellCardPlayResultV2 = playDuelSpellCardV2(session, "alice", {
      commandId: "spell-command", expectedVersion: f.main.stateVersion, command: { cardUID: f.uid },
    });
    f.spell.handoff(result);
    const before = f.journal.revision();
    const source = f.journal.readCostCensus()!.sources.find(item => item.uid === f.uid &&
      item.carrier === "object")!;
    const owned = f.journal.readCostCensus()!.sources.find(item => item.carrier === "runtime-effect")!;
    const binding = inspectDuelSpellResolutionBindingV2(result.session);
    const context = { matchId: f.head().matchId, dataVersion: f.head().dataVersion,
      catalogDigest: f.head().catalogDigest, turn: f.head().frame.turnNumber,
      taskId: `duel-v2:${f.head().matchId}:turn-${f.head().frame.turnNumber}:spell:attack`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: f.head().stateVersion, eventSeq: f.head().eventSeq } };
    const effect = { ledger: "chain" as const, operationId: "channel-a", context,
      entry: { effectId: "attack", eventId: "channel-a", kind: "chain-effect" as const,
        sourceUID: f.uid, sourceZoneEpoch: f.epoch + 1, cardId: source.cardId,
        controllerPlayerId: source.controllerPlayerId, zone: source.zone,
        programReference: owned.programReference! },
      resolutionBinding: { authority: binding.resolutionAuthority,
        chainId: binding.chainId, executorId: binding.executorId } };
    expect(() => f.journal.registerRuntimeEffect(effect)).toThrow(/not bound to its native entry/);
    const entry = f.journal.listCommits().find(commit => commit.transitions.some(step =>
      step.uid === f.uid && step.from.kind === "hand" && step.to.kind === "chain"))!;
    expect(() => f.journal.registerRuntimeEffect({ ...effect,
      operationId: entry.label.operationId,
      entry: { ...effect.entry, eventId: entry.label.eventId,
        sourceZoneEpoch: f.epoch + 2 } })).toThrow(/not bound to its native entry/);
    expect(() => f.journal.registerRuntimeEffect({ ...effect,
      operationId: entry.label.operationId,
      entry: { ...effect.entry, eventId: entry.label.eventId,
        programReference: "forged-program" } })).toThrow(/not registry-owned/);
    const cloned = structuredClone(f.head());
    expect(() => f.journal.observe({ ancestor: f.head(), descendant: cloned,
      commits: [] })).toThrow();
    expect(f.journal.revision()).toBe(before);
  });
});
