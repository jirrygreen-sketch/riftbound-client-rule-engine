import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/back-to-back.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CARD_ID = "card.hash-da1c2e22f4362a3f4d0eaa86e904a11354020a28a999ebe7cd71d8e76da691d7";
const [reaction, play] = program.abilities;
const [grantMight] = play.body;
const unitSpec = grantMight.targets[0];

/**
 * chain/engine.ts normalizes the static self/opponent player spellings against
 * the item's controller before it calls the production matcher; the reference
 * kernel compares filter values literally, so the goldens apply the same
 * normalization the merged siphon-power / on-the-hunt goldens use.
 */
const requirement = {
  id: unitSpec.id,
  filter: { ...unitSpec.filter, controller: "A" },
  min: unitSpec.min,
  max: unitSpec.max,
  selection: unitSpec.selection
};

const registrations = (kernel) => kernel.continuousEffects.map((entry, index) => ({
  ...entry,
  timestamp: index + 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher: 'self' becomes the ability controller and
 * 'opponent' excludes that player's objects. The reference kernel's own query
 * compares filter values literally, so the goldens go through the same
 * normalization the production chain applies (the merged siphon-power /
 * switcheroo goldens use this exact helper).
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

test("Back to Back program is valid EffectIR v2 data and executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
});

test("Back to Back identity, ruleset and printed text are verbatim", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
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

  // "Give two friendly units each +2 Might this turn": the merged
  // continuous.might instruction with the printed amount and a this-turn
  // duration (317.2.c expiry); the amount is not a Buff counter (703).
  assert.equal(grantMight.id, "back-to-back.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "back-to-back.units" }
  });

  // "two friendly units": one target group of exactly two units you control
  // (355.9.b). The printed count is fixed, so it is not "up to" (355.13).
  assert.equal(grantMight.targets.length, 1);
  assert.deepEqual(unitSpec, {
    id: "back-to-back.units",
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 2,
    max: 2,
    selection: "any"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
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

test("Back to Back golden: +2 Might this turn registers for each locked unit and expires at cleanup", () => {
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A", might: 1 })
    .unit("second-unit", { owner: "A", controller: "A", might: 2 })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("first-unit"), kernel.ref("second-unit")]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["back-to-back.grant-might", "executed"]]
  );

  // 478 / 478.1.a: one arithmetic-layer registration per resolved object, each
  // with the end-of-turn duration (317.1.a / 468.7.c).
  assert.equal(kernel.continuousEffects.length, 2);
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 2);
    assert.deepEqual(entry.duration, { type: "end-of-turn" });
  }
  assert.deepEqual(
    kernel.continuousEffects.map(entry => entry.effect.filter.objectId).sort(),
    ["first-unit", "second-unit"]
  );

  // 143.2.a: the effective Might is +2 on each unit while the effect lasts.
  assert.equal(effectiveMight(kernel, "first-unit"), 3);
  assert.equal(effectiveMight(kernel, "second-unit"), 4);

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("first-unit")).might, 3);
  assert.equal(engine.expireAt("turn-end").length, 2);
  assert.equal(engine.evaluate(kernel.ref("first-unit")).might, 1);
  assert.equal(engine.evaluate(kernel.ref("second-unit")).might, 2);
});

test("Back to Back golden: a locked unit that left the Board before resolution is ignored (359.3.e.8)", () => {
  const kernel = world()
    .unit("staying", { owner: "A", controller: "A", might: 1 })
    .unit("leaving", { owner: "A", controller: "A", might: 2 })
    .build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(unitSpec.id, [stale]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "A"));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("staying").might, 1);
});

test.todo(
  "Back to Back: the [Reaction] permission's continuous.timing consumption and chain admission " +
    "(813.1.c) belong to the keyword registry expansion and chain (RIFT-85 / RIFT-120)."
);
test.todo(
  "Back to Back: the printed 3-energy cost is charged at Finalize by the merged cost plan " +
    "(the historical kind: \"cost.printed\" spelling is still rejected; the plan accepts \"printed\" / \"activated\")."
);
