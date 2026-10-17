import assert from "node:assert/strict";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/akali-deadly-weapon.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7b24e8fb2cf27a115102e669fe4fd9219a98b10d2411cc5caf4bb1826db5e3c6";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)\n" +
  "When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n" +
  "[Empowered][>] I have +1 :rb_might:.";

const [empower, moveTrigger, mightBonus] = program.abilities;
const [mayDeal] = moveTrigger.body;
const [dealDamage] = mayDeal.args.body.value;
const OPTIONAL_ID = "akali.may-deal-damage/optional";

const akaliWorld = () =>
  world()
    .unit("akali", {
      controller: "A",
      might: 3,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("enemy", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();

test("ven-021-166 Akali, Deadly Weapon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-021-166 Akali: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /442\.1\.a/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("ven-021-166 Akali: [Empower] is declared as a bare keyword (no card-side expansion)", () => {
  // 827.1.c.1's "[2 Energy + 1 Fury Power]: Empower me. Play only if not
  // Empowered." is the keyword's expansion; the card declares the keyword only
  // (contract 3.7) and records the printed cost in the header/judgeReason.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
});

test("ven-021-166 Akali: the move trigger wraps the may-deal instruction in choice.optional", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.optional, false);
  // 421.1 / 449.1-2: "When I move" observes the closed object-moved timing point;
  // 458.1 keeps Recalls from triggering move abilities.
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  // 383.3.a / contract 3.9: the printed "you may" wraps the chosen instruction
  // in choice.optional's body (never a bare choice plus linkedTo).
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(mayDeal.id, "akali.may-deal-damage");
  assert.equal(mayDeal.op, "choice.optional");
  assert.deepEqual(mayDeal.args.body.kind, "constant");
  assert.equal(mayDeal.linkedTo, undefined);
  assert.equal(mayDeal.targets, undefined);
  assert.equal(mayDeal.picks, undefined);
});

test("ven-021-166 Akali: the damage instruction records the Empowered-dependent amount and target", () => {
  assert.deepEqual(mayDeal.args.body.value.map((instruction) => instruction.id), [
    "akali.deal-damage-at-moved-battlefield"
  ]);
  assert.equal(dealDamage.op, "effect.damage");
  // "deal 1 … If I'm [Empowered], deal 2 instead": the replacement amount is
  // gated on the host's live Empowered status (442.1.a). A count above one
  // still replaces 1 with 2, rather than scaling damage by the count.
  assert.deepEqual(dealDamage.args.amount, {
    kind: "arithmetic", operator: "add", operands: [
      { kind: "constant", value: 1 },
      { kind: "arithmetic", operator: "min", operands: [
        { kind: "constant", value: 1 },
        { kind: "object-property", object: "self", property: "empowered" }
      ] }
    ]
  });
  assert.deepEqual(dealDamage.args.target, {
    kind: "constant",
    value: "akali.unit-at-moved-battlefield"
  });
  assert.equal(dealDamage.targets.length, 1);
  const spec = dealDamage.targets[0];
  assert.equal(spec.id, "akali.unit-at-moved-battlefield");
  // 355.9.a.1 / 355.9.b: "a unit at a battlefield" is a targeting restriction;
  // "that I moved to or from" needs the move event's from/to payload (449.1-2),
  // recorded as the descriptive pending key.
  assert.deepEqual(spec.filter, {
    type: "unit",
    zone: "board",
    location: "battlefield",
    movedToOrFrom: "self"
  });
  assert.equal(spec.selection, "one");
});

test("ven-021-166 Akali: the [Empowered] Might bonus is a gated arithmetic-layer static", () => {
  // 828.1.b.1 / 828.1.c: the dependent ability is active only while the host has
  // the Empowered status; 479 puts +1 Might in the arithmetic layer.
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 1 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  assert.deepEqual(mightBonus.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-021-166 golden: declining the may wraps the whole damage half away", () => {
  const kernel = akaliWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-021-166 Akali: accepting the may without a bound movement target leaves the unit undamaged", () => {
  const kernel = akaliWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  // No movement-location target is bound, so accepting the optional action
  // cannot damage an unrelated unit (contract 3.6 / 359.3.e.6).
  const outcome = runAbilityBody(moveTrigger.body, kernel);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events, []);
  const inner = outcome.results.find(
    (entry) => entry.id === "akali.deal-damage-at-moved-battlefield"
  );
  assert.equal(inner.result.status, "ignored");
  assert.equal(inner.result.reason, "mistargeted");
});


