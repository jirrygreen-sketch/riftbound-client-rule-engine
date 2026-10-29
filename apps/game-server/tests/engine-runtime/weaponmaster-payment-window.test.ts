import { describe, expect, it } from "vitest";
import bfSword from "../../../../packages/card-dsl/dist/cards/sfd/bf-sword.js";
import lucian from "../../../../packages/card-dsl/dist/cards/sfd/lucian-merciless.js";
import orderRune from "../../../../packages/card-dsl/dist/cards/ogn/order-rune.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

const LUCIAN = "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef";
const BF_SWORD = "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe";
const ORDER_RUNE = "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67";

function card(printingId: string, cardId: string, name: string, index: number, seat: string, fields: {
  readonly type: "unit" | "gear" | "rune";
  readonly domain: "Body" | "Order";
  readonly energy?: number;
  readonly power?: readonly string[] | null;
  readonly tags?: readonly string[];
  readonly might?: number | null;
  readonly keywords?: readonly { readonly id: string; readonly value?: number; readonly params?: Readonly<Record<string, unknown>> }[];
}) {
  return {
    id: printingId,
    cardId,
    name,
    types: [fields.type],
    tags: [...(fields.tags ?? [])],
    energy: fields.energy ?? null,
    power: fields.power === undefined ? null : fields.power,
    might: fields.might ?? null,
    domains: [fields.domain],
  };
}

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  const battlefield = index => ({
    id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`,
    name: `Field ${index}`, types: ["battlefield"], energy: null, power: null, might: null,
  });
  const unit = index => card(`${seat}:lucian:${index}`, LUCIAN, "Lucian", index, seat, {
    type: "unit", domain: "Body", energy: 3, power: null, might: 3,
    tags: ["Lucian", "Demacia", "Sentinel", "Champion"],
  });
  const sword = index => card(`${seat}:sword:${index}`, BF_SWORD, "B.F. Sword", index, seat, {
    type: "gear", domain: "Order", energy: 0, power: null, might: 3, tags: ["Equipment"],
  });
  return {
    mainDeck: [...Array(39)].map((_, index) => index % 2 === 0 ? sword(index) : unit(index)),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(`${seat}:order-rune:${index}`, ORDER_RUNE, "Order Rune", index, seat, {
        type: "rune", domain: "Order", tags: ["Basic"],
      })),
    championLegend: { id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(battlefield) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function transparentDeck(seat: "A" | "B"): EngineRuntimeDeck {
  const cards = deck(seat);
  const normalize = <T extends { readonly cardId?: string | null; readonly id: string }>(card: T, index: number) => ({
    ...card,
    id: `${String(card.cardId)}:${index}`,
  });
  return {
    ...cards,
    mainDeck: cards.mainDeck.map(normalize),
    runeDeck: cards.runeDeck.map(normalize),
  };
}

function command<T extends V2Command["type"]>(type: T, commandId: string, stateVersion: number,
  fields: Omit<Extract<V2Command, { readonly type: T }>, "type" | "commandId" | "stateVersion">): V2Command {
  return { type, commandId, stateVersion, ...fields } as V2Command;
}

function programs(): readonly CardProgram[] {
  return [lucian, bfSword, orderRune] as readonly CardProgram[];
}

function setup(matchId: string) {
  const decks = [deck("A"), deck("B")] as const;
  return createEngineRuntime({
    matchId, roomId: matchId, decks, seed: matchId, firstPlayer: "A",
    battlefieldChoice: [0, 0], mulligans: [[], []], programs: programs(),
    printedCatalog: [
      { id: "sfd-161-221", canonicalCardId: BF_SWORD, cardType: "Gear", domains: ["Order"], energy: 0, power: null },
      { id: "sfd-113-221", canonicalCardId: LUCIAN, cardType: "Unit", domains: ["Body"], energy: 3, power: null },
      { id: "ogn-214-298", canonicalCardId: ORDER_RUNE, cardType: "Rune", domains: ["Order"], energy: null, power: null },
    ],
  }).start();
}

function setupOpening(matchId: string) {
  const decks = [transparentDeck("A"), transparentDeck("B")] as const;
  return createEngineRuntime({
    matchId, roomId: matchId, decks, seed: matchId, firstPlayer: "A",
    battlefieldChoice: [0, 0], mulligans: [[], []], programs: programs(),
    printedCatalog: [
      { id: "sfd-161-221", canonicalCardId: BF_SWORD, cardType: "Gear", domains: ["Order"], energy: 0, power: null },
      { id: "sfd-113-221", canonicalCardId: LUCIAN, cardType: "Unit", domains: ["Body"], energy: 3, power: null },
      { id: "ogn-214-298", canonicalCardId: ORDER_RUNE, cardType: "Rune", domains: ["Order"], energy: null, power: null },
    ],
  }).start();
}

function hand(view: V2Projection) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [];
}

function readyRunes(view: V2Projection, name: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [])
    .filter(rune => (name === "" || rune.name === name) && rune.zoneEntryId !== undefined);
}

function openMain(runtime: ReturnType<typeof createEngineRuntime>): V2Projection {
  let view = runtime.projectFor("A");
  for (let guard = 0; view.phase !== "main" && guard < 8; guard += 1) {
    const result = runtime.submit(view.activePlayerId, command("end-turn", `open-main-${guard}`, view.stateVersion, {}));
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    view = result.projection;
  }
  expect(view.phase).toBe("main");
  return view;
}

function nextOwnMain(runtime: ReturnType<typeof createEngineRuntime>): V2Projection {
  let view = runtime.projectFor("A");
  const initialTurn = view.turnNumber;
  for (let guard = 0; guard < 10 && !(view.phase === "main" && view.activePlayerId === "A" && view.turnNumber > initialTurn); guard += 1) {
    const result = runtime.submit(view.activePlayerId, command("end-turn", `next-own-main-${guard}`, view.stateVersion, {}));
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    view = result.projection;
  }
  expect(view).toMatchObject({ phase: "main", activePlayerId: "A" });
  return view;
}

describe("RIFT-1150 real Weaponmaster payment window", () => {
  it("exposes the payer's prompt, accepts a Rune Add, pays and attaches, and restores the journal", () => {
    const runtime = setupOpening("zira-2");
    let view = openMain(runtime);
    const sword = hand(view).find(object => object.cardId === BF_SWORD);
    expect(sword, JSON.stringify(hand(view))).toBeDefined();
    const playedSword = runtime.submit("A", command("play", "play-bf-sword", view.stateVersion, {
      cardObjectId: sword!.objectId, destination: { kind: "base", playerId: "A" },
    }));
    expect(playedSword.receipt.status, JSON.stringify(playedSword.receipt)).toBe("accepted");
    view = playedSword.projection;
    while (view.chain.items.length > 0) {
      const actor = view.chain.priorityPlayerId;
      expect(actor).not.toBeNull();
      const passed = runtime.submit(actor!, command("pass", `settle-sword-${view.stateVersion}`, view.stateVersion, {}));
      expect(passed.receipt.status, JSON.stringify(passed.receipt)).toBe("accepted");
      view = passed.projection;
    }
    view = nextOwnMain(runtime);
    const readied = readyRunes(view, "");
    const energyRunes = readied.filter(rune => rune.exhausted === false);
    for (const [index, rune] of energyRunes.entries()) {
      expect(rune.exhausted, `${rune.name} ${rune.objectId} at ${index}`).toBe(false);
      const result = runtime.submit("A", command("rune-energy", `rune-energy-${index}`, view.stateVersion, {
        runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
      }));
      expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
      view = result.projection;
    }
    expect(view.players.find(player => player.playerId === "A")?.energy).toBeGreaterThanOrEqual(3);
    const lucianNow = hand(view).find(object => object.cardId === LUCIAN);
    expect(lucianNow).toBeDefined();
    const pending = runtime.submit("A", command("play", "play-lucian", view.stateVersion, {
      cardObjectId: lucianNow!.objectId,
    }));
    expect(pending.receipt.status, JSON.stringify(pending.receipt)).toBe("pending");
    view = runtime.projectFor("A");
    expect(view.pendingChoice).toMatchObject({ status: "pending", kind: "select-objects", ownerPlayerId: "A" });
    if (view.pendingChoice.status !== "pending" || view.pendingChoice.kind !== "select-objects") {
      throw new Error("Weaponmaster target choice missing");
    }
    const targetOption = view.pendingChoice.options?.find(option => option.objectRef?.objectId === sword!.objectId);
    expect(targetOption).toBeDefined();
    const targeted = runtime.submit("A", command("choose", "target-bf-sword", view.stateVersion, {
      choiceId: view.pendingChoice.choiceId, answer: [targetOption!.objectRef!],
    }));
    expect(targeted.receipt.status, JSON.stringify(targeted.receipt)).toBe("accepted");
    view = runtime.projectFor("A");
    while (view.chain.items.length > 0 && view.pendingChoice.status === "none") {
      const actor = view.chain.priorityPlayerId;
      expect(actor).not.toBeNull();
      const passed = runtime.submit(actor!, command("pass", `reach-payment-${view.stateVersion}`, view.stateVersion, {}));
      expect(["accepted", "pending"], JSON.stringify(passed.receipt)).toContain(passed.receipt.status);
      view = passed.projection;
      if (view.chain.items.length === 0) break;
    }
    view = runtime.projectFor("A");
    expect(view.pendingChoice).toMatchObject({
      status: "pending", kind: "mode", ownerPlayerId: "A",
      prompt: expect.stringMatching(/^B\.F\. Sword的装配费用：1 点序理符能，当前不足。可先横置或回收符文补足，再选择支付；或放弃装配。$/u),
      options: [
        { id: "支付", label: "支付", value: "支付" },
        { id: "放弃装配", label: "放弃装配", value: "放弃装配" },
      ],
    });
    if (view.pendingChoice.status !== "pending") throw new Error("payment choice missing");
    const paymentChoiceId = view.pendingChoice.choiceId;
    const opponentView = runtime.projectFor("B");
    expect(opponentView.pendingChoice).toMatchObject({ status: "pending", kind: "mode", ownerPlayerId: "A" });
    expect(opponentView.pendingChoice).not.toHaveProperty("prompt");
    expect(opponentView.pendingChoice).not.toHaveProperty("options");

    const orderRunes = readyRunes(view, "Order Rune");
    expect(orderRunes.length).toBeGreaterThanOrEqual(3);
    const alreadyExhausted = (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [])
      .find(rune => rune.name === "Order Rune" && rune.exhausted === true);
    const selectedRune = alreadyExhausted ?? orderRunes[0]!;
    const wrongPlayerRune = runtime.submit("B", command("rune-power", "opponent-recycle-order-rune", view.stateVersion, {
      runeObjectId: selectedRune.objectId, zoneEntryId: selectedRune.zoneEntryId!,
    }));
    expect(wrongPlayerRune.receipt.status).toBe("rejected");
    expect(wrongPlayerRune.projection.pendingChoice).toMatchObject({ status: "pending", choiceId: paymentChoiceId });
    const nonRune = runtime.submit("A", command("end-turn", "end-turn-during-payment", view.stateVersion, {}));
    expect(nonRune.receipt.status).toBe("rejected");
    expect(nonRune.projection.pendingChoice).toMatchObject({ status: "pending", choiceId: paymentChoiceId });
    const added = runtime.submit("A", command("rune-power", "recycle-order-rune", view.stateVersion, {
      runeObjectId: selectedRune.objectId, zoneEntryId: selectedRune.zoneEntryId!,
    }));
    expect(added.receipt.status, JSON.stringify(added.receipt)).toBe("accepted");
    expect(added.receipt.result).toMatchObject({ resource: "power", powerAdded: ["Order"] });
    expect(added.projection.pendingChoice).toMatchObject({ status: "pending", choiceId: paymentChoiceId });

    const answered = runtime.submit("A", command("choose", "pay-weaponmaster", added.receipt.stateVersion, {
      choiceId: paymentChoiceId, answer: "支付",
    }));
    expect(answered.receipt.status, JSON.stringify(answered.receipt)).toBe("accepted");
    view = answered.projection;
    while (view.chain.items.length > 0) {
      const actor = view.chain.priorityPlayerId;
      expect(actor).not.toBeNull();
      const passed = runtime.submit(actor!, command("pass", `settle-lucian-${view.stateVersion}`, view.stateVersion, {}));
      expect(passed.receipt.status, JSON.stringify(passed.receipt)).toBe("accepted");
      view = passed.projection;
    }
    expect(view.pendingChoice).toEqual({ status: "none" });
    const swordOnBoard = view.objects.find(object => object.objectId === sword!.objectId);
    expect(swordOnBoard).toBeDefined();
    const internals = runtime as unknown as {
      readonly host: { readonly object: (ref: { id: string; zoneEntryId: number }) => { readonly attachedTo: object | null } | null };
      readonly match: { readonly flow: { readonly chain: { readonly layers: { evaluate(ref: object): { readonly might: number | null } } } } };
    };
    const liveSword = view.objects.find(object => object.objectId === sword!.objectId);
    expect(liveSword).toBeDefined();
    const swordRef = { id: sword!.objectId, zoneEntryId: liveSword!.zoneEntryId! };
    const liveLucian = view.objects.find(object => object.objectId === lucianNow!.objectId);
    expect(liveLucian).toBeDefined();
    const lucianRef = { id: lucianNow!.objectId, zoneEntryId: liveLucian!.zoneEntryId! };
    const rawSword = internals.host.object(swordRef);
    expect(rawSword?.attachedTo, JSON.stringify({ rawSword, swordRef })).toEqual(lucianRef);
    internals.match.flow.chain.layers.setObjects(internals.host.objects());
    expect(internals.match.flow.chain.layers.evaluate(lucianRef).might).toBe(6);

    const journal = runtime.journal();
    const runeIndex = journal.entries.findIndex(entry => entry.commandId === "recycle-order-rune");
    const chooseIndex = journal.entries.findIndex(entry => entry.commandId === "pay-weaponmaster");
    expect(runeIndex).toBeGreaterThan(0);
    expect(chooseIndex).toBe(runeIndex + 1);
    expect(journal.entries[runeIndex - 1]?.pendingReason).toMatchObject({ choiceId: paymentChoiceId });
    expect(journal.entries[runeIndex]?.pendingReason).toBeUndefined();
    expect(journal.entries[chooseIndex]?.pendingReason).toBeUndefined();
    const restored = setupOpening("zira-2").restore(journal);
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
    expect(restored.projectFor(null)).toEqual(runtime.projectFor(null));
  }, 30_000);
});
