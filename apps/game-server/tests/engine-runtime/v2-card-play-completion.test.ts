import { describe, expect, it } from "vitest";
import forecaster from "../../../../packages/card-dsl/dist/cards/sfd/forecaster.js";
import gemJammer from "../../../../packages/card-dsl/dist/cards/sfd/gem-jammer.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import { botCommand } from "../../../../packages/integration-tests/src/v2-duel/bot.js";

type PlayedCard = {
  readonly name: "Forecaster" | "Gem Jammer";
  readonly canonicalCardId: string;
  readonly domain: "Fury" | "Mind";
  readonly program: CardProgram;
};

const minions: Readonly<Record<PlayedCard["name"], PlayedCard>> = {
  Forecaster: {
    name: "Forecaster",
    canonicalCardId: forecaster.canonicalCardId,
    domain: "Mind",
    program: forecaster satisfies CardProgram,
  },
  "Gem Jammer": {
    name: "Gem Jammer",
    canonicalCardId: gemJammer.canonicalCardId,
    domain: "Fury",
    program: gemJammer satisfies CardProgram,
  },
};

function deck(card: PlayedCard, seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) => ({
      id: `${seat}:${card.name}:${index}`,
      cardId: card.canonicalCardId,
      name: card.name,
      types: ["unit"],
      tags: ["Mech"],
      energy: 2,
      power: null,
      might: 2,
      domains: [card.domain],
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:${card.domain}:rune:${index}`,
      cardId: `${seat}:${card.domain}:rune-card:${index}`,
      name: `${card.domain} Rune`,
      types: ["rune"],
      tags: ["Basic"],
      energy: null,
      power: null,
      domains: [card.domain],
    })),
    championLegend: {
      id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Test Legend",
      types: ["legend"], tags: [], energy: null, power: null, might: null,
    },
    chosenChampion: {
      id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Test Champion",
      types: ["champion"], tags: [], energy: null, power: null, might: null,
    },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`,
      name: `Field ${index}`, types: ["battlefield"], tags: [], energy: null, power: null, might: null,
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function setup(card: PlayedCard): ReturnType<typeof createEngineRuntime> {
  return createEngineRuntime({
    matchId: `rift-997:${card.name}`,
    roomId: `rift-997:${card.name}`,
    decks: [deck(card, "A"), deck(card, "B")],
    seed: `RIFT-997:${card.name}`,
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    programs: [card.program],
  }).start();
}

function command<T extends V2Command["type"]>(type: T, commandId: string, stateVersion: number,
  fields: Omit<Extract<V2Command, { readonly type: T }>, "type" | "commandId" | "stateVersion">): V2Command {
  return { type, commandId, stateVersion, ...fields } as V2Command;
}

function ownedHand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.cardId !== undefined && rune.zoneEntryId !== undefined);
}

function finishSetupToTurnThree(runtime: ReturnType<typeof createEngineRuntime>): void {
  for (let index = 0; index < 2; index += 1) {
    const view = runtime.projectFor(null);
    const receipt = runtime.submit(view.activePlayerId,
      command("end-turn", `finish-setup-${index}`, view.stateVersion, {})).receipt;
    expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  }
  expect(runtime.projectFor(null)).toMatchObject({ turnNumber: 3, activePlayerId: "A", phase: "main" });
}

function gainEnergy(runtime: ReturnType<typeof createEngineRuntime>, prefix: string): V2Projection {
  let view = runtime.projectFor("A");
  for (const [index, rune] of readyRunes(view, "A").slice(0, 2).entries()) {
    const result = runtime.submit("A", command("rune-energy", `${prefix}:rune:${index}`, view.stateVersion, {
      runeObjectId: rune.objectId,
      zoneEntryId: rune.zoneEntryId!,
    }));
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    view = result.projection;
  }
  return view;
}

function resolvePlayTriggerToChoice(runtime: ReturnType<typeof createEngineRuntime>, prefix: string) {
  const view = runtime.projectFor(null);
  const firstActor = view.chain.priorityPlayerId ?? view.priority.playerId;
  expect(firstActor, JSON.stringify(view)).not.toBeNull();
  const first = runtime.submit(firstActor!, command("pass", `${prefix}:pass:a`, view.stateVersion, {}));
  expect(first.receipt.status, JSON.stringify(first.receipt)).toBe("accepted");
  const secondView = runtime.projectFor(null);
  const secondActor = secondView.chain.priorityPlayerId ?? secondView.priority.playerId;
  expect(secondActor, JSON.stringify(secondView)).not.toBeNull();
  return runtime.submit(secondActor!, command("pass", `${prefix}:pass:b`, secondView.stateVersion, {}));
}

