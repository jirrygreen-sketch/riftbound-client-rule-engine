// Execution evidence (README 4.1): the Equip activation of Sacred Shears runs through the
// real ProgramBinding/ChainEngine path in test/cards/templates/keyword-equip-printed-power-882.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sacred-shears.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

test("Sacred Shears card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)");
});

test("Sacred Shears hosts a valued Order Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Order");
});

test("Sacred Shears carries its printed Equip cost as exactly one Order Power through params.cost", () => {
  const [equip] = program.abilities;
  assert.deepEqual(equip.params, {
    cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Order"] }]
    }
  });
  assert.equal(equip.params.cost.energy, undefined);
  assert.equal(equip.params.cost.payments.some(payment => payment.kind === "equip"), false);
});

test("Sacred Shears production coverage is bound to its canonical template row", () => {
  // CR v1.5 (2026-10-09), URL in the file header; Radiance effective
  // 2026-10-16.  Rules 818.1.b-.c and 818.2.  Production proof:
  // keyword-equip-printed-power-882.test.mjs / paying exactly one Order Power
  // attaches it to the only friendly Unit under this exact canonical id.
  assert.equal(program.canonicalCardId, "card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0");
  assert.equal(program.abilities[0].params.cost.payments[0].allowedDomains[0], "Order");
});

test("Sacred Shears production golden: Equip attaches for one Order and grants its +1 Might until Detach", () => {
  // Core Rules v1.5 (2026-10-09):
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // Radiance (effective 2026-10-16):
  // https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
  // Canonical card card.hash-d3579e6825470471f5ce05c53533806a5244c5e84364fe57b2aab0b7cc0f14e0.
  // Timeline: Priority -> Equip Finalize (one Order) -> both passes -> Resolve
  // Attach -> effective Might 2+1; committed Detach restores 2.  CR v1.5
  // 818.1/.2, 137.3 and 435.1.d.
  const kernel = world().player("A", { power: ["Order"] }).player("B")
    .object("shears", { cardId: program.canonicalCardId, owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"],
      zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: 1 })
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
  engine.execute(binding.describeActivate(kernel.getObject("shears"), "A"));
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 20, "Sacred Shears' production Chain settles");
    engine.pass(engine.priority);
  }
  assert.deepEqual(kernel.getObject("shears").attachedTo, kernel.ref("ally"));
  assert.deepEqual(kernel.player("A").power, []);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 3);
  assert.equal(engine.commit({ type: "detach", object: kernel.ref("shears") }).status, "done");
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
});
