import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/bounty-hunter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const ability = program.abilities[0];
const instruction = ability.body[0];
const targetSpec = instruction.targets[0];
const literal = (value) => ({ kind: "constant", value });

test("bounty-hunter program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("bounty-hunter identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /hasGanking/);
  assert.match(program.judgeReason, /810\.1\.c/);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
  );
});

test("bounty-hunter structure: exhaust-only activated ability granting Ganking for the turn", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.cost.energy, undefined);
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "bounty-hunter.grant-ganking");
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { kind: "target", id: "bounty-hunter.unit" } });
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);
  // "a unit" (not "a friendly unit"): the target is any Board unit, so the
  // filter must not carry a controller restriction.
  assert.equal(targetSpec.id, "bounty-hunter.unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.filter.controller, undefined);
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("Bounty Hunter original body grants the chosen friendly or enemy unit Ganking without granting the legend", () => {
  for (const owner of ["A", "B"]) {
    const base = world().base("legend", { types: ["legend"], might: null }).unit("target", { owner }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("legend") });
    const target = kernel.ref("target");
    kernel.setTargets(targetSpec.id, [target]);
    const receipt = payCostPlan(kernel, buildCostPlan(kernel, { id: `activate:${owner}`, cost: ability.cost }));
    assert.equal(receipt.paid, true);
    const outcome = resolveChainBody(ability.body, kernel);
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(kernel.getObject("legend").exhausted, true);
    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
    assert.deepEqual(layers.evaluate(kernel.ref("legend")).keywords, []);
    assert.deepEqual(layers.evaluate(target).keywords.map(({ id }) => id), ["Ganking"]);
    layers.advance({ id: "turn-end" });
    assert.deepEqual(layers.evaluate(target).keywords, []);
  }
});

test("Bounty Hunter original body ignores a target that has left the Board", () => {
  const base = world().base("legend", { types: ["legend"], might: null }).unit("target").build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("legend") });
  const target = kernel.ref("target");
  kernel.setTargets(targetSpec.id, [target]);
  kernel.perform({ type: "return-to-hand", object: target });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(kernel.continuousEffects, []);
});

