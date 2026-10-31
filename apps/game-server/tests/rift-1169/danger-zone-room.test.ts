import { describe, expect, it } from "vitest";

import dangerZone from "../../../../packages/card-dsl/dist/cards/sfd/danger-zone.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

const CANONICAL_ID = "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e";
const RULES_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const EVIDENCE = Object.freeze({
  ruleset: "core-1.5", published: "2026-10-09", effective: "2026-10-16", url: RULES_URL,
  rules: ["135.2.e.6.c", "430.3", "820.1.c.1"], canonicalCardId: CANONICAL_ID,
  processing: ["project play", "rune-energy", "rune-power", "play", "Finalize", "pay", "Resolve"],
});

function deck(seat: "A" | "B", runeDomain: "Fury" | "Mind" | "Order"): EngineRuntimeDeck {
  return {
    mainDeck: [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `${seat}:danger:${index}`, cardId: CANONICAL_ID, name: "Danger Zone", types: ["spell"],
        domains: ["Fury", "Mind"] as const, energy: 1, power: ["Fury", "Mind"] as const, might: null,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `${seat}:unit:${index}`, cardId: `unit:${seat}`, name: "Unit", types: ["unit"],
        domains: ["Order"] as const, energy: 0, power: null, might: 2,
      })),
    ],
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `rune:${runeDomain}:${seat}`, name: `${runeDomain} Rune`,
      types: ["rune"], tags: ["Basic"], domains: [runeDomain], energy: null, power: null, might: null,
    })),
    championLegend: { id: `${seat}:legend`, cardId: `legend:${seat}`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `champion:${seat}`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `field:${seat}:${index}`, name: `Field ${index}`, types: ["battlefield"],
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function program(canonicalCardId: string): CardProgram {
  return { canonicalCardId, rulesetVersion: "core-1.5", status: "executable", sourceText: "RIFT-1169 room fixture",
    abilities: [{ kind: "play", cost: { energy: { kind: "constant", value: 0 } }, body: [] }] };
}

function runtime(aDomain: "Fury" | "Mind", bDomain: "Mind" | "Order" = "Order",
  includeDangerCatalog = true): EngineRuntime {
  const decks = [deck("A", aDomain), deck("B", bDomain)] as const;
  const programs = [
    dangerZone as unknown as CardProgram,
    program("unit:A"), program("unit:B"),
    program("legend:A"), program("legend:B"), program("champion:A"), program("champion:B"),
    ...[0, 1, 2].flatMap(index => [program(`field:A:${index}`), program(`field:B:${index}`)]),
    program(`rune:${aDomain}:A`), program(`rune:${bDomain}:B`),
  ];
  const printedCatalog = ["unit:A", "unit:B", ...(includeDangerCatalog ? [CANONICAL_ID] : [])].map(canonicalCardId => ({
    id: canonicalCardId, canonicalCardId, cardType: canonicalCardId.startsWith("unit:") ? "Unit" : "Spell",
    domains: canonicalCardId === CANONICAL_ID ? ["Fury", "Mind"] : ["Order"],
    energy: canonicalCardId === CANONICAL_ID ? 1 : 0, power: canonicalCardId === CANONICAL_ID ? 1 : null,
  }));
  return createEngineRuntime({ matchId: `RIFT-1169-${aDomain}-${bDomain}`, roomId: `RIFT-1169-${aDomain}-${bDomain}`,
    decks, seed: "seed-0", firstPlayer: "A", battlefieldChoice: [0, 0], programs, printedCatalog }).start();
}

function ownHand(view: V2Projection, player: "A" | "B") {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === player)?.objects ?? [];
}
function submit(runtime: EngineRuntime, player: "A" | "B", command: V2Command) { return runtime.submit(player, command); }

function fund(runtime: EngineRuntime, player: "A" | "B", domain: "Fury" | "Mind", tag: string): void {
  for (const kind of ["rune-energy", "rune-power"] as const) {
    const view = runtime.projectFor(player);
    const rune = view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === player)?.objects?.find(object =>
      (kind === "rune-power" || object.exhausted === false) &&
      object.cardId === `rune:${domain}:${player}` && object.zoneEntryId !== undefined);
    expect(rune, JSON.stringify(view.zones)).toBeDefined();
    const result = submit(runtime, player, { type: kind, commandId: `${tag}:${kind}`, stateVersion: view.stateVersion,
      runeObjectId: rune!.objectId, zoneEntryId: rune!.zoneEntryId! });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  }
}

