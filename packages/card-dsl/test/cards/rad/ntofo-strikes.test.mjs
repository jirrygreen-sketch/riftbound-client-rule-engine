import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ntofo-strikes.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const [grantShield, shieldValue, dealShield] = play.body;

test("rad-148-167 Ntofo Strikes: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-09ac8b0dded2de4aaec186e708da9025177f38cddcb872a26bfa49aa0a1f627f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a friendly unit [Shield 2] this turn, then deal damage equal to its [Shield] to an enemy unit. " +
      "(A unit with Shield has +1 :rb_might: for each instance of Shield while it's a defender.)"
  );
});

test("rad-148-167 Ntofo Strikes: judgeReason names the keyword-grant and Shield-value gaps", () => {
  assert.match(program.judgeReason, /814\.1\.b\.2/);
  assert.match(program.judgeReason, /814\.2/);
  assert.match(program.judgeReason, /关键词/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("rad-148-167 Ntofo Strikes: structure — Action keyword, Shield grant, Shield-value read, linked damage", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "ntofo-strikes.grant-shield",
    "ntofo-strikes.shield-value",
    "ntofo-strikes.deal-shield"
  ]);

  // "Give a friendly unit [Shield 2] this turn" — duration-bounded keyword
  // grant (CR 801.3.a / 814.1.b.2); no merged op creates it.
  assert.equal(grantShield.op, "continuous.grant-keyword");
  assert.deepEqual(grantShield.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(grantShield.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantShield.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantShield.targets.length, 1);
  assert.equal(grantShield.targets[0].id, "ntofo-strikes.friendly-unit");
  assert.deepEqual(grantShield.targets[0].filter, { type: "unit", controller: "self" });
  assert.equal(grantShield.targets[0].min, 1);
  assert.equal(grantShield.targets[0].max, 1);
  assert.equal(grantShield.targets[0].selection, "one");

  // "then deal damage equal to its [Shield]" — the Shield Value read ("then"
  // makes this linked to the grant, 359.3.e.14); no merged expression reads a
  // keyword value or a snapshot keywords entry.
  assert.equal(shieldValue.op, "effect.shield-value");
  assert.equal(shieldValue.linkedTo, "ntofo-strikes.grant-shield");
  assert.deepEqual(shieldValue.args.object, {
    kind: "constant",
    value: { target: "ntofo-strikes.friendly-unit" }
  });
  assert.equal(shieldValue.targets, undefined);

  assert.equal(dealShield.op, "effect.damage");
  assert.equal(dealShield.linkedTo, "ntofo-strikes.shield-value");
  assert.deepEqual(dealShield.args.amount, {
    kind: "linked-value",
    instructionId: "ntofo-strikes.shield-value",
    key: "shieldValue"
  });
  assert.deepEqual(dealShield.args.target, {
    kind: "constant",
    value: "ntofo-strikes.enemy-unit"
  });
  assert.equal(dealShield.targets.length, 1);
  assert.equal(dealShield.targets[0].id, "ntofo-strikes.enemy-unit");
  assert.deepEqual(dealShield.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.equal(dealShield.targets[0].min, 1);
  assert.equal(dealShield.targets[0].max, 1);
  assert.equal(dealShield.targets[0].selection, "one");
});

test("rad-148-167 Ntofo Strikes: neither the keyword grant nor the Shield-value read is registered", () => {
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), false);
  assert.equal(instructionDefinitionsById.has("effect.shield-value"), false);
});

test("rad-148-167 Ntofo Strikes: the damage half deals the Shield Value once it is supplied (418.1.b)", () => {
  const kernel = world()
    .player("A")
    .unit("ally", { might: 2 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  // The Shield Value read is the unresolved half; with the value supplied (as
  // the pending effect.shield-value would link it), the merged effect.damage
  // deals exactly that much to the targeted enemy unit.
  const run = runInstruction(
    damage,
    { amount: dealShield.args.amount, target: "ntofo-strikes.enemy-unit" },
    {
      world: kernel,
      targets: { "ntofo-strikes.enemy-unit": [kernel.ref("enemy")] },
      linked: { shieldValue: 2 }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test.todo(
  "rad-148-167 Ntofo Strikes: 'Give a friendly unit [Shield 2] this turn' needs a duration-bounded " +
    "keyword grant (CR 801.3.a.2); layers/engine.ts can apply keyword layers but no card-facing op " +
    "registers one (same gap as sfd-007-221 Gem Jammer; RIFT-91)"
);

test.todo(
  "rad-148-167 Ntofo Strikes: 'damage equal to its [Shield]' needs a read of the unit's summed Shield " +
    "Value (ObjectSnapshot.keywords { id, value }; CR 814.1.b.2 / 814.2); no merged Expr reads a keyword " +
    "value (RIFT-81 Shield keyword + expression support)"
);
