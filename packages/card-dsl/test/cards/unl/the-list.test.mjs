import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/the-list.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { createLayerEngine } = await import(new URL("layers/index.js", ENGINE));

const CANONICAL_ID =
  "card.hash-507e1a3735db5fb2eaf2f03eb1f87ec27cf10682ba26b203f5b753db41e3eb00";
const SOURCE_TEXT =
  "As you play this, name a tag. (For example, Miss Fortune, Demacia, and Poro are tags.)\n" +
  ":rb_exhaust:: Give a unit with the named tag -2 :rb_might: this turn.";

const [play, activated] = program.abilities;
const [nameTag] = play.body;
const [giveMight] = activated.body;
const targetSpec = giveMight.targets[0];

test("unl-138-219 The List: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});
test("unl-138-219 The List: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /choice\.name/);
  assert.match(program.judgeReason, /namedTag/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /setTargets/);
  assert.match(program.judgeReason, /702/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-138-219 The List: 'As you play this, name a tag' is a play-time choice with the rule-defined tag list", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  // 355.1: choices made "as you play" are made during play; not a cost.
  assert.equal(play.body.length, 1);
  assert.equal(nameTag.id, "the-list.name-tag");
  // The op is the not-yet-merged naming choice (see judgeReason point 1): it is
  // recorded so the printed choice stays auditable.
  assert.equal(nameTag.op, "choice.name");
  assert.deepEqual(nameTag.args.namespace, { kind: "constant", value: "tag" });
  // 763 / 763.1: only tags that exist in Riftbound may be named.
  assert.deepEqual(nameTag.args.source, { kind: "constant", value: "riftbound-tag-list" });
  assert.deepEqual(nameTag.args.linkKey, { kind: "constant", value: "namedTag" });
  assert.equal(nameTag.targets, undefined);
  assert.equal(nameTag.picks, undefined);
});

test("unl-138-219 The List: the activated ability is action-speed, exhausts itself and modifies one chosen unit's Might", () => {
  assert.equal(activated.kind, "activated");
  // 151 / 151.2: Gear activated abilities default to action speed.
  assert.equal(activated.timing, "action");
  // 415.5 / 415.4: the exhaust symbol is the "Exhaust this" cost.
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust" }]
  });

  assert.equal(activated.body.length, 1);
  assert.equal(giveMight.id, "the-list.give-minus-2-might");
  // 143.2.a / 315.4 / 475-477: a temporary arithmetic Might modification, never a
  // Buff counter (702 / 703 is a different game object). The merged
  // continuous.might primitive registers it in the arithmetic layer (see
  // judgeReason point 3); the named-tag restriction still has no consumer.
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(giveMight.linkedTo, undefined);
  assert.equal(giveMight.picks, undefined);

  // 355.9.b / 355.10.b: "a unit" is a chosen target; "with the named tag" is a
  // targeting restriction. namedTag is a recorded key with no merged consumer
  // (see judgeReason point 2) — the restriction is kept, not rewritten away.
  assert.equal(targetSpec.id, "the-list.unit");
  assert.deepEqual(targetSpec.filter, { zone: "board", type: "unit", namedTag: true });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("unl-138-219 The List golden: the exhaust cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .unit("the-list", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A",
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("the-list") });
  const plan = buildCostPlan(context, { id: "the-list:give-might", cost: activated.cost });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(cost => cost.action.type), ["exhaust"]);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("the-list").exhausted, true);
});

test("unl-138-219 The List golden: continuous.might registers the -2 Might modification on the locked target", () => {
  const kernel = world()
    .unit("the-list", { types: ["gear"], zone: "board", location: { type: "base", player: "A" }, controller: "A", owner: "A" })
    .unit("target-unit", { zone: "board", controller: "A", owner: "A", might: 4, tags: ["Poro"] })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("the-list") });
  // The named-tag restriction has no consumer yet (judgeReason point 2), so the
  // executable half of this ability is covered with the Finalize-locked target:
  // the same setTargets path a real target lock would feed.
  context.setTargets("the-list.unit", [kernel.ref("target-unit")]);
  const outcome = resolveChainBody(activated.body, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["the-list.give-minus-2-might", "executed"]]
  );
  assert.equal(context.continuousEffects.length, 1);
  const [registration] = context.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.equal(registration.duration.type, "end-of-turn");
  assert.deepEqual(registration.effect.filter.objectId, "target-unit");
  const engine = createLayerEngine(
    context.objects,
    context.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  const snapshot = engine.evaluate(kernel.ref("target-unit"));
  assert.equal(snapshot.might, 2);
});

test.todo(
  "unl-138-219 The List: add the 'name a tag' choice op (CR 355.1 / 763 / 763.1) — no name / choose-name " +
    "primitive exists in contract 3.1 / 3.9 or in the merged op set (contract change request)"
);
test.todo(
  "unl-138-219 The List: evaluate 'the named tag' on a target (CR 355.9.b) — ObjectFilter is a static " +
    "conjunction and Condition only compares scalars, so the runtime-named tag cannot restrict the target yet"
);
