// Template evidence: ../templates/keyword-play-continuous-might-653.test.mjs.
// Whole-card scenarios remain blocked; the supported Might body is tested separately.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/call-to-glory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

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
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /ignore-base/);
  assert.match(program.judgeReason, /运行时友方 Buff 对象选择/);
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
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant", value: { kind: "target", id: mightSpec.id }
  });
  assert.deepEqual(mightSpec, {
    id: "call-to-glory.unit",
    filter: { types: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "Give a unit ..." is a target (355.7), so it is a TargetSpec and never a pick.
  assert.equal(mightInstruction.picks, undefined);
});

test("Call to Glory target filter excludes unit cards outside the Board (355.9.a.1)", () => {
  const kernel = world()
    .unit("friendly", { owner: "A" })
    .unit("enemy", { owner: "B" })
    .card("hand-unit", { owner: "A", types: ["unit"], zone: "hand" })
    .card("trash-unit", { owner: "B", types: ["unit"], zone: "trash" })
    .card("board-gear", { owner: "A", types: ["gear"], zone: "board" })
    .build();
  assert.deepEqual(
    kernel.query(translateObjectFilter(mightSpec.filter)).map(object => object.ref.id).sort(),
    ["enemy", "friendly"]
  );
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

test("Call to Glory golden: the printed +3 Might executes through continuous.might and expires at end of turn", () => {
  const kernel = world()
    .unit("call-to-glory", { owner: "A", types: ["spell"], zone: "chain" })
    .unit("buffed-unit", { owner: "A", controller: "A", might: 2 })
    .build();
  const run = runInstruction(
    might,
    {
      amount: mightInstruction.args.amount,
      duration: mightInstruction.args.duration,
      target: mightSpec.id
    },
    { world: kernel, targets: { [mightSpec.id]: [kernel.ref("buffed-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const engine = createLayerEngine(
    [kernel.getObject("buffed-unit")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ref = kernel.ref("buffed-unit");
  assert.equal(engine.evaluate(ref).might, 5);
  // 317.2.c: "this turn" expires at the end-of-turn cleanup.
  engine.advance({ id: "turn-end" });
  assert.equal(engine.evaluate(ref).might, 2);
});

test.todo(
  "Call to Glory: the conditional rewrite \"If you do, ignore this spell's cost\" (356.1.b sets " +
    "the base cost to zero; 357.2.a counts the paid additional cost; 356.1.b.3 keeps later " +
    "increases) needs a CardProgram-to-Finalize adapter with a runtime buff-holder choice and " +
    "an ignore-base cost modification."
);

test("Call to Glory: the original Might body resolves through the production interpreter adapter", () => {
  const kernel = world().unit("chosen", { might: 2, buffs: 1 }).unit("other", { might: 4 }).build();
  kernel.setTargets(mightSpec.id, [kernel.ref("chosen")]);
  const result = resolveChainBody(play.body, kernel);
  assert.equal(result.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 5);
  assert.equal(layers.evaluate(kernel.ref("other")).might, 4);
  assert.equal(kernel.getObject("chosen").buffs, 1);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 2);
});

test("Call to Glory: the original body does not grant Might when its finalized target has left", () => {
  const kernel = world().unit("chosen", { might: 2 }).unit("other", { might: 4 }).build();
  const stale = kernel.ref("chosen");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets(mightSpec.id, [stale]);
  const result = resolveChainBody(play.body, kernel);
  assert.equal(result.status, "partial");
  assert.equal(result.results[0].result.status, "ignored");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("chosen").zone, "hand");
  assert.equal(kernel.getObject("other").might, 4);
  assert.deepEqual(result.events, []);
});
