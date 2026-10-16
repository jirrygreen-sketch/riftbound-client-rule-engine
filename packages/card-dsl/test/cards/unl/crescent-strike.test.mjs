import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crescent-strike.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f7adf9f6506b55f668b24e077add9d1252841ee4cbb74fb432903d6cfc842c88";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to each other enemy unit there.";

const [keyword, play] = program.abilities;
const [dealFour, dealOneToOthers] = play.body;
const [battlefieldSpec, unitSpec] = dealFour.targets;

test("unl-072-219 Crescent Strike: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-072-219 Crescent Strike: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.damage/);
});

test("unl-072-219 Crescent Strike: [Action] plus battlefield/unit targets and the two damage statements", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["crescent-strike.deal-4", "effect.damage"],
      ["crescent-strike.deal-1-to-others", "effect.damage"]
    ]
  );

  // 355.10.d: the chosen battlefield is a target; 355.10.b: "there" restricts
  // the unit choice instead of adding another battlefield target.
  assert.deepEqual(battlefieldSpec, {
    id: "crescent-strike.battlefield",
    filter: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(unitSpec, {
    id: "crescent-strike.enemy-unit",
    filter: {
      type: "unit",
      zone: "board",
      controller: "opponent",
      sameLocationAs: { target: "crescent-strike.battlefield" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "Deal 4 to that unit" uses the merged target form of effect.damage.
  assert.deepEqual(dealFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(dealFour.args.target, {
    kind: "constant",
    value: "crescent-strike.enemy-unit"
  });
  assert.equal(dealFour.linkedTo, undefined);

  // "1 to each other enemy unit there" is the 355.10.d set (never targeted):
  // same battlefield as the chosen one, excluding the chosen unit. effect.damage
  // does not consume the set/query form yet (see judgeReason).
  assert.deepEqual(dealOneToOthers.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(dealOneToOthers.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: { target: "crescent-strike.battlefield" },
        exclude: { target: "crescent-strike.enemy-unit" }
      }
    }
  });
  assert.equal(dealOneToOthers.targets, undefined);
  assert.equal(dealOneToOthers.linkedTo, undefined);
});

test("unl-072-219 Crescent Strike golden: Deal 4 to the chosen unit only", () => {
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      might: 5,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("other-enemy", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealFour.args.amount, target: dealFour.args.target.value },
    { world: kernel, targets: { "crescent-strike.enemy-unit": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 4);
  assert.equal(run.linked.dealtCount, 1);
  assert.equal(kernel.getObject("enemy-unit").damage, 4);
  // The set clause is not executed: the other units must not take the 1 damage.
  assert.equal(kernel.getObject("other-enemy").damage, 0);
  assert.equal(kernel.getObject("enemy-elsewhere").damage, 0);
});

test("unl-072-219 Crescent Strike golden: a stale chosen unit is ignored without damage (359.3.e.6)", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("enemy-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealFour.args.amount, target: dealFour.args.target.value },
    { world: kernel, targets: { "crescent-strike.enemy-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "unl-072-219 Crescent Strike: '1 to each other enemy unit there' needs the non-target set form of effect.damage " +
    "(CR 355.10.d, RIFT-9 target.query) — writing the set as a TargetSpec would fire became-target"
);

test.todo(
  "unl-072-219 Crescent Strike: the battlefield/unit group choice and the 'there' relation re-check at Finalize/Resolve " +
    "(CR 355.11, RIFT-90 TargetPlan)"
);
