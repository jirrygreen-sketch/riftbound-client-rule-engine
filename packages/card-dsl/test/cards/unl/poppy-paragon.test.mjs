import assert from "node:assert/strict";
import test from "node:test";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/poppy-paragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f5361ea4d4f46808730ef47f9575d7fc51b16c6cbcfb2659bca74cdd30b9baf2";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "When you play me, if an opponent's score is within 3 points of the Victory Score, " +
  "ready me and gain 3 XP.";

const [deflect, playTrigger] = program.abilities;
const [readyInstruction, gainXp] = playTrigger.body;

test("unl-116-219 Poppy, Paragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-116-219 Poppy, Paragon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /BoundTargetTax/);
  assert.match(program.judgeReason, /Victory Score/);
  assert.match(program.judgeReason, /194\.3/);
  // The reason must refuse to hard-code the default Victory Score of 8.
  assert.match(program.judgeReason, /不能硬编码胜利分数 8/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+|缺 CardProgram → TriggerRegistration 适配器/);
});

test("unl-116-219 Poppy, Paragon: [Deflect] stays a keyword declaration without a printed value (809.1.b.3)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
  // 809.1.b.3: an omitted Deflect value is treated as 1 by the keyword expansion.
  assert.notEqual(keywordDefinitionsById.get("Deflect"), undefined);
  assert.equal(keywordDefinitionsById.get("Deflect").valued, true);
});

test("unl-116-219 Poppy, Paragon: 'When you play me' is a mandatory card-played trigger on the source", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("unl-116-219 Poppy, Paragon: the if clause is the trigger condition, not an instruction condition", () => {
  // 383.2.a.1: the trailing “if …” belongs to the trigger condition and is
  // evaluated when the ability triggers. The Victory Score has no read path, so
  // the condition keeps the named predicate as its documented shape and is
  // explicitly blocked by never instead of a hard-coded comparison.
  assert.equal(playTrigger.trigger.condition.kind, "all");
  assert.deepEqual(playTrigger.trigger.condition.conditions[0], { kind: "never" });
  assert.deepEqual(playTrigger.trigger.condition.conditions[1], {
    kind: "expression",
    value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
  });
  assert.equal(playTrigger.body.length, 2);
  for (const instruction of playTrigger.body) assert.equal(instruction.condition, undefined);
});

test("unl-116-219 Poppy, Paragon: 'ready me and gain 3 XP' are two independent instructions", () => {
  assert.equal(readyInstruction.id, "poppy-paragon.ready-self");
  assert.equal(readyInstruction.op, "effect.ready");
  // 355.10.g: “me” is the ability's source, so the default source selection is used.
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.linkedTo, undefined);

  assert.equal(gainXp.id, "poppy-paragon.gain-3-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 3 } });
  assert.equal(gainXp.args.player, undefined);
  // “ready me and gain 3 XP” is one sentence with two clauses: neither clause
  // references the other's action, so they are not linked (359.3.e.14).
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(gainXp.targets, undefined);
});

test("unl-116-219 Poppy, Paragon golden: the body readies the source and gains 3 XP", () => {
  const base = world().unit("poppy", { exhausted: true, might: 5 }).build();
  // The interpreter binds the source selector to the host/source reference the
  // caller supplies (interpreter README); the card-played trigger supplies the
  // entered permanent, which is this unit. The reference kernel's scenario is
  // started by the exhaustion of the just-played unit (359.2.c).
  const kernel = base.clone({ source: base.ref("poppy"), sourceSnapshot: base.getObject("poppy") });
  assert.equal(kernel.getObject("poppy").exhausted, true);

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  // 416.1: the ready action clears the exhausted state.
  assert.equal(kernel.getObject("poppy").exhausted, false);
  // 730.1: gaining 3 XP increases the controller's marked XP.
  assert.equal(kernel.player("A").xp, 3);
  assert.equal(kernel.player("B").xp, 0);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["poppy-paragon.ready-self", "executed"],
    ["poppy-paragon.gain-3-xp", "executed"]
  ]);
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
  assert.equal(outcome.results[1].result.linkedValues.gained, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready", "gain-xp"]);
});

