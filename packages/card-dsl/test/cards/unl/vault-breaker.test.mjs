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
  // 810.1: Ganking never carries a value; the same TargetSpec id keeps it the same unit.
  assert.deepEqual(grantGanking.args.keyword, { kind: "constant", value: "Ganking" });
  assert.equal(Object.hasOwn(grantGanking.args, "value"), false);
  assert.deepEqual(grantGanking.args.duration, { kind: "constant", value: "end-of-turn" });
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

test.todo("unl-010-219 Vault Breaker: grant [Assault 2] and [Ganking] to one unit for this turn — needs a duration-bounded continuous keyword-grant primitive with the card-side ctx.addContinuous entry (RIFT-9 / RIFT-91)");
test.todo("unl-010-219 Vault Breaker: the granted Assault expands to +2 Might while the unit is an attacker (807.1.c / 807.1.d.1) — needs the attacker designation on ObjectSnapshot and the Assault expansion consumer (RIFT-81 / RIFT-91)");
test.todo("unl-010-219 Vault Breaker: the granted Ganking permits the battlefield-to-battlefield Standard Move (810.1.b / 144.4.c.1) — needs the continuous.movement permission consumer in the movement system (RIFT-83)");
test.todo("unl-010-219 Vault Breaker: all 'this turn' effects expire simultaneously (317.2.c) — the timing-point driven duration handling (RIFT-91)");

