import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { fingerprintDuelAuthoritativeRuntimePrivateP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import { spellFirstSetupDeck } from "./fixtures/spell-first-setup-deck.js";

async function fixture() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  const runtime = createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p4-spell-command-journal-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: spellFirstSetupDeck },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ], randomIndex: () => 0, uidFactory: () => `p4-spell-journal-${++uid}` });
  return { runtime, uidCount: () => uid };
}

function packet(runtime: ReturnType<typeof createAuthoritativeDuelRuntimeP4>, actor: string, commandId: string,
  command: DuelCommandMessageV3Actions1["command"]): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId, expectedVersion: runtime.project(actor).match.stateVersion, command };
}

describe("P4 Spell command journal", () => {
  it("retries one pending Spell receipt without new identities and rejects cross-actor payload conflict", async () => {
    const f = await fixture();
    for (const id of ["m-1", "m-2"]) {
      const setup = f.runtime.project(null).match;
      if (setup.stage !== "setup") throw new Error("setup expected");
      const actor = setup.setup.currentMulliganOwner!;
      expect(f.runtime.dispatch(actor, packet(f.runtime, actor, id, { type: "mulligan", selectedUIDs: [] })).ack.ok).toBe(true);
    }
    let view = f.runtime.project("alice");
    for (let turn = 0; turn < 12 && !view.actions.some(action => action.kind === "play-card" && action.label === "施放法术"); turn++) {
      if (view.match.stage !== "playing") throw new Error("playing expected");
      const actor = view.match.frame.turnPlayerId;
      const actorView = f.runtime.project(actor);
      const end = actorView.actions.find(action => action.kind === "end-turn");
      if (!end || end.kind !== "end-turn") throw new Error("end action required");
      f.runtime.dispatch(actor, packet(f.runtime, actor, `end-${turn}`, { type: "end-turn", windowId: end.windowId }));
      view = f.runtime.project("alice");
    }
    const spell = view.actions.find(action => action.kind === "play-card" && action.label === "施放法术");
    if (!spell || spell.kind !== "play-card") throw new Error("Spell not in real Hand");
    const play = packet(f.runtime, "alice", "same-spell", { type: "play-card", cardUID: spell.cardUID, windowId: spell.windowId });
    expect(f.runtime.dispatch("alice", play).ack.pending).toBe(true);
    const beforeRetry = f.runtime.project(null);
    const identities = f.uidCount();
    const privateBefore = fingerprintDuelAuthoritativeRuntimePrivateP4(f.runtime);
    const retry = f.runtime.dispatch("alice", play);
    expect(retry.ack.pending).toBe(true);
    expect(retry.ack.duplicate).toBe(true);
    expect(f.uidCount()).toBe(identities);
    expect(f.runtime.project(null).match).toEqual(beforeRetry.match);
    expect(fingerprintDuelAuthoritativeRuntimePrivateP4(f.runtime)).toBe(privateBefore);
    const other = f.runtime.dispatch("bob", { ...play, requestId: "other-request" });
    expect(other.ack.type).toBe("blocked");
    expect(other.ack.pending).toBe(true);
    expect(other.projection.match).toEqual(beforeRetry.match);
  }, 30_000);
});