test("unl-116-219 Poppy, Paragon golden: an already-ready unit is not readied again (416.1.b/416.1.c)", () => {
  const base = world().unit("poppy", { exhausted: false, might: 5 }).build();
  const kernel = base.clone({ source: base.ref("poppy"), sourceSnapshot: base.getObject("poppy") });

  const outcome = resolveChainBody(playTrigger.body, kernel);

  // Already ready: nothing additional happens, the instruction still executes
  // (416.1.b/416.1.c) and the XP half is unaffected (359.3.e.11).
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.equal(kernel.getObject("poppy").exhausted, false);
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-116-219 Poppy, Paragon golden: a lost source negates the ready half but the XP half still resolves (359.3.e.11)", () => {
  // The source reference is old (the unit left its zone), so effect.ready is
  // ignored as mistargeted; the independent XP clause still resolves.
  const base = world().unit("poppy", { exhausted: true, might: 5 }).build();
  const stale = base.getObject("poppy");
  const kernel = base.clone({ sourceSnapshot: stale });
  kernel.addObject({ ...stale, ref: { id: "poppy", zoneEntryId: stale.ref.zoneEntryId + 1 } }, "board");
  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test.todo(
  "unl-116-219 Poppy, Paragon: [Deflect] taxes opponents' targeting with one any-domain Power " +
    "(CR 809.1.c/809.1.c.1) by wiring the target.tax layer effect into TargetPlan/costs with any-domain Power"
);
test.todo(
  "unl-116-219 Poppy, Paragon: evaluate “an opponent's score is within 3 points of the Victory Score” against the " +
    "live Victory Score (CR 194.3/194.3.a) through a victoryScore read path"
);
test.todo(
  "unl-116-219 Poppy, Paragon: the target.tax layer effect is read when an opponent chooses this unit " +
    "(CR 809.1.c/809.1.c.1) by adding a target.tax query and feeding the Finalize tax adapter from layers"
);

test("unl-116-219 Poppy, Paragon golden: the blocked Victory-Score gate keeps the play trigger off the chain", async () => {
  // The named predicate alone would be true for any non-empty string (the
  // merged expression evaluator coerces it), so the never block is what keeps
  // the printed condition closed until a real Victory Score read exists.
  const { evaluateCondition } = await import("../../../../engine-core/dist/effects/interpreter/condition.js");
  const { world } = await import("../../../../engine-core/dist/effects/testing/index.js");

  const kernel = world().player("A").player("B").build();
  const environment = {
    context: kernel, linked: () => undefined, canLookBack: () => false, isIgnored: () => false,
    query: filter => kernel.query(filter)
  };
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 0);
  assert.equal(evaluateCondition(playTrigger.trigger.condition.conditions[1], environment), true);
  assert.equal(evaluateCondition(playTrigger.trigger.condition, environment), false);
});

test("unl-116-219 Poppy, Paragon golden: a real play publishes card-played but adds no chain item", async () => {
  const { createProgramBinding } = await import("../../../../engine-core/dist/programs/index.js");
  const { fixture, resolveAll } = await import("../../../../engine-core/test/chain/helpers.mjs");

  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [{ id: "poppy", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: [], might: 5 }],
    describePlay: binding.describePlay
  });
  const source = f.kernel.getObject("poppy");
  const ids = binding.registerProgramTriggers(f.engine, { ...source, cardId: CANONICAL_ID, zone: "hand" });
  assert.equal(ids.length, 1);

  const hits = [];
  f.engine.pipeline.onTrigger = snapshot => hits.push(snapshot.registration.id);
  f.engine.execute({
    id: "play:poppy", controller: "A", kind: "unit", speed: "normal",
    source: f.kernel.getObject("poppy"), object: f.kernel.ref("poppy"), location: { type: "battlefield", id: "bf-1" }, body: []
  });
  resolveAll(f.engine);

  // 359 / 383.4.a: the play really reached the card-played timing point.
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-played").length, 1);
  // The blocked condition keeps the trigger out, so neither the ready half nor
  // the XP half ever ran.
  assert.deepEqual(hits, []);
  assert.equal(f.kernel.player("A").xp, 0);
  assert.equal(f.kernel.player("B").xp, 0);
  assert.equal(f.kernel.getObject("poppy").exhausted, true);
});

test("unl-116-219 Poppy, Paragon: every deck-level dependency of the trigger is merged", () => {
  // 383.4.a.1: "When you play me" is a Play Effect, so the merged card-played
  // timing and the card-program registration path cover the subscription itself. The
  // remaining gaps are the evaluated Victory-Score condition and the Deflect tax,
  // both recorded in judgeReason rather than approximated here.
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.equal(typeof keywordDefinitionsById.get("Deflect").expand, "function");
  // 809.1.c: the merged Deflect expansion really produces the static tax effect.
  const [tax] = keywordDefinitionsById.get("Deflect").expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tax.effect.kind, "target.tax");
  assert.deepEqual(tax.effect.value, { kind: "constant", value: 1 });
});

test("unl-116-219 Poppy, Paragon golden: its expanded Deflect charges any-domain Power through the merged tax adapter", () => {
  for (const [controller, power, payable, expectedTax] of [
    ["B", ["Mind"], true, 1],
    ["A", [], true, 0],
    ["B", [], false, 1]
  ]) {
    const initial = world().player("A", { energy: 20, power })
      .hand("spell", { types: ["spell"], energy: 1, power: [] })
      .unit("poppy", { owner: "B", controller, cardId: CANONICAL_ID, might: 5 }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("spell") });
    const target = kernel.getObject("poppy");
    const expanded = createProgramBinding({ cardPrograms: [program] }).inspect(target).abilities;
    const tax = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "target.tax");
    assert.ok(tax);
    const adapter = createTargetTaxAdapter(kernel, { id: "choose-poppy", cost: { kind: "printed" } }, {
      kind: "spell", effects: [{ id: "poppy-deflect", target: target.ref, effect: tax.effect }]
    });
    const requirement = { id: "poppy", filter: { type: "unit", zone: "board" }, min: 1, max: 1 };
    assert.deepEqual(adapter.queryTargetCandidates(requirement), payable ? [target.ref] : []);
    if (!payable) {
      // Energy alone cannot cover Deflect (809.1.c.1).
      assert.equal(kernel.player("A").energy, 20);
      continue;
    }
    assert.deepEqual(adapter.finalizeTargetPlan(requirement, { selected: [target.ref] }).selected, [target.ref]);
    assert.equal(adapter.costPlan.total.energy, 1);
    assert.equal(adapter.costPlan.total.power.reduce((sum, item) => sum + item.amount, 0), expectedTax);
    const receipt = payCostPlan(kernel, adapter.costPlan);
    assert.deepEqual(receipt.actions[0].action.plan.power, power);
    assert.equal(kernel.player("A").energy, 19);
  }
});
