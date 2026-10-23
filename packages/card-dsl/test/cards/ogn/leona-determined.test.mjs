import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/leona-determined.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shieldDefinition from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createEngineStaticBinder, createProgramBinding, translateInstructionTargets } from "../../../../engine-core/dist/programs/index.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-5cbcf053019f85d2ed95e9f9710c31e3286d72d0e93b515699b5b03dc6f9d0e4";
const [shield, attackTrigger] = program.abilities;
const [stunInstruction] = attackTrigger.body;
const [enemyHere] = stunInstruction.targets;

test("ogn-238-298 Leona, Determined: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-238-298 Leona, Determined: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /sameLocationAs/);
  // 2026-10-17 re-sweep: the reason now names the measured dispatch gap
  // (designation is unimplemented in the default evaluator) and the exact
  // translator that refuses the "here" anchor.
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /expr-ext\/evaluate\.ts/);
  assert.match(program.judgeReason, /translateInstructionTargets|translateObjectFilter/);
  assert.equal(
    program.sourceText,
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
      "When I attack, stun an enemy unit here. (It doesn't deal combat damage this turn.)"
  );
});

test("ogn-238-298 Leona, Determined: [Shield] is declared with its presumed value 1", () => {
  // CR 814.1.b.3: an omitted Shield Value is presumed to be 1.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 1 });
});

test("ogn-238-298 Leona, Determined: the declared Shield keyword matches the merged KeywordDef and its expansion", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, true);
  assert.equal(registered.stacking, "sum");
  const [expansion] = shieldDefinition.expand({ host: { canonicalCardId: CANONICAL }, value: 1 });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  // 814.1.d/814.1.d.1: the bonus exists only while the host holds the Defender designation.
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.left.property, "designation");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
});

test("ogn-238-298 Leona, Determined: attack trigger stuns one enemy unit at the same location", () => {
  assert.equal(attackTrigger.kind, "triggered");
  // CR 383.4.e / 466.2.c: attack triggers are put on the chain after the attacker is designated.
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, { source: "self" });
  assert.equal(attackTrigger.trigger.condition, undefined);
  assert.equal(attackTrigger.optional, false);

  assert.equal(attackTrigger.body.length, 1);
  assert.equal(stunInstruction.id, "leona-determined.stun-enemy-here");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "leona-determined.enemy-here" }
  });
  assert.equal(stunInstruction.targets.length, 1);
  assert.equal(enemyHere.id, "leona-determined.enemy-here");
  // CR 359.3.f.1-2: "here" is the source's location, checked when the instruction executes.
  assert.deepEqual(enemyHere.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });
  assert.equal(enemyHere.min, 1);
  assert.equal(enemyHere.max, 1);
  assert.equal(enemyHere.selection, "one");
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(stunInstruction.linkedTo, undefined);
});

test("ogn-238-298 Leona, Determined: the stun clause stuns a board unit (CR 424.1)", () => {
  const kernel = world().unit("leona").unit("enemy-unit", { owner: "B" }).build();
  const enemyRef = kernel.ref("enemy-unit");
  const run = runInstruction(stun, { target: enemyHere.id }, {
    world: kernel,
    targets: { [enemyHere.id]: [enemyRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").stunned, true);
  assert.equal(run.result.linkedValues["stunned.count"], 1);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
});

test("ogn-238-298 Leona, Determined: the declared instruction executes when the target is locked", () => {
  // The reference kernel compares the declared "opponent" placeholder literally, so the
  // Finalize-locked target set is supplied directly and the TargetSpec is dropped here
  // (the declared TargetSpec is asserted in the structure test above).
  const kernel = world()
    .unit("leona", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  kernel.setTargets(enemyHere.id, [kernel.ref("enemy-here")]);
  const { targets, ...instruction } = stunInstruction;
  assert.equal(targets.length, 1);

  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("leona") });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["leona-determined.stun-enemy-here", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-here").stunned, true);
  assert.equal(kernel.getObject("enemy-elsewhere").stunned, false);
});

test("ogn-238-298 Leona, Determined: the sameLocationAs anchor narrows candidates to the source location", () => {
  const kernel = world()
    .unit("leona", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("leona"), source: kernel.ref("leona") });
  // The interpreter's selector query resolves the sameLocationAs anchor; the bare kernel
  // query compares filter keys literally and does not know the anchor.
  const environment = {
    context: scoped,
    query: filter => scoped.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };

  const anchored = queryObjects({ type: "unit", sameLocationAs: "source" }, environment).map(object => object.ref.id);
  assert.deepEqual(anchored, ["leona", "enemy-here"]);
  const unanchored = scoped.query({ type: "unit", zone: "board" }).map(object => object.ref.id);
  assert.deepEqual(unanchored, ["leona", "enemy-here", "enemy-elsewhere"]);
});

test("ogn-238-298 Leona, Determined: a stun target that already left the board is ignored", () => {
  const kernel = world().unit("leona").unit("enemy-unit", { owner: "B" }).build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(enemyHere.id, [stale]);
  const { targets, ...instruction } = stunInstruction;
  assert.equal(targets.length, 1);

  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("leona") });
  assert.deepEqual(outcome.results.map(result => [result.result.status, result.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("enemy-unit").stunned, false);
});

test("ogn-238-298 Leona, Determined: Shield's designation condition reads combatRole", () => {
  const kernel = world().player("A").player("B")
    .unit("leona", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 4, combatRole: "defender" })
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
  const source = kernel.getObject("leona");
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const expandedShield = binding.inspect(source).abilities.find(ability => ability.kind === "static" && ability.effect.kind === "continuous.might");
  assert.equal(expandedShield.condition.left.property, "designation");
  assert.equal(evaluateCondition(expandedShield.condition, {
      context: bindResolveContext(kernel, { source, controller: "A", timingPoint: "main-start" }),
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false,
      query: filter => kernel.query(filter)
    }), true);
  const handle = createEngineStaticBinder(engine).bindStatic(expandedShield, source);
  assert.equal(engine.layers.registry.list()[0].effect.effect.condition(source), true);
  assert.equal(engine.layers.evaluate(source.ref).might, 5);
  handle.unbind();
});

test("ogn-238-298 Leona, Determined: the attack trigger registers with its source-location anchor", () => {
  const kernel = world().unit("leona", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"] }).build();
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const registered = [];
  assert.doesNotThrow(
    () => binding.registerProgramTriggers({ pipeline: { registerTrigger: registration => registered.push(registration) } }, kernel.getObject("leona"))
  );
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].body[0].targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });
});
