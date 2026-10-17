import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/herald-of-the-arcane.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const token = await import(new URL("effects/instructions/effect.token.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const ability = program.abilities[0];
const instruction = ability.body[0];
const baseA = { type: "base", player: "A" };

test("herald-of-the-arcane program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("herald identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-b65308f276825f21bb27abefcef45db6f138b952342039dac49beef16f14c2f1"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.equal(
    program.sourceText,
    ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token."
  );
});

test("herald structure: action-speed activated ability with the printed cost and Recruit play body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "herald.play-recruit");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: playing a NEW token creates it on the Chain and lets
  // the play action take it over.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // No destination argument: the default valid-location choice (CR 355.2)
  // comes from the missing target.location piece; a fixed Base would delete the
  // printed Battlefield option.
  assert.equal(instruction.args.location, undefined);
  assert.equal(instruction.args.target, undefined);
  assert.equal(instruction.args.locations, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("herald golden: the Recruit token definition and play path work through the real primitive", () => {
  const kernel = world().build();
  const run = runInstruction(
    token.default,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      // The golden run supplies the concrete Base that the missing
      // Finalize-time legal-location choice would pick; the program itself
      // keeps the choice open (judgeReason).
      location: { kind: "constant", value: baseA }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.token.amount, 1);
  assert.equal(run.result.linkedValues.token.createdAmount, 1);
  assert.equal(run.result.linkedValues.token.objectsComplete, true);
  assert.deepEqual(run.events.map(event => event.timingPoint), ["chain-item-pending", "card-played"]);

  const recruits = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(recruits.length, 1);
  const [recruit] = recruits;
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.tags, ["Recruit"]);
  // CR 185.3.a: tokens have no printed cost; null must not become 0.
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(recruit.location, baseA);
  assert.equal(recruit.owner, "A");
  assert.equal(recruit.controller, "A");
  assert.equal(run.result.linkedValues["token.objects"].length, 1);
});

test.todo(
  "herald default destination: at Finalize choose the controller's Base or a Battlefield they " +
    "control (CR 355.2/355.2.a, 440.2.b.1, 420.3.b.2); needs a runtime legal-location set for " +
    "the controller's Base and controlled Battlefields (RIFT-357)."
);
