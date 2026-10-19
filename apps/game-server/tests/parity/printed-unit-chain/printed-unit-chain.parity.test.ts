import { describe, expect, it } from "vitest";
import blazingScorcher from "../../../../../packages/card-dsl/src/cards/ogn/blazing-scorcher.js";
import legionRearguard from "../../../../../packages/card-dsl/src/cards/ogn/legion-rearguard.js";
import { expandProgram } from "../../../../../packages/engine-core/src/programs/keywords.js";
import { createProgramBinding } from "../../../../../packages/engine-core/src/programs/index.js";
import { ChainEngine } from "../../../../../packages/engine-core/src/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../../packages/engine-core/src/events/action-adapter.js";
import { AwaitChoice, world } from "../../../../../packages/engine-core/src/effects/testing/index.js";

/**
 * Batch E parity ledger for printed-unit-chain-services-p8.
 *
 * The TODO cases intentionally mirror the old service command sequences. They
 * remain pending until the generic CardProgram -> play-cost/replacement bridge
 * can execute the two real Fury printings without inventing semantics.
 */

describe("printed Unit Chain parity: new kernel primitives", () => {
  it("expands the real Fury printings through the new keyword program path", () => {
    for (const program of [blazingScorcher, legionRearguard]) {
      expect(program.status).toBe("judge-required");
      const expanded = expandProgram(program, {
        cardId: program.canonicalCardId,
        keywords: [],
      } as never);
      expect(expanded.expanded.map(ability => ability.kind)).toEqual([
        "static",
        "replacement",
      ]);
      expect(expanded.expanded[0]).toMatchObject({
        kind: "static",
        effect: {
          kind: "accelerate.cost",
          cost: {
            kind: "additional-cost",
            optional: true,
          },
        },
      });
      expect(expanded.expanded[1]).toMatchObject({
        kind: "replacement",
        replaces: {
          event: "object-enters-board",
        },
      });
    }
  });

  it.each([
    // CR 805.1.b/805.1.b.1: a paid Accelerate cost includes one Fury Power.
    // The old ledger assumed pay retained that Power; the actual payment receipt
    // spends it. The default-program case below verifies the full receipt.
    { decision: "pay", selected: true, exhausted: false, power: [] },
    { decision: "decline", selected: false, exhausted: true, power: ["Fury"] },
  ])(
    "executes the primitive unit path with the old $decision observable outcome",
    ({ selected, exhausted, power }) => {
      const kernel = world()
        .player("A", { energy: 3, power: ["Fury"] })
        .player("B", { energy: 0 })
        .hand("ogn-010-298", {
          cardId: "ogn-010-298",
          types: ["unit"],
          energy: 2,
          power: [],
          might: 2,
        })
        .deck(["A:deck:1"], { owner: "A" })
        .deck(["B:deck:1"], { owner: "B" })
        .build();
      const host = createActionPipelineHost({
        checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
        restore: checkpoint => {
          kernel.restore(checkpoint.state);
          kernel.copyLinkedFrom(checkpoint.links);
        },
        objects: () => kernel.objects,
        perform: action => kernel.perform(action),
        choose: () => {
          throw new Error("printed-unit-chain parity primitive unexpectedly asked for a choice");
        },
        context: (source, controller, timingPoint) =>
          bindResolveContext(kernel, { source, controller, timingPoint }),
        testTrigger: () => false,
      });
      const engine = new ChainEngine({
        turnOrder: ["A", "B"],
        turnPlayer: "A",
        phase: "main",
        host,
        cleanup: () => false,
      });

      engine.execute({
        id: `printed-unit-chain-${selected ? "pay" : "decline"}`,
        controller: "A",
        source: kernel.getObject("ogn-010-298"),
        kind: "unit",
        speed: "normal",
        body: [],
        cost: {
          id: "printed-unit-chain-cost",
          cost: { kind: "printed" },
          domains: ["Fury"],
          optionalAdditional: [{
            id: "accelerate",
            kind: "accelerate",
            selected,
          }],
        },
        location: { type: "base", player: "A" },
      });

      const unit = kernel.getObject("ogn-010-298");
      expect({
        zone: unit.zone,
        location: unit.location,
        exhausted: unit.exhausted,
        energy: kernel.player("A").energy,
        power: kernel.player("A").power,
      }).toEqual({
        zone: "board",
        location: { type: "base", player: "A" },
        exhausted,
        energy: selected ? 0 : 1,
        power,
      });
      expect(engine.pipeline.events.map(event => event.timingPoint)).toEqual([
        "object-leaves-zone",
        "object-leaves-hand",
        "object-enters-zone",
        "object-enters-chain",
        "chain-item-pending",
        "cleanup-start",
        "cleanup-end",
        "chain-item-finalize",
        "cleanup-start",
        "cleanup-end",
        "object-leaves-zone",
        "object-leaves-chain",
        "object-enters-zone",
        "object-enters-board",
        "object-enters-base",
        "card-played",
        "chain-item-resolve",
        "cleanup-start",
        "cleanup-end",
      ]);
    },
  );

  it.each([
    { decision: "pay" as const, selected: true, exhausted: false, energy: 0, power: [] },
    { decision: "decline" as const, selected: false, exhausted: true, energy: 1, power: ["Fury"] },
  ])(
    "binds the original Legion Rearguard program and uses its real $decision Finalize choice",
    ({ decision, selected, exhausted, energy, power }) => {
      const admitted = {
        ...legionRearguard,
        status: "executable" as const,
        judgeReason: undefined,
      };
      const kernel = world()
        .player("A", { energy: 3, power: ["Fury"] })
        .player("B", { energy: 0 })
        .hand("ogn-010-298", {
          cardId: legionRearguard.canonicalCardId,
          types: ["unit"],
          energy: 2,
          power: ["Fury"],
          might: 2,
        })
        .deck(["A:deck:1"], { owner: "A" })
        .deck(["B:deck:1"], { owner: "B" })
        .build();
      const asked: AwaitChoice[] = [];
      const performed: { type: string; [key: string]: unknown }[] = [];
      let answer: boolean | undefined;
      const choose = (request: Parameters<Parameters<typeof createActionPipelineHost>[0]["choose"]>[0]) => {
        asked.push(request as AwaitChoice);
        if (request.type === "optional" && answer !== undefined) return answer;
        throw new AwaitChoice(request);
      };
      const host = createActionPipelineHost({
        checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
        restore: checkpoint => {
          kernel.restore(checkpoint.state);
          kernel.copyLinkedFrom(checkpoint.links);
        },
        objects: () => kernel.objects,
        perform: action => {
          performed.push(action as typeof performed[number]);
          return kernel.perform(action);
        },
        choose,
        context: (source, controller, timingPoint) =>
          bindResolveContext(kernel, { source, controller, timingPoint, choose }),
        testTrigger: () => false,
      });
      const binding = createProgramBinding({ cardPrograms: [admitted] });
      const engine = new ChainEngine({
        turnOrder: ["A", "B"],
        turnPlayer: "A",
        phase: "main",
        host,
        cleanup: () => false,
        describePlay: binding.describePlay,
      });
      const source = kernel.getObject("ogn-010-298");
      const described = binding.describePlay(
        {
          type: "play",
          player: "A",
          object: source.ref,
          location: { type: "base", player: "A" },
        },
        source,
      );
      // The production binding supplies the original program's optional
      // Accelerate component. The server catalog supplies the distinct printed
      // base cost: ObjectSnapshot.power is a Domain set, so `["Fury"]` here does
      // not mean that Legion Rearguard has one printed Power.
      const draft = {
        ...described,
        cost: {
          ...described.cost!,
          printed: {
            id: "ogn-010-298",
            cardType: "Unit",
            domains: ["Fury"],
            energy: 2,
            power: null,
          },
        },
      };

      expect(legionRearguard.status).toBe("judge-required");
      expect(described.cost).toMatchObject({
        cost: { kind: "printed" },
        domains: ["Fury"],
        optionalAdditional: [
          {
            kind: "accelerate",
            cost: {
              payments: [
                { kind: "energy", amount: { kind: "constant", value: 1 } },
                { kind: "power", amount: { kind: "constant", value: 1 } },
              ],
            },
          },
        ],
      });
      expect(draft.cost.optionalAdditional).toBe(described.cost!.optionalAdditional);
      expect(draft.cost.printed).toEqual({
        id: "ogn-010-298",
        cardType: "Unit",
        domains: ["Fury"],
        energy: 2,
        power: null,
      });

      expect(() => engine.execute(draft)).toThrow(AwaitChoice);
      expect(kernel.getObject("ogn-010-298").ref).toEqual(source.ref);
      expect(kernel.player("A")).toMatchObject({ energy: 3, power: ["Fury"] });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        type: "optional",
        chooser: "A",
        visibility: "public",
      });
      expect(asked[0]!.id).toContain(":optional:");
      expect(asked[0]!.id).toContain(":accelerate.cost:");

      answer = selected;
      engine.execute(draft);
      expect(asked).toHaveLength(2);
      expect(asked[1]).toMatchObject({ id: asked[0]!.id, type: "optional" });

      const unit = kernel.getObject("ogn-010-298");
      expect({
        zone: unit.zone,
        location: unit.location,
        exhausted: unit.exhausted,
        energy: kernel.player("A").energy,
        power: kernel.player("A").power,
      }).toEqual({
        zone: "board",
        location: { type: "base", player: "A" },
        exhausted,
        energy,
        power,
      });
      expect(unit.ref).toEqual({ id: source.ref.id, zoneEntryId: source.ref.zoneEntryId + 2 });
      expect(unit.ref).not.toEqual(source.ref);
      expect(engine.items).toEqual([]);
      expect(engine.trace).toContainEqual({ step: "finalized", item: draft.id });
      expect(engine.trace).toContainEqual({ step: "resolved", item: draft.id });

      const payments = performed.filter(action => action.type === "pay");
      expect(payments).toEqual([
        {
          type: "pay",
          player: "A",
          plan: {
            finalized: true,
            energy: selected ? 3 : 2,
            power: selected ? ["Fury"] : [],
          },
        },
      ]);
      expect(performed.filter(action => action.type === "ready")).toHaveLength(selected ? 1 : 0);
      expect(performed.filter(action => action.type === "exhaust")).toHaveLength(selected ? 0 : 1);
      expect(engine.pipeline.events.filter(event => event.timingPoint === "chain-item-finalize")).toHaveLength(1);
      expect(engine.pipeline.events.filter(event => event.timingPoint === "object-readied")).toEqual([]);
      expect(engine.pipeline.events.filter(event => event.timingPoint === "object-enters-board")).toHaveLength(1);
      expect(engine.pipeline.events.map(event => event.timingPoint)).toEqual([
        "object-leaves-zone",
        "object-leaves-hand",
        "object-enters-zone",
        "object-enters-chain",
        "chain-item-pending",
        "cleanup-start",
        "cleanup-end",
        "chain-item-finalize",
        "cleanup-start",
        "cleanup-end",
        "object-leaves-zone",
        "object-leaves-chain",
        "object-enters-zone",
        "object-enters-board",
        "object-enters-base",
        "card-played",
        "chain-item-resolve",
        "cleanup-start",
        "cleanup-end",
      ]);
      expect(engine.pipeline.events.find(event => event.timingPoint === "card-played")?.details).toMatchObject({
        playedFromHand: true,
        printed: { energy: 2, power: ["Fury"], might: 2 },
      });
    },
  );
});

describe("printed Unit Chain parity: command-sequence gates", () => {
  it.todo("ogn-001-298: begin hand -> Chain, answer Accelerate, and reject a stale/sibling source head with the same event and zone evidence");
  it.todo("ogn-001-298: keep entry pending when the native journal has not observed the two Chain commits");
  it.todo("ogn-001-298: accept the journal-bound Chain head and issue exactly one required payment task");
  it.todo("ogn-001-298: reject payment-source attestation without the V4 attempt/choice proof lineage");
  it.todo("ogn-010-298: physical replay decline path pays the printed 2 Energy and enters the owner's Base exhausted");
  it.todo("ogn-010-298: physical replay pay path pays 3 Energy plus 1 Fury Power and enters the owner's Base ready");
  it.todo("ogn-010-298: resolved pre-exit history accepts exactly two witnessed sources, declines Accelerate, then enters exhausted");
  it.todo("ogn-010-298: resolved pre-exit history rejects additional source work after the census is complete");
  it.todo("ogn-010-298: resolved pre-exit history rejects a label whose native transition does not leave play");
  it.todo("ogn-010-298: historical P8 replay remains blocked when resolved-pre-exit history is disabled");
});
