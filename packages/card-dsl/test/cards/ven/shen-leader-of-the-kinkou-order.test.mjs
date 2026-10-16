import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shen-leader-of-the-kinkou-order.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-66a1a38d0f80c94dd99d8c34671b92d3e97ad609edb9693e7c2f2f31a8e70aa5";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "When I hold, if there is exactly one other unit you control here, you score 1 point.";

const [shield, holdAbility] = program.abilities;
const [scoreOne] = holdAbility.body;

const shenKernel = (companion) => {
  const builder = world()
    .player("controller")
    .unit("shen", {
      controller: "controller",
      might: 7,
      location: { type: "battlefield", id: "bf-1" }
    });
  if (companion === "here") {
    builder.unit("ally", { controller: "controller", location: { type: "battlefield", id: "bf-1" } });
  } else if (companion === "elsewhere") {
    builder.unit("ally", { controller: "controller", location: { type: "battlefield", id: "bf-2" } });
  } else if (companion === "second") {
    builder
      .unit("ally-1", { controller: "controller", location: { type: "battlefield", id: "bf-1" } })
      .unit("ally-2", { controller: "controller", location: { type: "battlefield", id: "bf-1" } });
  }
  const base = builder.build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("shen") });
};

test("ven-138-166 Shen, Leader of the Kinkou Order: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-138-166 Shen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-138-166 Shen: [Shield] is declared as a merged keyword", () => {
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield" });
  // 814.1.b.3: Shield with no printed value presumes 1.
  assert.equal(shield.value, undefined);
  assert.ok(keywordDefinitionsById.get("Shield"), "the Shield KeywordDef is merged");
});

test("ven-138-166 Shen: the Hold effect triggers on the closed 'hold' timing point", () => {
  assert.equal(holdAbility.kind, "triggered");
  // 315.2.b.2 / 471.2 / 473.2.b: Hold abilities trigger when the battlefield is
  // scored in the Beginning phase's hold step.
  assert.equal(holdAbility.trigger.at, "hold");
  assert.equal(holdAbility.optional, false);
  // The strict trigger validator rejects the descriptive 'hold' event spelling
  // because EVENT_PATTERN_TYPES has no held/hold discriminant yet.
  const validation = validateTriggerSpec(holdAbility.trigger);
  assert.equal(validation.ok, false);
  const codes = new Set(validation.issues.map(issue => issue.code));
  assert.ok(codes.has("invalid-event-type"), JSON.stringify([...codes]));
});

test("ven-138-166 Shen: 'score 1 point' guarded by the exactly-one-other-unit condition", () => {
  assert.deepEqual(holdAbility.body.map(instruction => instruction.id), ["shen.score-one"]);
  assert.equal(scoreOne.op, "effect.score");
  assert.deepEqual(scoreOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(scoreOne.targets, undefined);
  assert.equal(scoreOne.linkedTo, undefined);
  // 470.1 / 473.1: gaining points through effect.score is distinct from Scoring
  // a Battlefield; the instruction carries the printed count as its condition.
  assert.equal(scoreOne.condition.kind, "compare");
  assert.equal(scoreOne.condition.operator, "eq");
  assert.equal(scoreOne.condition.left.kind, "count");
  assert.equal(scoreOne.condition.left.subject, "other-friendly-units-here");
  assert.deepEqual(scoreOne.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.deepEqual(scoreOne.condition.right, { kind: "constant", value: 1 });
});

test("ven-138-166 golden: with exactly one other friendly unit here the controller scores 1 point", () => {
  const kernel = shenKernel("here");
  // The program's own instruction carries the printed condition, so the whole
  // hold-trigger body runs unmodified.
  const outcome = runAbilityBody(holdAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["shen.score-one", "executed"]
  ]);
  assert.equal(kernel.player("controller").score, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
  assert.deepEqual(outcome.linkedValues["shen.score-one.scored"], [
    { player: "controller", amount: 1 }
  ]);
});

test("ven-138-166 golden: zero, two, or elsewhere companions skip the score", () => {
  for (const companion of ["none", "elsewhere", "second"]) {
    const kernel = shenKernel(companion);
    const outcome = runAbilityBody(holdAbility.body, kernel);
    assert.equal(outcome.status, "partial", companion);
    assert.deepEqual(
      outcome.results.map(entry => [entry.result.status, entry.result.reason]),
      [["negated", "skipped"]],
      companion
    );
    assert.equal(kernel.player("controller").score, 0, companion);
    assert.deepEqual(outcome.events, [], companion);
  }
});

test.todo(
  "ven-138-166 Shen: registering the Hold effect needs a held/hold event discriminant in " +
    "events/trigger-spec.ts and the chain/events single pipeline wiring (RIFT-120)"
);

test.todo(
  "ven-138-166 Shen: full end-to-end hold scoring (315.2.b.2 hold step -> trigger -> score) is " +
    "blocked on the same RIFT-120 trigger registration path"
);
