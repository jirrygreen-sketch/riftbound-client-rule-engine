// Execution evidence (README 4.1): the Equip activation of Doran's Blade runs through the
// real ProgramBinding/ChainEngine path in test/cards/templates/keyword-equip-printed-power-882.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/dorans-blade.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

test("Doran's Blade card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)");
});

test("Doran's Blade hosts a valued Body Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
});

test("Doran's Blade carries its printed Equip cost as exactly one Body Power through params.cost", () => {
  const [equip] = program.abilities;
  assert.deepEqual(equip.params, {
    cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Body"] }]
    }
  });
  assert.equal(equip.params.cost.energy, undefined);
  assert.equal(equip.params.cost.payments.some(payment => payment.kind === "equip"), false);
});

test("Doran's Blade production coverage is bound to its canonical template row", () => {
  // CR v1.5 (2026-10-09), URL in the file header; Radiance effective
  // 2026-10-16.  Rules 818.1.b-.c and 818.2.  Production proof:
  // keyword-equip-printed-power-882.test.mjs / paying exactly one Body Power
  // attaches it to the only friendly Unit under this exact canonical id.
  assert.equal(program.canonicalCardId, "card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1");
  assert.equal(program.abilities[0].params.cost.payments[0].allowedDomains[0], "Body");
});

test("Doran's Blade production golden: Equip attaches for one Body and grants its +2 Might until Detach", () => {
  // Canonical card card.hash-a1ee07f71d453092ab7d54f9491684e972b735b22bb1f3fda73f2641bcedbfe1.
  // Timeline: Priority -> Equip Finalize (one Body) -> both passes -> Resolve
  // Attach -> effective Might 2+2; committed Detach restores 2.  CR v1.5
  // 818.1/.2, 137.3 and 435.1.d.
  const kernel = world().player("A", { power: ["Body"] }).player("B")
    .object("blade", { cardId: program.canonicalCardId, owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"],
      zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: 2 })
    .base("ally", { owner: "A", controller: "A", might: 2 }).build();
  const choose = request => request.type === "select-objects" && request.id.endsWith("equip-target")
    ? [kernel.ref("ally")] : (() => { throw new Error(`Unexpected production choice ${request.id}`); })();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  binding.attachLifecycle(engine);
  engine.execute(binding.describeActivate(kernel.getObject("blade"), "A"));
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 20, "Doran's Blade production Chain settles");
    engine.pass(engine.priority);
  }
  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("ally"));
  assert.deepEqual(kernel.player("A").power, []);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 4);
  assert.equal(engine.commit({ type: "detach", object: kernel.ref("blade") }).status, "done");
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
});
