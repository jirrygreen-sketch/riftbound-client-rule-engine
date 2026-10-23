// Execution evidence (README 4.1): the Equip activation of B.F. Sword runs through the
// real ProgramBinding/ChainEngine path in test/cards/templates/keyword-equip-printed-power-882.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bf-sword.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

test("B.F. Sword card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_order: (:rb_rune_order:: Attach this to a unit you control.)");
});

test("B.F. Sword hosts a valued Order Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Order");
});

test("B.F. Sword carries its printed Equip cost as exactly one Order Power through params.cost", () => {
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

// The production golden is the row-specific template test.  This assertion
// keeps the evidence discoverable from the canonical card file without
// duplicating its real ChainEngine scenario.
test("B.F. Sword production coverage is bound to its canonical template row", () => {
  // CR v1.5 (2026-10-09)
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // and Radiance (effective 2026-10-16)
  // https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
  // 818.1.b-.c, 818.2 and 818.3 govern target, Finalize payment, Resolve
  // attachment, and Equipped.  The proof is:
  // keyword-equip-printed-power-882.test.mjs / paying exactly one Order Power
  // attaches it to the only friendly Unit, for this exact canonicalCardId.
  assert.equal(program.canonicalCardId, "card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe");
  assert.equal(program.abilities[0].params.cost.payments[0].allowedDomains[0], "Order");
});

test("B.F. Sword production golden: Equip attaches for one Order and grants its +3 Might until Detach", () => {
  // Core Rules v1.5 (2026-10-09):
  // https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
  // Radiance (effective 2026-10-16):
  // https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
  // Canonical card card.hash-959c19d68f06f8f929625bfde93a1132701da5a5d0b49e91583db341384f0bfe.
  // Timeline: A activates Equip under Priority -> Finalize locks the friendly
  // Unit and pays one Order -> A/B pass in order -> Resolve Attaches.  The
  // production layer reads base 2 + Might Bonus 3.  A committed Detach stops
  // the bonus on the next layer read.
  const kernel = world()
    .player("A", { power: ["Order"] })
    .player("B")
    .object("sword", {
      cardId: program.canonicalCardId,
      owner: "A", controller: "A", types: ["gear"], tags: ["Equipment"],
      zone: "board", location: { type: "base", player: "A" },
      energy: null, power: null, might: 3
    })
    .base("ally", { owner: "A", controller: "A", might: 2 })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "select-objects" && request.id.endsWith("equip-target")) return [kernel.ref("ally")];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  binding.attachLifecycle(engine);
  engine.execute(binding.describeActivate(kernel.getObject("sword"), "A"));
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 20, "B.F. Sword's production Chain settles");
    engine.pass(engine.priority);
  }
  assert.deepEqual(kernel.getObject("sword").attachedTo, kernel.ref("ally"));
  assert.deepEqual(kernel.player("A").power, []);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 5);
  assert.equal(engine.commit({ type: "detach", object: kernel.ref("sword") }).status, "done");
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 2);
  assert.equal(requests.length, 1);
});
