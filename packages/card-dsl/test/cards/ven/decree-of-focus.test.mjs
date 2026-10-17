// Template evidence: ../templates/keyword-play-continuous-might-653.test.mjs.
// Only the Might sub-effect executes; the printed compound target predicate stays blocked.
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-focus.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-e5eafd33bb50e62c31da83b13c1e44904a8cd4d53760a85e48bbb1fb82d587eb";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or " +
  "that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn.";

const [reaction, play] = program.abilities;
const [giveMight] = play.body;
const [unitTarget] = giveMight.targets;

test("ven-040-166 Decree of Focus: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-040-166 Decree of Focus: judgeReason names the remaining compound target restriction", () => {
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-040-166 Decree of Focus: printed energy 1, absent power, [Reaction] keyword", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-040-166 Decree of Focus: structure — one +4 Might this turn instruction on one friendly unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(giveMight.id, "decree-of-focus.give-plus-4");
  // A temporary Might change is a layers arithmetic effect (continuous.might),
  // never a Buff counter (702 / 703; effect.buff's own header).
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: 4 });
  // 317.2.c: the "this turn" duration, spelled like the merged temporary-Might
  // programs (defiant-dance / hold-em).
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(giveMight.args.objects, {
    kind: "constant", value: { kind: "target", id: unitTarget.id }
  });
  assert.equal(giveMight.args.target, undefined);
  assert.equal(giveMight.linkedTo, undefined);
  assert.equal(giveMight.picks, undefined);

  // "Choose a friendly unit ..." is a target (355.7 / 355.9.a.1): one Board unit
  // the controller owns.
  assert.equal(giveMight.targets.length, 1);
  assert.equal(unitTarget.id, "decree-of-focus.friendly-unit");
  assert.equal(unitTarget.min, 1);
  assert.equal(unitTarget.max, 1);
  assert.equal(unitTarget.selection, "one");
});

test("ven-040-166 Decree of Focus: the target filter keeps the disjunctive clause descriptive only", () => {
  // The printed restriction is "in combat with an enemy Fury unit OR being
  // chosen by an enemy Fury spell" — a disjunction, while TargetSpec.filter is
  // a conjunction of keys. The program therefore must NOT pretend the clause is
  // a working filter: it carries a named placeholder, and the only real
  // predicates are type / zone / controller. A silent extra key would make
  // every friendly unit a legal target (unknown keys are ignored).
  assert.deepEqual(Object.keys(unitTarget.filter).sort(), [
    "controller",
    "targetRestriction",
    "type",
    "zone"
  ]);
  assert.equal(unitTarget.filter.type, "unit");
  assert.equal(unitTarget.filter.zone, "board");
  assert.equal(unitTarget.filter.controller, "self");
  // No fabricated predicate keys such as a bare "inCombat" / "domain".
  assert.equal(Object.hasOwn(unitTarget.filter, "inCombat"), false);
  assert.equal(Object.hasOwn(unitTarget.filter, "domain"), false);
  assert.match(unitTarget.filter.targetRestriction, /in-combat-with-an-enemy-fury-unit/);
  assert.match(unitTarget.filter.targetRestriction, /being-chosen-by-an-enemy-fury-spell/);
});

test("ven-040-166 Decree of Focus: the descriptive clause stays out of every real predicate slot", () => {
  // The named clause is metadata about the pending predicate, so it must not be
  // smuggled into the keys the merged matchers do evaluate (type / zone /
  // location / controller / owner / states / tags / characteristics). Asserting
  // the exact key set keeps the placeholder visible instead of letting it look
  // like a working restriction.
  const evaluatedKeys = ["type", "types", "zone", "location", "controller", "owner", "state", "states", "tags", "characteristics"];
  for (const key of Object.keys(unitTarget.filter)) {
    assert.equal(
      evaluatedKeys.includes(key) || key === "targetRestriction",
      true,
      "unexpected filter key: " + key
    );
  }
  assert.equal(typeof unitTarget.filter.targetRestriction, "string");
});



test("decree-of-focus: the review records the current blockers", () => {
  assert.match(program.judgeReason, /740\.2\.c/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test.todo("decree-of-focus: 740.2.c/355.9: test enemy Fury combat relation OR enemy Fury spell target plan (RIFT-359)");

test("decree-of-focus supported effect: temporary Might changes through the real primitive and expires", () => {
  const kernel = world().unit("locked-unit", { might: 3 }).build();
  // Only the arithmetic sub-effect is exercised here; the printed target restriction remains blocked.
  const run = runInstruction(might, giveMight.args, {
    world: kernel, targets: { [unitTarget.id]: [kernel.ref("locked-unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.affected.objects, [kernel.ref("locked-unit")]);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({ ...entry, timestamp: 1 })));
  assert.equal(layers.evaluate(kernel.ref("locked-unit")).might, 7);
  assert.equal(kernel.getObject("locked-unit").buffs, 0);
  layers.advance({ id: "turn-end", player: "A" });
  assert.equal(layers.evaluate(kernel.ref("locked-unit")).might, 3);
});

test("decree-of-focus supported effect: a stale target produces no continuous registration", () => {
  const kernel = world().unit("gone", { might: 8 }).build();
  const stale = kernel.ref("gone");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const run = runInstruction(might, giveMight.args, {
    world: kernel, targets: { [unitTarget.id]: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.continuousEffects, []);
});
