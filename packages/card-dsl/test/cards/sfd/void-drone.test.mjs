import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-drone.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c";

test("sfd-010-221 Void Drone: validates identity and cost-modification shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /not-hand/);
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

test.todo("Void Drone: project the static discount into Finalize only when the recorded pre-play origin is not hand");
