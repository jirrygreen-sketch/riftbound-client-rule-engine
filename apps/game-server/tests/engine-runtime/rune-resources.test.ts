import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command } from "../../../../packages/protocol/dist/v2/index.js";

type M1Card = {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
  readonly domains?: readonly string[];
};

type M1Candidate = {
  readonly id: string;
  readonly chosenChampion: string;
  readonly officialCardList: readonly M1Card[];
};

const domains = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
const m1Catalog = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly M1Candidate[];
};
const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
  readonly cards: readonly {
    readonly id: string;
    readonly canonicalCardId: string;
    readonly variant: string;
    readonly tags: readonly string[];
    readonly energy: number | null;
    readonly power: number | null;
  }[];
};
const printingByCanonical = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));

function m1Deck(candidateId: string): EngineRuntimeDeck {
  const candidate = m1Catalog.candidates.find(item => item.id === candidateId);
  if (!candidate) throw new Error(`Unknown M1 candidate ${candidateId}`);
  const expand = (entries: readonly M1Card[], zone: string) => entries.flatMap(entry => Array.from({ length: entry.quantity }, (_, index) => {
    const printing = printingByCanonical.get(entry.canonicalCardId);
    return {
      id: `${candidate.id}:${zone}:${index}:${entry.canonicalCardId}`,
      cardId: entry.canonicalCardId,
      name: entry.name,
      types: [entry.cardType.toLowerCase()],
      tags: entry.zone === "runes" ? [...(printing?.tags ?? ["Basic"])] : [...(printing?.tags ?? [])],
      domains: (entry.domains ?? []).filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
        domains.has(domain)),
      energy: entry.zone === "runes" ? null : printing?.energy ?? null,
      power: entry.zone === "runes" ? null : printing?.power === null ? null : (entry.domains ?? [])
        .filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" => domains.has(domain)),
    };
  }));
  const legend = expand(candidate.officialCardList.filter(entry => entry.zone === "legend"), "legend");
  const chosen = candidate.officialCardList.find(entry => entry.zone === "champion" && entry.name === candidate.chosenChampion);
  if (!chosen) throw new Error(`Missing chosen champion for ${candidateId}`);
  const mainDeck = expand(candidate.officialCardList.filter(entry => entry.zone === "mainDeck"), "main");
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosen.canonicalCardId);
  if (chosenIndex >= 0) mainDeck.splice(chosenIndex, 1);
  const battlefields = expand(candidate.officialCardList.filter(entry => entry.zone === "battlefields"), "battlefield");
  return {
    mainDeck,
    runeDeck: expand(candidate.officialCardList.filter(entry => entry.zone === "runes"), "rune"),
    championLegend: legend[0]!,
    chosenChampion: expand([chosen], "champion")[0]!,
    battlefields: battlefields as EngineRuntimeDeck["battlefields"],
  };
}

function programs(...decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const entries = decks.flatMap(deck => [
    ...deck.mainDeck, ...deck.runeDeck, deck.championLegend, deck.chosenChampion, ...deck.battlefields,
  ]).flatMap(card => {
    const program = card.cardId ? cardProgramsById.get(card.cardId) : undefined;
    return program ? [program as unknown as CardProgram] : [];
  });
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function command(commandId: string, stateVersion: number, type: V2Command["type"] = "pass"): V2Command {
  return { type, commandId, stateVersion } as V2Command;
}

function toMain(runtime: ReturnType<typeof createEngineRuntime>, turn = 2): void {
  for (let index = 0; index < turn; index += 1) {
    const view = runtime.projectFor(null);
    runtime.submit(view.activePlayerId, command(`advance-${index}`, view.stateVersion));
  }
}

function readyRunes(runtime: ReturnType<typeof createEngineRuntime>, playerId: string) {
  const zone = runtime.projectFor(playerId).zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId);
  return (zone?.objects ?? []).filter(object => object.exhausted === false);
}

