import { describe, expect, it } from "vitest";

import dangerZone from "../../../../packages/card-dsl/dist/cards/sfd/danger-zone.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import { RIFT_1169_ENGINE_VERSION } from "../../src/engine-runtime/projection.js";

const CANONICAL_ID = "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e";
const RULES_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const EVIDENCE = Object.freeze({
  ruleset: "core-1.5", published: "2026-10-09", effective: "2026-10-16", url: RULES_URL,
  rules: ["135.2.e.5.a", "135.2.e.6.c", "312.2.c", "430.3", "813.1.c.1", "820.1.c.1"],
  canonicalCardId: CANONICAL_ID,
  processing: ["project play", "rune-energy", "rune-power", "play", "Finalize", "pay", "Resolve"],
});

type RuneDomain = "Fury" | "Mind" | "Order";

function deck(seat: "A" | "B", runeDomains: readonly RuneDomain[]): EngineRuntimeDeck {
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
    runeDeck: Array.from({ length: 12 }, (_, index) => {
      const runeDomain = runeDomains[index % runeDomains.length]!;
      return {
        id: `${seat}:rune:${index}`, cardId: `rune:${runeDomain}:${seat}`, name: `${runeDomain} Rune`,
        types: ["rune"], tags: ["Basic"], domains: [runeDomain], energy: null, power: null, might: null,
      } as const;
    }),
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

function runtime(aDomain: RuneDomain, bDomain: RuneDomain | readonly RuneDomain[] = "Order",
  includeDangerCatalog = true, engineVersion = RIFT_1169_ENGINE_VERSION): EngineRuntime {
  const bDomains = typeof bDomain === "string" ? [bDomain] : bDomain;
  const decks = [deck("A", [aDomain]), deck("B", bDomains)] as const;
  const programs = [
    dangerZone as unknown as CardProgram,
    program("unit:A"), program("unit:B"),
    program("legend:A"), program("legend:B"), program("champion:A"), program("champion:B"),
    ...[0, 1, 2].flatMap(index => [program(`field:A:${index}`), program(`field:B:${index}`)]),
    program(`rune:${aDomain}:A`), ...[...new Set(bDomains)].map(domain => program(`rune:${domain}:B`)),
  ];
  const printedCatalog = ["unit:A", "unit:B", ...(includeDangerCatalog ? [CANONICAL_ID] : [])].map(canonicalCardId => ({
    id: canonicalCardId, canonicalCardId, cardType: canonicalCardId.startsWith("unit:") ? "Unit" : "Spell",
    domains: canonicalCardId === CANONICAL_ID ? ["Fury", "Mind"] : ["Order"],
    energy: canonicalCardId === CANONICAL_ID ? 1 : 0, power: canonicalCardId === CANONICAL_ID ? 1 : null,
  }));
  const matchup = [aDomain, ...bDomains].join("-");
  return createEngineRuntime({ matchId: `RIFT-1169-${matchup}`, roomId: `RIFT-1169-${matchup}`,
    decks, seed: "seed-0", firstPlayer: "A", battlefieldChoice: [0, 0], programs, printedCatalog,
    engineVersion }).start();
}

function ownHand(view: V2Projection, player: "A" | "B") {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === player)?.objects ?? [];
}
function submit(runtime: EngineRuntime, player: "A" | "B", command: V2Command) { return runtime.submit(player, command); }

