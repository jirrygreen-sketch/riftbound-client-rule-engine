import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/legion-rearguard.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import effectReady from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CANONICAL_ID =
  "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)";

test("ogn-010-298 Legion Rearguard: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-010-298 Legion Rearguard: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-010-298 Legion Rearguard: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /805\.1\.b\.1/);
  assert.match(program.judgeReason, /805\.2\.b/);
  assert.match(program.judgeReason, /describePlay/);
  assert.match(program.judgeReason, /accelerate\.cost/);
});

test("ogn-010-298 Legion Rearguard: exactly one unvalued Accelerate keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "accelerate");
  assert.equal(keyword.value, undefined);
});

test("ogn-010-298 Legion Rearguard: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("ogn-010-298 Legion Rearguard: the merged Accelerate enter-ready body readies the unit (CR 805.6)", () => {
  const host = { canonicalCardId: program.canonicalCardId };
  const [, replacement] = accelerate.expand({ host });
  const enterReady = replacement.with[0];
  assert.equal(enterReady.op, "effect.ready");

  const base = world().unit("legion-rearguard", { exhausted: true, might: 2, types: ["unit"] }).build();
  const bound = base.clone({ sourceSnapshot: undefined, source: base.ref("legion-rearguard") });
  const run = runInstruction(effectReady, enterReady.args, { world: bound });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
  assert.equal(bound.getObject("legion-rearguard").exhausted, false);
});

test("ogn-010-298 Legion Rearguard: the accelerated cost plan adds [1] and one domain-matched Power (805.1.b/805.1.b.1)", () => {
  // The cost plan's optionalAdditional accelerate branch is the merged consumer
  // that turns the declared keyword into the printed [1] + 1 Power component.
  const kernel = world().unit("legion-rearguard", { types: ["unit"], energy: 2, power: ["Fury"] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("legion-rearguard") });
  const plan = buildCostPlan(context, {
    id: "cost:legion-rearguard",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    domains: ["Fury"],
    optionalAdditional: [{ id: "legion-rearguard.accelerate", kind: "accelerate", selected: true }]
  });
  assert.deepEqual(plan.selectedAdditional, [{ id: "legion-rearguard.accelerate", kind: "accelerate" }]);
  assert.equal(plan.total.energy, 3);
  assert.equal(plan.total.power.length, 1);
  assert.equal(plan.total.power[0].amount, 1);
  // 805.1.b.1: a unit with a domain pays the Power part with a matching domain.
  assert.deepEqual(plan.total.power[0].allowedDomains, ["Fury"]);
  assert.equal(plan.components.some(component => component.stage === "optional-additional"), true);
});

test("ogn-010-298 Legion Rearguard: declining Accelerate charges only the base cost", () => {
  const kernel = world().unit("legion-rearguard", { types: ["unit"], energy: 2, power: ["Fury"] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("legion-rearguard") });
  const plan = buildCostPlan(context, {
    id: "cost:legion-rearguard-decline",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    domains: ["Fury"],
    optionalAdditional: [{ id: "legion-rearguard.accelerate", kind: "accelerate", selected: false }]
  });
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ["legion-rearguard.accelerate"]);
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
});

