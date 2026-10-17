import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/show-of-strength.js";
import { validateCardProgram } from "../../../dist/ir/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CARD_ID = "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f";

test("sfd-106-221 Show of Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, "core-1.5");
  assert.equal(result.value.status, "judge-required");
  assert.match(result.value.judgeReason, /Mighty/);
  // The Mighty KeywordDef has merged since the original note; the refreshed
  // reason points at the missing query/layer predicate consumer.
  assert.match(result.value.judgeReason, /mightGte/);
  assert.match(result.value.judgeReason, /RIFT-359/);
  assert.equal(result.value.judgeReason.includes("registry is currently empty"), false);
});

test("sfd-106-221 Show of Strength: structure — reaction keyword plus a count-driven draw", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, play] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(play.body.length, 1);
  const [instruction] = play.body;
  assert.equal(instruction.id, "draw-per-mighty");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args, {
    amount: {
      kind: "count",
      subject: "unit",
      filter: { type: "unit", controller: "you", mightGte: 5 }
    }
  });
  // 非目标集合查询：没有 targets / picks，不会触发“成为目标”类触发（355.7 / 355.10）。
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);

  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Draw 1 for each of your [Mighty] units. (A unit is Mighty while it has " +
      "5+ :rb_might:.)"
  );
});

test("sfd-106-221 Show of Strength: the count-driven draw follows the controller's quantified set", () => {
  // The golden locks the amount = count(filter) evaluation shape and the draw
  // result, not the Mighty predicate itself: every merged matcher silently
  // ignores the declared `mightGte` key, so the count here is the controller's
  // unit set (the printed predicate binding is the judged gap, see the
  // judgeReason). The reference kernel's query only supports exact predicates
  // and matches `zone` literally, so the kernel-side expression replaces the
  // contract placeholders with the concrete controller and adds zone: board
  // (deck cards also carry types: ["unit"] in the kernel).
  const testWorld = world()
    .deck(["deck-1", "deck-2", "deck-3"])
    .unit("mighty-1", { owner: "A", might: 6 })
    .unit("mighty-2", { owner: "A", might: 5 })
    .unit("not-mighty", { owner: "B", might: 7 })
    .build();
  const amountExpr = program.abilities[1].body[0].args.amount;
  const kernelExpr = {
    ...amountExpr,
    filter: { type: "unit", controller: testWorld.controller, zone: "board" }
  };
  const amount = testWorld.evaluate(kernelExpr);
  assert.equal(amount, 2, "count filter should see only the controller's units");

  const run = runInstruction(draw, { amount: kernelExpr }, { world: testWorld });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked?.drawn, 2);
  assert.equal(testWorld.player("A").handSize, 2);
  assert.equal(testWorld.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("sfd-106-221 Show of Strength: zero qualifying units draws zero", () => {
  const testWorld = world().deck(["deck-1"]).build();
  const amountExpr = program.abilities[1].body[0].args.amount;
  const kernelExpr = {
    ...amountExpr,
    filter: { type: "unit", controller: testWorld.controller, zone: "board" }
  };
  assert.equal(testWorld.evaluate(kernelExpr), 0);
  const run = runInstruction(draw, { amount: kernelExpr }, { world: testWorld });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked?.drawn, 0);
  assert.equal(testWorld.player("A").handSize, 0);
  assert.equal(testWorld.player("A").deckSize, 1);
});

test.todo("sfd-106-221 Show of Strength: the merged Mighty KeywordDef only exposes the static condition.predicate 'is-mighty' shape; a query/layer predicate consumer (ObjectFilter Might threshold) must replace the descriptive mightGte filter — kw-mighty; the remaining gap is the Might-threshold query consumer, in-progress RIFT-359.");

test("sfd-106-221 Show of Strength: the printed cost is really paid by the cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 4, power: ["Body"] })
    .deck(["deck-1"])
    .build();
  const plan = buildCostPlan(kernel, {
    id: "cost:show-of-strength",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 }, power: { kind: "constant", value: 1 } },
    domains: ["Body"]
  });
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Body"] }]);

  const energyBefore = kernel.player("A").energy;
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  // The 2 Energy requirement is charged from the paying player’s energy pool;
  // the 1 Power requirement is allocated from the declared Body domain.
  assert.equal(kernel.player("A").energy, energyBefore - 2);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: "Body", amount: 1 }]);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay"]);
});