test("ven-021-166 golden: continuous.might really adds +1 Might through the merged primitive (RIFT-258)", () => {
  // [Empowered][>] I have +1 :rb_might:. — the primitive itself is merged
  // (RIFT-258); the original gated static is exercised separately below.
  // This golden runs the card's own static effect shape through the real
  // interpreter + test kernel, then projects through the layers engine.
  const kernel = world()
    .unit("akali-deadly-weapon", { controller: "A", might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("akali-deadly-weapon") });
  const body = [{
    id: "akali-deadly-weapon.grant-might",
    op: "continuous.might",
    args: {
      amount: mightBonus.effect.amount,
      mode: { kind: "constant", value: mightBonus.effect.mode },
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");
  assert.deepEqual(context.continuousEffects[0].effect.effect.amount, 1);

  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  })));
  assert.equal(layers.evaluate(context.ref("akali-deadly-weapon")).might, 4);
});
test.todo(
  "ven-021-166 Akali: bind printed 2 Energy + 1 Fury Power through KeywordAbility.params.cost and expandProgram (827.1.c.1)"
);

test.todo(
  "ven-021-166 Akali: authoritative Empowered snapshot and binary-state action semantics across production adapters (442.1.a-c)"
);

test.todo(
  "ven-021-166 Akali: bind object-moved origin/destination LocationRefs into movedToOrFrom target selection (449.1/449.2; Recall excluded by 458.1)"
);

test.todo(
  "ven-021-166 Akali: integrate the tested dependent +1 Might clause with the printed-cost Empower activation (827.1.c.1 / 828.1.b.1)"
);

// The card remains judge-required: this binds only its supported static clause.
// State changes use real actions; the original static ability is never rewritten.
test("akali-deadly-weapon: the dependent static follows live Empower and Disempower actions", () => {
  const { kernel, engine } = fixture({ cards: [{
    id: "host", cardId: program.canonicalCardId, types: ["unit"],
    might: 3, energy: null, power: null
  }] });
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("host"), to: "battlefield",
    location: { type: "battlefield", id: "bf-gate" }
  }).status, "done");
  const binding = createEngineStaticBinder(engine).bindStatic(mightBonus, kernel.getObject("host"));
  let snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.might, 3);
  assert.equal(snapshot.energy, null);
  assert.equal(snapshot.power, null);

  assert.equal(engine.commit({ type: "empower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 1);
  assert.equal(snapshot.might, 4);

  assert.equal(engine.commit({ type: "disempower", object: kernel.ref("host") }).status, "done");
  snapshot = engine.layers.snapshot(kernel.ref("host"));
  assert.equal(snapshot.empowered, 0);
  assert.equal(snapshot.might, 3);
  assert.deepEqual(engine.pipeline.events.filter(event => event.timingPoint === "empowered-changed")
    .map(event => event.action.type), ["empower", "disempower"]);
  binding.unbind();
});

test("akali-deadly-weapon: the merged Empower definition expands through the real program adapter", () => {
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

test("ven-021-166 Akali: the actual damage expression deals 1, or 2 while Empowered", () => {
  for (const empowered of [false, true]) {
    const kernel = akaliWorld();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("akali") });
    if (empowered) {
      assert.equal(context.perform({ type: "empower", object: context.ref("akali") }).status, "done");
    }
    // Only the supported damage subeffect: movement-location targeting remains blocked.
    const { targets, ...damageSubeffect } = dealDamage;
    context.setTargets(targets[0].id, [context.ref("enemy")]);
    const result = resolveChainBody([damageSubeffect], context);
    assert.equal(result.status, "executed");
    assert.equal(result.results[0].result.status, "executed");
    assert.equal(context.getObject("enemy").damage, empowered ? 2 : 1);
    assert.deepEqual(result.events.map(event => event.action), ["damage"]);
  }
});
