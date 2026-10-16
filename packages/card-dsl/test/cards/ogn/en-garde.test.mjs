import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import enGarde from "../../../dist/cards/ogn/en-garde.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL = "card.hash-9e538f0004c80732dc1212c4b54ff1803de134cd9a4b8e1bb91a6c710b43a73a";

const [keyword, play] = enGarde.abilities;
const [firstClause, secondClause] = play.body;
// The instruction body without the TargetSpecs: the reference kernel matches
// filters by value and cannot resolve the pipeline's "controller" placeholder,
// so Finalize-time target locking is supplied directly (repo convention used
// by the merged Pit Rookie golden).
const body = play.body.map(({ targets, ...rest }) => rest);

test("En Garde program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(enGarde);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("En Garde identity, ruleset, status and printed text", () => {
  assert.equal(enGarde.canonicalCardId, CANONICAL);
  assert.equal(enGarde.rulesetVersion, "core-1.5");
  assert.equal(enGarde.status, "judge-required");
  assert.equal(enGarde.judgeReason.length > 0, true);
  assert.match(enGarde.judgeReason, /continuous\.might/);
  assert.match(enGarde.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(enGarde.canonicalCardId), enGarde);
  assert.equal(
    enGarde.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Give a friendly unit +1 :rb_might: this turn, then an additional +1 :rb_might: this turn " +
      "if it is the only unit you control there."
  );
});

test("En Garde keyword is the printed [Reaction]", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
});

test("En Garde body: two ordered Might clauses sharing the friendly-unit target", () => {
  assert.equal(play.body.length, 2);
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["grant-plus-1", "continuous.might"],
      ["grant-plus-1-conditional", "continuous.might"]
    ]
  );
  for (const instruction of play.body) {
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: "friendly-unit" });
    assert.deepEqual(instruction.targets, [
      {
        id: "friendly-unit",
        filter: { type: "unit", controller: "controller" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
  }
  // "then" is sequencing, not a dependency on the first clause's result: the
  // second clause repeats the same instruction, so it must stay independent
  // (linking it would let an ignored first clause suppress the second).
  assert.equal(firstClause.linkedTo, undefined);
  assert.equal(secondClause.linkedTo, undefined);
  assert.equal(firstClause.condition, undefined);
});

test("En Garde conditional clause: 'the only unit you control there'", () => {
  assert.deepEqual(secondClause.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "units",
      filter: {
        type: "unit",
        controller: "controller",
        sameLocationAs: { target: "friendly-unit" },
        exclude: { target: "friendly-unit" }
      }
    },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });
});

function runBody(kernel) {
  kernel.setTargets("friendly-unit", [kernel.ref("solo")]);
  const context = bindResolveContext(kernel, {
    query: filter => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "controller") normalized[key] = kernel.controller;
      }
      return kernel.listObjects().filter(object => matchesObjectFilter(normalized, object));
    }
  });
  return runAbilityBody(body, context, undefined, { host: kernel.ref("solo") });
}

test("En Garde interpreter: an ordinary friendly target gets +1 Might this turn", () => {
  const kernel = world()
    .unit("solo", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const outcome = runBody(kernel);

  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "negated"]);
  const layers = createLayerEngine([kernel.getObject("solo")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("solo")).might, 3);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("solo")).might, 2);
});

test("En Garde interpreter: a unique friendly target gets the additional +1 Might", () => {
  const kernel = world().unit("solo", { might: 2 }).build();
  const outcome = runBody(kernel);

  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "executed"]);
  const layers = createLayerEngine([kernel.getObject("solo")], kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("solo")).might, 4);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("solo")).might, 2);
});

test.todo(
  "En Garde: bind the Reaction CardProgram to the production Chain target plan and timing window, " +
    "including the location-scoped unique-unit condition (CR 158.1 / 355.9.b; RIFT-257)"
);
