import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { type DuelRecordedRuntimeP4 } from "../../src/duel/command-journal-p4.js";
import {
  createRecordedAuthoritativeDuelRuntimeP4, protectedDigestOf, restoreDuelCommandJournalP4,
} from "./fixtures/recorded-spell-p4-fixture.js";

type Runtime = DuelRecordedRuntimeP4["runtime"];
function packet(runtime: Runtime, actor: string, commandId: string,
  command: DuelCommandMessageV3Actions1["command"]): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId, expectedVersion: runtime.project(actor).match.stateVersion, command };
}
function views(runtime: Runtime) {
  return [runtime.project("alice"), runtime.project("bob"), runtime.project(null)];
}

describe("P4 recorded authoritative Draw Spell", () => {
  it("reconstructs every native owner checkpoint through payment, nonempty Chain, Draw and exact retirement", async () => {
    const f = await createRecordedAuthoritativeDuelRuntimeP4();
    const { recorded } = f, { runtime } = recorded;
    const checkpoint = () => {
      const archive = recorded.archive(), protectedDigest = protectedDigestOf(archive);
      const observed = archive.operations.at(-1)?.observation ?? archive.creation.observation;
      expect(observed.views).toEqual(views(runtime));
      expect(observed.privateDigest).toMatch(/^[0-9a-f]{64}$/);
      const restored = restoreDuelCommandJournalP4(f.options, archive, protectedDigest);
      expect(restored.archive().journal).toEqual(archive.journal);
      expect(views(restored.runtime)).toEqual(views(runtime));
      expect(protectedDigestOf(restored.archive())).toBe(protectedDigest);
      return archive;
    };
    checkpoint();
    for (const id of ["mulligan-a", "mulligan-b"]) {
      const setup = runtime.project(null).match;
      if (setup.stage !== "setup") throw Error("native setup expected");
      const actor = setup.setup.currentMulliganOwner!;
      expect(runtime.dispatch(actor, packet(runtime, actor, id, { type: "mulligan", selectedUIDs: [] })).ack.ok).toBe(true);
      checkpoint();
    }
    let initial = runtime.project("alice");
    if (initial.match.stage !== "playing") throw Error("native Main expected");
    expect(initial.match.frame.turnPlayerId).toBe("alice");
    expect(initial.match.frame.phase).toBe("main");
    const energy = initial.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (energy && energy.kind === "rune-energy") {
      expect(runtime.dispatch("alice", packet(runtime, "alice", "spell-energy", {
        type: "rune-energy", uid: energy.uid })).ack.ok).toBe(true);
      checkpoint();
      initial = runtime.project("alice");
    }
    const spell = initial.actions.find(action => action.kind === "play-card" && action.label === "施放法术" && action.enabled);
    if (!spell || spell.kind !== "play-card") throw Error("controlled Draw Spell not in real opening Hand");
    const initialHandCount = initial.match.players.find(player => player.playerId === "alice")!.handCount;
    const play = packet(runtime, "alice", "spell-play", { type: "play-card", cardUID: spell.cardUID, windowId: spell.windowId });
    expect(runtime.dispatch("alice", play).ack.pending).toBe(true);
    const pendingArchive = checkpoint();
    const pending = runtime.project("alice");
    const pendingViews = views(runtime);
    if (pending.match.stage !== "playing") throw Error("playing expected after play");
    expect(pending.match.frame.pendingPayment).not.toBeNull();
    expect(pending.match.frame.chain).toMatchObject({ active: true, itemCount: 1 });
    const identityCount = f.uidCount();
    const sameReceipt = runtime.dispatch("alice", play);
    expect(sameReceipt.ack).toMatchObject({ type: "blocked", pending: true, duplicate: true });
    expect(f.uidCount()).toBe(identityCount);
    expect(views(runtime)).toEqual(pendingViews);
    expect(recorded.archive().operations.at(-1)?.entropy).toEqual([]);
    checkpoint();
    const wrongActor = runtime.dispatch("bob", { ...play, requestId: "wrong-actor-request" });
    expect(wrongActor.ack.ok).not.toBe(true);
    expect(recorded.archive().operations.at(-1)?.entropy).toEqual([]);
    expect(views(runtime)).toEqual(pendingViews);
    checkpoint();
    const conflict = runtime.dispatch("alice", { ...play, requestId: "conflict-request",
      command: { type: "play-card", cardUID: "different-card", windowId: spell.windowId } });
    expect(conflict.ack.type).toBe("error");
    expect(recorded.archive().operations.at(-1)?.entropy).toEqual([]);
    expect(views(runtime)).toEqual(pendingViews);
    checkpoint();
    expect(pendingArchive.operations.at(-1)?.observation.privateDigest).toBeDefined();

    const payment = runtime.project("alice").actions.find(action => action.kind === "pay-pending");
    if (!payment || payment.kind !== "pay-pending") throw Error("native pending payment missing");
    expect(runtime.dispatch("alice", packet(runtime, "alice", "spell-pay", {
      type: "pay-pending", paymentId: payment.paymentId })).ack.ok).toBe(true);
    checkpoint();
    const chain = runtime.project("alice");
    if (chain.match.stage !== "playing") throw Error("playing expected after payment");
    expect(chain.match.frame.pendingPayment).toBeNull();
    expect(chain.match.frame.chain).toMatchObject({ active: true, itemCount: 1 });
    const passA = chain.actions.find(action => action.kind === "pass-priority");
    if (!passA || passA.kind !== "pass-priority") throw Error("first native Chain priority missing");
    expect(runtime.dispatch("alice", packet(runtime, "alice", "spell-pass-a", {
      type: "pass-priority", windowId: passA.windowId })).ack.ok).toBe(true);
    checkpoint();
    const passB = runtime.project("bob").actions.find(action => action.kind === "pass-priority");
    if (!passB || passB.kind !== "pass-priority") throw Error("second native Chain priority missing");
    expect(runtime.dispatch("bob", packet(runtime, "bob", "spell-pass-b", {
      type: "pass-priority", windowId: passB.windowId })).ack.ok).toBe(true);
    const finalArchive = checkpoint();
    const final = runtime.project("alice");
    if (final.match.stage !== "playing") throw Error("playing expected after resolution");
    const alice = final.match.players.find(player => player.playerId === "alice")!;
    expect(alice.handCount).toBe(initialHandCount - 1 + 4);
    expect(alice.trash.filter(card => card.uid === spell.cardUID)).toHaveLength(1);
    expect(final.match.frame.chain).toEqual({ active: false });
    expect(final.match.frame.pendingPayment).toBeNull();
    expect(finalArchive.operations.some(operation => operation.entropy.length > 0)).toBe(true);
    const restored = restoreDuelCommandJournalP4(f.options, finalArchive, protectedDigestOf(finalArchive));
    expect(restored.fork().archive().journal).toEqual(finalArchive.journal);
  }, 180_000);
});