function fund(runtime: EngineRuntime, player: "A" | "B", domain: RuneDomain, tag: string): void {
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
  it("keeps legacy Closed State behavior pinned while the explicit version replays unchanged", () => {
    const legacy = runtime("Fury", "Mind", true, "@riftbound/engine-core/current");
    expect(legacy.journal().header.engineVersion).toBe("@riftbound/engine-core/current");
    endTurn(legacy, "A", "legacy:end-a");
    fund(legacy, "B", "Mind", "legacy:opener-fund");
    const openerView = legacy.projectFor("B");
    const opener = ownHand(openerView, "B").find(object => object.cardId === CANONICAL_ID)!;
    const opened = submit(legacy, "B", { type: "play", commandId: "legacy:opener",
      stateVersion: openerView.stateVersion, cardObjectId: opener.objectId });
    expect(opened.receipt.status, opened.receipt.error).toBe("pending");
    const openerChoice = legacy.projectFor("B").pendingChoice;
    if (openerChoice.status !== "pending") throw new Error("Repeat choice expected");
    const openerDeclined = submit(legacy, "B", { type: "choose", commandId: "legacy:opener-decline",
      stateVersion: legacy.projectFor("B").stateVersion, choiceId: openerChoice.choiceId, answer: false });
    expect(openerDeclined.receipt.status, openerDeclined.receipt.error).toBe("accepted");
    const passed = submit(legacy, "B", { type: "pass", commandId: "legacy:opener-pass",
      stateVersion: legacy.projectFor("B").stateVersion });
    expect(passed.receipt.status, passed.receipt.error).toBe("accepted");
    expect(legacy.projectFor("A").priority).toMatchObject({ playerId: "A", window: "closed" });
    expect(legacy.projectFor("A").actionOptions.plays).toEqual([]);
    const priorCurrent = runtime("Fury", "Mind", true,
      "@riftbound/engine-core/current+RIFT-1165.setup-battlefield-board-v1");
    endTurn(priorCurrent, "A", "prior-current:end-a");
    fund(priorCurrent, "B", "Mind", "prior-current:opener-fund");
    const priorOpenerView = priorCurrent.projectFor("B");
    const priorOpener = ownHand(priorOpenerView, "B").find(object => object.cardId === CANONICAL_ID)!;
    const priorOpened = submit(priorCurrent, "B", { type: "play", commandId: "prior-current:opener",
      stateVersion: priorOpenerView.stateVersion, cardObjectId: priorOpener.objectId });
    expect(priorOpened.receipt.status, priorOpened.receipt.error).toBe("pending");
    const priorChoice = priorCurrent.projectFor("B").pendingChoice;
    if (priorChoice.status !== "pending") throw new Error("Repeat choice expected");
    const priorDeclined = submit(priorCurrent, "B", { type: "choose", commandId: "prior-current:decline",
      stateVersion: priorCurrent.projectFor("B").stateVersion, choiceId: priorChoice.choiceId, answer: false });
    expect(priorDeclined.receipt.status, priorDeclined.receipt.error).toBe("accepted");
    const priorPassed = submit(priorCurrent, "B", { type: "pass", commandId: "prior-current:pass",
      stateVersion: priorCurrent.projectFor("B").stateVersion });
    expect(priorPassed.receipt.status, priorPassed.receipt.error).toBe("accepted");
    expect(priorCurrent.projectFor("A").priority).toMatchObject({ playerId: "A", window: "closed" });
    expect(priorCurrent.projectFor("A").actionOptions.plays).toEqual([]);
    const current = runtime("Fury", "Order");
    expect(current.journal().header.engineVersion).toBe(RIFT_1169_ENGINE_VERSION);
    const restored = createEngineRuntime({ matchId: current.matchId, roomId: current.matchId,
      decks: [deck("A", ["Fury"]), deck("B", ["Order"])] as const, seed: "seed-0", firstPlayer: "A",
      battlefieldChoice: [0, 0], programs: [dangerZone as unknown as CardProgram, program("unit:A"), program("unit:B"),
        program("legend:A"), program("legend:B"), program("champion:A"), program("champion:B"),
        ...[0, 1, 2].flatMap(index => [program(`field:A:${index}`), program(`field:B:${index}`)]),
        program("rune:Fury:A"), program("rune:Order:B")], printedCatalog: [
        { id: "unit:A", canonicalCardId: "unit:A", cardType: "Unit", domains: ["Order"], energy: 0, power: null },
        { id: "unit:B", canonicalCardId: "unit:B", cardType: "Unit", domains: ["Order"], energy: 0, power: null },
        { id: CANONICAL_ID, canonicalCardId: CANONICAL_ID, cardType: "Spell", domains: ["Fury", "Mind"],
          energy: 1, power: 1 },
      ] }).restore(current.journal());
    expect(restored.journal().header.engineVersion).toBe(RIFT_1169_ENGINE_VERSION);
    expect(restored.projectFor(null)).toEqual(current.projectFor(null));
    expect(restored.journal().head).toMatchObject({ stateDigest: current.journal().head.stateDigest,
      privateStateDigest: current.journal().head.privateStateDigest,
      journalDigest: current.journal().head.journalDigest });
  });

  it.each(["Fury", "Mind"] as const)("pays with %s after exhausting then recycling the Rune", domain => {
    expect(EVIDENCE).toMatchObject({ ruleset: "core-1.5", published: "2026-10-09", effective: "2026-10-16",
      rules: ["135.2.e.5.a", "135.2.e.6.c", "312.2.c", "430.3", "813.1.c.1", "820.1.c.1"],
      canonicalCardId: CANONICAL_ID });
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

  it("offers the Reaction in a non-Combat Neutral Closed State with Priority", () => {
    const game = runtime("Fury", ["Mind", "Order"]);
    endTurn(game, "A", "neutral-closed:end-a");
    fund(game, "B", "Mind", "neutral-closed:opener-fund");
    const openerView = game.projectFor("B");
    const opener = ownHand(openerView, "B").find(object => object.cardId === CANONICAL_ID)!;
    const opened = submit(game, "B", {
      type: "play", commandId: "neutral-closed:opener", stateVersion: openerView.stateVersion,
      cardObjectId: opener.objectId,
    });
    expect(opened.receipt.status, opened.receipt.error).toBe("pending");
    const openerRepeat = game.projectFor("B").pendingChoice;
    if (openerRepeat.status !== "pending") throw new Error("Repeat choice expected");
    const openerDeclined = submit(game, "B", {
      type: "choose", commandId: "neutral-closed:opener-repeat-decline",
      stateVersion: game.projectFor("B").stateVersion, choiceId: openerRepeat.choiceId, answer: false,
    });
    expect(openerDeclined.receipt.status, openerDeclined.receipt.error).toBe("accepted");
    expect(game.projectFor("A").combat).toEqual({ status: "none" });
    const passOpener = submit(game, "B", {
      type: "pass", commandId: "neutral-closed:opener-pass", stateVersion: game.projectFor("B").stateVersion,
    });
    expect(passOpener.receipt.status, passOpener.receipt.error).toBe("accepted");
    expect(game.projectFor("A").priority).toMatchObject({ playerId: "A", window: "closed" });

    for (const [kind, tag] of [["rune-energy", "energy"], ["rune-power", "power"]] as const) {
      const view = game.projectFor("A");
      const rune = view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects?.find(object =>
        object.cardId === "rune:Fury:A" && object.zoneEntryId !== undefined &&
        (kind === "rune-power" || object.exhausted === false));
      expect(rune, JSON.stringify(view.zones)).toBeDefined();
      const funded = submit(game, "A", {
        type: kind, commandId: `neutral-closed:${tag}`, stateVersion: view.stateVersion,
        runeObjectId: rune!.objectId, zoneEntryId: rune!.zoneEntryId!,
      });
      expect(funded.receipt.status, funded.receipt.error).toBe("accepted");
      if (kind === "rune-energy") {
        const handedBack = submit(game, "B", {
          type: "pass", commandId: "neutral-closed:energy-pass", stateVersion: game.projectFor("B").stateVersion,
        });
        expect(handedBack.receipt.status, handedBack.receipt.error).toBe("accepted");
      }
    }

    const passPower = submit(game, "B", {
      type: "pass", commandId: "neutral-closed:power-pass", stateVersion: game.projectFor("B").stateVersion,
    });
    expect(passPower.receipt.status, passPower.receipt.error).toBe("accepted");
    const view = game.projectFor("A");
    const card = ownHand(view, "A").find(object => object.cardId === CANONICAL_ID);
    expect(card).toBeDefined();
    expect(view.combat).toEqual({ status: "none" });
    expect(view.chain.status).toBe("closed");
    expect(view.priority).toMatchObject({ playerId: "A", window: "closed" });
    expect(view.actionOptions.plays).toContainEqual(expect.objectContaining({
      cardObjectId: card!.objectId, requiresDestination: false,
    }));
    const played = submit(game, "A", {
      type: "play", commandId: "neutral-closed:play", stateVersion: view.stateVersion,
      cardObjectId: card!.objectId,
    });
    expect(played.receipt.status, played.receipt.error).toBe("pending");
    const repeat = game.projectFor("A").pendingChoice;
    if (repeat.status !== "pending") throw new Error("Repeat choice expected");
    const declined = submit(game, "A", {
      type: "choose", commandId: "neutral-closed:repeat-decline",
      stateVersion: game.projectFor("A").stateVersion, choiceId: repeat.choiceId, answer: false,
    });
    expect(declined.receipt.status, declined.receipt.error).toBe("accepted");
    expect(game.projectFor("A").players.find(player => player.playerId === "A")).toMatchObject({ energy: 0, power: {} });
  });

  it("pays base [C] with Mind and Repeat rainbow Power with Order", () => {
    const game = runtime("Fury", ["Mind", "Order"]);
    endTurn(game, "A", "repeat:end-a");
    fund(game, "B", "Mind", "repeat:base");
    fund(game, "B", "Order", "repeat:rainbow");
    const view = game.projectFor("B");
    expect(view.players.find(player => player.playerId === "B")).toMatchObject({
      energy: 2, power: { Mind: 1, Order: 1 },
    });
    const card = ownHand(view, "B").find(object => object.cardId === CANONICAL_ID)!;
    expect(view.actionOptions.plays).toContainEqual(expect.objectContaining({ cardObjectId: card.objectId }));
    const played = submit(game, "B", {
      type: "play", commandId: "repeat:pay", stateVersion: view.stateVersion, cardObjectId: card.objectId,
    });
    expect(played.receipt.status, played.receipt.error).toBe("pending");
    const choice = game.projectFor("B").pendingChoice;
    if (choice.status !== "pending") throw new Error("Repeat choice expected");
    const paid = submit(game, "B", {
      type: "choose", commandId: "repeat:accept", stateVersion: game.projectFor("B").stateVersion,
      choiceId: choice.choiceId, answer: true,
    });
    expect(paid.receipt.status, paid.receipt.error).toBe("accepted");
    expect(game.projectFor("B").players.find(player => player.playerId === "B")).toMatchObject({ energy: 0, power: {} });
    const item = (game as unknown as { readonly match: {
      readonly flow: { readonly chain: { readonly items: readonly {
        readonly costPlan: { readonly total: { readonly energy: number; readonly power: readonly {
          readonly amount: number; readonly allowedDomains: readonly string[];
        }[] } };
        readonly payment: { readonly power: { readonly power: readonly {
          readonly requirementIndex: number; readonly from: string; readonly amount: number;
        }[] } };
      }[] } };
    } }).match.flow.chain.items[0]!;
    expect(item.costPlan.total.energy).toBe(2);
    expect(item.costPlan.total.power).toEqual([
      { amount: 1, allowedDomains: ["Fury", "Mind"] },
      { amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] },
    ]);
    expect(item.payment.power.power).toEqual([
      { requirementIndex: 0, from: "Mind", amount: 1 },
      { requirementIndex: 1, from: "Order", amount: 1 },
    ]);
  });

});
