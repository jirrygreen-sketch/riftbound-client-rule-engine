import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/gust-monk.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-ac392c4087040dcdd16d8c56b9819899610a8873fb5b8314becec875dc3ef0a1";
const SOURCE_TEXT =
  "You may pay :rb_energy_1: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, banish a card from any trash to give a unit " +
  "[Assault 2] this turn. (+2 :rb_might: while it's an attacker.)";

const [play] = program.abilities;
const [banishInstruction, assaultInstruction] = play.body;

const trashKernel = ({ owner }) => {
  const builder = world().player("A").player("B");
  builder.card("target-card", { zone: "trash", owner });
  return builder.build();
};

test("ven-101-166 Gust Monk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-101-166 Gust Monk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("ven-101-166 Gust Monk: the printed optional additional cost is declared", () => {
  assert.equal(play.kind, "play");
  // 356.2.b / 356.2.b.1：「may … as an additional cost」是可选的追加费用。
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, true);
  assert.deepEqual(play.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
});

test("ven-101-166 Gust Monk: banish a card from any trash, then grant Assault 2 this turn", () => {
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["gust-monk.banish-a-card-from-any-trash", "effect.banish"],
      ["gust-monk.give-assault-2", "continuous.grant-keyword"]
    ]
  );

  // 355.10.c.1：[do X] to [do Y] 里的 “banish a card” 是指令内的费用，不是目标。
  assert.equal(banishInstruction.targets, undefined);
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "gust-monk.card-in-any-trash" }
  });
  assert.equal(banishInstruction.picks.length, 1);
  const [pick] = banishInstruction.picks;
  assert.equal(pick.id, "gust-monk.card-in-any-trash");
  // 「any trash」：不限定拥有者/控制者。
  assert.deepEqual(pick.filter, { zone: "trash" });
  assert.equal(pick.filter.owner, undefined);
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);

  // 807.1.c 的 [Assault 2] 授予，带 end-of-turn 期限（317.2.c 到期）。
  assert.equal(assaultInstruction.linkedTo, "gust-monk.banish-a-card-from-any-trash");
  assert.deepEqual(assaultInstruction.args.keyword, { kind: "constant", value: "assault" });
  assert.deepEqual(assaultInstruction.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(assaultInstruction.args.duration, {
    kind: "constant",
    value: "end-of-turn"
  });
  assert.equal(assaultInstruction.targets.length, 1);
  assert.deepEqual(assaultInstruction.targets[0].filter, {
    type: "unit",
    zone: "board"
  });
  assert.equal(assaultInstruction.targets[0].selection, "one");
});

test("ven-101-166 golden: a card in your own trash is really banished (428.1/428.2)", () => {
  const kernel = trashKernel({ owner: "A" });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    picks: { "gust-monk.card-in-any-trash": [kernel.ref("target-card")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("target-card").zone, "banishment");
  assert.equal(kernel.getObject("target-card").owner, "A");
  assert.doesNotThrow(() => assert.equal(run.linked["banished-for-assault"].count, 1));
});

test("ven-101-166 golden: 'any trash' also reaches an opponent's trash", () => {
  const kernel = trashKernel({ owner: "B" });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    picks: { "gust-monk.card-in-any-trash": [kernel.ref("target-card")] }
  });
  assert.equal(run.result.status, "executed");
  // 428.1/428.2：牌进入其**拥有者**的 Banishment，而不是施动者的。
  assert.equal(kernel.getObject("target-card").zone, "banishment");
  assert.equal(kernel.getObject("target-card").owner, "B");
  assert.deepEqual(kernel.objectsInZone("B", "banishment").length, 1);
  assert.deepEqual(kernel.objectsInZone("A", "banishment"), []);
});

test("ven-101-166 golden: an empty trash negates the banish instead of inventing a card", () => {
  const kernel = world().build();
  const run = runInstruction(banish, banishInstruction.args, { world: kernel, picks: {} });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked["banished-for-assault"].count, 0);
  assert.deepEqual(run.linked["banished-for-assault"].objects, []);
});

test.todo(
  "ven-101-166 Gust Monk: charge the optional 1-Energy additional cost (356.2.b / 356.2.b.1) — " +
    "effects/instructions/ has no cost.additional primitive and buildCostPlan only consumes a caller-supplied " +
    "optionalAdditional; programs/play.ts translateCost judge-requires additional-cost"
);

test.todo(
  "ven-101-166 Gust Monk: decide 'if you paid the additional cost' (356.4.f.1) — the frozen Condition/Expr " +
    "cannot read a cost-plan receipt (the recorded condition.result gap; adjacent to in-progress RIFT-359)"
);

test(
  "ven-101-166 golden: continuous.grant-keyword is merged and really registers the Assault grant",
  () => {
    assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
    assert.equal(assaultInstruction.op, "continuous.grant-keyword");
  }
);
