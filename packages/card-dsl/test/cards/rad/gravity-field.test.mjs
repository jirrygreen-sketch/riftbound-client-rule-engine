import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/gravity-field.js";
// card-dsl 没有到 engine-core 的依赖边（engine-core 依赖 card-dsl），
// golden 执行测试按 workspace 布局加载已构建的 engine-core。
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const draw = (await import(new URL("effects/instructions/effect.draw.js", ENGINE))).default;
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-d406d8dc66cee52b94dfb12d6f6e4fc13ed28937147e943fb4c4f4478b6bb58c";
const EXPECTED_SOURCE =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "Opponents must pay :rb_energy_1::rb_rune_rainbow: to move one or more units to this battlefield.\n" +
  "[Deathknell][>] Draw 1. (When I die, get the effect.)";

test("rad-062-167 Gravity Field: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /204\.4/);
  assert.match(program.judgeReason, /trigger\.leave/);
});

test("rad-062-167 Gravity Field: identity, ruleset and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-062-167 Gravity Field: Deploy + applied-cost declaration + Deathknell draw body", () => {
  assert.equal(program.abilities.length, 4);
  const [deploy, appliedCost, deathknell, triggered] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 204.4：Applied Cost 的开放形状声明（描述性数据，不是可执行原语）。
  assert.equal(appliedCost.kind, "static");
  assert.equal(appliedCost.effect.kind, "continuous.restrict");
  assert.equal(appliedCost.effect.mode, "applied-cost");
  assert.equal(appliedCost.effect.action, "move");
  assert.equal(appliedCost.effect.payers, "opponent");
  assert.deepEqual(appliedCost.effect.cost, { energy: 1, power: ["rainbow"] });

  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "gravity-field.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("rad-062-167 Gravity Field: the Draw 1 body really draws one card through the reference kernel", () => {
  const instruction = program.abilities[3].body[0];
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(
    draw,
    { amount: instruction.args.amount },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("rad-062-167 Gravity Field: the Deploy keyword has no merged definition", () => {
  // 防守性断言：Deploy 落地后本卡必须按依赖任务复核并改写，而不是静默保留声明。
  assert.equal(keywordDefinitionsById.get("Deploy"), undefined);
});

test("rad-062-167 Gravity Field: the merged Deathknell expansion cannot execute (unregistered trigger.leave)", () => {
  const deathknell = keywordDefinitionsById.get("Deathknell");
  assert.ok(deathknell, "effects/keywords/Deathknell.ts must be registered");
  const expansion = deathknell.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "triggered");
  assert.equal(expansion[0].trigger.at, "object-killed");
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
  assert.deepEqual(expansion[0].body.map((step) => [step.id, step.op]), [
    [`deathknell:${CARD_ID}:leave`, "trigger.leave"]
  ]);
});

test.todo("rad-062-167 Gravity Field: Deploy expansion (CR 830.1.b: play to any battlefield, no cleanup recall for non-Unit gear, kill this when an opponent holds here) needs a keywords/Deploy.ts definition plus the continuous.location/continuous.restrict consumers (\"kw-deploy\" workstream).");
test.todo("rad-062-167 Gravity Field: the applied cost (CR 204.4/204.4.b \"Opponents must pay :rb_energy_1::rb_rune_rainbow: to move one or more units to this battlefield\") needs an applied-cost primitive attached to the standard-move flow, including rainbow Power payment; nothing merged reads the static declaration above.");
test.todo("rad-062-167 Gravity Field: the Deathknell expansion needs trigger.leave plus the program -> keyword -> timing/chain wiring (contract 3.5) before \"Draw 1\" can fire on death.");
