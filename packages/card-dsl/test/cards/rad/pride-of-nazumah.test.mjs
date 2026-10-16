import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/pride-of-nazumah.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID =
  "card.hash-429ae86450b57eb8b5283953594d1e2375732b2cc9c460d030a5a5b418afd418";
const SOURCE_TEXT =
  ':rb_energy_1:, :rb_exhaust:: Give a friendly unit "I have [Assault] equal to my [Shield]" ' +
  "this turn. (+1 :rb_might: for each instance of Assault while it's an attacker.)";

const [ability] = program.abilities;
const [grant] = ability.body;

test("rad-147-167 Pride of Nazumah: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-147-167 Pride of Nazumah: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The gap must stay concrete: which primitive is missing and which task owns it.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-89/);
  // The generated card registry indexes this program by canonicalCardId.
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-147-167 Pride of Nazumah: activated ability charges 1 Energy plus Exhaust this", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
  // CR 204.1.b / 415.5: the printed cost before the colon; CR 415.4 makes the
  // exhaust a payment that must be completable, not an effect state change.
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("rad-147-167 Pride of Nazumah: body grants Assault equal to the target's Shield, this turn", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "pride-of-nazumah.grant-assault"
  ]);
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.condition, undefined);
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  // CR 814.1.b.2: the granted value is the recipient's Shield Value, read from
  // the selected unit itself (a placeholder expression, see judgeReason).
  assert.deepEqual(grant.args.value, {
    kind: "object-property",
    object: { target: "pride-of-nazumah.friendly-unit" },
    property: "shield"
  });
  // CR 807.1.d.1 / 814.1.d.1: the grant lasts until end of turn.
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // CR 355.9.a.1 / 355.10: one friendly unit is targeted, nothing else.
  assert.equal(grant.picks, undefined);
  assert.deepEqual(grant.targets, [
    {
      id: "pride-of-nazumah.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-147-167 Pride of Nazumah: the declared grant op cannot execute", () => {
  // (1) The merged instruction registry has no continuous.grant-keyword primitive
  // (RIFT-91), so the opcode itself is unregistered.
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);

  // (2) The declared value read is not resolvable either: ObjectSnapshot exposes
  // keywords as a list, not a "shield" property, so evaluating the argument
  // raises MissingInformation and the merged interpreter reports the
  // instruction as ignored instead of granting anything.
  const { targets, ...bodyOnly } = grant;
  const kernel = world()
    .unit("ally", { might: 2, keywords: [{ id: "Shield", value: 2 }] })
    .build();
  kernel.setTargets("pride-of-nazumah.friendly-unit", [kernel.ref("ally")]);
  const outcome = runAbilityBody([bodyOnly], kernel, undefined, { host: kernel.ref("ally") });
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [[
      "pride-of-nazumah.grant-assault",
      "ignored",
      "mistargeted"
    ]]
  );
  // The recipient kept exactly its current keywords — nothing was approximated.
  assert.deepEqual(kernel.getObject("ally").keywords, [{ id: "Shield", value: 2 }]);
});

test.todo(
  "rad-147-167 Pride of Nazumah: dynamically grant [Assault] with a value read from the " +
    "recipient's Shield Value and expire it at end of turn (continuous.grant-keyword + keyword " +
    "value reads + continuous.duration, RIFT-87/91)"
);
test.todo(
  "rad-147-167 Pride of Nazumah: pay 1 Energy and Exhaust this legend during Finalize " +
    "(CR 204.1.b / 415.4 / 415.5; cost.exhaust / cost.pay and a Legend Zone in the contract " +
    "ZoneId, RIFT-89)"
);
