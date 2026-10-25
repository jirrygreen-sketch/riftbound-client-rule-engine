import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

type M1DeckId = "rumble-sfd" | "fiora-sfd";
const PORT_FIELD = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";

const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly {
    readonly id: M1DeckId;
    readonly chosenChampion: string;
    readonly recommendedCardList: readonly {
      readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
      readonly canonicalCardId: string;
      readonly name: string;
      readonly quantity: number;
      readonly cardType: string;
      readonly domains: readonly string[];
    }[];
  }[];
};
const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
  readonly cards: readonly {
    readonly id: string;
    readonly canonicalCardId: string;
    readonly name: string;
    readonly fullName?: string;
    readonly cardType: string;
    readonly domains: readonly string[];
    readonly tags: readonly string[];
    readonly energy: number | null;
    readonly power: number | null;
    readonly might: number | null;
  }[];
};
const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
const domains = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
let serial = 0;

function deck(id: M1DeckId, seat: "A" | "B"): EngineRuntimeDeck {
  const candidate = m1.candidates.find(value => value.id === id)!;
  const expand = (zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes") =>
    candidate.recommendedCardList.filter(entry => entry.zone === zone).flatMap(entry =>
      Array.from({ length: entry.quantity }, () => {
        const printed = printings.get(entry.canonicalCardId);
        if (!printed) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
        const allowed = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
          domains.has(domain));
        return {
          id: `${seat}:${zone}:${serial++}:${entry.canonicalCardId}`,
          cardId: entry.canonicalCardId,
          canonicalCardId: entry.canonicalCardId,
          name: entry.name,
          types: [printed.cardType.toLowerCase()],
          tags: [...printed.tags],
          energy: zone === "runes" ? null : printed.energy,
          power: zone === "runes" || printed.power === null ? null : allowed,
          might: printed.might,
          domains: allowed,
        };
      }));
  const mainDeck = expand("mainDeck");
  const chosen = candidate.recommendedCardList.find(entry => entry.zone === "champion" && entry.name === candidate.chosenChampion)!;
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosen.canonicalCardId);
  if (chosenIndex >= 0) mainDeck.splice(chosenIndex, 1);
  return {
    mainDeck,
    runeDeck: expand("runes"),
    championLegend: expand("legend")[0]!,
    chosenChampion: expand("champion")[0]!,
    battlefields: expand("battlefields") as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const entries = decks.flatMap(deck => [
    ...deck.mainDeck, ...deck.runeDeck, deck.championLegend, deck.chosenChampion, ...deck.battlefields,
  ]).flatMap(card => card.cardId === null || card.cardId === undefined
    ? [] : [cardProgramsById.get(card.cardId)]).filter((program): program is CardProgram => program !== undefined);
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function setup(seed = "m1-choice-source-1"): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId: "rift-1069-choice-source",
    roomId: "rift-1069-choice-source",
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [2, 2],
    programs: programs(decks),
  }).start();
}

function submit(runtime: EngineRuntime, playerId: string, command: V2Command) {
  return runtime.submit(playerId, command);
}

function endTurn(runtime: EngineRuntime, prefix: string): void {
  const view = runtime.projectFor(null);
  expect(submit(runtime, view.activePlayerId, {
    type: "end-turn", commandId: prefix, stateVersion: view.stateVersion,
  }).receipt.status).toBe("accepted");
}

function moveToPort(runtime: EngineRuntime, prefix: string): void {
  for (;;) {
    const view = runtime.projectFor("A");
    expect(view.phase).toBe("main");
    const port = view.objects.find(object => object.cardId === PORT_FIELD && object.ownerPlayerId === "A")!;
    const move = view.actionOptions.moves.find(option => option.destination.kind === "battlefield" &&
      option.destination.battlefieldId === port.objectId);
    if (move === undefined) throw new Error(`No legal Treasure Hoard move: ${JSON.stringify(view.actionOptions.moves)}`);
    const result = submit(runtime, "A", {
      type: "move", commandId: prefix, stateVersion: view.stateVersion, objectId: move.objectId,
      to: { zone: "battlefield", locationId: port.objectId },
    });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    return;
  }
}

