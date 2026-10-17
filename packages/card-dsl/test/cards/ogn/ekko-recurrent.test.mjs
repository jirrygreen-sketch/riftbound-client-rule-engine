import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ekko-recurrent.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { buildAdditionalCostPlan, payAdditionalCostPlan, buildRecycleCostPlan, payRecycleCostPlan } from "../../../../engine-core/dist/cost/kinds/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assessCostPayment } from "../../../../engine-core/dist/cost/payment.js";

const [accelerate, deathknell, triggered] = program.abilities;

test("Ekko, Recurrent program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Ekko, Recurrent identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-20b19f69eca1bec8914d6f44145077493010be44bbcce72961eaa633e8a62bd2"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
      "[Deathknell] — Recycle me to ready your runes. (When I die, get the effect.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Accelerate] and [Deathknell] keyword declarations come first", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
});

test("structure: Deathknell body recycles me, then readies your runes", () => {
  assert.equal(triggered.kind, "triggered");
  // 808.1.c / 429.1.a.1.b：自身死亡触发在送入 Trash 前入链（object-killed）。
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(
    triggered.body.map(instruction => instruction.id),
    ["ekko.recycle-me", "ekko.ready-runes"]
  );

  // 383.3.b："Recycle me" 是效果开头的前导费用，静态 IR 用 "self" 选择器。
  const [recycle] = triggered.body;
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "object-property",
    object: "self",
    property: "ref"
  });
  assert.equal(recycle.linkedTo, undefined);

  // 416.1："ready your runes" 是该区域的无选择集合查询（355.10.d）。
  const [ready] = [triggered.body[1]];
  assert.equal(ready.op, "effect.ready");
  assert.equal(ready.linkedTo, undefined, "the leading recycle must be extracted as a Finalize cost");
  assert.deepEqual(ready.args.objects, { kind: "constant", value: {
    kind: "query",
    filter: { zone: "rune-zone", type: "rune", controller: "self" }
  } });
});

test("Ekko supported Accelerate cost locks 1 Energy and 1 Mind Power in addition to printed costs", () => {
  for (const selected of [false, true]) {
    const base = world().player("A", { energy: 6, power: ["Mind", "Mind"] })
      .hand("ekko", { cardId: program.canonicalCardId, types: ["unit"], energy: 5, power: ["Mind"] }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("ekko") });
    const plan = buildAdditionalCostPlan(kernel, { id: "ekko-cost", cost: { kind: "printed" }, domains: ["Mind"] }, [
      { id: "accelerate", kind: "accelerate", selected }
    ]);
    assert.equal(plan.total.energy, selected ? 6 : 5);
    assert.equal(plan.total.power.reduce((total, cost) => total + cost.amount, 0), selected ? 2 : 1);
    assert.ok(plan.total.power.every(cost => cost.allowedDomains.join() === "Mind"));
    assert.deepEqual(plan.selectedAdditional, selected ? [{ id: "accelerate", kind: "accelerate" }] : []);
    const receipt = payAdditionalCostPlan(kernel, plan);
    assert.equal(receipt.actions[0].action.type, "pay");
    assert.deepEqual(receipt.actions[0].action.plan.power, selected ? ["Mind", "Mind"] : ["Mind"]);
    assert.equal(kernel.player("A").energy, selected ? 0 : 1);
  }
});

test("Ekko supported leading recycle payment acts on the current Trash incarnation", () => {
  const base = world().card("ekko", { zone: "trash", cardId: program.canonicalCardId, types: ["unit"], might: 5 })
    .deck(["top", "bottom"]).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ekko") });
  const plan = buildRecycleCostPlan(kernel, { object: kernel.ref("ekko") }, { id: "recycle-ekko" });
  const receipt = payRecycleCostPlan(kernel, plan);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "recycle"]);
  assert.equal(kernel.getObject("ekko").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "bottom", "ekko"]);
});

test("Ekko supported recycle cost rechecks its locked Trash incarnation before payment", () => {
  const base = world().card("ekko", { zone: "trash", cardId: program.canonicalCardId, types: ["unit"], might: 5 })
    .deck("top").build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ekko") });
  const plan = buildRecycleCostPlan(kernel, { object: kernel.ref("ekko") }, { id: "recycle-ekko" });
  assert.equal(assessCostPayment(kernel, plan).payable, true);
  const before = kernel.ref("ekko");
  assert.equal(kernel.perform({ type: "banish", object: before }).status, "done");
  const assessment = assessCostPayment(kernel, plan);
  assert.equal(assessment.payable, false);
  assert.equal(assessment.error.reason, "cannot-pay-cost");
  assert.equal(kernel.getObject("ekko").zone, "banishment");
  assert.notDeepEqual(kernel.ref("ekko"), before);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top"]);
  assert.equal(kernel.events.some(event => event.action === "pay" || event.action === "recycle"), false);
});

test("Ekko rune-ready sub-body executes unchanged through Chain with controller-relative queries", () => {
  for (const count of [0, 2]) {
    const runes = Array.from({ length: count }, (_, index) => ({ id: `rune-${index}`, types: ["rune"], exhausted: true }));
    const f = fixture({ cards: [...runes, { id: "enemy-rune", types: ["rune"], exhausted: true, owner: "B", controller: "B" }] });
    for (const id of [...runes.map(rune => rune.id), "enemy-rune"]) {
      f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "rune-zone" });
    }
    f.engine.advance();
    // Only the supported rune-ready sub-body is under test; this does not
    // register a Deathknell or stand in for its missing Finalize cost binding.
    f.engine.execute(f.draft("ready-sub-body", { body: [triggered.body[1]] }));
    resolveAll(f.engine);
    for (let index = 0; index < count; index++) assert.equal(f.kernel.getObject(`rune-${index}`).exhausted, false);
    assert.equal(f.kernel.getObject("enemy-rune").exhausted, true);
    assert.equal(f.kernel.events.filter(event => event.action === "ready").length, count);
  }
});

test.todo("Ekko: bind accelerate.cost to optionalAdditional and gate entry replacement on committed payment (CR 805.2.b/805.6.a)");
test.todo("Ekko: attach Deathknell body to the object-killed registration and translate cause/destination filters (CR 808.1.d)");
test.todo("Ekko: extract leading Recycle as the triggered base cost at Finalize (CR 383.3.b/383.3.b.1), then resolve ready only after payment");