test("bounty-hunter golden: the exhaust cost pays and the grant gives any chosen unit Ganking for the turn", () => {
  const base = world()
    .unit("bounty-hunter", {
      cardId: program.canonicalCardId,
      types: ["legend"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    // "a unit" is unrestricted: an opponent's unit is a legal choice.
    .unit("enemy-unit", { owner: "B", controller: "B", keywords: [] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("bounty-hunter") });

  // 376/415.5: the printed :rb_exhaust: is the activated ability's cost.
  const plan = buildCostPlan(kernel, { id: "bounty-hunter:activate", cost: ability.cost });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("bounty-hunter").exhausted, true);

  const run = runInstruction(
    grantKeyword,
    {
      keyword: instruction.args.keyword,
      duration: instruction.args.duration,
      objects: literal({ kind: "target", id: targetSpec.id })
    },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("enemy-unit")] } }
  );
  assert.equal(run.result.status, "executed");

  const engine = createLayerEngine(
    [kernel.getObject("enemy-unit")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ref = kernel.ref("enemy-unit");
  assert.ok(engine.evaluate(ref).keywords.some((keyword) => keyword.id === "Ganking"));
  engine.advance({ id: "turn-end" });
  assert.deepEqual(engine.evaluate(ref).keywords, []);
});

test.todo(
  "bounty-hunter end-to-end: the printed activation pays Exhaust, locks the chosen unit and grants it Ganking through the real chain, " +
    "and once production assembly attaches the merged KeywordGrantLayerEngine to the default chain wiring (chain/engine.ts and " +
    "runCardScenario), the default path must assert the re-expanded battlefield-to-battlefield permission while the grant is live " +
    "and its revocation at turn end (CR 810.1.c); today the production default still attaches the plain LayerEngine, so the " +
    "re-expanded permission stays false on the default path"
);

test.todo(
  "bounty-hunter fixture: with an explicit KeywordGrantLayerEngine the granted Ganking re-expands into the movement() permission " +
    "(canGank === true) and is revoked at turn end (canGank === false) — the fixture below already pins these wired semantics; " +
    "promote the card to executable only after the production default assembly (chain/engine.ts and runCardScenario) attaches " +
    "the re-expansion engine, which is the remaining judge-required reason"
);

/**
 * The harness and ProgramRegistry.get refuse judge-required programs; this view
 * changes validation metadata only (the RIFT-681 executableView idiom). The
 * original program stays judge-required and the executable evidence below never
 * mutates abilities, costs, targets or sourceText.
 */
function executableView() {
  return { ...program, status: "executable", judgeReason: undefined };
}

test("bounty-hunter end-to-end: the printed activation pays Exhaust, locks the chosen unit and grants it Ganking through the real chain", () => {
  const result = runCardScenario(executableView(), {
    players: { A: {}, B: {} },
    objects: [
      {
        id: "bounty-hunter",
        cardId: program.canonicalCardId,
        program: executableView(),
        types: ["legend"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: null,
        power: null,
        might: null
      },
      // "a unit" is unrestricted: an opponent's Board unit is a legal target.
      { id: "target", owner: "B", types: ["unit"], zone: "board", might: 4, energy: null, power: null }
    ],
    operations: [
      { type: "activate", object: "bounty-hunter", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ],
    expect: {
      objects: {
        "bounty-hunter": { zone: "board", exhausted: true, energy: null, power: null },
        target: { zone: "board", keywords: [{ id: "Ganking" }] }
      },
      events: {
        sequence: [
          { timingPoint: "chain-item-pending", object: { ref: "bounty-hunter" } },
          { timingPoint: "object-exhausted", action: { type: "exhaust", object: { id: "bounty-hunter" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ]
      }
    }
  });
  // Production assembly wires the default LayerEngine, so the dynamically
  // granted Ganking is not re-expanded into a movement permission there; the
  // wired re-expansion semantics are asserted in the KeywordGrantLayerEngine
  // fixture below (CR 810.1.c).
  assert.equal(result.state.objects.find(object => object.ref.id === "target").movement.canGank, false,
    "the default path does not attach the re-expansion engine; that wiring gap is the judge-required reason");
});

test("bounty-hunter fixture: with an explicit KeywordGrantLayerEngine the granted Ganking re-expands into the movement() permission and is revoked at turn end", () => {
  // The default chain wiring does not attach the KeywordGrantLayerEngine yet;
  // this fixture follows the engine-core reexpand.test.mjs construction and
  // pins the CR 810.1.c semantics through the same production binding, so the
  // promotion path stays executable once assembly attaches this engine.
  const base = world()
    .unit("bounty-hunter", {
      cardId: program.canonicalCardId,
      types: ["legend"],
      might: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("target", { owner: "B", controller: "B", might: 4 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("bounty-hunter") });
  kernel.setAnswers({ "target:bounty-hunter.unit": [kernel.ref("target")] });
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    host,
    layers,
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    cleanup: current => {
      let changed = false;
      current.layers.setObjects(kernel.objects);
      for (const object of current.layers.evaluateAll()) {
        if (object.zone === "board" && object.types.includes("unit") && object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
          current.commit({ type: "kill", object: object.ref });
          changed = true;
        }
      }
      return changed;
    }
  });
  const binding = createProgramBinding({ cardPrograms: [executableView()] });
  engine.execute(binding.describeActivate(kernel.getObject("bounty-hunter"), "A", 0));
  engine.pass(engine.priority);
  while (engine.items.length) {
    engine.pass(engine.priority);
  }
  assert.ok(engine.trace.some(event => event.step === "resolved"), "the activated chain item resolved");

  layers.setObjects(kernel.objects);
  const ref = kernel.ref("target");
  const granted = movement(layers.registry, ref, layers.snapshot(ref), "A");
  assert.equal(granted.canGank, true);
  assert.ok(layers.snapshot(ref).keywords.some(keyword => keyword.id === "Ganking"));
  assert.equal(kernel.getObject("bounty-hunter").exhausted, true);

  engine.emit({ timingPoint: "turn-end", player: "A" });
  layers.setObjects(kernel.objects);
  const expired = movement(layers.registry, ref, layers.snapshot(ref), "A");
  assert.equal(expired.canGank, false);
  assert.deepEqual(layers.snapshot(ref).keywords, []);
});
