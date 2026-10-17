import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vault-breaker.js";

const CANONICAL_ID =
  "card.hash-b80a5751bd715a9eea06f849357e5792330b5cc9e83d549c928891740c31e9d8";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a unit [Assault 2] and [Ganking] this turn. (+2 :rb_might: while it's an attacker. " +
  "It can move from battlefield to battlefield.)";

const [speed, play] = program.abilities;
const [grantAssault, grantGanking] = play.body;

test("unl-010-219 Vault Breaker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-010-219 Vault Breaker: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /continuous\.movement/);
});

test("unl-010-219 Vault Breaker: [Action] plus Assault 2 and Ganking granted to the same unit this turn", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["vault-breaker.grant-assault-2", "continuous.grant-keyword"],
    ["vault-breaker.grant-ganking", "continuous.grant-keyword"]
  ]);

  // 807.1.c / 317.2.c: Assault 2 with an end-of-turn window.
  assert.deepEqual(grantAssault.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grantAssault.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantAssault.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantAssault.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "vault-breaker.unit" }
  });
  // 810.1: Ganking never carries a value; the same TargetSpec id keeps it the same unit.
  assert.deepEqual(grantGanking.args.keyword, { kind: "constant", value: "Ganking" });
  assert.equal(Object.hasOwn(grantGanking.args, "value"), false);
  assert.deepEqual(grantGanking.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantGanking.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "vault-breaker.unit" }
  });
  assert.deepEqual(grantAssault.targets[0], grantGanking.targets[0]);
  assert.deepEqual(grantAssault.targets[0], {
    id: "vault-breaker.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantAssault.linkedTo, undefined);
  assert.equal(grantGanking.linkedTo, undefined);
  assert.equal(grantGanking.picks, undefined);
});

test.todo("unl-010-219 Vault Breaker: consume the merged Assault/Ganking grants in attacker Might and Standard Move legality (807.1.c / 810.1.b)");
test.todo("unl-010-219 Vault Breaker: the granted Assault expands to +2 Might while the unit is an attacker (807.1.c / 807.1.d.1) — needs attacker designation and the Assault expansion consumer");
test.todo("unl-010-219 Vault Breaker: the granted Ganking permits the battlefield-to-battlefield Standard Move (810.1.b / 144.4.c.1) — needs the continuous.movement permission consumer in the movement system");
test("unl-010-219 Vault Breaker: the merged grant primitive records end-of-turn expiry", async () => {
  const { runAbilityBody } = await import("../../../../engine-core/dist/effects/interpreter.js");
  const { createLayerEngine } = await import("../../../../engine-core/dist/layers/index.js");
  const { world } = await import("../../../../engine-core/dist/effects/testing/index.js");
  const kernel = world().unit("target", { zone: "board", might: 3 }).build();
  kernel.setTargets("vault-breaker.unit", [kernel.ref("target")]);
  const outcome = runAbilityBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.effect.keyword), ["Assault", "Ganking"]);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.duration), [{ type: "end-of-turn" }, { type: "end-of-turn" }]);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 })));
  assert.deepEqual(
    layers.evaluate(kernel.ref("target")).keywords.map(keyword => [keyword.id, keyword.value]),
    [["Assault", 2], ["Ganking", undefined]]
  );
  assert.equal(layers.expireAt("turn-end").length, 2);
  assert.deepEqual(layers.evaluate(kernel.ref("target")).keywords, []);
});

