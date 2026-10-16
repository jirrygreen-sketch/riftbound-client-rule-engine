import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/ruined-rex.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import killDefinition from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-82/);
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

test("unl-067-219 Ruined Rex: the merged Deathknell expansion cannot execute its trigger body", () => {
  // keywords/Deathknell.ts 的展开体只引用 trigger.leave，而该 op 没有已注册实现，
  // 因此经解释器执行会抛 "Unregistered instruction opcode"（这里用真实注册表复现，
  // 不伪造 callback）。
  const kernel = world().unit("ruined-rex").build();
  assert.throws(
    () => runAbilityBody([{ id: "dk", op: "trigger.leave", args: {} }], kernel, instructionDefinitionsById),
    /Unregistered instruction opcode: trigger\.leave/
  );
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
  assert.equal(instructionDefinitionsById.has("effect.kill"), true);
  assert.equal(killDefinition.op, "effect.kill");
});

test.todo(
  "unl-067-219 Ruined Rex: [Deathknell] (CR 808.1) expansion — subscribing at object-killed, " +
    "removal from the chain when the death is replaced (808.1.d.1), and last-known capture before " +
    "the zone change (808.1.d.2/.d.3) — needs the keyword registry (RIFT-82) and the trigger.leave primitive"
);
test.todo(
  "unl-067-219 Ruined Rex: registering the card's triggered ability as a TriggerRegistration " +
    "(production chain/event pipeline) is shared wiring tracked by the coordinator (RIFT-120)"
);