function settleChain(runtime: ReturnType<typeof createEngineRuntime>, prefix: string): void {
  for (let index = 0; index < 8 && runtime.projectFor(null).chain.items.length > 0; index += 1) {
    const view = runtime.projectFor(null);
    const actor = view.chain.priorityPlayerId ?? view.priority.playerId;
    expect(actor, JSON.stringify(view)).not.toBeNull();
    const receipt = runtime.submit(actor!, command("pass", `${prefix}:settle:${index}`, view.stateVersion, {})).receipt;
    expect(["accepted", "pending"], JSON.stringify(receipt)).toContain(receipt.status);
    if (receipt.status === "pending") throw new Error(`Unexpected nested choice while settling ${prefix}`);
  }
  expect(runtime.projectFor(null).chain.items).toEqual([]);
}

function settleCombat(runtime: ReturnType<typeof createEngineRuntime>, prefix: string): void {
  for (let index = 0; index < 16; index += 1) {
    const view = runtime.projectFor(null);
    if (view.combat.status === "none" && view.phase === "main") return;
    if (view.actionOptions.canAdvance && view.activePlayerId !== null) {
      const receipt = runtime.submit(view.activePlayerId,
        command("advance", `${prefix}:advance:${index}`, view.stateVersion, {})).receipt;
      expect(["accepted", "pending"], JSON.stringify(receipt)).toContain(receipt.status);
      if (receipt.status === "pending") throw new Error(`Unexpected advance choice while settling ${prefix}`);
      continue;
    }
    const actor = view.chain.priorityPlayerId ?? view.priority.playerId;
    expect(actor, JSON.stringify(view)).not.toBeNull();
    const receipt = runtime.submit(actor!, command("pass", `${prefix}:combat:${index}`, view.stateVersion, {})).receipt;
    expect(["accepted", "pending"], JSON.stringify(receipt)).toContain(receipt.status);
    if (receipt.status === "pending") throw new Error(`Unexpected combat choice while settling ${prefix}`);
  }
  throw new Error(`Combat did not settle for ${prefix}`);
}

function playCard(runtime: ReturnType<typeof createEngineRuntime>, prefix: string,
  destination: { readonly kind: "base"; readonly playerId: "A" } |
    { readonly kind: "battlefield"; readonly battlefieldId: string }) {
  const view = runtime.projectFor("A");
  const card = ownedHand(view, "A")[0];
  expect(card).toBeDefined();
  return runtime.submit("A", command("play", `${prefix}:play`, view.stateVersion, {
    cardObjectId: card!.objectId,
    destination,
  }));
}

