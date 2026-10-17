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
  "bounty-hunter end-to-end: bind the activated CardProgram ability to the chain so paying the cost runs the " +
    "granted Ganking, re-expand dynamic keywords, normalize permission.routes and revoke that Standard Move permission at turn end."
);
