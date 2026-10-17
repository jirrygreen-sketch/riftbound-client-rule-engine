import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mageseeker-warden.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616";

/** A real chain engine so the production static binder runs. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("warden", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 3 })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

test("ogn-070-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-b2b0dc0db7b4646ebf76c4865cc10fb826a643400e758e6396dfeca70062a616");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous.restrict|Finalize/);
  // Restored pre-resweep assertion /动态读取|相对 opponent|ready cause/, kept
  // as equivalent semantics because the refreshed reason names the same gaps.
  assert.match(program.judgeReason, /relative-player|相对玩家|opponent/);
  assert.match(program.judgeReason, /battlefield/);
  assert.match(program.judgeReason, /causes/);
  assert.equal(program.sourceText, "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Mageseeker Warden: both declared restrictions are still refused by the production static binder", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("warden");
  const binder = createEngineStaticBinder(engine);
  for (const ability of program.abilities) {
    const error = (() => {
      try {
        binder.bindStatic(ability, source);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.ok(error, "the merged static binder must still refuse the opponent-relative filter");
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /controller:opponent filter needs a relative-player query/);
  }
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("Mageseeker Warden: the registered restriction query ignores the ready cause filter", () => {
  // Only the relative-player translation is blocked, so bind the effect through
  // the merged continuous.restrict primitive with an absolute controller to
  // show what the query would do: causes are never read, and the entry matches
  // every action name the caller asks about.
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("warden");
  const absolute = {
    ...program.abilities[1],
    effect: { ...program.abilities[1].effect, filter: { type: ["unit", "gear"], controller: "B" } }
  };
  const handle = createEngineStaticBinder(engine).bindStatic(absolute, source);
  const entry = engine.layers.registry.list()[0];
  assert.equal(entry.effect.effect.kind, "restriction");
  assert.deepEqual(entry.effect.effect.causes, ["spell", "ability"]);
  assert.deepEqual(entry.effect.effect.filter, { type: ["unit", "gear"], controller: "B" });
  // 416's "spells and abilities can't ready" is cause-scoped; the query only
  // matches the action name, so an absolute enemy target shows the leak: the
  // same entry answers for an unrelated action name because `actions` is unset.
  const enemyKernel = world()
    .player("A", { energy: 20 })
    .unit("enemy-unit", { owner: "B", controller: "B", types: ["unit"], might: 3 })
    .build();
  const enemy = enemyKernel.getObject("enemy-unit");
  assert.equal(restrictions(engine.layers.registry, "ready", enemy.ref, enemy, "A").length, 1);
  assert.equal(restrictions(engine.layers.registry, "draw", enemy.ref, enemy, "A").length, 1);
  assert.equal(restrictions(engine.layers.registry, "move", enemy.ref, enemy, "A").length, 1);
  handle.unbind();
});

test("Mageseeker Warden: the self-at-battlefield condition is not evaluated by the reference kernel", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .unit("warden", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"] })
    .build();
  const source = kernel.getObject("warden");
  const condition = program.abilities[0].condition;
  kernel.perform({ type: "move-location", object: source.ref, to: { type: "battlefield", id: "bf-1" } });
  assert.deepEqual(kernel.getObject("warden").location, { type: "battlefield", id: "bf-1" });
  // The card is at a battlefield, yet the host test() resolves the zone filter
  // to a false count: the location predicate has no evaluator yet.
  assert.equal(kernel.test(condition), false);
  assert.deepEqual(condition.left.filter, { object: "self", zone: "battlefield" });
  assert.equal(condition.left.subject, "objects");
});

test("Mageseeker Warden: two independent static restrictions with identical battlefield conditions", () => {
  assert.equal(program.abilities.length, 2);
  const expectedCondition = { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", zone: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } };
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    assert.deepEqual(ability.condition, expectedCondition);
    assert.equal(ability.effect.kind, "continuous.restrict");
  }
});

test("Mageseeker Warden: opponent unit plays go only to the playing player's base", () => {
  assert.deepEqual(program.abilities[0].effect, { kind: "continuous.restrict", action: "play", filter: { type: "unit", controller: "opponent" }, allowedDestination: "acting-player-base" });
});

test("Mageseeker Warden: only spell/ability ready actions on enemy units OR gear are forbidden", () => {
  assert.deepEqual(program.abilities[1].effect, { kind: "continuous.restrict", action: "ready", filter: { type: ["unit", "gear"], controller: "opponent" }, causes: ["spell", "ability"], allowed: false });
  assert.equal(program.abilities[1].effect.causes.includes("awaken"), false);
});

test.todo("Mageseeker Warden: deny enemy battlefield unit plays at Finalize, allow their base and end restriction after Warden leaves (CR 355.17.b; dynamic battlefield and relative-player binding)");
test.todo("Mageseeker Warden: forbid spell/ability ready of enemy units/gear while preserving Awaken and friendly ready actions (continuous.restrict action-cause binding)");
