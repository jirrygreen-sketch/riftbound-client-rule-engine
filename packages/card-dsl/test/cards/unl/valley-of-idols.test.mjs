import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/valley-of-idols.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8bf10670367f6b61f3c498325e7f4439d4e2341b2c8c6d47e1771e902955a174";
const SOURCE_TEXT =
  "When a player plays a unit here, they may pay :rb_energy_1: to [Buff] it. " +
  "(Give it a +1 :rb_might: buff if it doesn't have one.)";

const [ability] = program.abilities;
const [optIn] = ability.body;
const [pay, buffInstruction] = optIn.args.body.value;

test("unl-218-219 Valley of Idols: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-218-219 Valley of Idols: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /190\.6\.c/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /here/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-218-219 Valley of Idols: card-played trigger for a played unit at this Battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4 / 359 / 407: the trigger is "another object is played", not a Play
  // Effect; "here" is this Battlefield (053.3), kept as the scoring/play-payload
  // placeholder the sibling Battlefield cards use.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    here: true,
    object: { type: "unit" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a.3: the leading "they may" of the effect.
  assert.equal(ability.optional, true);
});

test("unl-218-219 Valley of Idols: the may-clause wraps pay-then-buff in one choice.optional body", () => {
  // Contract 3.9: "可以……" always wraps the chosen instructions inside the
  // choice's body; never a bare choice with later instructions linkedTo it.
  assert.equal(ability.body.length, 1);
  assert.equal(optIn.id, "valley-of-idols.opt-in");
  assert.equal(optIn.op, "choice.optional");
  assert.equal(optIn.args.body.kind, "constant");
  assert.deepEqual(
    optIn.args.body.value.map(instruction => [instruction.id, instruction.op]),
    [
      ["valley-of-idols.pay", "cost.pay"],
      ["valley-of-idols.buff-played-unit", "effect.buff"]
    ]
  );
  assert.equal(optIn.linkedTo, undefined);
  assert.equal(optIn.args.chooser, undefined);

  // 383.3.b: the payment follows the leading "they may", so it is the
  // triggered ability's base cost; the printed amount is 1 Energy.
  assert.deepEqual(pay.args, { energy: { kind: "constant", value: 1 } });

  // 702.2.a / 702.3.a through the merged effect.buff, gated on the payment
  // (359.3.e.14.b). "it" is the played unit, which is programmatically
  // specified (355.10.d) — only the placeholder id is authored, with no
  // TargetSpec/PickSpec invented for it.
  assert.equal(buffInstruction.linkedTo, "valley-of-idols.pay");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "valley-of-idols.played-unit"
  });
  assert.equal(buffInstruction.targets, undefined);
  assert.equal(buffInstruction.picks, undefined);
});

test("unl-218-219 Valley of Idols: declining the may-clause skips payment and Buff", () => {
  const kernel = world().unit("played-unit", { zone: "board", buffs: 0 }).build();
  kernel.setAnswers({ "valley-of-idols.opt-in/optional": false });
  const outcome = runAbilityBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["valley-of-idols.opt-in", "negated", "skipped"]
  ]);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("played-unit").buffs, 0);
});

test("unl-218-219 Valley of Idols: effect.buff places one Buff on the played unit (CR 702.2.a)", () => {
  const kernel = world().unit("played-unit", { zone: "board", buffs: 0 }).build();
  const ref = kernel.ref("played-unit");
  const run = runInstruction(
    buff,
    { mode: "buff", target: "valley-of-idols.played-unit" },
    { world: kernel, targets: { "valley-of-idols.played-unit": [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
  assert.equal(kernel.getObject("played-unit").buffs, 1);
});

test("unl-218-219 Valley of Idols: a unit that already has a Buff is not buffed twice (CR 702.3.a)", () => {
  const kernel = world().unit("played-unit", { zone: "board", buffs: 1 }).build();
  const ref = kernel.ref("played-unit");
  const run = runInstruction(
    buff,
    { mode: "buff", target: "valley-of-idols.played-unit" },
    { world: kernel, targets: { "valley-of-idols.played-unit": [ref] } }
  );
  // 702.3.a: the second Buff is not placed, and the printed instruction still
  // resolves as an attempted no-op.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("played-unit").buffs, 1);
});

test.todo(
  "unl-218-219 Valley of Idols: bind 'they' to the player who played the unit (190.6.c) for both " +
    "the accept decision and the payment — the frozen IR has no event-player selector (same gap as " +
    "ogn/rakelstake and ogn/obelisk-of-power)"
);

test.todo(
  "unl-218-219 Valley of Idols: pay the 1 Energy as the trigger's base cost at Finalize (383.3.b, " +
    "404.1.b.1) — TriggeredAbility has no CostSpec field and the merged cost.pay primitive is not " +
    "connected to a triggered base-cost Finalize path (RIFT-261); paying at resolution would let an " +
    "unable player still Buff the unit"
);

test.todo(
  "unl-218-219 Valley of Idols: bind 'it' to the played unit of the card-played event (355.10.d, " +
    "programmatically selected) — contract 3.6 has no event-payload object selector and " +
    "effect.buff only reads a TargetSpec id"
);

test.todo(
  "unl-218-219 Valley of Idols: register this CardProgram's triggered ability and expose the play's " +
    "destination Battlefield so the 053.3 'here' filter can match — programs/filters.ts rejects the " +
    "here key today; the ordinary CardProgram trigger registration is already merged"
);

test.todo(
  "unl-218-219 Valley of Idols: 703 layer arithmetic turns the placed Buff into +1 effective Might " +
    "(layers continuous buffs -> Might)"
);
