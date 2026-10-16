import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/shakedown.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const choiceInstruction = play.body[0];
const targetSpec = choiceInstruction.targets[0];
const [drawMode, damageMode] = choiceInstruction.args.modes.value;

// The authored TargetSpec pins "an enemy unit" (controller "opponent"), which
// the production chain normalizes in its query override. The reference kernel
// compares filter fields literally, so execution locks the finalized target
// instead of re-deriving candidates — the same convention the other card
// goldens use. The authored spec is asserted structurally below.
const executableBody = play.body.map(({ targets, ...instruction }) => instruction);

/** Run the card body with the locked target and pre-supplied answers. */
function runBody(body, kernel) {
  return resolveChainBody(body, kernel);
}

test("Shakedown program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The only open item is the rules meaning of "unless".
  assert.match(program.judgeReason, /unless/);
  assert.match(program.judgeReason, /unclassified-ogn/);
});

test("Shakedown identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-ba7c14228a3f1b238f24fea9d3c946f61d32728e8186d24e325cee8bce8302f3"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Choose an enemy unit. Deal 6 to it unless its controller has you draw 2."
  );
});

test("Shakedown structure: [Reaction], one enemy-unit target, two-outcome choice by its controller", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  // Printed cost (2 Energy + 1 Fury power) comes from the catalog.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(choiceInstruction.id, "shakedown.choose-outcome");
  assert.equal(choiceInstruction.op, "choice.mode");
  assert.equal(choiceInstruction.linkedTo, undefined);
  // The choice belongs to the target unit's controller, not to the caster.
  assert.deepEqual(choiceInstruction.args.chooser, {
    kind: "object-property",
    object: { target: "shakedown.enemy-unit" },
    property: "controller"
  });
  assert.deepEqual(choiceInstruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choiceInstruction.args.different, { kind: "constant", value: true });

  // "Choose an enemy unit": one target on the board controlled by an opponent.
  assert.equal(choiceInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "shakedown.enemy-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board", controller: "opponent" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");

  // Both outcomes are separate modes; the damage mode reuses the same TargetSpec
  // so "it" is the very unit chosen by the spell.
  assert.equal(drawMode.id, "shakedown.draw-two");
  assert.equal(drawMode.body.length, 1);
  assert.equal(drawMode.body[0].id, "shakedown.draw-2");
  assert.equal(drawMode.body[0].op, "effect.draw");
  assert.deepEqual(drawMode.body[0].args.amount, { kind: "constant", value: 2 });
  assert.equal(damageMode.id, "shakedown.deal-six");
  assert.equal(damageMode.body.length, 1);
  assert.equal(damageMode.body[0].id, "shakedown.deal-6");
  assert.equal(damageMode.body[0].op, "effect.damage");
  assert.deepEqual(damageMode.body[0].args.amount, { kind: "constant", value: 6 });
  assert.deepEqual(damageMode.body[0].args.target, {
    kind: "constant",
    value: "shakedown.enemy-unit"
  });
});

test("Shakedown golden execution: the chooser is the target unit's controller, not the caster", () => {
  const kernel = world().unit("enemy-unit", { owner: "B", might: 7 }).build();
  kernel.setTargets("shakedown.enemy-unit", [kernel.ref("enemy-unit")]);

  assert.throws(
    () => runBody(executableBody, kernel),
    error => {
      assert.ok(error instanceof AwaitChoice);
      assert.equal(error.request.type, "mode");
      // The caster is A; the target's controller is B, so B must be the chooser.
      assert.equal(error.request.chooser, "B");
      assert.deepEqual(error.request.options, ["shakedown.draw-two", "shakedown.deal-six"]);
      return true;
    }
  );
});

test("Shakedown golden execution: the damage outcome deals exactly 6 to the chosen unit", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 7 })
    .deck(["card-one", "card-two"])
    .build();
  kernel.setTargets("shakedown.enemy-unit", [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "shakedown.choose-outcome/mode%3A0": "shakedown.deal-six" });

  const outcome = runBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  const damage = outcome.results.find(result => result.id === "shakedown.deal-6");
  assert.equal(damage.result.status, "executed");
  assert.equal(damage.result.linkedValues.dealt, 6);
  assert.equal(kernel.getObject("enemy-unit").damage, 6);
  assert.equal(kernel.player("A").handSize, 0);
});

test("Shakedown golden execution: the draw outcome draws 2 for the caster and deals no damage", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 7 })
    .deck(["card-one", "card-two"])
    .build();
  kernel.setTargets("shakedown.enemy-unit", [kernel.ref("enemy-unit")]);
  kernel.setAnswers({ "shakedown.choose-outcome/mode%3A0": "shakedown.draw-two" });

  const outcome = runBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  const draw = outcome.results.find(result => result.id === "shakedown.draw-2");
  assert.equal(draw.result.status, "executed");
  assert.equal(draw.result.linkedValues.drawn, 2);
  // "...has you draw 2": the caster draws (190.6.d).
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
});

test.todo(
  "Shakedown: the merged chain cannot yet finalize this body, because " +
    "choice.mode inside a resolving card body needs the Finalize/Resolve " +
    "choice-plan adapter (engine-core/src/chain/engine.ts " +
    "assertFinalizationSurface blocks mode choices)."
);

test.todo(
  "Shakedown: the official meaning of 'unless' for ogn-033-298 needs a ruling " +
    "before the card can leave judge-required; the encoded two-outcome reading " +
    "comes from docs/plans/survey/unclassified-ogn.json, not from CR v1.5."
);
