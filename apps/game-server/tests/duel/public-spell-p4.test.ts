import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import { spellFirstSetupDeck } from "./fixtures/spell-first-setup-deck.js";

async function fixture() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  return createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p4-public-spell-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: spellFirstSetupDeck },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    // Fixed-width identities make the leakage assertion distinguish UID 4
    // from public Rune UID 43 without changing what information is allowed.
    ], randomIndex: () => 0, uidFactory: () => `p4-public-spell-${String(++uid).padStart(6, "0")}` });
}

function command(runtime: ReturnType<typeof createAuthoritativeDuelRuntimeP4>, actor: string, commandId: string,
  body: DuelCommandMessageV3Actions1["command"]): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId, expectedVersion: runtime.project(actor).match.stateVersion, command: body };
}

describe("P4 public Spell projection", () => {
  it("keeps private hand/source/payment data viewer-bound while exposing only real Chain state", async () => {
    const runtime = await fixture();
    for (const id of ["m-1", "m-2"]) {
      const setup = runtime.project(null).match;
      if (setup.stage !== "setup") throw new Error("setup expected");
      const actor = setup.setup.currentMulliganOwner!;
      expect(runtime.dispatch(actor, command(runtime, actor, id, { type: "mulligan", selectedUIDs: [] })).ack.ok).toBe(true);
    }
    let alice = runtime.project("alice");
    for (let turn = 0; turn < 12 && !alice.actions.some(action => action.kind === "play-card" && action.label === "施放法术"); turn++) {
      if (alice.match.stage !== "playing") throw new Error("playing expected");
      const actor = alice.match.frame.turnPlayerId;
      const view = runtime.project(actor);
      const end = view.actions.find(action => action.kind === "end-turn");
      if (!end || end.kind !== "end-turn") throw new Error("end action required");
      expect(runtime.dispatch(actor, command(runtime, actor, `end-${turn}`, { type: "end-turn", windowId: end.windowId })).ack.ok).toBe(true);
      alice = runtime.project("alice");
    }
    if (alice.match.stage !== "playing") throw new Error("playing expected");
    const spell = alice.actions.find(action => action.kind === "play-card" && action.label === "施放法术");
    if (!spell || spell.kind !== "play-card") throw new Error("Spell not in real Hand");
    expect(runtime.dispatch("alice", command(runtime, "alice", "play", { type: "play-card", cardUID: spell.cardUID, windowId: spell.windowId })).ack.pending).toBe(true);
    const own = runtime.project("alice"), other = runtime.project("bob"), spectator = runtime.project(null);
    if (own.match.stage !== "playing" || other.match.stage !== "playing" || spectator.match.stage !== "playing") throw new Error("playing expected");
    const payment = own.actions.find(action => action.kind === "pay-pending");
    if (!payment || payment.kind !== "pay-pending") throw new Error("owner payment action missing");
    expect(other.match.frame.pendingPayment).toEqual({ active: true });
    expect(spectator.match.frame.pendingPayment).toEqual({ active: true });
    expect(other.actions.some(action => action.kind === "pay-pending")).toBe(false);
    expect(spectator.actions).toEqual([]);
    expect(JSON.stringify(other)).not.toContain(payment.paymentId);
    expect(JSON.stringify(other)).not.toContain(spell.cardUID);
    expect(other.match.frame.chain.active).toBe(true);
    expect(other.match.frame.stateOpen).toBe(false);
  }, 30_000);
});
