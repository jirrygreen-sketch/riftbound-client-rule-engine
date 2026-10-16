import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/sfd/assembly-rig.js";

test("Assembly Rig card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base.");
});

test("Assembly Rig has one action-speed activated ability with the printed three-part cost", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(ability.cost.power, { kind: "constant", value: ["Fury"] });
  const payments = ability.cost.payments;
  assert.equal(payments.length, 2);
  const [recyclePayment, exhaustPayment] = payments;
  assert.equal(recyclePayment.kind, "recycle");
  assert.equal(exhaustPayment.kind, "exhaust");
  assert.deepEqual(recyclePayment.choice, {
    id: "recycled-unit",
    options: ["unit-in-controller-trash"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "trash",
    type: "unit",
    owner: "controller"
  });
});

test("Assembly Rig body is one effect.token instruction creating a Mech at the controller base", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  assert.deepEqual(instruction.args.locations.value, [{ type: "base", player: "controller" }]);
  assert.equal(instruction.args.choiceId.value, "token-base");
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("Assembly Rig body executes through the reference kernel: a 3 Might Mech token lands in the controller base", () => {
  const kernel = world()
    .hand("assembly-rig", { name: "Assembly Rig", types: ["gear"], tags: ["Equipment"], energy: null, power: null })
    .build();
  const base = { type: "base", player: "A" };
  const [instruction] = program.abilities[0].body;
  // The reference kernel evaluates Expr args itself; substitute the printed
  // controller-base placeholder with the concrete player base.
  const args = {
    ...instruction.args,
    locations: { kind: "constant", value: [base] }
  };
  const run = runInstruction(tokenDefinition, args, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  const [tokenRef] = run.linked["token.objects"];
  assert.deepEqual(tokenRef, created[0].ref);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].tags, ["Mech"]);
  assert.deepEqual(created[0].location, base);
  assert.equal(created[0].owner, "A");
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.deepEqual(run.events.map(event => event.action), ["create-token"]);
});

test.todo("Assembly Rig: energy/Fury-power payment, the recycle-a-unit-from-trash cost, and source exhaustion are charged at Finalize by the chain (RIFT-81~91)");
