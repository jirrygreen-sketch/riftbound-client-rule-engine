import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/grim-resolve.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f385047d7a4e0de7205afceb0e18bea608003fce1dfced764451413396098017";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a friendly unit +3 :rb_might: this turn. When it wins a combat this turn, gain 2 XP.";

const [action, play] = program.abilities;
const [grant, delayed] = play.body;
const [gainXp] = delayed.args.body.value;
const targetSpec = grant.targets[0];

// The production chain (chain/engine.ts) resolves the controller/owner placeholders
// before querying; the reference kernel compares filter values literally. The goldens
// therefore drive the card bodies through the production chain adapter while keeping
// the reference kernel as the resolver — the merged siphon-power / facebreaker convention.
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};
const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});
const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));
const layerEngine = (kernel) => createLayerEngine(kernel.objects, registrations(kernel));
const effectiveMight = (kernel, id) => layerEngine(kernel).evaluate(kernel.ref(id)).might;

test("unl-095-219 Grim Resolve: program passes validateCardProgram and keeps judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The Might half is merged and executed below; the delayed combat-result
  // clause is the remaining gap (trigger.delayed op + combat-result emission).
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /468\.3/);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /唯一事件管线|事件对象/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(9|124)/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
});

test("unl-095-219 Grim Resolve: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-095-219 Grim Resolve: [Action] + the merged Might grant + the delayed combat-win XP clause", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["grim-resolve.grant-3-might", "continuous.might"],
      ["grim-resolve.win-combat-xp", "trigger.delayed"]
    ]
  );
  // The merged primitive fixes the arithmetic layer and takes the objects
  // selector; the authored layer argument is no longer part of the IR.
  assert.equal(grant.args.layer, undefined);
  assert.deepEqual(grant.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "grim-resolve.friendly-unit" }
  });
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
  // combat-result subscription and the this-turn window; "it" reads the grant target.
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
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 3 - 1 });
});

test("unl-095-219 Grim Resolve golden: the +3 Might half executes through the production adapter", () => {
  const kernel = world()
    .unit("hero", { owner: "A", controller: "A", might: 4, location: { type: "base", player: "A" } })
    .unit("other", { owner: "A", controller: "A", might: 4, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("hero")]);
  const outcome = resolveChainBody([grant], chainContext(kernel, "A"));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["grim-resolve.grant-3-might", "executed"]
  ]);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.filter.objectId), ["hero"]);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "hero"), 7);
  assert.equal(effectiveMight(kernel, "other"), 4);
});

test("unl-095-219 Grim Resolve golden: the +3 expires with the other \"this turn\" effects (317.2.c)", () => {
  const kernel = world()
    .unit("hero", { owner: "A", controller: "A", might: 4, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("hero")]);
  resolveChainBody([grant], chainContext(kernel, "A"));
  assert.equal(effectiveMight(kernel, "hero"), 7);

  const engine = layerEngine(kernel);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("hero")).might, 4);
});

test("unl-095-219 Grim Resolve golden: Gain 2 XP gives the caster two experience", () => {
  const kernel = world().player("A", { xp: 3 }).build();
  const outcome = resolveChainBody([gainXp], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["grim-resolve.gain-2-xp.gained"], 2);
  assert.equal(kernel.player("A").xp, 5);
});

test.todo(
  "unl-095-219 Grim Resolve: register the \"When it wins a combat this turn\" delayed trigger (CR 390/391.2/392, " +
    "468.3.a combat-result) and bind \"it\" to the chosen unit — wire trigger.delayed to the combat-result emission " +
    "and preserve the selected unit through the this-turn window"
);
