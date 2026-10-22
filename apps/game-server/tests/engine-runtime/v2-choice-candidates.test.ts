import { describe, expect, it } from "vitest";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";
import type { V2Command, V2PendingChoice, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";

const choiceCardId = "rift-943:choice-card";
const constant = (value: unknown) => ({ kind: "constant" as const, value });

const orderProgram = {
  canonicalCardId: choiceCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "RIFT-943 production choice candidate fixture",
  abilities: [
    {
      kind: "play",
      cost: { energy: constant(0) },
      body: [
        {
          id: "choice.bind-controller",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: constant("controller"),
          },
        },
        {
          id: "choice.look",
          op: "effect.inspect",
          linkedTo: "choice.bind-controller",
          args: {
            player: { kind: "linked-value", instructionId: "choice.bind-controller", key: "controller" },
            zone: constant("deck"),
            scope: constant("top"),
            amount: constant(2),
            picksSpecId: constant("choice.top-two"),
            choose: constant(false),
            pickedKey: constant("choice.looked"),
            choosePicksKey: constant("choice.selected"),
          },
          picks: [
            {
              id: "choice.top-two",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: constant(2) },
            },
          ],
        },
        {
          id: "choice.order",
          op: "effect.order",
          args: { destination: constant("top"), count: constant(2), chooseOrder: constant(true) },
        },
      ],
    },
  ],
} satisfies CardProgram;

const selectProgram = {
  ...orderProgram,
  abilities: [
    {
      kind: "play",
      cost: { energy: constant(0) },
      body: [
        {
          id: "choice.bind-controller",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: constant("controller"),
          },
        },
        {
          id: "choice.look",
          op: "effect.inspect",
          linkedTo: "choice.bind-controller",
          args: {
            player: { kind: "linked-value", instructionId: "choice.bind-controller", key: "controller" },
            zone: constant("deck"),
            scope: constant("top"),
            amount: constant(2),
            picksSpecId: constant("choice.top-two"),
            choose: constant(true),
            chooseCount: constant({ min: 1, max: 1 }),
            choiceId: constant("choice.select"),
            pickedKey: constant("choice.looked"),
            choosePicksKey: constant("choice.selected"),
          },
          picks: [
            {
              id: "choice.top-two",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: constant(2) },
            },
          ],
        },
      ],
    },
  ],
} satisfies CardProgram;

