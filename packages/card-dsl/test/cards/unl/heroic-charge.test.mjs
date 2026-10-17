import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/heroic-charge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7df5a08371438cce0299d5cb0462f93ad1b442be5e5d5f288e5a0ce882fa4230";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a friendly unit +1 :rb_might: this turn and [Stun] an enemy unit at its location. " +
  "(A stunned unit doesn't deal combat damage this turn.)";

const [speed, play] = program.abilities;
const [grantMight, stunEnemy] = play.body;
const mightSpec = grantMight.targets[0];
// The production interpreter evaluates the card's Expr args before the primitive
// parses them; the merged one-two-punch / facebreaker convention runs the original
// instruction with its TargetSpec removed (the Finalize-locked targets are supplied
// to the kernel instead).
const executableBody = play.body.map(({ targets, ...rest }) => rest);
const enemySpec = stunEnemy.targets[0];

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

test("unl-155-219 Heroic Charge: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // Both printed instructions execute; the remaining gap is the sameLocationAs
  // anchor in programs/filters.ts, which blocks a production play as written.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /355\.10\.b/);
});

test("unl-155-219 Heroic Charge: [Action] plus the printed 3 energy cost", () => {
  // 806: the printed [Action] permission is a keyword the registry expands.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
});

test("unl-155-219 Heroic Charge: the +1 Might half uses the merged continuous.might shape", () => {
  // 143.2.a / 317.2.c: a temporary Might modification; RIFT-258 fixes the layer
  // and takes the merged objects selector.
  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.args.layer, undefined);
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "heroic-charge.friendly-unit" }
  });
  assert.deepEqual(mightSpec, {
    id: "heroic-charge.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-155-219 Heroic Charge: the Stun half is a real enemy target anchored to the friendly location", () => {
  // 424.1 / 424.1.a.1: Stun is a real game action on one enemy target; "at its
  // location" is a targeting restriction anchored to the friendly unit (355.10.b).
  assert.equal(stunEnemy.op, "effect.stun");
  assert.deepEqual(stunEnemy.args.target, {
    kind: "constant",
    value: "heroic-charge.enemy-unit"
  });
  assert.deepEqual(stunEnemy.targets, [
    {
      id: "heroic-charge.enemy-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: { target: "heroic-charge.friendly-unit" }
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "and" joins two actions of one sentence: neither instruction is linked.
  assert.equal(stunEnemy.linkedTo, undefined);
});

test("unl-155-219 Heroic Charge golden: the +1 Might lands through the production adapter", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("other", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(mightSpec.id, [kernel.ref("ally")]);
  const outcome = runAbilityBody([executableBody[0]], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["heroic-charge.grant-might", "executed"]
  ]);
  assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.filter.objectId), ["ally"]);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "ally"), 3);
  assert.equal(effectiveMight(kernel, "other"), 2);

  // The same authored instruction also runs through the production chain adapter
  // (chain/interpreter-adapter.ts), which is where registered primitives are
  // dispatched in a real play.
  const viaChain = world()
    .unit("ally", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  viaChain.setTargets(mightSpec.id, [viaChain.ref("ally")]);
  const chained = resolveChainBody([grantMight], chainContext(viaChain, "A"));
  assert.equal(chained.status, "executed");
  assert.equal(effectiveMight(viaChain, "ally"), 3);
});

test("unl-155-219 Heroic Charge golden: the merged Stun primitive stuns the locked enemy unit", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy")]);
  const outcome = runAbilityBody([executableBody[1]], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["heroic-charge.stun-enemy-unit", "executed"]]
  );
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.equal(kernel.getObject("ally").stunned, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
});

test("unl-155-219 Heroic Charge golden: without a locked legal target the Stun instruction is ignored (359.3.e.6)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("far-enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(enemySpec.id, []);
  const outcome = resolveChainBody([stunEnemy], kernel);

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["heroic-charge.stun-enemy-unit", "ignored", "mistargeted"]]
  );
  assert.equal(kernel.getObject("far-enemy").stunned, false);
});

test("unl-155-219 Heroic Charge: the \"at its location\" anchor restricts the set to the friendly unit's location", () => {
  // The production interpreter evaluates the frozen sameLocationAs anchor itself
  // (effects/interpreter/selectors.ts); the reference kernel's plain matchesFilter
  // compares the controller placeholder verbatim, so the query callback supplies the
  // scalar part and the anchor does the restriction.
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets("heroic-charge.friendly-unit", [kernel.ref("ally")]);
  const environment = {
    context: kernel,
    linked: () => undefined,
    isIgnored: () => false,
    canLookBack: () => false,
    // The anchor is what this assertion is about; the scalar controller
    // placeholder is resolved by the chain layer at Finalize
    // (chain/engine.ts normalizes controller/owner "self"/"opponent"), so the
    // placeholder is dropped here rather than compared verbatim.
    query: (scalar) => {
      const { controller, ...rest } = scalar;
      return kernel.query(rest);
    }
  };

  const matched = queryObjects(enemySpec.filter, environment)
    .map((object) => object.ref.id)
    .sort();
  // The anchor keeps every object located with the chosen friendly unit and
  // drops the one at the other battlefield.
  assert.deepEqual(matched, ["ally", "here"]);
  assert.equal(matched.includes("elsewhere"), false);
});

test("unl-155-219 Heroic Charge golden: an already Stunned unit is a legal target with no repeat (424.1.a.1)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, stunned: true, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(enemySpec.id, [kernel.ref("enemy")]);
  const outcome = runAbilityBody([executableBody[1]], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.events.filter(event => event.action === "stun").length, 0);
  assert.equal(kernel.getObject("enemy").stunned, true);
});

test.todo(
  "unl-155-219 Heroic Charge: bind the card as-written in a production play — programs/filters.ts " +
    "(translateObjectFilter) rejects the 'sameLocationAs' anchor key (CR 355.10.b), so " +
    "describePlay cannot translate this card's TargetSpecs until the position anchor is wired " +
    "(RIFT-90 follow-up)"
);

test.todo(
  "unl-155-219 Heroic Charge: the Stunned consequences — no combat damage in the combat damage step (CR 424.1.b) " +
    "and removal in step 3d of the end-of-turn cleanup (424.1.a.2) — belong to combat / turn, not to this card"
);
