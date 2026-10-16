import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4, DUEL_RUNTIME_PROFILE_P4_SPELL, type DuelRuntimeProfileP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import { spellFirstSetupDeck } from "./fixtures/spell-first-setup-deck.js";

/**
 * Focused regression: a legal Rune resource command dispatched while a real
 * Spell payment is pending must be acknowledged from the canonical resource
 * receipt (request-result ok + appliedVersion), not as a generic
 * blocked/error.
 *
 * The regression originated in the historical spell-v1 profile: in
 * `authoritative-runtime-p4.ts` the Spell resource branch (~L847-L859) derives
 * its ACK from the Spell-session outcome. A legal rune activation really
 * applies in the canonical Core (pool +1, stateVersion +1) and the Core
 * returns `status: 'applied'`, but `applyDuelSpellResourceCommandV2`
 * re-labels it as `{ status: 'pending', step: 'payment' }` because a Spell
 * payment is still outstanding. The branch therefore maps the successful
 * activation to `blocked("法术付款仍在等待资源")`. The canonical
 * `DuelCommandReceiptV2 { actor, commandId, outcome: applied }` is the proof
 * that must drive the ACK instead.
 *
 * This file uses the real authoritative constructor, real mulligans, a real
 * Main turn, and the existing controlled `Draw 4` spell-first fixture. The
 * controlled ability text is a test input, not a claim about the official
 * printing. No owner/Core/room/protocol source is modified by this file.
 */

const DIGEST = "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10";

async function owner(runtimeProfile?: DuelRuntimeProfileP4) {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery", digest: DIGEST } });
  let uid = 0;
  return createAuthoritativeDuelRuntimeP4({ catalog, runtimeProfile, matchId: "p4-pending-spell-resource-ack-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: spellFirstSetupDeck },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ], randomIndex: () => 0, uidFactory: () => `p4-pending-spell-${++uid}` });
}

type Runtime = ReturnType<typeof createAuthoritativeDuelRuntimeP4>;

function packet(runtime: Runtime, actor: string, commandId: string,
  command: DuelCommandMessageV3Actions1["command"]): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId,
    expectedVersion: runtime.project(actor).match.stateVersion, command };
}

function alicePool(runtime: Runtime) {
  const view = runtime.project("alice");
  if (view.match.stage !== "playing") throw new Error("playing expected");
  const player = view.match.resources.players.find(entry => entry.playerId === "alice");
  if (!player) throw new Error("alice resource pool expected");
  return { energy: player.runePool.energy, power: player.runePool.power };
}

/** Real mulligans, real turn kernels, then a genuine Spell play left pending. */
async function pendingSpell(runtimeProfile?: DuelRuntimeProfileP4) {
  const runtime = await owner(runtimeProfile);
  for (const id of ["pending-m-1", "pending-m-2"]) {
    const setup = runtime.project(null).match;
    if (setup.stage !== "setup") throw new Error("setup expected");
    const actor = setup.setup.currentMulliganOwner!;
    expect(runtime.dispatch(actor, packet(runtime, actor, id, { type: "mulligan", selectedUIDs: [] })).ack.ok).toBe(true);
  }
  let alice = runtime.project("alice");
  for (let turn = 0; turn < 12 &&
      !alice.actions.some(action => action.kind === "play-card" && action.label === "施放法术"); turn++) {
    if (alice.match.stage !== "playing") throw new Error("playing expected");
    const actor = alice.match.frame.turnPlayerId;
    const view = runtime.project(actor);
    const end = view.actions.find(action => action.kind === "end-turn");
    if (!end || end.kind !== "end-turn") throw new Error("real End action required while reaching the Spell");
    expect(runtime.dispatch(actor, packet(runtime, actor, `pending-end-${turn}`,
      { type: "end-turn", windowId: end.windowId })).ack.ok).toBe(true);
    alice = runtime.project("alice");
  }
  if (alice.match.stage !== "playing") throw new Error("playing expected");
  const spell = alice.actions.find(action => action.kind === "play-card" && action.label === "施放法术");
  if (!spell || spell.kind !== "play-card") throw new Error("Draw Spell was not dealt into the real Hand");
  // Play BEFORE pooling any Rune: the pending payment is genuine, not pre-funded.
  expect(alicePool(runtime).energy).toBe(0);
  const played = runtime.dispatch("alice", packet(runtime, "alice", "pending-play",
    { type: "play-card", cardUID: spell.cardUID, windowId: spell.windowId }));
  expect(played.ack).toMatchObject({ type: "blocked", pending: true });
  const pending = runtime.project("alice");
  if (pending.match.stage !== "playing") throw new Error("playing expected");
  expect(pending.match.frame.chain.active).toBe(true);
  expect(pending.match.frame.pendingPayment).toMatchObject({ active: true });
  return { runtime, spellCardUID: spell.cardUID };
}

