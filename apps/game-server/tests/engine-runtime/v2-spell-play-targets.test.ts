import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import gold from "../../../../packages/card-dsl/dist/cards/sfd/gold.js";
import frigidTouch from "../../../../packages/card-dsl/dist/cards/sfd/frigid-touch.js";
import wagesOfPain from "../../../../packages/card-dsl/dist/cards/sfd/wages-of-pain.js";
import stupefy from "../../../../packages/card-dsl/dist/cards/ogn/stupefy.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { projectedPlayCommand } from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

interface SpellCase {
  readonly name: "Stupefy" | "Frigid Touch" | "Wages of Pain";
  readonly program: CardProgram;
  readonly energy: number;
  readonly battlefieldTarget: boolean;
}

const TARGET_ID = "synthetic:target-unit";
const TARGET_PROGRAM: CardProgram = {
  canonicalCardId: TARGET_ID,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Synthetic zero-cost Unit used only as a real target.",
  abilities: [{ kind: "play", cost: { kind: "explicit", energy: { kind: "constant", value: 0 } }, body: [] }],
};

function card(id: string, name: string, types: readonly string[], extra: Record<string, unknown> = {}) {
  return { id, cardId: id, canonicalCardId: id, name, types, tags: [], energy: null, power: null, might: null, ...extra };
}

function uniqueCards(prefix: string, count: number, make: (index: number) => Record<string, unknown>) {
  return Array.from({ length: count }, (_, index) => ({
    ...make(index), id: `${prefix}:${index}`, cardId: `${prefix}:${index}`, canonicalCardId: `${prefix}:${index}`,
  }));
}

