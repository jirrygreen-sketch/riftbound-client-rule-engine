import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/drag-under.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [keyword, costModification, play] = program.abilities;
const killInstruction = play.body[0];

test("Drag Under program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-aaa1325feb0034c6e6408ff32eff79926e80a52b19fc29dfeffe6718b4ed6afe"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /366\.2/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "I cost :rb_energy_2: less to play from anywhere other than your hand.\n" +
      "Kill a unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Drag Under structure: Action keyword, printed cost, cost-modify static ability", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });

  // "I cost 2 less to play from anywhere other than your hand" — the printed
  // cost is 5 energy + 1 Order power (deck-catalog); the reduction is declared
  // as a static cost modification consumed at Finalize.
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "cost.modify");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  assert.equal(costModification.effect.appliesTo, "self");
  assert.equal(costModification.effect.fromZone, "any-except-hand");

  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 1 }
  });
});

test("Drag Under structure: 'Kill a unit at a battlefield' is one located-unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "drag-under.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "drag-under.unit" });
  assert.equal(killInstruction.linkedTo, undefined);

  assert.equal(killInstruction.targets.length, 1);
  const [target] = killInstruction.targets;
  assert.equal(target.id, "drag-under.unit");
  assert.equal(target.selection, "one");
  assert.deepEqual(target.filter, { type: "unit", locationType: "battlefield" });
});

test("Drag Under golden: the kill half kills the locked battlefield unit", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("victim");
  const run = runInstruction(kill, { target: "drag-under.unit" }, {
    world: kernel,
    targets: { "drag-under.unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.equal(kernel.getObject("victim").zone, "trash");
});

test("Drag Under golden: a unit that left the battlefield makes the instruction ignored", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "drag-under.unit" }, {
    world: kernel,
    targets: { "drag-under.unit": [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "Drag Under cost reduction: playing this spell from anywhere other than the hand reduces its " +
    "printed 5 energy by 2 at Finalize (CR 366.2 + 349 cost steps) (依赖 cost.modify 指令与卡牌静态效果到费用计划的绑定，RIFT-261 / RIFT-257)"
);
