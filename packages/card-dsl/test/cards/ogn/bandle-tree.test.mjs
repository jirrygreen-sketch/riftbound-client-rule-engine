import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/bandle-tree.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const [ability] = program.abilities;

test("ogn-278-298 Bandle Tree: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-278-298 Bandle Tree: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-278-298) carries this text verbatim.
  assert.equal(program.sourceText, "You may hide an additional card here.");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /cost\.hidden/);
});

test("ogn-278-298 Bandle Tree: one static ability raising this battlefield's facedown limit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // CR 107.3.b / 107.3.b.1: the Facedown Zone has a maximum occupancy that can
  // be increased; "may hide" is a permission, not a chain instruction.
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "facedown-zone-maximum-occupancy");
  assert.equal(ability.effect.amount, 1);
  assert.equal(ability.effect.location, "self");
  // CR 190.6.a/190.6.d: the permission belongs to the battlefield's controller
  // (and to nobody while it is uncontrolled, 190.6.b).
  assert.equal(ability.condition, undefined);
});

test("ogn-278-298 Bandle Tree: no instruction is encoded, since neither restriction op is merged", () => {
  // The merged instruction registry (effects/instructions/registry.generated.ts)
  // has no continuous.restrict or cost.hidden file, and no layer evaluator
  // consumes continuous.restrict. Encoding a body instruction would describe an
  // executable ability that nothing can execute.
  assert.equal("body" in ability, false);
  assert.equal("with" in ability, false);
});

test.todo(
  "ogn-278-298 Bandle Tree: raising the Facedown Zone maximum occupancy by 1 (CR 107.3.b.1) " +
    "needs a merged continuous.restrict consumer"
);

test.todo(
  "ogn-278-298 Bandle Tree: the Hide action and its slot check (CR 422.1/422.2.a, 811.1.b) " +
    "need cost.hidden, which has no merged instruction file"
);

test.todo(
  "ogn-278-298 Bandle Tree: hiding an extra card must grant no discount and must not let cards " +
    "without Hidden be hidden (RIFT-40 triage of the same printing)"
);
