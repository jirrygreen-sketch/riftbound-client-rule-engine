import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/fallen-feline.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e308123735feeaeba45468a3883162bc0278fffe1ef3374615c10a8647de047c";
const SOURCE_TEXT =
  "When you play me, name a spell.\n" +
  "While I'm at a battlefield, opponents can't play spells with that name.";

const [nameSpell, playRestriction] = program.abilities;
const [nameInstruction] = nameSpell.body;

test("ven-132-166 Fallen Feline: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-132-166 Fallen Feline: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /choice\.name/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /762\.1/);
});

test("ven-132-166 Fallen Feline: 'When you play me' is a mandatory card-played self trigger", () => {
  assert.equal(nameSpell.kind, "triggered");
  assert.equal(nameSpell.trigger.at, "card-played");
  assert.deepEqual(nameSpell.trigger.filter, { self: true });
  assert.equal(nameSpell.optional, false);
  assert.equal(nameSpell.body.length, 1);
});

test("ven-132-166 Fallen Feline: the naming instruction keeps the printed link for the ban", () => {
  assert.equal(nameInstruction.id, "fallen-feline.name-a-spell");
  // 759/760: the effect instructs the player to name a card; 762 restricts the
  // legal names. No naming primitive is merged (asserted below).
  assert.equal(nameInstruction.op, "choice.name");
  assert.deepEqual(nameInstruction.args.kind, { kind: "constant", value: "spell" });
  assert.deepEqual(nameInstruction.args.linkKey, { kind: "constant", value: "namedCard" });
  assert.equal(instructionDefinitionsById.get("choice.name"), undefined);
});

test("ven-132-166 Fallen Feline: the play ban is a static restriction gated on being at a battlefield", () => {
  assert.equal(playRestriction.kind, "static");
  assert.equal(playRestriction.effect.kind, "continuous.restrict");
  assert.equal(playRestriction.effect.mode, "cannot-play");
  assert.equal(playRestriction.effect.appliesTo, "opponent");
  assert.deepEqual(playRestriction.effect.subject, {
    kind: "constant",
    value: { type: "spell" }
  });
  // The banned name comes from the naming instruction's linked value; recorded
  // descriptively because neither side of the link has a merged consumer.
  assert.deepEqual(playRestriction.effect.namedFrom, {
    instructionId: "fallen-feline.name-a-spell",
    key: "namedCard"
  });
  // “While I'm at a battlefield”: the ability's own condition.
  assert.equal(playRestriction.condition.kind, "compare");
  assert.equal(playRestriction.condition.operator, "ne");
  assert.deepEqual(playRestriction.condition.left, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.deepEqual(playRestriction.condition.right, { kind: "constant", value: null });
});

test("ven-132-166 golden: running the naming body fails loudly instead of silently doing nothing", () => {
  const base = world().player("controller").unit("fallen-feline", { controller: "controller" }).build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("fallen-feline") });
  assert.throws(() => runAbilityBody(nameSpell.body, kernel), /Unregistered instruction opcode: choice\.name/);
});

test.todo(
  "ven-132-166 Fallen Feline: 'name a spell' needs a naming choice primitive (collected name as " +
    "a linked value; 759-762) — no choice.name / effect.name-card op is merged"
);

test.todo(
  "ven-132-166 Fallen Feline: 'opponents can't play spells with that name' needs a " +
    "continuous.restrict primitive consumed by the chain's play legality check " +
    "(chain canAct / Finalize) — no consumer is merged (RIFT-89)"
);
