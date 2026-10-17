// Scenario execution evidence: ../../templates/static-642.test.mjs.
// This file keeps the validation and identity checks plus the key structural
// assertions; the real execution path for this card lives in that template row.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/clanging-sentry.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-664329985c0c826779032a079e87a5c433f6be42cbfb4f724f81fd89fcc9a90a";
const SOURCE_TEXT =
  "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)";

const [grant] = program.abilities;

const registrations = (kernel) => kernel.continuousEffects.map((entry) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

// The registrations written by the executed body live on the scoped kernel the
// interpreter ran against, so both the object list and the effect list come from
// that same scoped world.
const keywordsOf = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).keywords;

/**
 * "Your Mechs": the controller's Board Mechs (190.6.c). Following the merged
 * rad/coalesced-energy and sfd/show-of-strength goldens, the execution scenarios
 * substitute the production "controller" placeholder with the concrete player id:
 * the reference kernel compares filter scalars literally, and resolving the
 * relative-player placeholder is the real Finalize/target pipeline's job.
 */
const FRIENDLY_MECHS = {
  type: "unit",
  tag: "Mech",
  controller: "A",
  zone: "board"
};

/**
 * The printed static ability's grant as one executable body instruction: the
 * merged continuous.grant-keyword primitive consumes Expr-valued arguments, so
 * the static effect's fields are wrapped as constants here (the production
 * CardProgram -> layer registration consumer that would do this wiring is the
 * dynamic keyword-consumption gaps recorded in judgeReason and the TODOs below).
 */
function grantInstruction(id) {
  return {
    id,
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: grant.effect.keyword },
      value: grant.effect.value,
      duration: { kind: "constant", value: "end-of-turn" },
      filter: { kind: "constant", value: FRIENDLY_MECHS }
    }
  };
}

function sentryWorld() {
  return world()
    .unit("mech", { owner: "A", tags: ["Mech"], zone: "board" })
    .unit("soldier", { owner: "A", zone: "board" })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], zone: "board" })
    .unit("clanging-sentry", { owner: "A", tags: ["Mech"], zone: "board" })
    .build();
}

test("rad-055-167 Clanging Sentry: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-055-167 Clanging Sentry: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the actual remaining gap — dynamic Disarm trigger
  // consumption — not the already-merged static binder or grant instruction.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /动态/);
  // The current gap is both the dynamic keyword re-expansion consumer and the
  // missing attack-declared emitter; the reason must not claim a producer exists.
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-055-167 Clanging Sentry: one static grant of Disarm 1 to every friendly Mech", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.deepEqual(grant.effect, {
    kind: "continuous.grant-keyword",
    keyword: "disarm",
    // 831.1.c.3：印刷省略 Disarm 值，按 1；831.2 由关键词注册表把多个来源相加。
    value: { kind: "constant", value: 1 },
    filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
  });
  assert.equal(grant.condition, undefined);
});

test("rad-055-167 Clanging Sentry golden: the printed grant registers Disarm on friendly Mechs only", () => {
  const kernel = sentryWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("clanging-sentry") });

  const outcome = runAbilityBody([grantInstruction("clanging-sentry.grant-disarm")], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["clanging-sentry.grant-disarm", "executed"]]
  );
  // 478.1.a: one ability-layer registration per surviving matched object.
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => [entry.effect.layer, entry.effect.effect.keyword, entry.effect.effect.keywordValue, entry.effect.filter.objectId]).sort(),
    [
      ["ability", "disarm", 1, "clanging-sentry"],
      ["ability", "disarm", 1, "mech"]
    ]
  );

  assert.deepEqual(keywordsOf(scoped, "mech"), [{ id: "disarm", value: 1 }]);
  assert.deepEqual(keywordsOf(scoped, "clanging-sentry"), [{ id: "disarm", value: 1 }]);
  // "Your Mechs": the other friendly unit and the opponent's Mech are untouched.
  assert.deepEqual(keywordsOf(scoped, "soldier"), []);
  assert.deepEqual(keywordsOf(scoped, "enemy-mech"), []);
});

test("rad-055-167 Clanging Sentry golden: a grant adds onto a Disarm value the unit already has", () => {
  // The merged primitive's combining path (CR 831.2): when the target already has
  // a Disarm value, continuous.grant-keyword keeps that value in the ability layer
  // and adds its own instance through the arithmetic companion, so 2 + 1 reads as
  // one Disarm 3 rather than two separate instances (831.1.d.1).
  const kernel = world().unit("mech", { owner: "A", tags: ["Mech"], zone: "board", keywords: [{ id: "disarm", value: 2 }] }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mech") });

  const outcome = runAbilityBody([grantInstruction("clanging-sentry.grant-disarm")], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => entry.effect.layer),
    ["ability", "arithmetic"]
  );
  assert.deepEqual(keywordsOf(scoped, "mech"), [{ id: "disarm", value: 3 }]);
});

test("rad-055-167 Clanging Sentry golden: the merged Disarm expansion deals -1 Might this turn", () => {
  // 831.1.d: the granted Disarm expands (keywords/Disarm.ts) to "when the host
  // attacks, give an enemy unit there -1 [M] this turn". Its own instruction
  // runs unchanged on the merged continuous.might primitive.
  const disarm = keywordDefinitionsById.get("Disarm");
  assert.equal(disarm.stacking, "sum");
  const [expanded] = disarm.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "attack-declared");
  const [instruction] = expanded.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });

  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3, zone: "board" })
    .unit("src", { owner: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setTargets("disarm.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([{ ...instruction, targets: undefined }], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["disarm.give-minus-might", "executed"]]
  );
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => [entry.effect.effect.kind, entry.effect.effect.amount, entry.duration]),
    [["continuous.might", -1, { type: "end-of-turn" }]]
  );

  const layers = createLayerEngine(kernel.objects, registrations(scoped));
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 2);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 3);
});

test.todo(
  "rad-055-167 Clanging Sentry: dynamically consume a grant-keyword Disarm registration by " +
    "expanding and registering its 831.1.d attack trigger on attack-declared"
);

test.todo(
  "rad-055-167 Clanging Sentry: produce the attack-declared timing event from the combat flow " +
    "without the current combat-start-transaction block"
);
