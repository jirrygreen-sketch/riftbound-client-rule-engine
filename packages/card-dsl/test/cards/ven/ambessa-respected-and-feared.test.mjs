import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ambessa-respected-and-feared.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /RIFT-87/);
});

test("ven-136-166 Ambessa: [Empower] plus the Empowered [Assault 2] grant", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(keywordDefinitionsById.get("Empower"), undefined);
  assert.equal(keywordDefinitionsById.get("Empowered"), undefined);
  // 807.1.c: Assault 2 is a valued keyword whose expansion is merged; the card
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
    property: "empoweredCount"
  });
  assert.equal(assaultGrant.condition.operator, "gte");
  assert.deepEqual(assaultGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-136-166 Ambessa: the Empowered attack trigger and its Might-comparison kill", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" },
    empowered: true
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

test("ven-136-166: the descriptive Empowered trigger gate is rejected by the strict validator", () => {
  const result = validateTriggerSpec(attackTrigger.trigger);
  assert.equal(result.ok, false);
  const codes = new Set(result.issues.map(issue => issue.code));
  assert.ok(codes.has("unknown-field"), JSON.stringify([...codes]));
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

test.todo(
  "ven-136-166 Ambessa: [Empower] expansion (827.1.c.1: 1 Energy + 2 Order Power, 'use only if " +
    "not Empowered') needs an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-136-166 Ambessa: both [Empowered][>] dependent abilities (828.1.b.1) need an Empowered " +
    "status predicate, including for the Assault 2 grant (RIFT-87)"
);
