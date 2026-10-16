import { describe, expect, it } from "vitest";
import blazingScorcher from "../../../../../packages/card-dsl/src/cards/ogn/blazing-scorcher.js";
import legionRearguard from "../../../../../packages/card-dsl/src/cards/ogn/legion-rearguard.js";
import { expandProgram } from "../../../../../packages/engine-core/src/programs/keywords.js";
import { ChainEngine } from "../../../../../packages/engine-core/src/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../../packages/engine-core/src/events/action-adapter.js";
import { world } from "../../../../../packages/engine-core/src/effects/testing/index.js";

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
    { decision: "pay", selected: true, exhausted: false, power: ["Fury"] },
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
