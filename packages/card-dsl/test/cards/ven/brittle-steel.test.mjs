import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brittle-steel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-045b07d4199255ec6dcfd300272520972fba1ee89dc4e3cfe4e63f1f6b6c95e3";
const SOURCE_TEXT =
  "Kill a gear.\n" +
  "[Flow] :rb_energy_4::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [killInstruction] = play.body;
const [gearSpec] = killInstruction.targets;

test("ven-003-166 Brittle Steel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-003-166 Brittle Steel: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // README section 2: name the exact missing pieces (the Flow cost channel and
  // the Flow consumers) and the rules they come from.
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /829\.1\.c/);
  assert.match(program.judgeReason, /3\.8\.3/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unsupported replacement opcode/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-003-166 Brittle Steel: [Flow] is declared, never re-implemented in the card", () => {
  // cards/README.md section 5: only the keyword identity is declared. The printed
  // Flow cost (4 energy + 1 Fury power, 829.1.c.1) has no KeywordAbility field yet
  // (contract 3.8.3), so the card must not invent one, and 4 is not smuggled in as
  // a numeric keyword value.
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
});

test("ven-003-166 Brittle Steel: printed base cost and one Kill instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  // Catalog: energy 2, power 1, domains ["Fury"].
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "brittle-steel.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "brittle-steel.gear"
  });
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.picks, undefined);
  // 355.9.a.1: "gear" means a Board object, and it is a target (355.7/355.8).
  assert.deepEqual(gearSpec, {
    id: "brittle-steel.gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-003-166 Brittle Steel golden: effect.kill really sends the gear to its owner's trash", () => {
  const kernel = world()
    .unit("enemy-gear", {
      owner: "B",
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("bystander", { owner: "B" })
    .build();
  const locked = kernel.ref("enemy-gear");

  const run = runInstruction(kill, { target: gearSpec.id }, {
    world: kernel,
    targets: { [gearSpec.id]: [locked] }
  });

  assert.equal(run.result.status, "executed");
  // CR 429: the gear leaves the Board for its owner's trash; nothing else moves.
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.getObject("bystander").zone, "board");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("ven-003-166 Brittle Steel boundary: an already-killed gear ignores the instruction (359.3.e)", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", types: ["gear"], zone: "board" })
    .build();
  const stale = kernel.ref("enemy-gear");
  kernel.perform({ type: "kill", object: stale });

  const run = runInstruction(kill, { target: gearSpec.id }, {
    world: kernel,
    targets: { [gearSpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

const engineFor = (kernel) => {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
};

test("ven-003-166 Brittle Steel: the [Flow] expansion registers neither a cost plan nor a replacement", () => {
  // 829.1.c.1: the printed Flow cost is 4 energy + 1 Fury power, but the printed
  // text cannot reach expand (contract 3.8.3 production side), so the expansion
  // carries no cost at all. 829.1.b.1's delayed banishment cannot bind either.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("brittle-steel", { types: ["spell"], zone: "board", owner: "A", controller: "A" })
    .build();
  const source = kernel.getObject("brittle-steel");
  const expanded = expandProgram(program, source);
  assert.deepEqual(expanded.expanded.map(ability => ability.kind), ["static", "replacement"]);
  const [flowCost, flowBanish] = expanded.expanded;
  // The declared cost effect has no cost member: nothing carried the printed
  // Flow cost from the card into the keyword.
  assert.equal(flowCost.effect.kind, "flow.cost");
  assert.equal(Object.hasOwn(flowCost.effect, "cost"), false);
  assert.equal(flowBanish.replaces.event, "object-leaves-chain");

  const engine = engineFor(kernel);
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(flowCost, source),
    /Static ability kind flow\.cost has no layer mapping/
  );
  assert.throws(
    () => binder.bindReplacement(flowBanish, source),
    /Unsupported replacement opcode: effect\.banish/
  );
});

test("ven-003-166 Brittle Steel: the cost planner can price a Flow alternate, but nothing feeds it into plan-building", () => {
  // RIFT-261's base modifications really understand "flow": given the printed
  // 4 energy + 1 Fury power, the planner replaces the base cost of a spell in
  // Trash and refuses a source that is not a Trash spell. The missing half is the
  // production path from the card's flow.cost declaration into baseModifications
  // (see the previous test): the card cannot declare the cost, and the binder
  // rejects the declaration's layer.
  const c = value => ({ kind: "constant", value });
  const flowCost = { energy: c(4), power: c(1) };
  const trashSpell = world()
    .player("A", { energy: 10, power: ["Fury"] })
    .object("brittle-steel", { types: ["spell"], zone: "trash", owner: "A", controller: "A", power: ["Fury"] })
    .build();
  const plan = buildCostPlan(trashSpell.clone({ sourceSnapshot: trashSpell.getObject("brittle-steel") }), {
    id: "flow",
    domains: ["Fury"],
    cost: { kind: "explicit", energy: c(2), power: c(1) },
    baseModifications: [{ kind: "flow", id: "flow-1", cost: flowCost }]
  });
  assert.deepEqual(plan.total.energy, 4);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  const charged = trashSpell.clone({ sourceSnapshot: trashSpell.getObject("brittle-steel") });
  assert.equal(payCostPlan(charged, plan).paid, true);
  assert.equal(charged.player("A").energy, 6);

  // 829.1.c: Flow only replaces the cost when playing the spell from Trash.
  const onBoard = world()
    .player("A", { energy: 10, power: ["Fury"] })
    .unit("brittle-steel", { types: ["spell"], zone: "board", owner: "A", controller: "A", power: ["Fury"] })
    .build();
  assert.throws(
    () => buildCostPlan(onBoard.clone({ sourceSnapshot: onBoard.getObject("brittle-steel") }), {
      id: "flow",
      domains: ["Fury"],
      cost: { kind: "explicit", energy: c(2), power: c(1) },
      baseModifications: [{ kind: "flow", id: "flow-1", cost: flowCost }]
    }),
    /Flow replaces the base cost only when playing a spell from Trash/
  );
});

test.todo(
  "ven-003-166 Brittle Steel: play from trash for the printed Flow cost (4 energy + 1 Fury power, " +
    "829.1.c.1) then banish it (829.1.b.1 delayed replacement) — the KeywordAbility IR has no field shape " +
    "and expandProgram does not pass the printed cost (contract 3.8.3 production side), programs/statics has " +
    "no layer for flow.cost, and replacement/pattern.ts has no object-leaves-chain matcher or " +
    "leavingInstruction action marker"
);
