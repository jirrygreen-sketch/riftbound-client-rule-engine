import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/abandoned-hall.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-07b0ff2f6b2a7899316d0f3ec26470eae4923b0137b2818ab839dff113b77608";
const SOURCE_TEXT =
  "When a player plays a spell, they may give a unit they control here +1 :rb_might: this turn.";
const HERE = { type: "battlefield", id: "battlefield-1" };
const ELSEWHERE = { type: "battlefield", id: "battlefield-2" };

const [ability] = program.abilities;
const [optional] = ability.body;
const [grantMight] = optional.args.body.value;
const [unitPick] = grantMight.picks;

test("unl-205-219 Abandoned Hall: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-205-219 Abandoned Hall: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /190\.6\.c/);
});

test("unl-205-219 Abandoned Hall: a spell-play trigger for any player, decided by the spell's player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4: an ability that triggers when another object is played is not a
  // Play Effect; the timing point is the merged card-played event.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "spell" },
    player: "any"
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a/383.3.e.2: "they may" as the first part of the effect is the
  // ability's finalize decision.
  assert.equal(ability.optional, true);
});

test("unl-205-219 Abandoned Hall: one choice.optional wrapping the Might grant and its non-target pick", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, "abandoned-hall.opt-in");
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Give a unit here +1 Might this turn?"
  });
  // Contract 3.9: the chosen instruction lives inside the optional body; there
  // is no choice-plus-linkedTo shape anywhere.
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.args.body.value.length, 1);

  assert.equal(grantMight.id, "abandoned-hall.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // RIFT-258's merged parameter shape reads the non-target pick through
  // `objects` (the bare `pick` argument was the pre-merge spelling).
  assert.equal(grantMight.args.pick, undefined);
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "pick", id: "abandoned-hall.unit-here" }
  });
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.targets, undefined);

  // 355.10.c.1 / 355.7: the unit is chosen inside the instruction, so it is a
  // non-target pick; 053.3 gives the filter its "here" anchor, and 190.6.c
  // makes "they control" the ability controller.
  assert.equal(grantMight.picks.length, 1);
  assert.equal(unitPick.id, "abandoned-hall.unit-here");
  assert.deepEqual(unitPick.options, ["unit-controlled-by-the-spells-player-here"]);
  assert.deepEqual(unitPick.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: "self"
  });
  assert.equal(unitPick.min, 1);
  assert.equal(unitPick.max, 1);
  assert.equal(unitPick.selection, "one");
});

test("unl-205-219 Abandoned Hall: declining the option executes as a real skipped choice", () => {
  // Contract 3.4/3.9: the refusal is the optional node's own negated(skipped)
  // result; nothing in the body runs. This exercises the merged interpreter
  // path for the printed "they may" shape.
  const kernel = world()
    .unit("hall", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { location: HERE, might: 3 })
    .build();
  kernel.setAnswers({ "abandoned-hall.opt-in/optional": false });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hall") });

  const outcome = runAbilityBody(ability.body, scoped);
  assert.deepEqual(outcome.results.map(entry => entry.id), ["abandoned-hall.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(scoped.getObject("here-ally").might, 3);
});

test("unl-205-219 Abandoned Hall: the pick's 053.3 'here' anchor excludes units at other battlefields", () => {
  // The merged interpreter resolves the sameLocationAs/exclude anchors for
  // set queries; this runs the card's own anchor vocabulary (with the ability
  // controller concretized, as the merged kernel compares raw values) through
  // a condition.predicate node so the location scope is really executed.
  const kernel = world()
    .unit("hall", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { location: HERE, might: 3 })
    .unit("elsewhere-ally", { location: ELSEWHERE, might: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hall") });
  const predicate = [
    {
      id: "abandoned-hall.here-count",
      op: "condition.predicate",
      args: {
        condition: {
          kind: "constant",
          value: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units",
              filter: {
                type: "unit",
                zone: "board",
                controller: "A",
                sameLocationAs: "self",
                exclude: "self"
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 1 }
          }
        }
      }
    }
  ];

  const outcome = runAbilityBody(predicate, scoped, undefined, { host: scoped.ref("hall") });
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["abandoned-hall.here-count.value"], true);
});

test("unl-205-219 Abandoned Hall golden: the chosen unit at this battlefield really gets +1 Might this turn", () => {
  // 143.2.a / 475 / 478: RIFT-258's continuous.might writes one arithmetic-layer
  // registration with the end-of-turn duration; the layer engine then reports
  // the modified Might and expires it at turn end.
  const kernel = world()
    .unit("hall", { types: ["battlefield"], location: HERE })
    .unit("here-ally", { controller: "A", location: HERE, might: 3 })
    .unit("elsewhere-ally", { controller: "A", location: ELSEWHERE, might: 3 })
    .build();
  kernel.setPicks(unitPick.id, [kernel.ref("here-ally")]);
  kernel.setAnswers({ "abandoned-hall.opt-in/optional": true });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hall"), controller: "A" });

  const outcome = runAbilityBody(ability.body, scoped, undefined, { host: scoped.ref("hall") });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["abandoned-hall.grant-might", "executed"],
    ["abandoned-hall.opt-in", "executed"]
  ]);
  assert.equal(scoped.continuousEffects.length, 1);
  const [registration] = scoped.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.equal(registration.effect.filter.objectId, "here-ally");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(scoped.objects, scoped.continuousEffects.map(entry => ({ ...entry })));
  assert.equal(layers.evaluate(scoped.ref("here-ally")).might, 4);
  assert.equal(layers.evaluate(scoped.ref("elsewhere-ally")).might, 3);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(scoped.ref("here-ally")).might, 3);
});

test("unl-205-219 Abandoned Hall golden: a pick that resolved to nothing registers no layer effect", () => {
  // 359.3.e.2/e.6: the merged primitive reports ignored/mistargeted when the
  // referenced pick holds no surviving Board object, so no Might modification
  // is registered against anything else.
  const kernel = world()
    .unit("hall", { types: ["battlefield"], location: HERE })
    .unit("elsewhere-ally", { controller: "A", location: ELSEWHERE, might: 3 })
    .build();
  kernel.setAnswers({ "abandoned-hall.opt-in/optional": true });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hall"), controller: "A" });

  const outcome = runAbilityBody(ability.body, scoped, undefined, { host: scoped.ref("hall") });
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.continuousEffects.length, 0);
  assert.equal(scoped.getObject("elsewhere-ally").might, 3);
});

test("unl-205-219 Abandoned Hall: the merged trigger binder registers the card-played subscription", () => {
  // RIFT-257's production adapter accepts this program's declared trigger and
  // registers it with the pipeline. What it cannot yet honor is CR 190.6.c: the
  // pipeline resolves `player: "self"` against the registration's controller,
  // not against the player who played the spell (see judgeReason).
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const source = {
    ref: { id: "hall", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Abandoned Hall",
    types: ["battlefield"], tags: [], keywords: [], owner: "A", controller: "A",
    zone: "board", location: HERE, might: null, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const registered = [];
  const ids = binding.registerProgramTriggers({ pipeline: { registerTrigger: registration => registered.push(registration) } }, source);

  assert.equal(ids.length, 1);
  assert.deepEqual(registered.map(entry => [entry.spec.at, entry.spec.filter, entry.optional]), [
    ["card-played", { event: "card-played", object: { type: "spell" }, player: "any" }, true]
  ]);
  // The registration carries the battlefield's controller; 190.6.c needs the
  // spell's player instead, and no merged binder re-binds it from the payload.
  assert.equal(registered[0].controller, "A");
});
