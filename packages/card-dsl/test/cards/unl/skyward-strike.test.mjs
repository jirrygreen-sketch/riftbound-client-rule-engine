import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/skyward-strike.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-62a9f2d639b7330735e8fe37e90125f696cee6bef52e5005de3b0701be88e001";
const SOURCE_TEXT =
  "Move an enemy unit.\n" +
  "[Level 6][>] [Stun] an enemy unit. (While you have 6+ XP, get the effect. " +
  "A stunned unit doesn't deal combat damage this turn.)";

const [play] = program.abilities;
const [moveInstruction, stunInstruction] = play.body;

test("unl-038-219 Skyward Strike: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-038-219 Skyward Strike: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-038-219 Skyward Strike: printed cost, Move target and the Level 6 gated Stun", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Catalog printing: 2 energy + 1 Calm power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["skyward-strike.move-enemy-unit", "effect.move"],
      ["skyward-strike.stun-enemy-unit", "effect.stun"]
    ]
  );

  // "Move an enemy unit": one enemy Board unit is the target (451 / 355.9.a.1);
  // the destination has no printed value, so it is the runtime location choice
  // of 355.4 (recorded as a descriptive marker until RIFT-357 lands).
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "skyward-strike.enemy-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "skyward-strike.enemy-unit",
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "[Level 6][>] [Stun] an enemy unit" (824.1.b.1): the Stun is the dependent
  // clause's instruction and carries the 6+ XP gate on that instruction alone
  // (contract 3.4), with enemy units as the printed target.
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "skyward-strike.stunned-unit" }
  });
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.deepEqual(stunInstruction.targets, [
    {
      id: "skyward-strike.stunned-unit",
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(stunInstruction.condition.kind, "compare");
  assert.equal(stunInstruction.condition.operator, "gte");
  assert.deepEqual(stunInstruction.condition.right, { kind: "constant", value: 6 });
  assert.equal(stunInstruction.condition.left.kind, "count");
  assert.equal(stunInstruction.condition.left.subject, "controller-xp");
});

test("unl-038-219 Skyward Strike golden: the printed Move half moves a locked enemy unit (CR 451)", () => {
  // The card's own object selection and amount drive the merged effect.move;
  // only the destination is supplied, because the printed text has none and
  // 355.4 makes it the runtime location choice (see judgeReason / test.todo).
  const kernel = world()
    .unit("enemy", { owner: "B", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      // effect.move evaluates `to` as an Expr (contract 3.6): the runner is
      // given the evaluated destination the runtime location choice supplies.
      to: { kind: "constant", value: "controller-base" },
      amount: moveInstruction.args.amount
    },
    { world: kernel, targets: { "skyward-strike.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.objects, [{ id: "enemy", zoneEntryId: 1 }]);
  assert.deepEqual(kernel.getObject("enemy").location, { type: "base", player: "B" });
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

test("unl-038-219 Skyward Strike golden: the printed [Stun] clause stuns a locked enemy unit (CR 424.1)", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 3 }).build();
  kernel.setTargets("skyward-strike.stunned-unit", [kernel.ref("enemy")]);

  const outcome = runInstruction(
    stun,
    { target: "skyward-strike.stunned-unit" },
    { world: kernel }
  );

  assert.equal(outcome.result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
  assert.equal(outcome.linked.stunned.count, 1);
});

test.todo(
  "unl-038-219 Skyward Strike: the destination of 'Move an enemy unit' is a runtime location choice " +
    "(CR 355.4 / 355.4.a / 451.1) that needs the runtime Location selector — RIFT-357"
);

test.todo(
  "unl-038-219 Skyward Strike: expand [Level 6][>] (CR 824.1.b.1: 'while you have 6 or more XP, this " +
    "card gains [Text]') with dynamic Active/Inactive re-evaluation (824.1.c.1/.d) and an evaluable XP " +
    "predicate — no kw-level expansion and no Expr path to PlayerSnapshot.xp are merged (RIFT-359)"
);

test.todo(
  "unl-038-219 Skyward Strike: the printed '[Stun] an enemy unit' through the production chain adapter " +
    "needs effect.stun's literal `target` decoded (chain/interpreter-adapter.ts LITERAL_FIELDS) — " +
    "the chain adapter's literal-field registration for effect.stun"
);
