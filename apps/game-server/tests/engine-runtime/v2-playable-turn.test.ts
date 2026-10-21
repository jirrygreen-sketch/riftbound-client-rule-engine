import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  buildM1Deck,
  type M1PreconId,
} from "../../../../packages/integration-tests/src/headless/decks.js";

function deck(id: M1PreconId, seat: "A" | "B"): EngineRuntimeDeck {
  const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
    readonly candidates: readonly {
      readonly id: string;
      readonly chosenChampion: string;
      readonly recommendedCardList: readonly {
        readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
        readonly canonicalCardId: string;
        readonly name: string;
        readonly quantity: number;
        readonly cardType: string;
        readonly domains: readonly string[];
      }[];
    };
  };
  const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
    readonly cards: readonly {
      readonly id: string;
      readonly canonicalCardId: string;
      readonly name: string;
      readonly cardType: string;
      readonly domains: readonly string[];
      readonly tags: readonly string[];
      readonly energy: number | null;
      readonly power: number | null;
      readonly might: number | null;
    }[];
  };
  const candidate = m1.candidates.find(value => value.id === id)!;
  const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
  const domainSet = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  const expand = (zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes") =>
    candidate.recommendedCardList.filter(entry => entry.zone === zone).flatMap(entry =>
      Array.from({ length: entry.quantity }, (_, index) => {
        const printed = printings.get(entry.canonicalCardId);
        if (!printed) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
        const allowed = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
          domainSet.has(domain));
        return {
          id: `${seat}:${zone}:${index}:${entry.canonicalCardId}`,
          cardId: entry.canonicalCardId,
          name: entry.name,
          types: [printed.cardType.toLowerCase()],
          tags: [...printed.tags],
          energy: zone === "runes" ? null : printed.energy,
          power: zone === "runes" || printed.power === null ? null : allowed,
          might: printed.might,
          domains: allowed,
        };
      }));
  return {
    mainDeck: expand("mainDeck"),
    runeDeck: expand("runes"),
    championLegend: expand("legend")[0]!,
    chosenChampion: expand("champion")[0]!,
    battlefields: expand("battlefields") as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const cards = decks.flatMap(value => [
    ...value.mainDeck,
    ...value.runeDeck,
    value.championLegend,
    value.chosenChampion,
    ...value.battlefields,
  ]);
  const entries = cards.flatMap(card => {
    const program = card.cardId === null || card.cardId === undefined
      ? undefined : cardProgramsById.get(card.cardId);
    return program === undefined ? [] : [program as unknown as CardProgram];
  });
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function setup(matchId: string, seed: string): EngineRuntime {
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId,
    roomId: matchId,
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    programs: programs(decks),
  }).start();
}

function submit(runtime: EngineRuntime, playerId: string, command: V2Command) {
  return runtime.submit(playerId, command).receipt;
}

function ownedHand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.cardId !== undefined && rune.zoneEntryId !== undefined);
}

function nextPass(runtime: EngineRuntime, playerId: string, id: string) {
  return submit(runtime, playerId, { type: "pass", commandId: id, stateVersion: runtime.projectFor(null).stateVersion });
}