function playUnit(runtime: EngineRuntime, player: "A" | "B", tag: string): string {
  const view = runtime.projectFor(player);
  const unit = ownHand(view, player).find(object => object.cardId === `unit:${player}`);
  expect(unit, JSON.stringify(ownHand(view, player))).toBeDefined();
  const option = view.actionOptions.plays.find(candidate => candidate.cardObjectId === unit!.objectId);
  expect(option, JSON.stringify(view.actionOptions.plays)).toBeDefined();
  const result = submit(runtime, player, { type: "play", commandId: tag, stateVersion: view.stateVersion,
    cardObjectId: unit!.objectId, destination: option!.destination });
  expect(result.receipt.status, result.receipt.error).toBe("accepted");
  return unit!.objectId;
}

function endTurn(runtime: EngineRuntime, player: "A" | "B", tag: string): void {
  const view = runtime.projectFor(player);
  const result = submit(runtime, player, { type: "end-turn", commandId: tag, stateVersion: view.stateVersion });
  expect(result.receipt.status, result.receipt.error).toBe("accepted");
}

describe("RIFT-1169 Danger Zone real engine room", () => {
  it.each(["Fury", "Mind"] as const)("pays with %s after exhausting then recycling the Rune", domain => {
    expect(EVIDENCE).toMatchObject({ ruleset: "core-1.5", published: "2026-10-09", effective: "2026-10-16",
      rules: ["135.2.e.6.c", "430.3", "820.1.c.1"], canonicalCardId: CANONICAL_ID });
    const game = runtime(domain);
    const card = ownHand(game.projectFor("A"), "A").find(object => object.cardId === CANONICAL_ID);
    expect(card).toBeDefined();
    expect(game.projectFor("A").actionOptions.plays).not.toContainEqual(expect.objectContaining({ cardObjectId: card!.objectId }));
    fund(game, "A", domain, domain.toLowerCase());
    const funded = game.projectFor("A");
    expect(funded.actionOptions.plays).toContainEqual(expect.objectContaining({ cardObjectId: card!.objectId, requiresDestination: false }));
    const play = funded.actionOptions.plays.find(option => option.cardObjectId === card!.objectId)!;
    const result = submit(game, "A", { type: "play", commandId: "mind:play", stateVersion: funded.stateVersion,
      cardObjectId: card!.objectId, ...(play.requiresDestination ? { destination: play.destination } : {}) });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("pending");
    const choice = game.projectFor("A").pendingChoice;
    expect(choice).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "optional" });
    if (choice.status !== "pending") throw new Error("Repeat choice expected");
    const declined = submit(game, "A", { type: "choose", commandId: "mind:repeat:decline",
      stateVersion: game.projectFor("A").stateVersion, choiceId: choice.choiceId, answer: false });
    expect(declined.receipt.status, declined.receipt.error).toBe("accepted");
    expect(game.projectFor("A").players.find(player => player.playerId === "A")).toMatchObject({ energy: 0, power: {} });
  });

  it("does not offer the spell with neither Fury nor Mind Power", () => {
    const game = runtime("Order");
    fund(game, "A", "Order", "wrong-domain");
    const view = game.projectFor("A");
    const card = ownHand(view, "A").find(object => object.cardId === CANONICAL_ID);
    expect(card).toBeDefined();
    expect(view.players.find(player => player.playerId === "A")?.energy).toBe(1);
    expect(view.players.find(player => player.playerId === "A")?.power).toEqual({ Order: 1 });
    expect(view.actionOptions.plays).not.toContainEqual(
      expect.objectContaining({ cardObjectId: card!.objectId }),
    );
  });

  it("offers the Reaction to the non-acting Focus holder in a real Combat Showdown", () => {
    const game = runtime("Fury", "Mind");
    fund(game, "A", "Fury", "showdown:a-fund");
    playUnit(game, "A", "showdown:play-a");
    endTurn(game, "A", "showdown:end-a");
    playUnit(game, "B", "showdown:play-b");
    endTurn(game, "B", "showdown:end-b");
    const aView = game.projectFor("A");
    const aUnit = aView.objects.find(object => object.cardId === "unit:A" && object.zone === "board");
    const move = aView.actionOptions.moves.find(option => option.objectId === aUnit?.objectId && option.destination.kind === "battlefield");
    expect(move, JSON.stringify(aView.actionOptions.moves)).toBeDefined();
    const moved = submit(game, "A", { type: "move", commandId: "showdown:move-a", stateVersion: aView.stateVersion,
      objectId: move!.objectId, to: { zone: "battlefield", locationId: move!.destination.kind === "battlefield"
        ? move!.destination.battlefieldId : "" } });
    expect(moved.receipt.status, moved.receipt.error).toBe("accepted");
    expect(game.projectFor("B").combat).toMatchObject({ status: "active", step: "showdown" });
    expect(game.projectFor("A").priority.focusPlayerId).toBe("A");
    const passed = submit(game, "A", { type: "pass", commandId: "showdown:pass-focus-a",
      stateVersion: game.projectFor("A").stateVersion });
    expect(passed.receipt.status, passed.receipt.error).toBe("accepted");
    expect(game.projectFor("B").priority.focusPlayerId).toBe("B");
    const card = ownHand(game.projectFor("B"), "B").find(object => object.cardId === CANONICAL_ID);
    expect(card).toBeDefined();
    expect(game.projectFor("B").actionOptions.plays).not.toContainEqual(expect.objectContaining({ cardObjectId: card!.objectId }));
    fund(game, "B", "Mind", "showdown:mind");
    const funded = game.projectFor("B");
    expect(funded.actionOptions.plays).toContainEqual(expect.objectContaining({ cardObjectId: card!.objectId, requiresDestination: false }));
    const played = submit(game, "B", { type: "play", commandId: "showdown:play-danger", stateVersion: funded.stateVersion,
      cardObjectId: card!.objectId });
    expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("pending");
    const repeat = game.projectFor("B").pendingChoice;
    expect(repeat).toMatchObject({ status: "pending", ownerPlayerId: "B", kind: "optional" });
    if (repeat.status !== "pending") throw new Error("Repeat choice expected");
    const declined = submit(game, "B", {
      type: "choose", commandId: "showdown:repeat:decline", stateVersion: game.projectFor("B").stateVersion,
      choiceId: repeat.choiceId, answer: false,
    });
    expect(declined.receipt.status, declined.receipt.error).toBe("accepted");
    expect(game.projectFor("B").players.find(player => player.playerId === "B")?.energy).toBe(0);
    expect(game.projectFor("B").players.find(player => player.playerId === "B")?.power).toEqual({});
  });

  it("uses the trusted numerical Power amount instead of the Domain-set width", () => {
    const game = runtime("Fury", "Mind");
    const card = ownHand(game.projectFor("A"), "A").find(object => object.cardId === CANONICAL_ID)!;
    fund(game, "A", "Fury", "power-width");
    const view = game.projectFor("A");
    expect(view.actionOptions.plays).toContainEqual(expect.objectContaining({ cardObjectId: card.objectId }));
    const internal = game as unknown as {
      readonly runtimeOptions: { readonly printedCatalog?: readonly { readonly canonicalCardId: string; readonly power: number | null }[] };
      readonly binding: { readonly printedCatalog: (cardId: string) => unknown };
    };
    expect(internal.runtimeOptions.printedCatalog?.find(row => row.canonicalCardId === CANONICAL_ID)?.power).toBe(1);
    expect(internal.binding.printedCatalog(CANONICAL_ID)).toMatchObject({ power: 1, energy: 1, domains: ["Fury", "Mind"] });
  });

  it("fails closed when a multi-domain Power card has no trusted catalog row", () => {
    const game = runtime("Fury", "Order", false);
    fund(game, "A", "Fury", "missing-row");
    const view = game.projectFor("A");
    const card = ownHand(view, "A").find(object => object.cardId === CANONICAL_ID);
    expect(card).toBeDefined();
    expect(view.actionOptions.plays).not.toContainEqual(expect.objectContaining({ cardObjectId: card!.objectId }));
  });

});
