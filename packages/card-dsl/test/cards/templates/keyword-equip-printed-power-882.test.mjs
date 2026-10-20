// README 4.1 template golden: Equipment whose only ability is a printed
// "[Equip] <one Power rune>" (CR 818). Every row is one official Fiora SFD
// card with its own canonical identity, printed domain, off-domain rune and
// expectations; each row produces separate tests.
//
// The original CardProgram from the generated registry is bound through
// createProgramBinding, the keyword registry expands Equip, and the
// activation runs through ChainEngine Finalize (target lock + cost payment),
// both passes and Resolve. Nothing is settled by hand.
//
// Not covered here: the Might Bonus applied while attached (CR 137.3,
// 435.1.d) is a rules-engine characteristic tracked by RIFT-883.
import assert from "node:assert/strict";
import test from "node:test";

import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ROWS = [
  {
    name: "B.F. Sword",
    canonicalCardId: "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe",
    domain: "Order",
    offDomain: "Body",
    energy: 4,
    mightBonus: 3,
  },
  {
    name: "Doran's Blade",
    canonicalCardId: "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1",
    domain: "Body",
    offDomain: "Order",
    energy: 2,
    mightBonus: 2,
  },
  {
    name: "Sacred Shears",
    canonicalCardId: "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0",
    domain: "Order",
    offDomain: "Body",
    energy: 2,
    mightBonus: 1,
  },
  {
    name: "Warmog's Armor",
    canonicalCardId: "card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322",
    domain: "Body",
    offDomain: "Order",
    energy: 1,
    mightBonus: 1,
  },
];

const label = row => `${row.name} [${row.canonicalCardId.slice(0, 18)}]`;

function gear(row) {
  return {
    id: "gear",
    cardId: row.canonicalCardId,
    types: ["gear"],
    tags: ["Equipment"],
    zone: "board",
    location: { type: "base", player: "A" },
    energy: row.energy,
    power: null,
    might: row.mightBonus,
  };
}

// --- Accept path through the generic scenario harness (effects/testing/scenario).

for (const row of ROWS) {
  const program = cardProgramsById.get(row.canonicalCardId);
  const [suite] = defineTemplateSuite("keyword-equip-printed-power", [{
    name: `${label(row)}: paying exactly one ${row.domain} Power attaches it to the only friendly Unit`,
    canonicalCardId: row.canonicalCardId,
    program,
    scenario: {
      players: { A: { energy: 3, power: [row.domain] }, B: { energy: 2, power: [row.domain] } },
      objects: [
        { ...gear(row), program },
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 2 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "base", player: "B" }, might: 2 },
      ],
      operations: [
        { type: "activate", object: "gear", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          gear: { zone: "board", exhausted: false },
          ally: { zone: "board", exhausted: false },
          enemy: { zone: "board" },
        },
        players: {
          A: { energy: 3, power: [] },
          B: { energy: 2, power: [row.domain] },
        },
      },
    },
  }]);
  test(suite.name, () => {
    const result = suite.run();
    const byId = id => result.state.objects.find(object => object.ref.id === id);
    assert.deepEqual(byId("gear").attachedTo, byId("ally").ref, "attached to the friendly Unit");
    assert.equal(byId("ally").attachedTo ?? null, null, "the Unit is the host, never the attached object");
    assert.deepEqual(result.state.chain, [], "the activation resolved and left the Chain");
  });
}

// --- Production fixture for choice and failure observation (same binding/Chain path).

function fixture(row, powerA) {
  const program = cardProgramsById.get(row.canonicalCardId);
  const kernel = world()
    .player("A", { energy: 3, power: powerA })
    .player("B", { energy: 2, power: [row.domain] })
    .object("gear", gear(row))
    .base("ally", { might: 2 })
    .unit("enemy", { owner: "B", controller: "B", might: 2, location: { type: "base", player: "B" } })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "select-objects") return [kernel.ref("ally")];
    throw new Error(`Unexpected production choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binding = createProgramBinding({ cardPrograms: [program] });
  binding.attachLifecycle(engine, error => { throw error; });
  const activate = () => {
    engine.execute(binding.describeActivate(kernel.getObject("gear"), "A"));
    while (engine.items.length) engine.pass(engine.priority);
  };
  return { kernel, engine, binding, requests, activate };
}

for (const row of ROWS) {
  test(`${label(row)}: the Equip target offers only Units its controller controls (CR 818.1.c.2)`, () => {
    const f = fixture(row, [row.domain]);
    f.activate();
    const targetRequests = f.requests.filter(request => request.type === "select-objects");
    assert.equal(targetRequests.length, 1);
    assert.deepEqual(targetRequests[0].options, [f.kernel.ref("ally")]);
    assert.equal(targetRequests[0].min, 1);
    assert.equal(targetRequests[0].max, 1);
    assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("ally"));
    assert.equal(f.kernel.getObject("enemy").attachedTo ?? null, null);
  });

  test(`${label(row)}: with two ${row.domain} Power only one is paid`, () => {
    const f = fixture(row, [row.domain, row.domain]);
    f.activate();
    assert.deepEqual(f.kernel.player("A").power, [row.domain]);
    assert.equal(f.kernel.player("A").energy, 3, "the printed Equip cost has no Energy");
    assert.deepEqual(f.kernel.getObject("gear").attachedTo, f.kernel.ref("ally"));
  });

  for (const [why, powerA] of [["no Power", []], [`only ${row.offDomain} Power`, [row.offDomain]]]) {
    test(`${label(row)}: with ${why} the activation is rejected atomically`, () => {
      const f = fixture(row, powerA);
      const before = f.kernel.snapshot();
      assert.throws(f.activate, /insufficient matching Power/);
      assert.deepEqual(f.kernel.snapshot(), before, "no partial payment, attachment or zone change");
      assert.equal(f.kernel.getObject("gear").attachedTo ?? null, null);
      assert.deepEqual(f.engine.items, []);
    });
  }
}
