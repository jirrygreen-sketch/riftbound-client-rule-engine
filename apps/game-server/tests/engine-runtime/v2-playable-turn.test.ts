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

function advanceAuthorizationRuntime(): EngineRuntime {
  const deck = (seat: "A" | "B"): EngineRuntimeDeck => ({
    mainDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:unit:${index}`, cardId: `${seat}:unit-card`, name: `${seat} Unit`,
      types: ["unit"], energy: 0, power: null, might: 3,
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `${seat}:rune-card`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], energy: null, power: null, domains: ["Mind"],
    })),
    championLegend: { id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`,
      name: `Field ${index}`, types: ["battlefield"],
    })) as unknown as EngineRuntimeDeck["battlefields"],
  });
  const seats = ["A", "B"] as const;
  const programs: readonly CardProgram[] = seats.flatMap(seat => [
    { canonicalCardId: `${seat}:unit-card`, rulesetVersion: "core-1.5" as const,
      status: "executable" as const, sourceText: "RIFT-924 advance authorization fixture",
      abilities: [{ kind: "play" as const, cost: { energy: { kind: "constant" as const, value: 0 } }, body: [] }] },
    { canonicalCardId: `${seat}:rune-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "fixture", abilities: [] },
    { canonicalCardId: `${seat}:legend-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "fixture", abilities: [] },
    { canonicalCardId: `${seat}:champion-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "fixture", abilities: [] },
    ...[0, 1, 2].map(index => ({ canonicalCardId: `${seat}:field-card:${index}`,
      rulesetVersion: "core-1.5" as const, status: "no-ability" as const,
      sourceText: "fixture", abilities: [] })),
  ]);
  const decks = [deck("A"), deck("B")] as const;
  return createEngineRuntime({ matchId: "v2-advance-authorization", roomId: "v2-advance-authorization",
    decks, seed: "RIFT-924-advance-authorization", firstPlayer: "A", battlefieldChoice: [0, 0], programs })
    .start();
}

function playUnit(runtime: EngineRuntime, playerId: "A" | "B", commandId: string): string {
  const view = runtime.projectFor(playerId);
  const card = ownedHand(view, playerId).find(object => object.cardId === `${playerId}:unit-card`);
  expect(card).toBeTruthy();
  const receipt = submit(runtime, playerId, {
    type: "play", commandId, stateVersion: view.stateVersion, cardObjectId: card!.objectId,
    destination: { kind: "base", playerId },
  });
  expect(receipt.status, receipt.error).toBe("accepted");
  const chainView = runtime.projectFor(playerId);
  if (chainView.chain.items.length > 0) {
    const chainAdvance = submit(runtime, chainView.chain.priorityPlayerId!, {
      type: "advance", commandId: `${commandId}:unstable-chain`, stateVersion: chainView.stateVersion,
    });
    expect(chainAdvance.status).toBe("rejected");
    expect(runtime.projectFor(playerId).stateVersion).toBe(chainView.stateVersion);
    expect(runtime.projectFor(playerId).eventSeq).toBe(chainView.eventSeq);
  }
  settleChain(runtime, playerId, `${commandId}:chain`);
  return card!.objectId;
}

function endCurrentTurn(runtime: EngineRuntime, commandId: string): void {
  const view = runtime.projectFor(null);
  const receipt = submit(runtime, view.activePlayerId, {
    type: "end-turn", commandId, stateVersion: view.stateVersion,
  });
  expect(receipt.status, receipt.error).toBe("accepted");
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
    expect(showdown.actionOptions.canAdvance).toBe(false);
    const earlyAdvance = submit(runtime, "A", {
      type: "advance", commandId: "showdown-advance-too-early",
      stateVersion: showdown.stateVersion,
    });
    expect(earlyAdvance.status).toBe("rejected");
    expect(earlyAdvance.error).toMatch(/stable empty Chain/);
    expect(runtime.projectFor("A")).toEqual(showdown);
    const focusA = nextPass(runtime, "A", "showdown-focus-a");
    expect(focusA.status, focusA.error).toBe("accepted");
    const focusB = nextPass(runtime, "B", "showdown-focus-b");
    expect(focusB.status, focusB.error).toBe("accepted");
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

  it("authorizes advance only at the public Combat Showdown handoff", () => {
    const runtime = setup("v2-advance-auth", "RIFT-924-advance-auth");
    const main = runtime.projectFor("A");
    expect(main.phase).toBe("main");
    expect(main.actionOptions.canEndTurn).toBe(true);
    expect(main.actionOptions.canAdvance).toBe(false);
    expect(runtime.projectFor("B").actionOptions.canAdvance).toBe(false);
    expect(runtime.projectFor(null).actionOptions.canAdvance).toBe(false);

    const beforeMain = runtime.projectFor(null);
    for (const [player, commandId] of [["A", "main-advance"], ["B", "wrong-player-main-advance"]] as const) {
      const receipt = submit(runtime, player, {
        type: "advance", commandId, stateVersion: beforeMain.stateVersion,
      });
      expect(receipt.status).toBe("rejected");
      expect(receipt.stateVersion).toBe(beforeMain.stateVersion);
      expect(runtime.projectFor(null)).toEqual(beforeMain);
    }

    const beforeSpectator = runtime.projectFor(null);
    const spectator = runtime.submit(null as never, {
      type: "advance", commandId: "spectator-advance", stateVersion: beforeSpectator.stateVersion,
    });
    expect(spectator.receipt.status).toBe("rejected");
    expect(spectator.receipt.stateVersion).toBe(beforeSpectator.stateVersion);
    expect(runtime.projectFor(null)).toEqual(beforeSpectator);
    expect(runtime.journal().entries).toHaveLength(0);
  }, 120_000);

  it("binds advance and both combat-damage allocations to the public responsible actors", () => {
    const runtime = advanceAuthorizationRuntime();
    const aUnit = playUnit(runtime, "A", "auth-play-a");
    endCurrentTurn(runtime, "auth-end-a-1");
    const bUnit = playUnit(runtime, "B", "auth-play-b");
    endCurrentTurn(runtime, "auth-end-b-1");

    const aView = runtime.projectFor("A");
    const aMove = aView.actionOptions.moves.find(option => option.objectId === aUnit &&
      option.destination.kind === "battlefield");
    expect(aMove).toBeTruthy();
    const aMoved = submit(runtime, "A", {
      type: "move", commandId: "auth-move-a", stateVersion: aView.stateVersion, objectId: aUnit,
      to: { zone: "battlefield", locationId: aMove!.destination.kind === "battlefield"
        ? aMove!.destination.battlefieldId : "" },
    });
    expect(aMoved.status, aMoved.error).toBe("accepted");
    expect(nextPass(runtime, "A", "auth-a-showdown-focus-a").status).toBe("accepted");
    expect(nextPass(runtime, "B", "auth-a-showdown-focus-b").status).toBe("accepted");
    endCurrentTurn(runtime, "auth-end-a-2");

    const bView = runtime.projectFor("B");
    const bMove = bView.actionOptions.moves.find(option => option.objectId === bUnit &&
      option.destination.kind === "battlefield");
    expect(bMove).toBeTruthy();
    const bMoved = submit(runtime, "B", {
      type: "move", commandId: "auth-move-b", stateVersion: bView.stateVersion, objectId: bUnit,
      to: { zone: "battlefield", locationId: bMove!.destination.kind === "battlefield"
        ? bMove!.destination.battlefieldId : "" },
    });
    expect(bMoved.status, bMoved.error).toBe("accepted");
    expect(runtime.projectFor(null).combat).toMatchObject({ status: "active", step: "showdown" });
    expect(runtime.projectFor("A").actionOptions.canAdvance).toBe(false);
    expect(nextPass(runtime, "B", "auth-combat-focus-b").status).toBe("accepted");
    expect(nextPass(runtime, "A", "auth-combat-focus-a").status).toBe("accepted");

    const stable = runtime.projectFor(null);
    const responsible = runtime.projectFor("B");
    const other = runtime.projectFor("A");
    expect(stable.priority).toMatchObject({ playerId: "B", focusPlayerId: null, window: "open" });
    expect(stable.combat).toMatchObject({ status: "active", step: "showdown" });
    expect(responsible.actionOptions.canAdvance).toBe(true);
    expect(other.actionOptions.canAdvance).toBe(false);

    const beforeWrong = runtime.projectFor("A");
    const wrong = submit(runtime, "A", {
      type: "advance", commandId: "auth-advance-wrong-player", stateVersion: beforeWrong.stateVersion,
    });
    expect(wrong.status).toBe("rejected");
    expect(wrong.stateVersion).toBe(beforeWrong.stateVersion);
    expect(runtime.projectFor("A")).toEqual(beforeWrong);

    const beforeAdvance = runtime.projectFor("B");
    const advanced = submit(runtime, "B", {
      type: "advance", commandId: "auth-advance", stateVersion: beforeAdvance.stateVersion,
    });
    expect(advanced.status, advanced.error).toBe("accepted");
    const damage = runtime.projectFor(null).combat;
    expect(damage).toMatchObject({ status: "active", step: "damage", attackerPlayerId: "B", defenderPlayerId: "A" });
    if (damage.status !== "active" || damage.step !== "damage" || damage.damage === undefined || damage.combatId === undefined) {
      throw new Error("Expected an authoritative Combat damage window");
    }

    const beforeWrongDamage = runtime.projectFor("A");
    const wrongDamage = submit(runtime, "A", {
      type: "combat-damage", commandId: "auth-damage-wrong-actor",
      stateVersion: beforeWrongDamage.stateVersion, combatId: damage.combatId,
      assignments: [{ unitObjectId: aUnit, amount: damage.damage.attackerMight }],
    });
    expect(wrongDamage.status).toBe("rejected");
    expect(wrongDamage.stateVersion).toBe(beforeWrongDamage.stateVersion);
    expect(runtime.projectFor("A")).toEqual(beforeWrongDamage);

    const attacker = submit(runtime, "B", {
      type: "combat-damage", commandId: "auth-damage-b",
      stateVersion: runtime.projectFor("B").stateVersion, combatId: damage.combatId,
      assignments: [{ unitObjectId: aUnit, amount: damage.damage.attackerMight }],
    });
    expect(attacker.status, attacker.error).toBe("accepted");
    expect(runtime.projectFor("A").combat).toMatchObject({
      status: "active", step: "damage", damage: { attackerSubmitted: true, expectedPlayerId: "A" },
    });
    const defender = submit(runtime, "A", {
      type: "combat-damage", commandId: "auth-damage-a",
      stateVersion: runtime.projectFor("A").stateVersion, combatId: damage.combatId,
      assignments: [{ unitObjectId: bUnit, amount: damage.damage.defenderMight }],
    });
    expect(defender.status, defender.error).toBe("accepted");
    expect(runtime.projectFor(null).combat.status).toBe("none");
    const afterCombat = runtime.projectFor(null);
    expect(afterCombat.combat.status).toBe("none");
    expect(afterCombat.chain.items).toHaveLength(0);
    expect(afterCombat.priority).toMatchObject({ playerId: "B", focusPlayerId: null, window: "open" });
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
