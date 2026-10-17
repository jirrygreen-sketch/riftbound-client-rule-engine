import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blast-corps-cadet.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-61c2c98673d31b1cc983ca4dea64165ef227232e1816a012d1c058d13db5bb4f";
const [cost, trigger] = program.abilities;
const instruction = trigger.body[0];

test("sfd-013-221 Blast Corps Cadet: validates identity and printed structure", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.equal(program.sourceText, "You may pay :rb_energy_1::rb_rune_fury: as an additional cost to play me.\nWhen you play me, if you paid the additional cost, deal 2 to a unit at a battlefield.");
});

test("sfd-013-221 Blast Corps Cadet: declares optional Energy plus Fury additional cost", () => {
  assert.equal(cost.kind, "static");
  assert.equal(cost.effect.kind, "cost.additional");
  assert.equal(cost.effect.optional, true);
  assert.deepEqual(cost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }
  ]);
  assert.deepEqual(trigger.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.deepEqual(instruction.targets[0].filter, { type: "unit", location: "battlefield" });
});

test("sfd-013-221 Blast Corps Cadet: deal-two body resolves against a locked battlefield unit", () => {
  const kernel = world().unit("cadet").unit("battlefield-unit", { location: { type: "battlefield", id: "bf-1" } }).build();
  const run = runInstruction(damage, { amount: { kind: "constant", value: 2 }, target: "blast-corps-cadet.battlefield-unit" }, {
    world: kernel,
    targets: { "blast-corps-cadet.battlefield-unit": [kernel.ref("battlefield-unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 2);
});

test.todo("Blast Corps Cadet: bind the optional-cost paid receipt so the damage runs only after the additional cost is chosen (RIFT-89)");