describe("RIFT-997 public V2 card play completion", () => {
  it("keeps a rolled-back choice ancestor resolvable but not usable as current state", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => {
      const error = new Error("choice suspended");
      throw error;
    });
    const ref = host.addCard("A", {
      id: "choice-source", cardId: "card:choice-source", name: "Choice Source", types: ["unit"],
    }, "hand");
    const movedToChain = host.perform({ type: "move-zone", object: ref, to: "chain" });
    expect(movedToChain.status).toBe("done");
    const onChain = host.object(movedToChain.result as typeof ref)!;
    const checkpoint = host.checkpoint();
    const movedToTrash = host.perform({ type: "move-zone", object: onChain.ref, to: "trash" });
    expect(movedToTrash.status).toBe("done");
    const onTrash = host.object(movedToTrash.result as typeof ref)!;
    expect(() => host.choose({ id: "choice:source", chooser: "A", visibility: "public", type: "select-objects",
      options: [onTrash.ref], min: 1, max: 1 })).toThrow("choice suspended");
    host.restore(checkpoint);
    expect(host.object(onChain.ref)).toEqual(onChain);
    expect(host.object(onTrash.ref)).toEqual(onTrash);
    expect(host.perform({ type: "gain-energy", player: "A", amount: 1 }).status).toBe("done");
    expect(host.object(onChain.ref)).toEqual(onChain);
  });

  it("keeps Forecaster and Gem Jammer available to the V2 bot", () => {
    const runtime = setup(minions.Forecaster);
    finishSetupToTurnThree(runtime);
    const forecasterView = gainEnergy(runtime, "bot-forecaster");
    const forecasterCard = ownedHand(forecasterView, "A").find(card => card.name === "Forecaster")!;
    const facts = new Map([[minions.Forecaster.canonicalCardId, {
      energy: 2, power: null, status: "executable", kind: "unit" as const,
    }]]);
    expect(botCommand(forecasterView, "A", "bot-forecaster", new Set(), facts)).toMatchObject({
      type: "play", cardObjectId: forecasterCard.objectId,
    });

    const gemRuntime = setup(minions["Gem Jammer"]);
    finishSetupToTurnThree(gemRuntime);
    const gemView = gainEnergy(gemRuntime, "bot-gem");
    const gemFacts = new Map([[minions["Gem Jammer"].canonicalCardId, {
      energy: 2, power: null, status: "executable", kind: "unit" as const,
    }]]);
    expect(botCommand(gemView, "A", "bot-gem", new Set(), gemFacts)).toMatchObject({ type: "play" });
  }, 180_000);

  it("settles Forecaster's real Vision choice and accepts the next command", () => {
    const runtime = setup(minions.Forecaster);
    finishSetupToTurnThree(runtime);
    gainEnergy(runtime, "forecaster");
    const played = playCard(runtime, "forecaster", { kind: "base", playerId: "A" });
    expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("accepted");
    expect(played.projection.chain.items).toHaveLength(1);

    const pending = resolvePlayTriggerToChoice(runtime, "forecaster-vision");
    expect(pending.receipt.status, JSON.stringify(pending.receipt)).toBe("pending");
    const choice = runtime.projectFor("A").pendingChoice;
    expect(choice).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "select-objects" });
    if (choice.status !== "pending") throw new Error("Forecaster Vision choice is missing");
    expect(choice.options).toHaveLength(1);
    expect(choice.options![0]?.objectRef?.objectId).toMatch(/^hidden:/u);

    const answered = runtime.submit("A", command("choose", "answer-forecaster-vision",
      runtime.projectFor("A").stateVersion, {
        choiceId: choice.choiceId,
        answer: [],
      }));
    expect(answered.receipt.status, JSON.stringify(answered.receipt)).toBe("accepted");
    expect(answered.projection.pendingChoice).toEqual({ status: "none" });
    expect(answered.projection.chain.items).toEqual([]);

    const following = runtime.submit("A", command("end-turn", "after-forecaster",
      answered.receipt.stateVersion, {}));
    expect(following.receipt.status, JSON.stringify(following.receipt)).toBe("accepted");
  }, 180_000);

  it("settles Gem Jammer's choice, grants Ganking, and moves battlefield to battlefield", () => {
    const runtime = setup(minions["Gem Jammer"]);
    finishSetupToTurnThree(runtime);
    gainEnergy(runtime, "gem-first");
    const firstPlay = playCard(runtime, "gem-first", { kind: "base", playerId: "A" });
    expect(firstPlay.receipt.status, JSON.stringify(firstPlay.receipt)).toBe("pending");
    const firstChoiceView = runtime.projectFor("A");
    const firstChoice = firstChoiceView.pendingChoice;
    expect(firstChoice).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "select-objects" });
    if (firstChoice.status !== "pending") throw new Error("Gem Jammer's first target choice is missing");
    expect(firstChoice.options).toHaveLength(1);
    const firstAnswered = runtime.submit("A", command("choose", "answer-first-gem", firstChoiceView.stateVersion, {
      choiceId: firstChoice.choiceId,
      answer: [firstChoice.options![0]!.objectRef!],
    }));
    expect(firstAnswered.receipt.status, JSON.stringify(firstAnswered.receipt)).toBe("accepted");
    settleChain(runtime, "first-gem");

    const firstSettled = runtime.projectFor("A");
    const fieldA = firstSettled.battlefields[0]!.battlefieldId;
    const fieldB = firstSettled.battlefields[1]!.battlefieldId;
    const firstGemAtBase = firstSettled.objects.find(object => object.name === "Gem Jammer" &&
      object.zone === "board" && object.location?.kind === "base");
    expect(firstGemAtBase).toBeDefined();
    const endA = runtime.submit("A", command("end-turn", "after-first-gem",
      firstSettled.stateVersion, {}));
    expect(endA.receipt.status, JSON.stringify(endA.receipt)).toBe("accepted");
    const endB = runtime.submit("B", command("end-turn", "finish-gem-round",
      endA.receipt.stateVersion, {}));
    expect(endB.receipt.status, JSON.stringify(endB.receipt)).toBe("accepted");
    let nextTurn = runtime.projectFor("A");
    while (nextTurn.activePlayerId !== "A") {
      const other = nextTurn.activePlayerId;
      nextTurn = runtime.submit(other,
        command("end-turn", `return-to-a:${nextTurn.turnNumber}`, nextTurn.stateVersion, {})).projection;
    }
    const readiedGem = nextTurn.objects.find(object => object.objectId === firstGemAtBase!.objectId);
    expect(readiedGem).toMatchObject({ zone: "board", exhausted: false, location: { kind: "base", playerId: "A" } });
    const readyMove = runtime.submit("A", command("move", "first-gem-to-battlefield",
      nextTurn.stateVersion, {
        objectId: readiedGem!.objectId,
        to: { zone: "battlefield", locationId: fieldA },
      }));
    expect(readyMove.receipt.status, JSON.stringify(readyMove.receipt)).toBe("accepted");
    settleCombat(runtime, "first-gem-entry");
    const postCombat = runtime.projectFor("A");
    const endA2 = runtime.submit("A", command("end-turn", "after-field-entry",
      postCombat.stateVersion, {}));
    expect(endA2.receipt.status, JSON.stringify(endA2.receipt)).toBe("accepted");
    const endB2 = runtime.submit("B", command("end-turn", "finish-field-round",
      endA2.receipt.stateVersion, {}));
    expect(endB2.receipt.status, JSON.stringify(endB2.receipt)).toBe("accepted");
    gainEnergy(runtime, "gem-second");
    const secondPlay = playCard(runtime, "gem-second", { kind: "base", playerId: "A" });
    expect(secondPlay.receipt.status, JSON.stringify(secondPlay.receipt)).toBe("pending");
    const secondChoiceView = runtime.projectFor("A");
    const secondChoice = secondChoiceView.pendingChoice;
    expect(secondChoice).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "select-objects" });
    if (secondChoice.status !== "pending") throw new Error("Gem Jammer's second target choice is missing");
    expect(secondChoice.options?.length).toBeGreaterThanOrEqual(2);
    const firstGemAtFieldAgain = secondChoiceView.objects.find(object => object.name === "Gem Jammer" &&
      object.zone === "board" && object.location?.kind === "battlefield" &&
      object.location.battlefieldId === fieldA);
    expect(firstGemAtFieldAgain).toMatchObject({ exhausted: false });
    const target = secondChoice.options!.find(option =>
      option.objectRef?.objectId === firstGemAtFieldAgain!.objectId &&
      option.objectRef.zoneEntryId === firstGemAtFieldAgain!.zoneEntryId);
    expect(target, JSON.stringify({ options: secondChoice.options, firstGemAtFieldAgain })).toBeDefined();

    const secondAnswered = runtime.submit("A", command("choose", "answer-second-gem",
      secondChoiceView.stateVersion, {
        choiceId: secondChoice.choiceId,
        answer: [target!.objectRef!],
      }));
    expect(secondAnswered.receipt.status, JSON.stringify(secondAnswered.receipt)).toBe("accepted");
    settleChain(runtime, "second-gem");
    const secondSettled = runtime.projectFor("A");

    const moved = runtime.submit("A", command("move", "ganking-battlefield-move",
      secondSettled.stateVersion, {
        objectId: firstGemAtFieldAgain!.objectId,
        to: { zone: "battlefield", locationId: fieldB },
      }));
    expect(moved.receipt.status, JSON.stringify(moved.receipt)).toBe("accepted");
    expect(moved.projection.objects.find(object => object.objectId === firstGemAtFieldAgain!.objectId)).toMatchObject({
      zone: "board",
      exhausted: true,
      location: { kind: "battlefield", battlefieldId: fieldB },
    });
  }, 180_000);
});
