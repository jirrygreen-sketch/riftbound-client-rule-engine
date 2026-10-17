import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/abandoned-hall.js";
import { createProgramBinding, triggerRegistrations } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
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
const unitChoice = grantMight.args.objects.value;

function hallContext(kernel) {
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hall"), controller: "A" });
  // The reference kernel compares scalar players literally. Keep the authored
  // body and resolve self exactly as the production chain context does.
  return bindResolveContext(scoped, {
    query: filter => scoped.query({ ...filter, ...(filter.controller === "self" ? { controller: "A" } : {}) })
  });
}

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
  assert.match(program.judgeReason, /card-played/);
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

test("unl-205-219 Abandoned Hall: the optional Might grant chooses one non-target unit at resolution", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, "abandoned-hall.opt-in");
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.prompt, { kind: "constant", value: "Give a unit here +1 Might this turn?" });
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.args.body.value.length, 1);
  assert.equal(grantMight.id, "abandoned-hall.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.deepEqual(unitChoice, {
    kind: "choose", id: "abandoned-hall.unit-here",
    filter: { type: "unit", zone: "board", controller: "self", sameLocationAs: "self" },
    min: 1, max: 1
  });
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

test("unl-205-219 Abandoned Hall: the choice's 053.3 'here' anchor excludes units at other battlefields", () => {
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
    .unit("here-enemy", { controller: "B", location: HERE, might: 3 })
    .unit("elsewhere-ally", { controller: "A", location: ELSEWHERE, might: 3 })
    .build();
  kernel.setAnswers({ "abandoned-hall.opt-in/optional": true });
  const scoped = hallContext(kernel);
  let request;
  assert.throws(() => runAbilityBody(ability.body, scoped), error => {
    request = error.request;
    return error instanceof AwaitChoice;
  });
  assert.equal(request.type, "select-objects");
  assert.equal(request.chooser, "A");
  assert.deepEqual(request.options, [scoped.ref("here-ally")]);
  assert.equal(request.min, 1);
  assert.equal(request.max, 1);
  scoped.setAnswers({ "abandoned-hall.opt-in/optional": true, [request.id]: [scoped.ref("here-ally")] });

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
  assert.equal(layers.evaluate(scoped.ref("here-enemy")).might, 3);
  assert.equal(layers.evaluate(scoped.ref("elsewhere-ally")).might, 3);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(scoped.ref("here-ally")).might, 3);
});

test("unl-205-219 Abandoned Hall golden: no legal unit here leaves the Might grant impossible", () => {
  // An empty resolution-time choice cannot grant Might to a unit elsewhere.
  const kernel = world()
    .unit("hall", { types: ["battlefield"], location: HERE })
    .unit("elsewhere-ally", { controller: "A", location: ELSEWHERE, might: 3 })
    .build();
  kernel.setAnswers({ "abandoned-hall.opt-in/optional": true });
  const scoped = hallContext(kernel);

  const outcome = runAbilityBody(ability.body, scoped, undefined, { host: scoped.ref("hall") });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.equal(scoped.continuousEffects.length, 0);
  assert.equal(scoped.getObject("elsewhere-ally").might, 3);
});

test("unl-205-219 Abandoned Hall: the merged trigger binder registers the card-played subscription", () => {
  // Exercise the supported subscription in the real pipeline. Dynamic
  // controller binding for the opponent's spell remains a separate gate.
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "hall", cardId: CANONICAL_ID, types: ["battlefield"], might: null, energy: null, power: null }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("hall"), to: "battlefield", location: HERE });
  const source = f.kernel.getObject("hall");
  const [registration] = triggerRegistrations(binding.registry, source);
  const ids = binding.registerProgramTriggers(f.engine, source);
  assert.deepEqual(ids, [registration.id]);
  assert.deepEqual(registration.spec.filter, { event: "card-played", object: { type: "spell" }, player: "any" });
  assert.equal(registration.spec.at, "card-played");
  assert.equal(registration.optional, true);
  assert.equal(registration.controller, "A");
});