// Core Rules v1.5 (2026-10-09):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Rune rules: 164.1/164.2, 166.1, 357.1.a, 417.1.b, 430.2-430.3.
// Mind Rune canonical: card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b.
// Fury Rune canonical: card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902.
// Consult the Past canonical: card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007.
// Radiance CR303.2.a, effective 2026-10-16, was checked and adds no Rune-specific ordering rule.
describe("RIFT-861 real MatchRuntime Basic Rune resources", () => {
  it("turns four real Rune Energy adds into the real Consult the Past Energy cost", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    const runtime = createEngineRuntime({
      matchId: "duel:r861-rune-room",
      roomId: "r861-rune-room",
      decks: [deckA, deckB],
      seed: "r861-1",
      firstPlayer: "A",
      programs: programs(deckA, deckB),
    }).start();
    toMain(runtime, 4);
    const view = runtime.projectFor("A");
    expect(view.phase).toBe("main");
    const hand = view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [];
    const card = hand.find(object => object.name === "Consult the Past");
    expect(card?.cardId).toBe("card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007");
    const runes = readyRunes(runtime, "A");
    expect(runes.length).toBeGreaterThanOrEqual(4);
    let stateVersion = view.stateVersion;
    for (const [index, rune] of runes.slice(0, 4).entries()) {
      const result = runtime.submit("A", {
        type: "rune-energy",
        commandId: `rune-energy-${index}`,
        stateVersion,
        runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      });
      expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
      expect(result.receipt.result).toMatchObject({ resource: "energy", energyAdded: 1, powerAdded: [] });
      stateVersion = result.receipt.stateVersion;
    }
    const played = runtime.submit("A", {
      type: "play",
      commandId: "consult-the-past",
      stateVersion,
      cardObjectId: card!.objectId,
    });
    expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("accepted");
    expect(played.projection.players.find(player => player.playerId === "A")?.energy).toBe(0);
    expect(played.projection.chain.items).toContainEqual(expect.objectContaining({
      kind: "spell",
      sourceObjectId: card!.objectId,
      controllerPlayerId: "A",
    }));
    expect(played.projection.chain.phase).toBe("resolve");
    expect(played.projection.priority.window).toBe("closed");
    expect(played.projection.pendingChoice).toEqual({ status: "none" });
    const payer = played.projection.chain.priorityPlayerId;
    expect(payer).toBe("A");
    const firstPass = runtime.submit(payer!, {
      type: "pass",
      commandId: "pass-consult-the-past-a",
      stateVersion: played.receipt.stateVersion,
    });
    expect(firstPass.receipt.status, JSON.stringify(firstPass.receipt)).toBe("accepted");
    const resolved = runtime.submit("B", {
      type: "pass",
      commandId: "pass-consult-the-past-b",
      stateVersion: firstPass.receipt.stateVersion,
    });
    expect(resolved.receipt.status, JSON.stringify(resolved.receipt)).toBe("accepted");
    expect(resolved.projection.objects.find(object => object.objectId === card!.objectId)?.zone).toBe("trash");
  }, 120_000);

  it("does not duplicate a Rune command or spend the same Rune twice", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    const runtime = createEngineRuntime({
      matchId: "duel:r861-duplicate", roomId: "r861-duplicate",
      decks: [deckA, deckB], seed: "r861-1", firstPlayer: "A", programs: programs(deckA, deckB),
    }).start();
    toMain(runtime, 4);
    const rune = readyRunes(runtime, "A")[0]!;
    const input = {
      type: "rune-energy" as const,
      commandId: "single-rune-receipt",
      stateVersion: runtime.projectFor(null).stateVersion,
      runeObjectId: rune.objectId,
      zoneEntryId: rune.zoneEntryId!,
    };
    const accepted = runtime.submit("A", input);
    expect(accepted.receipt.status, JSON.stringify(accepted.receipt)).toBe("accepted");
    const duplicate = runtime.submit("A", input);
    expect(duplicate.receipt).toMatchObject({ status: "duplicate", stateVersion: accepted.receipt.stateVersion });
    expect(duplicate.projection.players.find(player => player.playerId === "A")?.energy).toBe(1);
    const restored = createEngineRuntime({
      matchId: "duel:r861-duplicate", roomId: "r861-duplicate",
      decks: [deckA, deckB], seed: "r861-1", firstPlayer: "A", programs: programs(deckA, deckB),
    }).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
  }, 120_000);

  it("restores a committed baseline after a late nested Rune Add failure and re-plans a clean retry", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    let failOnce = true;
    const runtime = createEngineRuntime({
      matchId: "duel:r861-late-rune", roomId: "r861-late-rune",
      decks: [deckA, deckB], seed: "r861-1", firstPlayer: "A", programs: programs(deckA, deckB),
      afterCommandExecution: command => {
        if (failOnce && command.type === "rune-energy") {
          failOnce = false;
          throw new Error("late nested Rune Add failure");
        }
      },
    }).start();
    toMain(runtime, 4);
    const before = runtime.projectFor("A");
    const journalBefore = runtime.journal();
    const rune = readyRunes(runtime, "A")[0]!;
    const input = {
      type: "rune-energy" as const, commandId: "late-rune-add", stateVersion: before.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    };
    const failed = runtime.submit("A", input);
    expect(failed.receipt.status).toBe("rejected");
    expect(failed.receipt.error).toBe("late nested Rune Add failure");
    expect(failed.projection).toEqual(before);
    expect(runtime.journal()).toEqual(journalBefore);
    const retried = runtime.submit("A", input);
    expect(retried.receipt.status, JSON.stringify(retried.receipt)).toBe("accepted");
    expect(retried.projection.players.find(player => player.playerId === "A")?.energy).toBe(1);
    expect(retried.projection.objects.find(object => object.objectId === rune.objectId)?.exhausted).toBe(true);
    expect(retried.receipt.eventSeq).toBeGreaterThan(failed.receipt.eventSeq);
    const duplicate = runtime.submit("A", input);
    expect(duplicate.receipt).toMatchObject({ status: "duplicate", eventSeq: retried.receipt.eventSeq });
    expect(duplicate.projection.players.find(player => player.playerId === "A")?.energy).toBe(1);
  }, 120_000);

  it("rejects a Power Request outside an authoritative Priority or parent payment window", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    const runtime = createEngineRuntime({
      matchId: "duel:power-0", roomId: "power-0",
      decks: [deckA, deckB], seed: "power-0", firstPlayer: "A", programs: programs(deckA, deckB),
    }).start();
    toMain(runtime, 4);
    const view = runtime.projectFor("B");
    const card = view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "B")
      ?.objects?.find(object => object.name === "B.F. Sword");
    expect(card).toBeTruthy();
    const orderRune = readyRunes(runtime, "B").find(rune => rune.name === "Order Rune");
    expect(orderRune).toBeTruthy();
    const power = runtime.submit("B", {
      type: "rune-power", commandId: "rune-power-order", stateVersion: view.stateVersion,
      runeObjectId: orderRune!.objectId, zoneEntryId: orderRune!.zoneEntryId!,
    });
    expect(view.activePlayerId).toBe("A");
    expect(power.receipt.status).toBe("rejected");
    expect(power.receipt.error).toBe("Only Reaction Add is allowed during payment");
    expect(power.receipt.stateVersion).toBe(view.stateVersion);
    expect(power.projection.players).toEqual(view.players);
    expect(power.projection.objects.find(object => object.objectId === orderRune!.objectId)?.zone).toBe("rune-zone");
    expect(power.projection.objects.find(object => object.objectId === orderRune!.objectId)?.exhausted).toBe(orderRune!.exhausted);
    expect(power.projection.objects.find(object => object.objectId === card!.objectId)?.zone).toBe("hand");
  }, 120_000);

  it("rejects stale incarnations, opponents, illegal windows and unknown ability ids without mutation", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    const runtime = createEngineRuntime({
      matchId: "duel:r861-rejections", roomId: "r861-rejections",
      decks: [deckA, deckB], seed: "r861-1", firstPlayer: "A", programs: programs(deckA, deckB),
    }).start();
    toMain(runtime, 4);
    const before = runtime.projectFor("A");
    const rune = readyRunes(runtime, "A")[0]!;
    const actor = runtime.projectFor(null).activePlayerId;
    const stale = runtime.submit("A", {
      type: "rune-energy", commandId: "stale-rune", stateVersion: before.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId! + 100,
    });
    expect(stale.receipt.status).toBe("rejected");
    expect(stale.receipt.error).toMatch(/Stale object reference|no longer current/);
    expect(stale.projection.players).toEqual(before.players);
    const opponent = runtime.submit("B", {
      type: "rune-energy", commandId: "opponent-rune", stateVersion: before.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
    expect(opponent.receipt.status).toBe("rejected");
    expect(opponent.receipt.error).toMatch(/control|payment/);
    const unknown = runtime.submit(actor, {
      type: "activate", commandId: "unknown-ability", stateVersion: before.stateVersion,
      sourceObjectId: rune.objectId, abilityId: "not-numeric",
    });
    expect(unknown.receipt.status).toBe("rejected");
    expect(unknown.receipt.error).toMatch(/Unknown ability/);
    expect(unknown.projection.players).toEqual(before.players);
  }, 120_000);

  it("routes move through the core Standard Move validator instead of arbitrary zone movement", () => {
    const deckA = m1Deck("rumble-sfd");
    const deckB = m1Deck("fiora-sfd");
    const runtime = createEngineRuntime({
      matchId: "duel:r861-move", roomId: "r861-move",
      decks: [deckA, deckB], seed: "r861-1", firstPlayer: "A", programs: programs(deckA, deckB),
    }).start();
    const hand = runtime.projectFor("A").zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")
      ?.objects?.[0];
    expect(hand).toBeTruthy();
    for (const to of [
      { zone: "deck" as const, position: "top" as const },
      { zone: "rune-deck" as const, position: "bottom" as const },
      { zone: "battlefield" as const, locationId: "forged-field" },
    ]) {
      const before = runtime.projectFor("A");
      const result = runtime.submit("A", {
        type: "move", commandId: `illegal-move-${to.zone}`, stateVersion: before.stateVersion,
        objectId: hand!.objectId, to,
      });
      expect(result.receipt.status).toBe("rejected");
      expect(result.receipt.error).toMatch(/Standard Move|Unknown Battlefield|Movement transaction/);
      expect(result.projection.objects.find(object => object.objectId === hand!.objectId)?.zone).toBe("hand");
      expect(result.projection.players).toEqual(before.players);
    }
  }, 120_000);
});
