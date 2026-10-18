// 2026-10-18 re-sweep: the merged cost module (RIFT-709) now really consumes
// this card's static declaration through finalizeCostPlan with a real
// originZone, so the collector path is asserted here as live execution
// evidence. The published status stays judge-required because the default
// static binder and the production chain Finalize still have no wiring; the
// RIFT-668/RIFT-643 template rows keep their own partial/boundary claims.

import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-drone.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const ID = "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c";

test("sfd-010-221 Void Drone: validates identity and cost-modification shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason must name the measured current gaps.
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /finalizeCostPlan/);
  assert.match(program.judgeReason, /originZone/);
  assert.match(program.judgeReason, /buildCostPlan/);
  assert.equal(program.sourceText, "I cost :rb_energy_2: less to play from anywhere other than your hand.");
});

test("sfd-010-221 Void Drone: declares the non-hand-only Energy discount", () => {
  assert.deepEqual(program.abilities, [{
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      amount: { kind: "constant", value: -2 },
      appliesTo: "self",
      fromZone: "not-hand"
    }
  }]);
});

test("Void Drone supported modifier subpath: cost.modify discounts the printed plan by two with a zero floor", () => {
  for (const [energy, expected] of [[5, 3], [1, 0]]) {
    const base = world().object("drone", { cardId: ID, zone: "banishment", energy, power: [], types: ["unit"] }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("drone") });
    const effect = program.abilities[0].effect;
    const run = runInstruction(costModify, {
      id: "void-drone.cost", modifier: {
        kind: "reduce", resource: effect.resource,
        amount: { kind: "arithmetic", operator: "neg", operands: [effect.amount] }
      }
    }, { world: kernel });
    assert.equal(run.result.status, "executed");
    assert.equal(run.linked.cost.total.energy, expected);
    assert.equal(kernel.getObject("drone").zone, "banishment");
    assert.equal(kernel.player("A").energy, 0);
  }
});

test("sfd-010-221 Void Drone: the merged Finalize collector applies the [2] discount only for a recorded non-hand origin", () => {
  // The real consumer: cost/discounts/collect.ts. The card's own static
  // ability is supplied exactly as the program declares it.
  const kernel = world().player("A", { energy: 20 })
    .hand("drone", { cardId: ID, types: ["unit"], energy: 3, power: [] })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("drone"), controller: "A" });
  const statics = [{ id: "drone-static", source: context.ref("drone"), ability: program.abilities[0] }];
  const plan = (originZone) => finalizeCostPlan(context, { id: "drone-play", cost: { kind: "printed" } }, {
    statics, ...(originZone === undefined ? {} : { originZone })
  });

  // 356.4: the reduction is a real component discount, not a changed printed cost.
  const fromTrash = plan("trash");
  assert.equal(fromTrash.printed.energy, 3);
  assert.equal(fromTrash.total.energy, 1);
  assert.deepEqual(fromTrash.discounts.map((entry) => [entry.id, entry.resource, entry.amount, entry.before, entry.after]),
    [["drone-static:0:total", "energy", 2, 3, 1]]);
  assert.equal(plan("banishment").total.energy, 1);
  // "from anywhere other than your hand": from hand the discount does not apply.
  assert.equal(plan("hand").total.energy, 3);
  assert.deepEqual(plan("hand").discounts, []);
  // Without the recorded pre-play origin the collector must fail closed rather
  // than guess from the current zone or silently skip the discount.
  assert.throws(() => plan(undefined), (error) => error.reason === "judge-required" && /pre-chain origin zone/.test(String(error.message)));
});

test("sfd-010-221 Void Drone: the default CardProgram static binder still rejects the declaration", () => {
  const { engine, kernel } = fixture();
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(program.abilities[0], kernel.getObject("source")),
    (error) => /Static ability kind continuous\.cost-modification has no layer mapping/.test(String(error.message))
  );
});