function deck(seat: "A" | "B", spell: CardProgram, spellEnergy: number): EngineRuntimeDeck {
  const mainDeck = seat === "A"
    ? Array.from({ length: 20 }, (_, index) => ({
      id: `${seat}:spell:${index}`, cardId: spell.canonicalCardId, canonicalCardId: spell.canonicalCardId,
      name: spell.canonicalCardId, types: ["spell"], tags: [], domains: ["Mind"], cardType: "Spell",
      energy: spellEnergy, power: null, might: null,
    }))
    : Array.from({ length: 20 }, (_, index) => ({
      id: `${seat}:target:${index}`, cardId: TARGET_ID, canonicalCardId: TARGET_ID,
      name: "Target Unit", types: ["unit"], tags: [], domains: ["Mind"], cardType: "Unit",
      energy: 0, power: null, might: 4,
    }));
  return {
    mainDeck,
    runeDeck: uniqueCards(`${seat}:rune`, 12, () => ({
      name: "Mind Rune", types: ["rune"], tags: ["Basic"], domains: ["Mind"], cardType: "Rune",
      energy: null, power: null, might: null,
    })),
    championLegend: card(`${seat}:legend`, "Target Test Legend", ["legend"]),
    chosenChampion: card(`${seat}:champion`, "Target Test Champion", ["champion"]),
    battlefields: [0, 1, 2].map(index => card(`${seat}:field:${index}`, `Field ${index}`, ["battlefield"])) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function setup(spell: SpellCase): EngineRuntime {
  return createEngineRuntime({
    matchId: `RIFT-1022:${spell.name}`,
    roomId: `RIFT-1022:${spell.name}`,
    decks: [deck("A", spell.program, spell.energy), deck("B", spell.program, spell.energy)],
    seed: `RIFT-1022:${spell.name}`,
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    programs: [spell.program, TARGET_PROGRAM, gold],
    printedCatalog: [
      { canonicalCardId: spell.program.canonicalCardId, id: `rift-1022:${spell.program.canonicalCardId}`,
        cardType: "Spell", domains: ["Mind"], energy: spell.energy, power: null },
      { canonicalCardId: TARGET_ID, id: TARGET_ID, cardType: "Unit", domains: ["Mind"], energy: 0, power: null },
      ...Array.from({ length: 12 }, (_, index) => [
        { canonicalCardId: `A:rune:${index}`, id: `A:rune:${index}`,
          cardType: "Rune", domains: ["Mind"], energy: null, power: null },
        { canonicalCardId: `B:rune:${index}`, id: `B:rune:${index}`,
          cardType: "Rune", domains: ["Mind"], energy: null, power: null },
      ]).flat(),
      ...Array.from({ length: 20 }, (_, index) => [
        { canonicalCardId: `A:target:${index}`, id: `A:target:${index}`,
          cardType: "Unit", domains: ["Mind"], energy: 0, power: null },
        { canonicalCardId: `B:target:${index}`, id: `B:target:${index}`,
          cardType: "Unit", domains: ["Mind"], energy: 0, power: null },
      ]).flat(),
    ],
  }).start();
}

function command<T extends V2Command["type"]>(type: T, commandId: string, stateVersion: number,
  fields: Omit<Extract<V2Command, { readonly type: T }>, "type" | "commandId" | "stateVersion">): V2Command {
  return { type, commandId, stateVersion, ...fields } as V2Command;
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function settle(runtime: EngineRuntime, prefix: string): V2Projection {
  for (let index = 0; index < 40; index += 1) {
    const publicView = runtime.projectFor(null);
    if (publicView.pendingChoice.status === "pending") {
      const owner = publicView.pendingChoice.ownerPlayerId;
      const view = runtime.projectFor(owner);
      const pending = view.pendingChoice;
      if (pending.status !== "pending") throw new Error(`Pending choice was not projected for ${owner}`);
      const options = pending.options ?? [];
      const answer = pending.kind === "optional" ? false
        : pending.kind === "mode" ? options[0]?.value ?? options[0]?.id ?? null
          : pending.kind === "number" ? pending.min ?? 0
            : options.slice(0, Math.max(1, pending.min ?? 1)).map(option => option.objectRef ?? option.id);
      const result = runtime.submit(owner, command("choose", `${prefix}:choice:${index}`,
        view.stateVersion, { choiceId: pending.choiceId, answer: answer as never }));
      expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
      continue;
    }
    if (publicView.chain.items.length === 0 && publicView.combat.status === "none") return publicView;
    const actor = publicView.combat.status === "active" && publicView.combat.step === "damage"
      ? publicView.combat.damage?.expectedPlayerId
      : publicView.combat.status === "active" ? publicView.priority.playerId
        : publicView.chain.priorityPlayerId;
    if (actor === null || actor === undefined) throw new Error(`No settling actor at ${JSON.stringify(publicView.chain)}`);
    const result = runtime.submit(actor, command("pass", `${prefix}:pass:${index}`, publicView.stateVersion, {}));
    expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
  }
  throw new Error(`The Chain and Combat did not settle for ${prefix}`);
}

function enterTarget(runtime: EngineRuntime, spell: SpellCase): string {
  const endA = runtime.projectFor("A");
  const battlefield = endA.battlefields.find(field => field.controllerPlayerId === "A") ?? endA.battlefields[0]!;
  const endedA = runtime.submit("A", command("end-turn", "setup:a-end", endA.stateVersion, {}));
  expect(endedA.receipt.status, JSON.stringify(endedA.receipt)).toBe("accepted");
  const b = runtime.projectFor("B");
  const unit = hand(b, "B")[0]!;
  const option = b.actionOptions.plays.find(candidate => candidate.cardObjectId === unit.objectId &&
    candidate.destination.kind === "base");
  expect(option, JSON.stringify({ hand: hand(b, "B"), plays: b.actionOptions.plays })).toBeDefined();
  const played = runtime.submit("B", projectedPlayCommand(option!, "setup:b-unit", b.stateVersion)!);
  expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("accepted");
  settle(runtime, "setup:unit-settle");
  if (spell.battlefieldTarget) {
    const endB = runtime.projectFor("B");
    const endedB = runtime.submit("B", command("end-turn", "setup:b-end", endB.stateVersion, {}));
    expect(endedB.receipt.status, JSON.stringify(endedB.receipt)).toBe("accepted");
    const endA2 = runtime.projectFor("A");
    const endedA2 = runtime.submit("A", command("end-turn", "setup:a-end-2", endA2.stateVersion, {}));
    expect(endedA2.receipt.status, JSON.stringify(endedA2.receipt)).toBe("accepted");
    const bMove = runtime.projectFor("B");
    const current = bMove.objects.find(object => object.objectId === unit.objectId);
    expect(current).toBeDefined();
    const moved = runtime.submit("B", command("move", "setup:b-move", bMove.stateVersion, {
      objectId: unit.objectId,
      to: { zone: "battlefield", locationId: battlefield.battlefieldId },
    }));
    expect(moved.receipt.status, JSON.stringify(moved.receipt)).toBe("accepted");
    settle(runtime, "setup:b-move-settle");
  }
  expect(runtime.projectFor("A").objects.some(object => object.objectId === unit.objectId)).toBe(true);
  return unit.objectId;
}

function fundSpell(runtime: EngineRuntime, spell: SpellCase): V2Projection {
  for (let index = 0; index < 30; index += 1) {
    const publicView = runtime.projectFor(null);
    if (publicView.pendingChoice.status === "pending" || publicView.chain.items.length > 0 || publicView.combat.status !== "none") {
      settle(runtime, `fund:${index}`);
      continue;
    }
    const active = publicView.activePlayerId;
    const own = runtime.projectFor(active);
    if (active === "A" && hand(own, "A").some(card => card.cardId === spell.program.canonicalCardId)) {
      const energy = own.players.find(player => player.playerId === "A")?.energy ?? 0;
      if (energy >= spell.energy) return own;
      const rune = readyRunes(own, "A")[0];
      if (rune !== undefined) {
        const gained = runtime.submit("A", command("rune-energy", `fund:rune:${index}`, own.stateVersion, {
          runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
        }));
        expect(gained.receipt.status, JSON.stringify(gained.receipt)).toBe("accepted");
        continue;
      }
    }
    const ended = runtime.submit(active, command("end-turn", `fund:end:${index}`, own.stateVersion, {}));
    expect(ended.receipt.status, JSON.stringify(ended.receipt)).toBe("accepted");
  }
  throw new Error(`Could not fund ${spell.name}`);
}

function scenario(spell: SpellCase) {
  const runtime = setup(spell);
  const targetId = enterTarget(runtime, spell);
  const view = fundSpell(runtime, spell);
  const spellCard = hand(view, "A").find(card => card.cardId === spell.program.canonicalCardId);
  if (spellCard === undefined) throw new Error(`Spell not drawn: ${JSON.stringify({ hand: hand(view, "A"), deck: view.players.find(player => player.playerId === "A")?.deckCount })}`);
  const option = view.actionOptions.plays.find(candidate => candidate.cardObjectId === spellCard!.objectId);
  expect(option, JSON.stringify(view.actionOptions.plays)).toBeDefined();
  expect(option?.requiresDestination).toBe(false);
  expect(option?.targetRequirements).toHaveLength(1);
  const projectedTarget = option!.targetRequirements![0]!.options.find(candidate =>
    candidate.objectRef?.objectId === targetId);
  expect(projectedTarget?.objectRef?.objectId, JSON.stringify(option!.targetRequirements)).toBeDefined();
  return { runtime, view, spellCard: spellCard!, option: option!, projectedTarget: projectedTarget!, targetId };
}

describe("RIFT-1022 V2 spell play target receipts", () => {
  for (const spell of [
    { name: "Stupefy", program: stupefy, energy: 1, battlefieldTarget: false },
    { name: "Frigid Touch", program: frigidTouch, energy: 2, battlefieldTarget: false },
    { name: "Wages of Pain", program: wagesOfPain, energy: 3, battlefieldTarget: true },
  ] satisfies readonly SpellCase[]) {
    it(`${spell.name}: omits spell destination, rejects an illegal target atomically, and resolves the projected target`, () => {
      const { runtime, view, spellCard, option, projectedTarget, targetId } = scenario(spell);
      const legal = projectedPlayCommand(option, "legal-shape", view.stateVersion)!;
      expect(legal).not.toHaveProperty("destination");
      expect(legal.targets).toEqual([{ kind: "object", objectId: targetId,
        zoneEntryId: projectedTarget.objectRef!.zoneEntryId }]);

      const before = runtime.projectFor("A");
      const rejected = runtime.submit("A", command("play", "invalid-target", before.stateVersion, {
        cardObjectId: spellCard.objectId,
        targets: [{ kind: "object", objectId: spellCard.objectId, zoneEntryId: spellCard.zoneEntryId! }],
      }));
      expect(rejected.receipt.status, JSON.stringify(rejected.receipt)).toBe("rejected");
      const afterRejected = rejected.projection;
      expect(afterRejected.stateVersion).toBe(before.stateVersion);
      expect(afterRejected.eventSeq).toBe(before.eventSeq);
      expect(hand(afterRejected, "A").find(card => card.objectId === spellCard.objectId)?.zone).toBe("hand");
      expect(afterRejected.players.find(player => player.playerId === "A")?.energy)
        .toBe(before.players.find(player => player.playerId === "A")?.energy);
      expect(afterRejected.objects.find(object => object.objectId === targetId)).toEqual(
        before.objects.find(object => object.objectId === targetId));

      const result = runtime.submit("A", projectedPlayCommand(option, "legal-target",
        afterRejected.stateVersion)!);
      expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
      expect(result.projection.pendingChoice.status === "pending" || result.projection.chain.items.length > 0).toBe(true);
      if (result.receipt.status === "pending") settle(runtime, `${spell.name}:pending-play`);
      const resolved = settle(runtime, `${spell.name}:resolve`);
      expect(resolved.objects.find(object => object.objectId === spellCard.objectId)?.zone).toBe("trash");
      expect(resolved.events.some(event => event.timingPoint === "chain-item-resolve")).toBe(true);
      expect(runtime.journal().entries.some(entry => entry.commandId === "legal-target")).toBe(true);
    }, 180_000);
  }
});
