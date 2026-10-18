import assert from "node:assert/strict";
import test from "node:test";

import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ambessa-respected-and-feared.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-e8af5c2839945839572f9122c2803fdda719845f1a7356eca006d791891545cd";
const SOURCE_TEXT =
  "[Empower] :rb_energy_1::rb_rune_order::rb_rune_order: " +
  "(:rb_energy_1::rb_rune_order::rb_rune_order:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Assault 2]. (+2 :rb_might: while I'm an attacker.)\n" +
  "[Empowered][>] When I attack, kill an enemy unit here with less Might than me.";

const [empower, assaultGrant, attackTrigger] = program.abilities;
const [killWeaker] = attackTrigger.body;

const ambessaKernel = (enemyMight) => {
  const base = world()
    .player("controller")
    .unit("ambessa", {
      controller: "A",
      might: 5,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      might: enemyMight,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("far-enemy", {
      owner: "B",
      controller: "B",
      might: 1,
      location: { type: "battlefield", id: "bf-2" }
    })
    .build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("ambessa") });
  kernel.setTargets("ambessa.enemy-unit-here", [kernel.ref("enemy")]);
  return kernel;
};

test("ven-136-166 Ambessa, Respected and Feared: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-136-166 Ambessa: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The refreshed reason names the four measured gaps, not merged task numbers.
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /Unsupported cost kind: empower/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-136-166 Ambessa: [Empower] plus the Empowered [Assault 2] grant", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 807.1.c: Assault 2 is a valued keyword whose definition is merged; the card
  // only declares the 828.1.b.1 dependent grant of that keyword.
  assert.ok(keywordDefinitionsById.get("Assault"), "the Assault KeywordDef is merged");
  assert.equal(assaultGrant.kind, "static");
  assert.equal(assaultGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(assaultGrant.effect.keyword, "assault");
  assert.deepEqual(assaultGrant.effect.value, { kind: "constant", value: 2 });
  assert.equal(assaultGrant.condition.kind, "compare");
  assert.deepEqual(assaultGrant.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.equal(assaultGrant.condition.operator, "gte");
  assert.deepEqual(assaultGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-136-166 Ambessa: the merged grant primitive really registers the Assault 2 grant", () => {
  const kernel = world()
    .unit("ambessa", { types: ["champion"], zone: "board", owner: "A", controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ambessa") });
  const body = [{
    id: "ambessa.grant-assault",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: assaultGrant.effect.keyword },
      value: assaultGrant.effect.value,
      // 828.1.b.1 的“我获得”= 授予宿主自身：契约 3.6 的 self 选择器。
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "ability");
  assert.equal(context.continuousEffects[0].effect.effect.keyword, "assault");
  assert.equal(context.continuousEffects[0].effect.effect.keywordValue, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "permanent" });
});

test("ven-136-166 Ambessa: the Empowered attack trigger and its Might-comparison kill", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);

  assert.equal(killWeaker.id, "ambessa.kill-weaker-enemy-here");
  assert.equal(killWeaker.op, "effect.kill");
  assert.deepEqual(killWeaker.args.target, {
    kind: "constant",
    value: "ambessa.enemy-unit-here"
  });
  assert.equal(killWeaker.targets.length, 1);
  assert.deepEqual(killWeaker.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.equal(killWeaker.targets[0].selection, "one");
  // “with less Might than me”: target Might < source Might, evaluated at
  // resolution (contract 3.6 evaluate timing).
  assert.deepEqual(killWeaker.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { target: "ambessa.enemy-unit-here" },
      property: "might"
    },
    operator: "lt",
    right: { kind: "object-property", object: "self", property: "might" }
  });
});