function card(id: string, types: readonly string[], extra: Record<string, unknown> = {}) {
  return { id, cardId: id, name: id, types, energy: null, power: null, might: null, ...extra };
}

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 40 }, (_, index) => card(
      `${seat}:choice:${index}`,
      ["spell"],
      { cardId: choiceCardId, name: "Choice Card", energy: 0 },
    )),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:rune:${index}`,
      ["rune"],
      { cardId: `${seat}:rune-card:${index}`, domains: ["Mind"] },
    )),
    championLegend: card(`${seat}:legend`, ["legend"]),
    chosenChampion: card(`${seat}:champion`, ["champion"]),
    battlefields: [0, 1, 2].map(index => card(`${seat}:field:${index}`, ["battlefield"])) as EngineRuntimeDeck["battlefields"],
  };
}

function setup(program: CardProgram = orderProgram): EngineRuntime {
  return createEngineRuntime({
    matchId: "RIFT-943-choice-runtime",
    roomId: "RIFT-943-choice-runtime",
    decks: [deck("A"), deck("B")],
    seed: "RIFT-943-choice-runtime",
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    programs: [program],
  }).start();
}

function submit(runtime: EngineRuntime, playerId: string, command: V2Command) {
  return runtime.submit(playerId, command);
}

function pendingObjectChoice(view: V2Projection): Extract<V2PendingChoice, { readonly status: "pending" }> {
  const pending = view.pendingChoice;
  if (pending.status !== "pending" || (pending.kind !== "select-objects" && pending.kind !== "order")) {
    throw new Error(`Expected object choice, received ${JSON.stringify(pending)}`);
  }
  return pending;
}

function refs(choice: Extract<V2PendingChoice, { readonly status: "pending" }>) {
  return (choice.options ?? []).map(option => option.objectRef!);
}

function passUntilChoice(runtime: EngineRuntime): V2Projection {
  const handCard = runtime.projectFor("A").objects.find(object =>
    object.zone === "hand" && object.ownerPlayerId === "A" && object.cardId === choiceCardId)!;
  const played = submit(runtime, "A", {
    type: "play",
    commandId: "play-choice-card",
    stateVersion: runtime.projectFor("A").stateVersion,
    cardObjectId: handCard.objectId,
  });
  expect(played.receipt.status, JSON.stringify(played.receipt)).toBe("accepted");

  for (let index = 0; index < 4; index += 1) {
    const view = runtime.projectFor(null);
    if (view.pendingChoice.status === "pending") return runtime.projectFor("A");
    const actor = view.chain.priorityPlayerId;
    expect(actor).not.toBeNull();
    const result = submit(runtime, actor!, {
      type: "pass",
      commandId: `resolve-choice-${index}`,
      stateVersion: view.stateVersion,
    });
    expect(["accepted", "pending"]).toContain(result.receipt.status);
  }
  throw new Error("The real Chain did not reach a pending choice");
}

describe("RIFT-943 protocol v2 order choice candidates", () => {
  it("projects chooser order candidates, rejects invalid answers, and accepts an exact permutation", () => {
    const runtime = setup();
    const order = pendingObjectChoice(passUntilChoice(runtime));
    expect(order).toMatchObject({ kind: "order", ownerPlayerId: "A" });
    expect(order.options).toHaveLength(2);
    expect(refs(order)).toHaveLength(2);
    expect(order.options?.every(option => option.objectRef?.objectId === option.id)).toBe(true);
    expect(order.options?.every(option => option.id.startsWith("hidden:") && option.label === "Choice Card")).toBe(true);
    expect(JSON.stringify(order)).not.toContain("rift-943:choice-card");
    const visibleObjects = new Map(runtime.projectFor("A").objects.map(object =>
      [`${object.objectId}:${String(object.zoneEntryId)}`, object]));
    for (const option of order.options!) {
      const projectedObject = visibleObjects.get(`${option.objectRef!.objectId}:${option.objectRef!.zoneEntryId}`);
      expect(projectedObject).toBeDefined();
      expect(projectedObject?.zone).toBe("facedown");
      expect(projectedObject?.faceDown).toBe(true);
      expect(projectedObject?.cardId).toBeUndefined();
      expect(option.label).toBe("Choice Card");
    }

    const opponent = runtime.projectFor("B").pendingChoice;
    expect(opponent).toMatchObject({ status: "pending", choiceId: order.choiceId, ownerPlayerId: "A", kind: "order" });
    expect(opponent).not.toHaveProperty("options");
    expect(JSON.stringify(runtime.projectFor("B"))).not.toContain(order.options![0]!.id);
    const nonChooserAnswer = submit(runtime, "B", {
      type: "choose", commandId: "order-wrong-owner", stateVersion: runtime.projectFor("B").stateVersion,
      choiceId: order.choiceId, answer: refs(order),
    });
    expect(nonChooserAnswer.receipt.status).toBe("rejected");
    expect(runtime.projectFor("B").pendingChoice).toEqual(opponent);

    const beforeInvalid = runtime.projectFor(null);
    for (const [commandId, answer] of [
      ["order-forged", [{ objectId: "forged", zoneEntryId: 1 }]],
      ["order-wrong-zone-entry", [{ ...refs(order)[0]!, zoneEntryId: refs(order)[0]!.zoneEntryId! + 1 }, refs(order)[1]!]],
      ["order-too-short", [refs(order)[0]!]],
      ["order-duplicate", [refs(order)[0]!, refs(order)[0]!]],
    ] as const) {
      const rejected = submit(runtime, "A", {
        type: "choose", commandId, stateVersion: beforeInvalid.stateVersion,
        choiceId: order.choiceId, answer: [...answer],
      });
      expect(rejected.receipt.status).toBe("rejected");
      const after = runtime.projectFor(null);
      expect(after.stateVersion).toBe(beforeInvalid.stateVersion);
      expect(after.eventSeq).toBe(beforeInvalid.eventSeq);
      expect(after.pendingChoice).toEqual(beforeInvalid.pendingChoice);
    }

    const selected = submit(runtime, "A", {
      type: "choose",
      commandId: "order-valid",
      stateVersion: beforeInvalid.stateVersion,
      choiceId: order.choiceId,
      answer: [refs(order)[1]!, refs(order)[0]!],
    });
    expect(selected.receipt.status, JSON.stringify(selected.receipt)).toBe("accepted");
    expect(runtime.projectFor("A").pendingChoice).toEqual({ status: "none" });

    const restored = createEngineRuntime({
      matchId: "RIFT-943-choice-runtime",
      roomId: "RIFT-943-choice-runtime",
      decks: [deck("A"), deck("B")],
      seed: "RIFT-943-choice-runtime",
      firstPlayer: "A",
      battlefieldChoice: [0, 0],
      programs: [orderProgram],
    }).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.projectFor("B")).toEqual(runtime.projectFor("B"));
  }, 120_000);

  it("rejects forged, duplicate, and non-permutation order answers without changing the pending projection", () => {
    const runtime = setup();
    const order = pendingObjectChoice(passUntilChoice(runtime));
    const choiceView = runtime.projectFor("A");
    const candidates = refs(order);
    expect(candidates.length).toBe(2);
    const before = runtime.projectFor(null);
    for (const [commandId, answer] of [
      ["order-too-short", [candidates[0]!]],
      ["order-duplicate", [candidates[0]!, candidates[0]!]],
      ["select-forged", [{ objectId: "forged", zoneEntryId: 1 }]],
    ] as const) {
      const rejected = submit(runtime, "A", {
        type: "choose", commandId, stateVersion: choiceView.stateVersion,
        choiceId: order.choiceId, answer: [...answer],
      });
      expect(rejected.receipt.status).toBe("rejected");
      const after = runtime.projectFor(null);
      expect(after.stateVersion).toBe(before.stateVersion);
      expect(after.eventSeq).toBe(before.eventSeq);
      expect(after.pendingChoice).toEqual(before.pendingChoice);
    }
  }, 120_000);

  it("accepts a valid select-objects answer only from the projected candidate set", () => {
    const runtime = setup(selectProgram);
    const select = pendingObjectChoice(passUntilChoice(runtime));
    expect(select).toMatchObject({ kind: "select-objects", ownerPlayerId: "A", min: 1, max: 1 });
    expect(select.options).toHaveLength(2);
    const before = runtime.projectFor(null);
    const forgedOwner = submit(runtime, "B", {
      type: "choose", commandId: "select-wrong-owner", stateVersion: before.stateVersion,
      choiceId: select.choiceId, answer: [refs(select)[0]!],
    });
    expect(forgedOwner.receipt.status).toBe("rejected");
    expect(runtime.projectFor("B").pendingChoice).not.toHaveProperty("options");
    const rejected = submit(runtime, "A", {
      type: "choose", commandId: "select-forged", stateVersion: before.stateVersion,
      choiceId: select.choiceId, answer: [{ objectId: "forged", zoneEntryId: 1 }],
    });
    expect(rejected.receipt.status).toBe("rejected");
    expect(runtime.projectFor(null)).toMatchObject({ stateVersion: before.stateVersion, eventSeq: before.eventSeq });
    expect(runtime.projectFor(null).pendingChoice).toEqual(before.pendingChoice);
    const tooMany = submit(runtime, "A", {
      type: "choose", commandId: "select-too-many", stateVersion: before.stateVersion,
      choiceId: select.choiceId, answer: refs(select),
    });
    expect(tooMany.receipt.status).toBe("rejected");
    expect(runtime.projectFor(null)).toMatchObject({ stateVersion: before.stateVersion, eventSeq: before.eventSeq });
    expect(runtime.projectFor(null).pendingChoice).toEqual(before.pendingChoice);
    const accepted = submit(runtime, "A", {
      type: "choose", commandId: "select-valid", stateVersion: before.stateVersion,
      choiceId: select.choiceId, answer: [refs(select)[0]!],
    });
    expect(accepted.receipt.status, JSON.stringify(accepted.receipt)).toBe("accepted");
    expect(runtime.projectFor("A").pendingChoice).toEqual({ status: "none" });
  }, 120_000);

  it("accepts valid order references through the same runtime boundary", () => {
    const runtime = setup(orderProgram);
    const order = pendingObjectChoice(passUntilChoice(runtime));
    const before = runtime.projectFor(null);
    const accepted = submit(runtime, "A", {
      type: "choose", commandId: "order-runtime-valid", stateVersion: before.stateVersion,
      choiceId: order.choiceId, answer: [refs(order)[1]!, refs(order)[0]!],
    });
    expect(accepted.receipt.status, JSON.stringify(accepted.receipt)).toBe("accepted");
    expect(accepted.receipt.stateVersion).toBe(before.stateVersion + 1);
    expect(runtime.projectFor("A").pendingChoice).toEqual({ status: "none" });
  }, 120_000);
});
