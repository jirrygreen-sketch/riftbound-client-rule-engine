import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/seal-of-strength.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-163-298 Seal of Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-163-298 Seal of Strength: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-6a0595ffe067b24200ab041d201195a0e2583fabab24b3f54c8d25446b69c7f3"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_body:. (Abilities that add resources can't be reacted to.)"
  );
});

test("ogn-163-298 Seal of Strength: reaction-speed activated ability with exhaust cost and Body Power Add body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "reaction");
  assert.equal(ability.cost.kind, "activated");
  assert.equal(ability.cost.energy, undefined);
  assert.equal(ability.cost.power, undefined);
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "seal-of-strength.add-body");
  assert.equal(instruction.op, "effect.resources");
  assert.deepEqual(instruction.args.power, { kind: "constant", value: ["Body"] });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "added" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-163-298 Seal of Strength: the Add body executes through effect.resources with the program's own args", () => {
  const [ability] = program.abilities;
  const [instruction] = ability.body;
  const kernel = world().player("A", { power: ["Fury"] }).build();
  const run = runInstruction(resources, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Fury", "Body"]);
  assert.deepEqual(run.linked.added, { player: "A", energy: 0, power: ["Body"] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-power"]);
});

test.todo(
  "Seal of Strength: Finalize pays the exhaust-this cost and the Add ability finalizes immediately " +
    "(chain cost plan / Add timing, RIFT-89/90 + RIFT-120)"
);
