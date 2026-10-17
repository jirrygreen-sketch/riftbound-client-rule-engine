import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-insight.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-f345f205e63964bf3901c9e175e8aee2a18b9ada1c14fb80568ff7dce79b66e3";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Ignore [Deflect] while paying this spell's cost.\n" +
  "Give an enemy Body (:rb_rune_body:) unit -5 :rb_might: this turn.";

const [reaction, ignoreDeflect, play] = program.abilities;
const [giveMight] = play.body;
const [enemyUnit] = giveMight.targets;

test("ven-061-166 Decree of Insight: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-061-166 Decree of Insight: judgeReason names the remaining target-tax and domain-filter gaps", () => {
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-061-166 Decree of Insight: printed energy 1, absent power, [Reaction] keyword", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-061-166 Decree of Insight: 'Ignore [Deflect]' is a static cost-window declaration, not a body instruction", () => {
  // The clause changes how this spell's own cost is paid (809.1.c removes the
  // Mandatory Additional Cost for choosing a Deflected object); it is not an
  // effect that resolves from the body.
  assert.equal(ignoreDeflect.kind, "static");
  assert.deepEqual(ignoreDeflect.effect, {
    kind: "continuous.ignore-target-tax",
    appliesTo: "self",
    tax: { kind: "constant", value: "deflect" },
    window: { kind: "constant", value: "paying-this-spells-cost" }
  });
  assert.equal(ignoreDeflect.condition, undefined);
  // No body instruction was invented for it.
  assert.equal(play.body.length, 1);
  assert.equal(play.body[0].op, "continuous.might");
});

test("ven-061-166 Decree of Insight: structure — one -5 Might this turn instruction on an enemy unit", () => {
  assert.equal(giveMight.id, "decree-of-insight.give-minus-5");
  // A temporary Might change is a layers arithmetic effect (continuous.might),
  // never a Buff counter (702 / 703; effect.buff's own header).
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: -5 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(giveMight.args.target, { kind: "constant", value: enemyUnit.id });
  assert.equal(giveMight.linkedTo, undefined);
  assert.equal(giveMight.picks, undefined);
  // The printing has no "to a minimum of" clause, so no minimum is invented
  // (143.2.c is a general rule, not a restriction on this card).
  assert.equal(Object.hasOwn(giveMight.args, "minimum"), false);

  assert.equal(giveMight.targets.length, 1);
  assert.equal(enemyUnit.id, "decree-of-insight.enemy-body-unit");
  assert.equal(enemyUnit.min, 1);
  assert.equal(enemyUnit.max, 1);
  assert.equal(enemyUnit.selection, "one");
});

test("ven-061-166 Decree of Insight: the Body restriction stays descriptive and never becomes a filter key", () => {
  // Body is an independent domain characteristic; printed Power cannot replace it.
  // The program keeps blocked metadata next to type/zone/controller.
  assert.deepEqual(Object.keys(enemyUnit.filter).sort(), [
    "controller",
    "targetRestriction",
    "type",
    "zone"
  ]);
  assert.equal(enemyUnit.filter.type, "unit");
  assert.equal(enemyUnit.filter.zone, "board");
  assert.equal(enemyUnit.filter.controller, "opponent");
  assert.equal(enemyUnit.filter.targetRestriction, "domain-body");
  assert.equal(Object.hasOwn(enemyUnit.filter, "domain"), false);
  assert.equal(Object.hasOwn(enemyUnit.filter, "power"), false);
});



test("decree-of-insight: the review records the current blockers", () => {
  assert.match(program.judgeReason, /809\.1\.c/);
  assert.match(program.judgeReason, /continuous\.ignore-target-tax/);
  assert.match(program.judgeReason, /targetRestriction/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
});

test.todo("decree-of-insight: 809.1.c: bind continuous.ignore-target-tax and waive this spell's Deflect taxes in Finalize");

test.todo("decree-of-insight: 134: expose and filter Body domain independently of printed power, including power:null units");

test("decree-of-insight supported effect: temporary Might changes through the real primitive and expires", () => {
  const kernel = world().unit("locked-unit", { might: 8 }).build();
  // Only the arithmetic sub-effect is exercised here; the printed target restriction remains blocked.
  const run = runInstruction(might, { ...giveMight.args, target: giveMight.args.target.value }, {
    world: kernel, targets: { [giveMight.args.target.value]: [kernel.ref("locked-unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("locked-unit")]);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({ ...entry, timestamp: 1 })));
  assert.equal(layers.evaluate(kernel.ref("locked-unit")).might, 3);
  assert.equal(kernel.getObject("locked-unit").buffs, 0);
  layers.advance({ id: "turn-end", player: "A" });
  assert.equal(layers.evaluate(kernel.ref("locked-unit")).might, 8);
});

test("decree-of-insight supported effect: a stale target produces no continuous registration", () => {
  const kernel = world().unit("gone", { might: 8 }).build();
  const stale = kernel.ref("gone");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(might, { ...giveMight.args, target: giveMight.args.target.value }, {
    world: kernel, targets: { [giveMight.args.target.value]: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.continuousEffects, []);
});