describe("P4 pending-Spell Rune resource acknowledgement", () => {
  it.skip("keeps the historical Spell profile ACK and journals distinct from the new profile [legacy-replay-e2cbcdf]", async () => {
    const { runtime } = await pendingSpell(DUEL_RUNTIME_PROFILE_P4_SPELL);
    const before = runtime.project("alice");
    if (before.match.stage !== "playing") throw new Error("playing expected");
    const rune = before.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error("real enabled Rune required");
    const result = runtime.dispatch("alice", packet(runtime, "alice", "historical-rune", { type: "rune-energy", uid: rune.uid }));
    expect(result.ack).toMatchObject({ type: "blocked", pending: true });
    expect(runtime.project("alice").match.stateVersion).toBe(before.match.stateVersion + 1);
    expect(alicePool(runtime).energy).toBe(1);
  }, 30_000);

  it("keeps unpaid Chain priority closed against pass, response and foreign payment", async () => {
    const { runtime } = await pendingSpell();
    const alice = runtime.project("alice");
    if (alice.match.stage !== "playing" || !alice.match.frame.pendingPayment.active ||
        !("paymentId" in alice.match.frame.pendingPayment)) throw new Error("owned pending payment required");
    const before = ['alice', 'bob', null].map(actor => runtime.project(actor));
    const windowId = `forged-payment-window`;
    const attempts = [
      ["alice", { type: "pass-focus", windowId }],
      ["bob", { type: "pass-focus", windowId }],
      ["bob", { type: "pay-pending", paymentId: alice.match.frame.pendingPayment.paymentId }],
      ["alice", { type: "pay-pending", paymentId: "another-chain-item" }],
    ] as const;
    for (const [index, [actor, command]] of attempts.entries()) {
      const result = runtime.dispatch(actor, packet(runtime, actor, `unpaid-chain-reject-${index}`, command));
      expect(result.ack.ok).not.toBe(true);
      expect(['alice', 'bob', null].map(viewer => runtime.project(viewer))).toEqual(before);
    }
    const pending = runtime.project("alice");
    if (pending.match.stage !== "playing") throw new Error("playing expected");
    expect(pending.match.frame.pendingPayment).toEqual(alice.match.frame.pendingPayment);
    expect(pending.match.frame.chain).toEqual(alice.match.frame.chain);
    expect(pending.match.frame.stateOpen).toBe(false);
  }, 30_000);

  it("acknowledges a legal Rune activation from the canonical receipt, not as blocked", async () => {
    const { runtime } = await pendingSpell();
    const before = runtime.project("alice");
    if (before.match.stage !== "playing") throw new Error("playing expected");
    const rune = before.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error("real enabled Rune activation required while the Spell payment is pending");
    const poolBefore = alicePool(runtime);
    const versionBefore = before.match.stateVersion;
    const eventSeqBefore = before.match.eventSeq;

    const dispatched = runtime.dispatch("alice", packet(runtime, "alice", "pending-rune-energy",
      { type: "rune-energy", uid: rune.uid }));

    const after = runtime.project("alice");
    if (after.match.stage !== "playing") throw new Error("playing expected");
    // Real business state delta FIRST: the Core genuinely applied the activation,
    // advancing exactly one unique clock and crediting +1 Energy.
    expect(after.match.stateVersion).toBe(versionBefore + 1);
    expect(after.match.eventSeq).toBe(eventSeqBefore + 1);
    const poolAfter = alicePool(runtime);
    expect(poolAfter.energy).toBe(poolBefore.energy + 1);
    expect(poolAfter.power).toEqual(poolBefore.power);
    // The Spell payment is still outstanding; the activation must not resolve it.
    expect(after.match.frame.pendingPayment).toMatchObject({ active: true });
    expect(after.match.frame.chain.active).toBe(true);
    // ...so the ACK must reflect that real, canonical application: a
    // request-result carrying the appliedVersion, not blocked/error.
    expect(dispatched.ack, JSON.stringify(dispatched.ack)).toMatchObject({ type: "request-result", ok: true });
    expect(dispatched.ack.appliedVersion).toBe(versionBefore + 1);
    expect(dispatched.ack.eventSeq).toBe(eventSeqBefore + 1);
  }, 30_000);

  it("does not grant the Rune twice when the identical pending packet is retried", async () => {
    const { runtime } = await pendingSpell();
    const view = runtime.project("alice");
    if (view.match.stage !== "playing") throw new Error("playing expected");
    const rune = view.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error("real enabled Rune activation required");
    const first = packet(runtime, "alice", "pending-rune-retry", { type: "rune-energy", uid: rune.uid });
    const applied = runtime.dispatch("alice", first);
    expect(applied.ack, JSON.stringify(applied.ack)).toMatchObject({ type: "request-result", ok: true });
    const afterFirst = runtime.project("alice");
    if (afterFirst.match.stage !== "playing") throw new Error("playing expected");
    const poolAfterFirst = alicePool(runtime);

    const retried = runtime.dispatch("alice", first);
    // A duplicate must still answer from the receipt, never re-apply or error.
    expect(retried.ack, JSON.stringify(retried.ack)).toMatchObject({ type: "request-result", ok: true });
    expect(retried.ack.appliedVersion).toBe(afterFirst.match.stateVersion);
    const afterRetry = runtime.project("alice");
    if (afterRetry.match.stage !== "playing") throw new Error("playing expected");
    expect(alicePool(runtime)).toEqual(poolAfterFirst);
    expect(afterRetry.match.stateVersion).toBe(afterFirst.match.stateVersion);
    expect(afterRetry.match.eventSeq).toBe(afterFirst.match.eventSeq);
  }, 30_000);

  it("acknowledges a legal Rune recycle (rune-power) while the Spell payment is pending", async () => {
    const { runtime } = await pendingSpell();
    const view = runtime.project("alice");
    if (view.match.stage !== "playing") throw new Error("playing expected");
    const rune = view.actions.find(action => action.kind === "rune-power" && action.enabled);
    if (!rune || rune.kind !== "rune-power") throw new Error("real enabled Rune recycle required while the Spell payment is pending");
    const poolBefore = alicePool(runtime);
    const versionBefore = view.match.stateVersion;

    const dispatched = runtime.dispatch("alice", packet(runtime, "alice", "pending-rune-power",
      { type: "rune-power", uid: rune.uid }));
    expect(dispatched.ack, JSON.stringify(dispatched.ack)).toMatchObject({ type: "request-result", ok: true });
    expect(dispatched.ack.appliedVersion).toBe(versionBefore + 1);
    const after = runtime.project("alice");
    if (after.match.stage !== "playing") throw new Error("playing expected");
    expect(after.match.stateVersion).toBe(versionBefore + 1);
    const poolAfter = alicePool(runtime);
    // Recycle grants one matching-domain Rune-power without touching Energy.
    expect(poolAfter.energy).toBe(poolBefore.energy);
    const gainedPower = Object.keys(poolAfter.power).some(domain =>
      poolAfter.power[domain as keyof typeof poolAfter.power] ===
      poolBefore.power[domain as keyof typeof poolBefore.power] + 1);
    expect(gainedPower).toBe(true);
  }, 30_000);

  it("rejects an invalid Rune UID, a wrong actor, and a stale window without any silent apply", async () => {
    const { runtime } = await pendingSpell();
    const view = runtime.project("alice");
    if (view.match.stage !== "playing") throw new Error("playing expected");
    const rune = view.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error("real enabled Rune activation required");
    const baseline = runtime.project("alice");
    if (baseline.match.stage !== "playing") throw new Error("playing expected");
    const poolBefore = alicePool(runtime);

    // Invalid Rune UID: rejected, no pool/version change.
    const invalid = runtime.dispatch("alice", packet(runtime, "alice", "pending-rune-invalid",
      { type: "rune-energy", uid: "not-a-real-rune" }));
    expect(invalid.ack.type).not.toBe("request-result");
    expect(invalid.ack.ok).not.toBe(true);

    // Wrong actor: bob may not activate alice's Rune.
    const wrongActor = runtime.dispatch("bob", packet(runtime, "bob", "pending-rune-wrong-actor",
      { type: "rune-energy", uid: rune.uid }));
    expect(wrongActor.ack.type).not.toBe("request-result");
    expect(wrongActor.ack.ok).not.toBe(true);

    // Stale expectedVersion: rejected as a fresh command.
    const stale = { ...packet(runtime, "alice", "pending-rune-stale", { type: "rune-energy", uid: rune.uid }),
      expectedVersion: baseline.match.stateVersion - 5 };
    const staleResult = runtime.dispatch("alice", stale);
    expect(staleResult.ack.type).not.toBe("request-result");
    expect(staleResult.ack.ok).not.toBe(true);

    const final = runtime.project("alice");
    if (final.match.stage !== "playing") throw new Error("playing expected");
    expect(final.match.stateVersion).toBe(baseline.match.stateVersion);
    expect(final.match.eventSeq).toBe(baseline.match.eventSeq);
    expect(alicePool(runtime)).toEqual(poolBefore);

    // A legal command after the rejections still works (failures stayed resumable).
    const legal = runtime.dispatch("alice", packet(runtime, "alice", "pending-rune-after-reject",
      { type: "rune-energy", uid: rune.uid }));
    expect(legal.ack).toMatchObject({ type: "request-result", ok: true });
    expect(alicePool(runtime).energy).toBe(poolBefore.energy + 1);
  }, 30_000);
});
