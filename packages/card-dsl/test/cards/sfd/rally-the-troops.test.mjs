import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rally-the-troops.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [keyword, play] = program.abilities;
const registerInstruction = play.body[0];
const drawInstruction = play.body[1];
const buffInstruction = registerInstruction.args.body.value[0];

test("Rally the Troops program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-3e2b0e6be550a6ea91eaca662301cad701e40cd382c25c86b966e45b6858b678"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "When a friendly unit is played this turn, buff it. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)\n" +
      "Draw 1."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Rally the Troops structure: Action keyword, delayed trigger registration, unlinked draw", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["rally-the-troops.register-trigger", "trigger.delayed"],
      ["rally-the-troops.draw", "effect.draw"]
    ]
  );

  // "When a friendly unit is played this turn, buff it": a delayed trigger for
  // this turn (392) whose trigger is the card-played timing point filtered to
  // the controller's units.
  assert.deepEqual(registerInstruction.args.at, { kind: "constant", value: "card-played" });
  assert.deepEqual(registerInstruction.args.filter, {
    kind: "constant",
    value: { type: "unit", controller: "controller" }
  });
  assert.deepEqual(registerInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(registerInstruction.args.body.kind, "constant");

  // "buff it": the merged effect.buff primitive targeting the played unit; the
  // choice is made when the delayed trigger finalizes (355.5.b).
  assert.equal(buffInstruction.id, "rally-the-troops.buff");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "rally-the-troops.played-unit"
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "rally-the-troops.played-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "Draw 1." is the second instruction of the same spell and is not linked
  // to the delayed registration (359.3.e.11).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("Rally the Troops golden: the buff body places one Buff counter on the played unit", () => {
  // The delayed registration has no merged op, so the golden test executes the
  // buff body the delayed trigger would run, against the merged effect.buff.
  const kernel = world().unit("played-unit", { owner: "A", might: 2 }).build();
  const locked = kernel.ref("played-unit");
  // The primitive is driven with the program's own evaluated arguments (the
  // interpreter evaluates Expr args before dispatch).
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: buffInstruction.args.target.value
  }, {
    world: kernel,
    targets: { "rally-the-troops.played-unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("played-unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
});

test("Rally the Troops golden: a unit that already has a buff is not buffed again (427.1.b.1)", () => {
  const kernel = world().unit("played-unit", { owner: "A", might: 2, buffs: 1 }).build();
  const run = runInstruction(buff, {
    mode: buffInstruction.args.mode.value,
    target: buffInstruction.args.target.value
  }, {
    world: kernel,
    targets: { "rally-the-troops.played-unit": [kernel.ref("played-unit")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("played-unit").buffs, 1);
});

test("Rally the Troops golden: the independent Draw 1 draws one card", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Rally the Troops delayed trigger: the spell registers a \"this turn\" trigger at the " +
    "card-played timing point, a friendly unit played later buffers through it, and the trigger " +
    "expires at end of turn (CR 382 / 392 / 355.5.b) (依赖 trigger.delayed 原语与 continuous.duration，RIFT-91)"
);
