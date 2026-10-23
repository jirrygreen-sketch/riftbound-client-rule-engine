// Golden test for Mageseeker Warden (ogn-070-298).
//
// Execution evidence (the real play/ready scenarios through the merged chain,
// the no-legal-target boundary and the fail-closed production static bind)
// lives in the RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// Existing per-card behavior and structure assertions are retained here;
// the template suite supplies additional execution evidence.
// RIFT-651 template execution evidence (pending relative-player, location and
// ready-cause consumers): packages/card-dsl/test/cards/templates/static-static-651.test.mjs
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
    .unit("warden", {
      cardId: CANONICAL,
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 3,
      location: { type: "base", player: "A" }
    })
    .unit("enemy", { owner: "B", controller: "B", types: ["unit"], might: 3 })
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

test("ogn-070-298 Mageseeker Warden: program validates and is registered by canonicalCardId", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

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

test("Mageseeker Warden: both declared restrictions register through the production static binder", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("warden");
  const binder = createEngineStaticBinder(engine);
  const handles = program.abilities.map(ability => binder.bindStatic(ability, source));
  assert.deepEqual(
    engine.layers.registry.list().map(entry => entry.effect.effect.kind),
    ["restriction", "restriction"]
  );
  handles.reverse().forEach(handle => handle.unbind());
});

test("Mageseeker Warden: the registered restriction query scopes the ready action", () => {
  const { engine, kernel } = engineFor();
  assert.equal(engine.commit({
    type: "move-zone",
    object: kernel.ref("warden"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  }).status, "done");
  assert.equal(engine.commit({
    type: "move-zone",
    object: kernel.ref("enemy"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  }).status, "done");
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
  const enemy = kernel.getObject("enemy");
  assert.equal(restrictions(engine.layers.registry, "ready", enemy.ref, enemy, "A").length, 1);
  assert.equal(restrictions(engine.layers.registry, "draw", enemy.ref, enemy, "A").length, 0);
  assert.equal(restrictions(engine.layers.registry, "move", enemy.ref, enemy, "A").length, 0);
  handle.unbind();
});

test("Mageseeker Warden: the play restriction exists only while the host is at a battlefield", () => {
  const { engine, kernel } = engineFor();
  // Use an absolute target controller so this test isolates the host-location
  // gate from the separately tested relative-opponent consumer gap.
  const ability = {
    ...program.abilities[0],
    effect: { ...program.abilities[0].effect, filter: { type: "unit", controller: "B" } }
  };
  const handle = createEngineStaticBinder(engine).bindStatic(ability, kernel.getObject("warden"));
  const restricted = () => {
    const enemy = kernel.getObject("enemy");
    return restrictions(engine.layers.registry, "play", enemy.ref, enemy, "A").length;
  };

  engine.layers.setObjects(kernel.objects);
  assert.equal(restricted(), 0, "inactive at the controller's Base");

  assert.equal(kernel.perform({
    type: "move-location",
    object: kernel.ref("warden"),
    to: { type: "battlefield", id: "battlefield-1" }
  }).status, "done");
  engine.layers.setObjects(kernel.objects);
  assert.equal(restricted(), 1, "active at a battlefield");

  assert.equal(kernel.perform({
    type: "move-location",
    object: kernel.ref("warden"),
    to: { type: "base", player: "A" }
  }).status, "done");
  engine.layers.setObjects(kernel.objects);
  assert.equal(restricted(), 0, "inactive again after leaving the battlefield");
  handle.unbind();
});

test("Mageseeker Warden: two independent static restrictions with identical battlefield conditions", () => {
  assert.equal(program.abilities.length, 2);
  const expectedCondition = { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", location: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } };
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
