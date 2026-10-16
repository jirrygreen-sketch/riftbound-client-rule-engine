import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/scorched-earth.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: damage } = await import(new URL("effects/instructions/effect.damage.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-0de7fdfddfced7ff6b7fcdb3da2d93eb7c6f6531565882598b1ff5fa0d827fa0";
const [keyword, play] = program.abilities;
const deal = play.body[0];

test("rad-006-167 Scorched Earth: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\nDeal 5 damage split among units at a single battlefield."
  );
});

test("rad-006-167 Scorched Earth: judge-required naming the single-battlefield group gap", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.14\.a/);
  assert.match(program.judgeReason, /group/);
  assert.match(program.judgeReason, /355\.14\.h/);
});

test("rad-006-167 Scorched Earth: [Action] plus one split-damage target up to 5 units, capped at the damage", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.body.length, 1);
  assert.equal(deal.op, "effect.damage");
  assert.deepEqual(deal.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(deal.args.divide, { kind: "constant", value: true });
  assert.deepEqual(deal.args.target, { kind: "constant", value: "scorched-earth.units" });

  assert.equal(deal.targets.length, 1);
  const [spec] = deal.targets;
  assert.equal(spec.id, "scorched-earth.units");
  // Targets are units on the Board at a battlefield (355.9.b: "at a battlefield"
  // is a targeting restriction; the battlefield itself is not a target, 355.10.b).
  assert.deepEqual(spec.filter, { type: "unit", zone: "board", location: "battlefield" });
  // 355.14.c: the target count cannot exceed the available damage (5).
  assert.equal(spec.max, 5);
  assert.equal(spec.selection, "any");
  // Group marker for "at a single battlefield" (CR 355.14.a).
  assert.equal(spec.group, true);
  assert.equal(deal.picks, undefined);
  assert.equal(deal.linkedTo, undefined);
});

test("rad-006-167 Scorched Earth golden: 5 damage split 3/2 across two targeted units", () => {
  const kernel = world()
    .unit("enemy-1", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-2", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: deal.args.amount, target: "scorched-earth.units", divide: true },
    {
      world: kernel,
      targets: { "scorched-earth.units": [kernel.ref("enemy-1"), kernel.ref("enemy-2")] },
      answers: { "effect.damage:divide:0": 3, "effect.damage:divide:1": 2 }
    }
  );
  assert.equal(run.result.status, "executed");
  // CR 355.14.e: the division is chosen at resolution; 418.1.c marks each unit.
  assert.equal(run.linked.dealt, 5);
  assert.equal(run.linked.dealtCount, 2);
  assert.deepEqual(run.linked.dealtTo, [
    { target: { id: "enemy-1", zoneEntryId: 1 }, amount: 3 },
    { target: { id: "enemy-2", zoneEntryId: 1 }, amount: 2 }
  ]);
  assert.equal(kernel.getObject("enemy-1").damage, 3);
  assert.equal(kernel.getObject("enemy-2").damage, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["damage", "damage"]);
});

test("rad-006-167 Scorched Earth golden: the split asks for the division at resolution", () => {
  const kernel = world()
    .unit("enemy-1", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: deal.args.amount, target: "scorched-earth.units", divide: true },
    { world: kernel, targets: { "scorched-earth.units": [kernel.ref("enemy-1")] } }
  );
  assert.equal(run.result, null);
  assert.equal(run.asked.request.min, 1);
  // Only one target: the whole 5 must go to it (355.14.f/.g allow no smaller
  // valid amount when remaing slots are exhausted).
  assert.equal(run.asked.request.max, 5);
  assert.equal(kernel.getObject("enemy-1").damage, 0);
});

test("rad-006-167 Scorched Earth boundary: a stale target set ignores the instruction (359.3.e.7)", () => {
  const kernel = world()
    .unit("enemy-1", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("enemy-1");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    damage,
    { amount: deal.args.amount, target: "scorched-earth.units", divide: true },
    { world: kernel, targets: { "scorched-earth.units": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "rad-006-167 Scorched Earth: the 'at a single battlefield' group constraint (CR 355.14.a) " +
    "needs target-group enforcement; TargetRequirement carries kind/group but target/ never " +
    "checks that the chosen members share one location (target.many, RIFT-90 scope)"
);
test.todo(
  "rad-006-167 Scorched Earth: 355.14.h (fewer available damage than targets at resolution " +
    "lets the controller drop Targets) has no implementation; effect.damage negates instead"
);