describe("RIFT-1069 V2 choice source", () => {
  it("projects a real M1 Treasure Hoard optional effect to the chooser only", () => {
    const runtime = setup();
    const opening = runtime.projectFor("A");
    const hand = opening.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [];
    const poro = hand.find(object => object.name === "Plundering Poro");
    expect(poro).toBeDefined();
    endTurn(runtime, "setup-a");
    endTurn(runtime, "setup-b");
    const runes = runtime.projectFor("A").zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [];
    for (const [index, rune] of runes.filter(rune => rune.exhausted === false).slice(0, 2).entries()) {
      const view = runtime.projectFor("A");
      expect(submit(runtime, "A", {
        type: "rune-energy", commandId: `port-energy:${index}`, stateVersion: view.stateVersion,
        runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
      }).receipt.status).toBe("accepted");
    }
    const playView = runtime.projectFor("A");
    const currentPoro = (playView.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [])
      .find(object => object.name === "Plundering Poro")!;
    expect(submit(runtime, "A", {
      type: "play", commandId: "play-plundering-poro", stateVersion: playView.stateVersion,
      cardObjectId: currentPoro.objectId, destination: { kind: "base", playerId: "A" },
    }).receipt.status).toBe("accepted");
    endTurn(runtime, "after-poro-a");
    endTurn(runtime, "after-poro-b");
    moveToPort(runtime, "conquer-treasure-hoard");
    let pending: ReturnType<EngineRuntime["projectFor"]>["pendingChoice"] | null = null;
    for (let index = 0; index < 8; index += 1) {
      const view = runtime.projectFor(null);
      if (view.pendingChoice.status === "pending") { pending = view.pendingChoice; break; }
      const actor = view.priority.focusPlayerId ?? view.priority.playerId;
      if (actor === null) break;
      const result = submit(runtime, actor, {
        type: "pass", commandId: `resolve-port:${index}`, stateVersion: view.stateVersion,
      });
      expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
      if (result.receipt.status === "pending") { pending = result.projection.pendingChoice; break; }
    }
    // A real Conquer may surface a mandatory trigger-order mode before the
    // optional Finalize request. If it does, select only Treasure Hoard's
    // registered trigger; a single trigger may also reach its optional
    // Finalize directly. Both are engine-owned production paths.
    while (pending?.status === "pending" && pending.kind === "mode") {
      const ownerPending = runtime.projectFor(pending.ownerPlayerId).pendingChoice;
      expect(ownerPending).toMatchObject({ status: "pending", choiceId: pending.choiceId, kind: "mode" });
      if (ownerPending.status !== "pending") throw new Error("Trigger-order mode must remain pending for its owner");
      const option = ownerPending.options?.find(candidate => candidate.label === "Treasure Hoard");
      expect(option, JSON.stringify(ownerPending)).toBeDefined();
      const selected = submit(runtime, pending.ownerPlayerId, {
        type: "choose", commandId: `select-trigger:${pending.choiceId}`,
        stateVersion: runtime.projectFor(null).stateVersion,
        choiceId: pending.choiceId, answer: option!.value ?? option!.id,
      });
      expect(["accepted", "pending"], JSON.stringify(selected.receipt)).toContain(selected.receipt.status);
      pending = selected.projection.pendingChoice;
    }
    expect(pending).toMatchObject({
      status: "pending", kind: "optional", ownerPlayerId: "A",
      source: { name: "Treasure Hoard" },
    });
    expect(pending?.status === "pending" ? pending.prompt : undefined)
      .toBe("Pay 1 energy to play a Gold gear token exhausted?");
    const sourceId = pending?.status === "pending" ? pending.source?.objectId : undefined;
    expect(sourceId).toBeDefined();
    expect(runtime.projectFor("A").pendingChoice).toMatchObject({ source: { objectId: sourceId, name: "Treasure Hoard" } });
    const opponent = runtime.projectFor("B").pendingChoice;
    expect(opponent).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "optional" });
    expect(opponent).not.toHaveProperty("source");
    expect(opponent).not.toHaveProperty("prompt");
  }, 120_000);
});