test("ven-136-166: the live Empowered trigger condition passes the strict validator", () => {
  const result = validateTriggerSpec({
    ...attackTrigger.trigger,
    filter: translateTriggerFilter(attackTrigger.trigger.filter, "host", attackTrigger.trigger.at)
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(attackTrigger.trigger.condition, assaultGrant.condition);
});

test("ven-136-166 golden: the attack kill destroys a weaker enemy unit here", () => {
  const body = attackTrigger.body.map(({ targets, ...rest }) => rest);
  const kernel = ambessaKernel(3);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["ambessa.kill-weaker-enemy-here", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy").zone, "trash");
  // An enemy at another battlefield is never affected.
  assert.equal(kernel.getObject("far-enemy").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("ven-136-166 golden: equal or greater Might leaves the enemy unit alone (skipped, not mistargeted)", () => {
  const body = attackTrigger.body.map(({ targets, ...rest }) => rest);
  for (const enemyMight of [5, 7]) {
    const kernel = ambessaKernel(enemyMight);
    const outcome = runAbilityBody(body, kernel);
    assert.equal(outcome.status, "partial", `might=${enemyMight}`);
    assert.deepEqual(
      outcome.results.map(entry => [entry.result.status, entry.result.reason]),
      [["negated", "skipped"]],
      `might=${enemyMight}`
    );
    assert.equal(kernel.getObject("enemy").zone, "board", `might=${enemyMight}`);
    assert.deepEqual(outcome.events, [], `might=${enemyMight}`);
  }
});

// The card remains judge-required: this binds only its supported static clause.
// State changes use real actions; the original static ability is never rewritten.
test("ambessa-respected-and-feared: the dependent static follows live Empower and Disempower actions", () => {
  const { kernel, engine } = fixture({ cards: [{
    id: "host", cardId: program.canonicalCardId, types: ["unit"],
    might: 5, energy: null, power: null
  }] });
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("host"), to: "battlefield",
    location: { type: "battlefield", id: "bf-gate" }
  }).status, "done");
  const binding = createEngineStaticBinder(engine).bindStatic(assaultGrant, kernel.getObject("host"));
  let snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.might, 5);
  assert.deepEqual(snapshot.keywords, []);
  assert.equal(snapshot.energy, null);
  assert.equal(snapshot.power, null);

  assert.equal(engine.commit({ type: "empower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 1);
  assert.equal(snapshot.might, 5);
  assert.deepEqual(snapshot.keywords, [{ id: "assault", value: 2 }]);

  assert.equal(engine.commit({ type: "disempower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 0);
  assert.equal(snapshot.might, 5);
  assert.deepEqual(snapshot.keywords, []);
  assert.deepEqual(engine.pipeline.events.filter(event => event.timingPoint === "empowered-changed")
    .map(event => event.action.type), ["empower", "disempower"]);
  binding.unbind();
});

test("ambessa-respected-and-feared: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});

test("ambessa-respected-and-feared evidence: the printed 1 Energy + 2 Order Power never reaches the planner", () => {
  // 827.1.c.1: KeywordAbility carries only keyword/value, so the expanded
  // activation ships { kind: "empower" } and the real planner rejects it.
  const kernel = world().player("A", { energy: 5 })
    .unit("host", { controller: "A", energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("host") });
  assert.throws(
    () => buildCostPlan(context, { id: "empower-cost", cost: { kind: "empower" } }),
    (error) => error instanceof Error && /Unsupported cost kind: empower/.test(error.message)
  );
});

test("ambessa-respected-and-feared evidence: the default lifecycle still does not re-expand the granted Assault", () => {
  // The merged KeywordGrantLayerEngine adapter covers re-expansion; the default
  // CardProgram lifecycle still uses LayerEngine and only exposes the keyword.
  const { engine, kernel } = fixture({ cards: [{
    id: "host", cardId: program.canonicalCardId, types: ["unit"],
    might: 5, energy: null, power: null, combatRole: "attacker"
  }] });
  engine.commit({ type: "move-zone", object: kernel.ref("host"), to: "base" });
  const binding = createEngineStaticBinder(engine).bindStatic(assaultGrant, kernel.getObject("host"));
  engine.commit({ type: "empower", object: kernel.ref("host") });
  const snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.deepEqual(snapshot.keywords, [{ id: "assault", value: 2 }]);
  assert.equal(snapshot.might, 5);
  assert.equal(snapshot.combatRole, null, "the production host does not carry the designation");
  binding.unbind();
});

test("ambessa-respected-and-feared golden: the merged keyword-grant adapter applies Assault 2 to an attacker", () => {
  const kernel = world().unit("host", {
    cardId: program.canonicalCardId,
    owner: "A",
    controller: "A",
    zone: "board",
    might: 5,
    combatRole: "attacker",
    location: { type: "battlefield", id: "bf-1" },
    energy: null,
    power: null
  }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("host") });
  const outcome = runAbilityBody([{
    id: "ambessa.grant-assault",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: assaultGrant.effect.keyword },
      value: assaultGrant.effect.value,
      appliesTo: { kind: "constant", value: "self" }
    }
  }], context);
  assert.equal(outcome.status, "executed");
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  for (const entry of context.continuousEffects) layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  const snapshot = layers.snapshot(kernel.ref("host"));
  assert.deepEqual(snapshot.keywords, [{ id: "Assault", value: 2 }]);
  assert.equal(snapshot.might, 7);
});

test("ambessa-respected-and-feared evidence: the attack target filter is rejected before any binding", () => {
  // 355.9 / 355.10.g: "an enemy unit here with less Might than me" needs the
  // sameLocationAs anchor, which the production target translator refuses.
  assert.throws(
    () => translateInstructionTargets(attackTrigger.body),
    (error) => error instanceof Error && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  assert.equal(instructionDefinitionsById.has("effect.kill"), true);
});

test.todo(
  "ven-136-166 Ambessa: bind printed 1 Energy + 2 Order Power through a per-instance cost carrier " +
    "so Empower.expand can emit a payable plan (827.1.c.1) - KeywordAbility has no params.cost"
);

test.todo(
  "ven-136-166 Ambessa: re-expand granted Assault 2 against the live combat designation so the " +
    "attacker gains +2 Might (807.1.c / 828.1.b.1) - the default interpreter cannot read designation"
);

test.todo(
  "ven-136-166 Ambessa: bind sameLocationAs/exclude targets and resolve the empowered attack " +
    "trigger end to end (355.9 / 466.2) - combat/flow.ts still throws combat-start-transaction"
);

