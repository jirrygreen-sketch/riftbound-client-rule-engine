import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-drone.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c";

test("sfd-010-221 Void Drone: validates identity and cost-modification shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /not-hand/);
  assert.equal(program.sourceText, "I cost :rb_energy_2: less to play from anywhere other than your hand.");
});

test("sfd-010-221 Void Drone: reduces Energy by two only outside hand", () => {
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

test.todo("Void Drone: consume the non-hand cost discount through CardProgram→CostPlan wiring (RIFT-89)");
