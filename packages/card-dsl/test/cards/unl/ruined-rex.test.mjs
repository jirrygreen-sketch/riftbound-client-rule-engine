import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/ruined-rex.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-5fc071b35396434404e95d25b47aa739a9bb470b51d8c62aa840cf72ceea550b";
const SOURCE_TEXT = "[Deathknell][>] Deal 4 to an enemy unit. (When I die, get the effect.)";

const [deathknell, triggered] = program.abilities;
const [damage] = triggered.body;
const [enemyUnit] = damage.targets;

test("unl-067-219 Ruined Rex: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-067-219 Ruined Rex: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /cause \/ destination/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-067-219 Ruined Rex: [Deathknell] is declared as a keyword ability (CR 808.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.value, undefined);
});

test("unl-067-219 Ruined Rex: the effect body is an object-killed trigger dealing 4 to an enemy unit", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { event: "object-killed", filter: { role: "self" } });
  assert.equal(triggered.optional, false);

  assert.equal(damage.id, "ruined-rex.deal-4");
  assert.equal(damage.op, "effect.damage");
  assert.deepEqual(damage.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(damage.args.target, { kind: "constant", value: "ruined-rex.enemy-unit" });
  // 418.6.a：未写 source 时以本能力为伤害来源，effect.damage 缺省即 ctx.source.ref。
  assert.equal(damage.args.source, undefined);
  assert.equal(damage.args.combat, undefined);
  assert.equal(damage.linkedTo, undefined);

  assert.equal(enemyUnit.id, "ruined-rex.enemy-unit");
  assert.deepEqual(enemyUnit.filter, { type: "unit", zone: "board", controller: "opponent" });
  assert.equal(enemyUnit.min, 1);
  assert.equal(enemyUnit.max, 1);
  assert.equal(enemyUnit.selection, "one");
});

test("unl-067-219 Ruined Rex golden: the deal-4 clause executes against an enemy unit (CR 418)", () => {
  const kernel = world()
    .unit("ruined-rex", { might: 6 })
    .unit("enemy-unit", { owner: "B", might: 3 })
    .build();
  kernel.setTargets(enemyUnit.id, [kernel.ref("enemy-unit")]);
  const { targets, ...instruction } = damage;
  assert.equal(targets.length, 1);
  const outcome = resolveChainBody([instruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").damage, 4);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage"]);
});

test("unl-067-219 Ruined Rex golden: an enemy unit that left the board is ignored (CR 359.3.e.7)", () => {
  const kernel = world().unit("ruined-rex").unit("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(enemyUnit.id, [stale]);
  const { targets, ...instruction } = damage;
  const outcome = resolveChainBody([instruction], kernel);

  assert.deepEqual(outcome.results.map((entry) => [entry.result.status, entry.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
});

test.todo(
  "unl-067-219 Ruined Rex: bind the printed damage body to Deathknell and preserve killed-to-Trash filtering, replacement cancellation and last-known information (CR 808.1.c/808.1.d); trigger.leave and the keyword payload adapter remain required"
);
