import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/call-to-glory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339";
const [reaction, play] = program.abilities;
const [mightInstruction] = play.body;
const mightSpec = mightInstruction.targets[0];

test("Call to Glory program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Call to Glory identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("356.2.b"), true);
  assert.equal(program.judgeReason.includes("356.1.b"), true);
  assert.equal(program.judgeReason.includes("RIFT-89"), true);
  assert.equal(program.judgeReason.includes("RIFT-91"), true);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "As you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\n" +
      "Give a unit +3 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Call to Glory structure: Reaction list, an optional spend-buff payment with a pay/decline choice", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");

  // 356.2.b: the buff spend is an Optional Additional Cost declared on the play
  // ability, carrying an explicit pay/decline choice (the merged cost-plan
  // shape, as in Frigid Touch's [Repeat] payment).
  assert.equal(play.cost.kind, "explicit");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "spend-buff");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "call-to-glory.spend-buff-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");

  // The printed base cost is 3 Energy with no Power component, carried on the
  // same CostSpec as the optional additional payment.
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 3 });
  assert.equal(play.cost.power, undefined);
});

test("Call to Glory structure: the +3 Might instruction with its single-unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "call-to-glory.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "literal", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(mightSpec, {
    id: "call-to-glory.unit",
    filter: { types: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "Give a unit ..." is a target (355.7), so it is a TargetSpec and never a pick.
  assert.equal(mightInstruction.picks, undefined);
});

test("Call to Glory golden: the merged spend-buff payment consumes exactly one buff (702.2.b)", () => {
  // 702.2.b / 702.2.b.1 / 702.2.b.2 are implemented by effect.buff spend mode:
  // one counter leaves a unit the paying player controls, and a unit with no
  // buff is skipped rather than drained below zero.
  const kernel = world()
    .unit("buffed-unit", { owner: "A", controller: "A", buffs: 1 })
    .unit("unbuffed-unit", { owner: "A", controller: "A" })
    .build();
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    {
      world: kernel,
      targets: { "buff-holder": [kernel.ref("buffed-unit"), kernel.ref("unbuffed-unit")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("buffed-unit").buffs, 0);
  assert.equal(kernel.getObject("unbuffed-unit").buffs, 0);
  assert.deepEqual(run.events.map(event => event.action), ["spend-buff"]);
  assert.equal(run.linked.spentCount, 1);
});

test("Call to Glory golden: spending without any buff is a no-op, not an invented payment", () => {
  const kernel = world().unit("unbuffed-unit", { owner: "A", controller: "A" }).build();
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "buff-holder": [kernel.ref("unbuffed-unit")] } }
  );

  // 702.2.b.1: a buff cannot be spent from a Unit that does not have one, so
  // nothing happens and the payment cannot be claimed as made.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("unbuffed-unit").buffs, 0);
  assert.deepEqual(run.events, []);
});

test("Call to Glory golden: a stale buff pick leaves the unit untouched", () => {
  const kernel = world()
    .unit("buffed-unit", { owner: "A", controller: "A", buffs: 1 })
    .build();
  const stale = kernel.ref("buffed-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(
    buff,
    { mode: "spend", target: "buff-holder", amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "buff-holder": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("buffed-unit").buffs, 1);
});

test.todo(
  "Call to Glory: the conditional rewrite \"If you do, ignore this spell's cost\" (356.1.b sets " +
    "the base cost to zero; 357.2.a counts the paid additional cost; 356.1.b.3 keeps later " +
    "increases) needs the Finalize cost-plan generation and consumption (RIFT-89)."
);

test.todo(
  "Call to Glory: the +3 Might this turn (433.1.a layer modulation, 317.2.c end-of-turn expiry) " +
    "needs the card-facing continuous.might instruction that feeds the merged layers engine " +
    "(RIFT-91)."
);
