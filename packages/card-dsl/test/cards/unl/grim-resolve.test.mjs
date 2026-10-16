import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/grim-resolve.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f385047d7a4e0de7205afceb0e18bea608003fce1dfced764451413396098017";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a friendly unit +3 :rb_might: this turn. When it wins a combat this turn, gain 2 XP.";

const [action, play] = program.abilities;
const [grant, delayed] = play.body;
const [gainXp] = delayed.args.body.value;

test("unl-095-219 Grim Resolve: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-095-219 Grim Resolve: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /468\.3/);
});

test("unl-095-219 Grim Resolve: [Action] + a target Might grant + the delayed combat-win XP clause", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["grim-resolve.grant-3-might", "continuous.might"],
      ["grim-resolve.win-combat-xp", "trigger.delayed"]
    ]
  );

  // "Give a friendly unit +3 [M] this turn": the temporary Might modification
  // belongs to the layers arithmetic layer (see judgeReason), with the 317.2.c
  // this-turn duration; 355.5/355.7 make the unit a single chosen target.
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grant.targets, [
    {
      id: "grim-resolve.friendly-unit",
      filter: { zone: "board", type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "When it wins a combat this turn": 390/391.2 delayed trigger, 468.3.a
  // combat-result subscription (468.3.c: the unit inherits its controller's
  // result) and the this-turn window; "it" reads the grant's target.
  assert.equal(delayed.op, "trigger.delayed");
  assert.deepEqual(delayed.args.at, { kind: "constant", value: "combat-result" });
  assert.deepEqual(delayed.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(delayed.args.filter, {
    kind: "constant",
    value: {
      event: "combat-result",
      object: { target: "grim-resolve.friendly-unit" },
      winner: "controller"
    }
  });

  // "gain 2 XP" is the merged effect.xp; the recipient is the ability
  // controller (190.6.d), so no player override is passed.
  assert.equal(gainXp.id, "grim-resolve.gain-2-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 2 });
  assert.equal(gainXp.args.player, undefined);
});

test("unl-095-219 Grim Resolve golden: Gain 2 XP gives the caster two experience", () => {
  const kernel = world().player("A", { xp: 3 }).build();
  const run = runInstruction(xp, { amount: gainXp.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gained, 2);
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(kernel.player("A").xp, 5);
});

test.todo(
  "unl-095-219 Grim Resolve: apply the +3 Might temporary modification in the arithmetic layer with a this-turn " +
    "duration and cleanup expiry (CR 317.2.c) — no continuous.might / effect.might-modify instruction is merged (RIFT-91)"
);

test.todo(
  "unl-095-219 Grim Resolve: register the 'When it wins a combat this turn' delayed trigger (CR 390/391.2/392, " +
    "468.3.a combat-result) and bind 'it' to the chosen unit — RIFT-9 trigger.delayed plus the combat-result pipeline wiring"
);
