import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lee-sin-ascetic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";

const CANONICAL = "card.hash-cc6ad3795219f298711ebf12535a88b5542ad11cc99575a77634de551464784e";

/** A real chain engine so the production static binder and cost planner run. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("monk", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 4 })
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


test("ogn-078-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-cc6ad3795219f298711ebf12535a88b5542ad11cc99575a77634de551464784e");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.buff|427\.1\.b\.2/);
  // 2026-10-17 re-sweep: the reason now names the dispatch gap rather than a
  // missing snapshot characteristic; the designation/combatRole merge is the
  // stale part, so the assertion follows the measured gap.
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /expr-ext\/evaluate\.ts/);
  assert.match(program.judgeReason, /continuous\.restrict|maximum/);
  assert.equal(program.sourceText, "[Shield] (+1 :rb_might: while I'm a defender.)\n:rb_exhaust:: Buff me. (I get a +1 :rb_might: buff.)\nI can have any number of buffs.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Lee Sin: Shield declaration and action-speed self Buff with exhaust as a cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "shield" });
  const activated = program.abilities[1];
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, { payments: [{ kind: "exhaust", object: "self" }] });
  assert.equal(activated.body.length, 1);
  assert.equal(activated.body[0].op, "effect.buff");
  assert.deepEqual(activated.body[0].args, { mode: { kind: "constant", value: "buff" }, objects: { kind: "constant", value: "self" } });
  // "Me" is not a target or a made-up pick (CR 355.10.d).
  assert.equal(activated.body[0].targets, undefined);
  assert.equal(activated.body[0].picks, undefined);
});

test("Lee Sin: explicitly declare an unlimited self Buff capacity, rather than a large finite amount", () => {
  const permission = program.abilities[2];
  assert.equal(permission.kind, "static");
  assert.deepEqual(permission.effect, { kind: "continuous.restrict", action: "buff", filter: { object: "self" }, maximum: null });
  assert.equal(permission.condition, undefined);
  assert.match(program.judgeReason, /已有 Buff|702\.3\.a/);
});

test("Lee Sin: the printed 'Buff me' still cannot pass the merged effect.buff arg shape", () => {
  // CR 355.10.d: "me" is not a chosen target, so the card declares the
  // symbolic self selector; the merged primitive only accepts a TargetSpec id.
  const kernel = world().unit("monk", { owner: "A", controller: "A", might: 4 }).build();
  const instruction = program.abilities[1].body[0];
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: "self" });
  assert.throws(
    () => runInstruction(buff, { mode: "buff", objects: instruction.args.objects }, { world: kernel }),
    /effect\.buff args: target must be a non-empty TargetSpec id/
  );
  assert.equal(kernel.getObject("monk").buffs, 0);
});

test("Lee Sin: the exhaust cost really pays, but a second Buff is still dropped by 702.3.a", () => {
  const base = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("monk", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 4 })
    .build();
  const context = base.clone({ controller: "A", sourceSnapshot: base.getObject("monk") });
  const activated = program.abilities[1];
  const translated = translateCost(activated.cost, "lee-sin.probe", "activate");
  const plan = buildCostPlan(context, { id: "lee-sin.probe", cost: translated });
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("monk").exhausted, true);

  // 702.3.a: a second Buff is skipped unconditionally; the declared unlimited
  // permission (427.1.b.2) has no consumer, so this never becomes a 2nd buff.
  const buffed = world()
    .unit("monk", { owner: "A", controller: "A", might: 4, buffs: 1 })
    .build();
  const target = buffed.ref("monk");
  const run = runInstruction(buff, { mode: "buff", target: "lee-sin.self" }, { world: buffed, targets: { "lee-sin.self": [target] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(buffed.getObject("monk").buffs, 1);
});

test("Lee Sin: the unlimited-buff permission registers but no rule query consumes it", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("monk");
  const permission = program.abilities[2];
  const handle = createEngineStaticBinder(engine).bindStatic(permission, source);
  const registered = engine.layers.registry.list()[0];
  // The declaration reaches the ability layer, but the rules query only reads
  // actions/amount/cap: the maximum:null permission never becomes readable.
  assert.equal(registered.effect.effect.kind, "restriction");
  assert.equal(registered.effect.effect.maximum, null);
  assert.deepEqual(registered.effect.effect.actions, undefined);
  // 2026-10-17 re-sweep: the declared field names do not match the primitive's
  // RestrictArgs (mode/action/operation/appliesTo/restriction/amount/cost/...),
  // so the query still reports an entry with no actions and no maximum slot.
  assert.throws(
    () => restrict.argsSchema.parse({ kind: "continuous.restrict", action: "buff", filter: { object: "self" }, maximum: null }),
    /Invalid continuous\.restrict argument: kind/
  );
  assert.deepEqual(
    restrictions(engine.layers.registry, "buff", source.ref, source, source.controller)
      .map(entry => [entry.actions, "maximum" in entry]),
    [[[], false]]
  );
  handle.unbind();
});

test("Lee Sin: the Shield expansion binds, but its Defender predicate never evaluates", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("monk");
  const [shield] = keywordDefinitionsById.get("Shield").expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(shield.condition.left.property, "designation");
  assert.equal(Object.hasOwn(source, "designation"), false);
  assert.throws(
    () => evaluateCondition(shield.condition, { context: kernel, host: source.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false }),
    /Unavailable characteristic: designation/
  );
  const handle = createEngineStaticBinder(engine).bindStatic(shield, source);
  const registered = engine.layers.registry.list()[0];
  assert.equal(registered.effect.effect.condition(source), false);
  assert.equal(engine.layers.evaluate(source.ref).might, 4);
  handle.unbind();
});

test.todo("Lee Sin: first self Buff via a non-target ObjectSelector, with real exhaust payment; effect.buff currently requires a TargetSpec id");
test.todo("Lee Sin: second and subsequent Buffs through the same primitive after consuming unlimited-Buff permission; 427.1.b.2 still has no consumer and the declared action/maximum/filter fields have no counterpart in continuous.restrict's RestrictArgs or layers/rules/query.ts restrictions()");
test.todo("Lee Sin: Shield defender Might needs the designation -> combatRole dispatch in effects/interpreter/expr.ts / programs/statics.ts (RIFT-711's expr-ext/evaluate.ts implements it but is not wired in)");
