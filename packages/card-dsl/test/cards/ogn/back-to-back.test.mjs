import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/back-to-back.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-da1c2e22f4362a3f4d0eaa86e904a11354020a28a999ebe7cd71d8e76da691d7";
const [reaction, play] = program.abilities;
const [grantMight] = play.body;
const unitSpec = grantMight.targets[0];

/**
 * The same bounds the merged target system reads from the card's spec. The
 * static "controller" spelling is resolved by the layer that owns the board
 * state (chain/engine.ts maps it to the ability controller); the reference
 * kernel compares raw values, so the fixture pins the acting seat here.
 */
const requirement = {
  id: unitSpec.id,
  filter: { ...unitSpec.filter, controller: "A" },
  min: unitSpec.min,
  max: unitSpec.max,
  selection: unitSpec.selection
};

test("Back to Back program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Back to Back identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.equal(program.judgeReason.includes("RIFT-91"), true);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Give two friendly units each +2 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Back to Back structure: Reaction keyword, printed cost, a fixed two-unit Might grant", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(play.body.length, 1);

  // "Give two friendly units each +2 Might this turn": the pending layers
  // instruction (continuous.might) with the printed amount and a this-turn
  // duration (317.2.c expiry); the amount is not a Buff counter (703).
  assert.equal(grantMight.id, "back-to-back.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "literal", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "literal", value: "this-turn" });

  // "two friendly units": one target group of exactly two units you control
  // (355.9.b). The printed count is fixed, so it is not "up to" (355.13).
  assert.equal(grantMight.targets.length, 1);
  assert.deepEqual(unitSpec, {
    id: "back-to-back.units",
    filter: { types: "unit", controller: "controller" },
    min: 2,
    max: 2,
    selection: "any"
  });
});

test("Back to Back golden: the merged target system locks exactly two friendly units", () => {
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A" })
    .unit("second-unit", { owner: "A", controller: "A" })
    .unit("third-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();
  kernel.setAnswers({ ["target:" + unitSpec.id]: [kernel.ref("first-unit"), kernel.ref("third-unit")] });

  const plan = finalizeTargetPlan(kernel, requirement);
  assert.equal(plan.selected.length, 2);
  assert.deepEqual(plan.selected.map(ref => ref.id), ["first-unit", "third-unit"]);
  assert.equal(resolveTargetPlan(kernel, plan).status, "resolved");
});

test("Back to Back golden: fewer than two friendly units cannot finalize (355.8)", () => {
  const kernel = world()
    .unit("only-unit", { owner: "A", controller: "A" })
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();

  // 355.8: valid choices must be made for all targets before the spell goes on
  // the chain; with only one friendly unit the fixed pair is unavailable and
  // the merged target system rejects the finalize instead of playing for less.
  assert.throws(() => finalizeTargetPlan(kernel, requirement), /required target count/);
});

test.todo(
  "Back to Back: the +2 Might this turn itself (433.1.a layer modulation, 317.2.c end-of-turn " +
    "expiry, two units each) needs the card-facing continuous.might instruction that feeds the " +
    "merged layers engine (RIFT-91)."
);

test.todo(
  "Back to Back: the [Reaction] permission's continuous.timing consumption and chain admission " +
    "(813.1.c) belong to the keyword registry expansion and chain (RIFT-85 / RIFT-120)."
);