function energyFor(runtime: EngineRuntime, playerId: string, commandId: string, count = Infinity): void {
  const view = runtime.projectFor(playerId);
  for (const [index, rune] of readyRunes(view, playerId).slice(0, count).entries()) {
    const receipt = submit(runtime, playerId, {
      type: "rune-energy", commandId: `${commandId}:rune:${index}`,
      stateVersion: runtime.projectFor(playerId).stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
    expect(receipt.status, receipt.error).toBe("accepted");
  }
}

function settleChain(runtime: EngineRuntime, owner: string, prefix: string): void {
  let index = 0;
  while (runtime.projectFor(null).chain.items.length > 0) {
    const actor = runtime.projectFor(null).chain.priorityPlayerId;
    if (actor === null) throw new Error("A nonempty Chain must have a Priority holder");
    const receipt = nextPass(runtime, actor, `${prefix}:pass:${index++}`);
    expect(receipt.status, receipt.error).toBe("accepted");
    expect(index).toBeLessThan(20);
  }
  // Keep the owner argument explicit: this helper never asserts a fabricated
  // actor and lets TurnFlow decide which player receives the next window.
  void owner;
}

function moveToBattlefield(runtime: EngineRuntime, playerId: string, objectId: string,
  battlefieldId: string, commandId: string) {
  const receipt = submit(runtime, playerId, {
    type: "move", commandId, stateVersion: runtime.projectFor(null).stateVersion,
      objectId, to: { zone: "battlefield", locationId: battlefieldId },
  });
  expect(receipt.status, receipt.error).toBe("accepted");
  return receipt;
}

function resolveShowdown(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; index < 24; index += 1) {
    const view = runtime.projectFor(null);
    if (view.combat.status === "active" && view.combat.step === "damage") return;
    if (view.chain.items.length > 0) {
      const actor = view.chain.priorityPlayerId;
      if (actor === null) throw new Error("A nonempty Chain must have a Priority holder");
      const receipt = nextPass(runtime, actor, `${prefix}:chain:${index}`);
      expect(receipt.status, receipt.error).toBe("accepted");
      continue;
    }
    if (view.combat.status === "active" && view.combat.step === "showdown") {
      const actor = view.priority.focusPlayerId;
      if (actor !== null) {
        const receipt = nextPass(runtime, actor, `${prefix}:focus:${index}`);
        expect(receipt.status, receipt.error).toBe("accepted");
      } else {
        const advance = submit(runtime, view.activePlayerId, {
          type: "advance", commandId: `${prefix}:advance:${index}`,
          stateVersion: view.stateVersion,
        });
        expect(advance.status, advance.error).toBe("accepted");
      }
      continue;
    }
    if (view.combat.status === "active") {
      const advance = submit(runtime, view.activePlayerId, {
        type: "advance", commandId: `${prefix}:advance:${index}`,
        stateVersion: view.stateVersion,
      });
      expect(advance.status, advance.error).toBe("accepted");
      continue;
    }
    return;
  }
  throw new Error("Showdown did not close");
}

describe("RIFT-924 protocol v2 playable turn runtime", () => {
  it("plays an M1 permanent to the chosen Base through real resource and Finalize checks", () => {
    const runtime = setup("v2-destination", "RIFT-924-search-4");
    const opening = runtime.projectFor("A");
    expect(opening.players.find(player => player.playerId === "A")?.energy).toBe(0);
    expect(opening.phase).toBe("main");
    expect(opening.actionOptions.canEndTurn).toBe(true);
    const bubbleBot = ownedHand(opening, "A").find(card => card.name === "Bubble Bot");
    expect(bubbleBot).toBeTruthy();
    for (let turn = 0; turn < 4; turn += 1) {
      const active = runtime.projectFor(null).activePlayerId;
      const ended = submit(runtime, active, {
        type: "end-turn", commandId: `destination-turn-${turn}`,
        stateVersion: runtime.projectFor(null).stateVersion,
      });
      expect(ended.status, ended.error).toBe("accepted");
    }
    energyFor(runtime, "A", "destination-energy");
    const view = runtime.projectFor("A");
    const play = view.actionOptions.plays.find(option => option.destination.kind === "base" &&
      ownedHand(view, "A").some(card => card.objectId === option.cardObjectId &&
        card.name === "Bubble Bot"));
    expect(play).toBeTruthy();
    // A controlled battlefield is not part of this deterministic opening. The
    // projection must still offer the Base of the viewer, never an enemy Base.
    expect(view.actionOptions.plays.filter(option => option.destination.kind === "base")
      .every(option => option.destination.kind === "base" && option.destination.playerId === "A")).toBe(true);
    const result = submit(runtime, "A", {
      type: "play", commandId: "destination-play", stateVersion: view.stateVersion,
      cardObjectId: play!.cardObjectId, destination: play!.destination,
    });
    expect(result.status, result.error).toBe("accepted");
    settleChain(runtime, "A", "destination-chain");
    const played = runtime.projectFor("A").objects.find(object => object.objectId === play!.cardObjectId);
    expect(played).toMatchObject({ zone: "board", location: { kind: "base", playerId: "A" } });
    expect(played?.exhausted).toBe(true);

    // Move in a later A turn through the public Standard Move command. Two
    // completed turn boundaries run A's next Awaken; the engine itself readies
    // the Base permanent and opens Showdown from the real location move.
    for (let index = 0; index < 2; index += 1) {
      const actor = runtime.projectFor(null).activePlayerId;
      const ended = submit(runtime, actor, {
        type: "end-turn", commandId: `after-play-turn-${index}`,
        stateVersion: runtime.projectFor(null).stateVersion,
      });
      expect(ended.status, ended.error).toBe("accepted");
    }
    const moveView = runtime.projectFor("A");
    const move = moveView.actionOptions.moves.find(option => option.objectId === play!.cardObjectId &&
      option.destination.kind === "battlefield");
    expect(move).toBeTruthy();
    const moved = submit(runtime, "A", {
      type: "move", commandId: "played-unit-standard-move", stateVersion: moveView.stateVersion,
      objectId: play!.cardObjectId,
      to: { zone: "battlefield", locationId: move!.destination.kind === "battlefield"
        ? move!.destination.battlefieldId : "" },
    });
    expect(moved.status, moved.error).toBe("accepted");
    const showdown = runtime.projectFor("A");
    expect(showdown.priority.window).toBe("showdown");
    expect(showdown.combat).toMatchObject({ status: "active", step: "showdown" });
    const focusA = nextPass(runtime, "A", "showdown-focus-a");
    expect(focusA.status, focusA.error).toBe("accepted");
    const focusB = nextPass(runtime, "B", "showdown-focus-b");
    expect(focusB.status, focusB.error).toBe("accepted");
    expect(runtime.projectFor("A").actionOptions.canAdvance).toBe(false);
    const advanced = submit(runtime, "A", {
      type: "advance", commandId: "showdown-advance",
      stateVersion: runtime.projectFor(null).stateVersion,
    });
    expect(advanced.status, advanced.error).toBe("accepted");
    expect(runtime.projectFor("A").scoring.players.find(player => player.playerId === "A")?.points)
      .toBeGreaterThanOrEqual(1);
    let winner = runtime.projectFor(null).winnerPlayerId;
    for (let turn = 0; turn < 40 && winner === null; turn += 1) {
      const current = runtime.projectFor(null);
      const ended = submit(runtime, current.activePlayerId, {
        type: "end-turn", commandId: `natural-turn-${turn}`, stateVersion: current.stateVersion,
      });
      expect(ended.status, ended.error).toBe("accepted");
      winner = runtime.projectFor(null).winnerPlayerId;
    }
    expect(winner).toBe("A");
    expect(runtime.projectFor(null).phase).toBe("ended");
  }, 120_000);

  it("does not silently drop illegal destinations or stale versions", () => {
    const runtime = setup("v2-errors", "RIFT-924-errors");
    const view = runtime.projectFor("A");
    const card = ownedHand(view, "A").find(object => object.cardId !== undefined);
    expect(card).toBeTruthy();
    const before = runtime.projectFor(null);
    const illegal = submit(runtime, "A", {
      type: "play", commandId: "illegal-destination", stateVersion: view.stateVersion,
      cardObjectId: card!.objectId,
      destination: { kind: "battlefield", battlefieldId: "not-a-field" },
    });
    expect(illegal.status).toBe("rejected");
    expect(illegal.error).toMatch(/Unknown Battlefield/);
    expect(runtime.projectFor(null).stateVersion).toBe(before.stateVersion);
    const stale = submit(runtime, "A", {
      type: "move", commandId: "stale-move", stateVersion: before.stateVersion,
      objectId: card!.objectId, to: { zone: "base", playerId: "A" },
    });
    // A valid current-version command gets an engine-owned object/route
    // rejection; the stale-version guard is asserted separately by changing
    // only the wire concurrency token on an otherwise valid shape.
    expect(stale.status).toBe("rejected");
    const beforeRejectedPass = runtime.projectFor(null);
    const staleGuard = runtime.submit("A", {
      type: "pass", commandId: "stale-guard", stateVersion: beforeRejectedPass.stateVersion + 1,
    }).receipt;
    expect(staleGuard.status).toBe("rejected");
    expect(staleGuard.error).toMatch(/stateVersion mismatch/);
    expect(runtime.projectFor(null).stateVersion).toBe(before.stateVersion);
  }, 120_000);

  it("rejects an unavailable Unit move without mutation", () => {
    const runtime = setup("v2-move", "RIFT-924-move");
    const before = runtime.projectFor(null);
    const invalid = submit(runtime, "A", {
      type: "move", commandId: "missing-unit-move", stateVersion: before.stateVersion,
      objectId: "missing-unit", to: { zone: "battlefield", locationId: "missing-field" },
    });
    expect(invalid.status).toBe("rejected");
    expect(invalid.error).toMatch(/Unknown object/);
    expect(runtime.projectFor(null).stateVersion).toBe(before.stateVersion);
  }, 120_000);

  it("rejects forged combat assignments and keeps an unstarted turn actionable", () => {
    const runtime = setup("v2-combat-reject", "RIFT-924-combat-reject");
    const view = runtime.projectFor("A");
    const before = runtime.projectFor(null);
    const receipt = submit(runtime, "A", {
      type: "combat-damage", commandId: "no-combat", stateVersion: view.stateVersion,
      combatId: "forged-combat", assignments: [{ unitObjectId: "missing", amount: 1 }],
    });
    expect(receipt.status).toBe("rejected");
    expect(receipt.error).toMatch(/No Combat is active/);
    expect(runtime.projectFor(null).stateVersion).toBe(before.stateVersion);
    expect(view.actionOptions).toMatchObject({ canEndTurn: true });
  }, 120_000);
});