/** Real EventPipeline + ChainEngine harness (engine-core/test/chain/helpers.mjs shape). */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20, power: ["Fury"] })
    .player("B", { energy: 20 })
    .hand("legion-rearguard", { energy: 2, power: ["Fury"] })
    .deck(["A:deck:1", "A:deck:2"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => {
      if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
      if (request.type === "optional") return request.options?.[0] ?? true;
      throw new Error(`Unexpected choice: ${request.id}`);
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

const resolveAll = engine => {
  engine.advance();
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
};

const C = value => ({ kind: "constant", value });

test("ogn-010-298 Legion Rearguard: a finalized accelerate plan makes the unit enter ready (805.6)", () => {
  // The chain's ready entry reads selectedAdditional[accelerate] exactly as the
  // production resolver does (chain/engine.ts); the plan below is built by the
  // merged cost planner from the card's printed [1] + 1 Power wording.
  const state = fixture();
  state.engine.execute({
    id: "legion-rearguard-play",
    kind: "unit",
    controller: "A",
    speed: "normal",
    source: state.kernel.getObject("legion-rearguard"),
    body: [],
    cost: {
      id: "cost:legion-rearguard",
      cost: { kind: "explicit", energy: C(2) },
      domains: ["Fury"],
      optionalAdditional: [{ id: "legion-rearguard.accelerate", kind: "accelerate", selected: true }]
    }
  });
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("legion-rearguard").zone, "board");
  assert.equal(state.kernel.getObject("legion-rearguard").exhausted, false);
  assert.equal(state.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("ogn-010-298 Legion Rearguard: without the accelerate payment the unit enters exhausted (359.2.c)", () => {
  const state = fixture();
  state.engine.execute({
    id: "legion-rearguard-play",
    kind: "unit",
    controller: "A",
    speed: "normal",
    source: state.kernel.getObject("legion-rearguard"),
    body: [],
    cost: {
      id: "cost:legion-rearguard-decline",
      cost: { kind: "explicit", energy: C(2) },
      domains: ["Fury"],
      optionalAdditional: [{ id: "legion-rearguard.accelerate", kind: "accelerate", selected: false }]
    }
  });
  resolveAll(state.engine);
  assert.equal(state.kernel.getObject("legion-rearguard").zone, "board");
  assert.equal(state.kernel.getObject("legion-rearguard").exhausted, true);
});

test.todo(
  "Legion Rearguard: pay [1][Fury] as an optional additional cost while playing me, then enter ready "
    + "through the delayed replacement (CR 805.1.b/805.2.b/805.6) — the merged cost plan and chain "
    + "ready entry execute a finalized accelerate component, but no producer turns the card's keyword "
    + "ability into that optionalAdditional component or registers the accelerate.cost / enter-ready "
    + "replacement for it"
);

test("ogn-010-298 Legion Rearguard: the merged play binding produces no accelerate cost component", () => {
  // 805.1.b: the printed accelerate cost must appear in the play's cost plan. programs/play.ts
  // builds the draft from the card program, but the keyword declaration has no producer: the
  // draft carries no cost at all, so the chain never sees an optionalAdditional component and
  // the ready entry path (chain/engine.ts reads selectedAdditional) can never trigger.
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("legion-rearguard", {
      cardId: program.canonicalCardId,
      types: ["unit"],
      energy: 2,
      power: ["Fury"],
      owner: "A"
    })
    .build();
  const source = kernel.getObject("legion-rearguard");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.cost, undefined);
  assert.deepEqual(draft.body, []);
  // The keyword expansion does declare the cost and the enter-ready replacement, so the missing
  // piece really is the producer wiring rather than the keyword definition.
  const expanded = binding.inspect(source).abilities;
  assert.deepEqual(
    expanded.map((ability) => [ability.kind, ability.effect?.kind ?? ability.keyword]),
    [["keyword", "accelerate"], ["static", "accelerate.cost"], ["replacement", undefined]]
  );
});

test("ogn-010-298 Legion Rearguard: the accelerate.cost static ability has no layer mapping", () => {
  // programs/statics.ts maps copy/trait/ability/arithmetic kinds (and the might/keyword/movement/
  // combat families); the accelerate cost declaration has no consumer, so Finalize cannot read it.
  const kernel = world()
    .player("A", { energy: 20 })
    .hand("legion-rearguard", {
      cardId: program.canonicalCardId,
      types: ["unit"],
      energy: 2,
      power: ["Fury"],
      owner: "A"
    })
    .build();
  const source = kernel.getObject("legion-rearguard");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const [accelerateCost] = binding.inspect(source).abilities.filter(
    (ability) => ability.kind === "static" && ability.effect.kind === "accelerate.cost"
  );
  assert.ok(accelerateCost, "the Accelerate keyword must declare accelerate.cost");
  const binder = createEngineStaticBinder({
    layers: { addContinuous: () => {}, removeContinuous: () => {} },
    pipeline: {
      host: { objects: () => kernel.objects, context: () => kernel.clone({ sourceSnapshot: source }) },
      registerReplacement: () => {}
    }
  });
  assert.throws(() => binder.bindStatic(accelerateCost, source), /has no layer mapping/);
});
