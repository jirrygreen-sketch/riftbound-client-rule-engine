import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/bandle-tree.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const literal = (value) => ({ kind: "constant", value });

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
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
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

test("ogn-278-298 Bandle Tree golden: the +1 Facedown Zone cap registers through continuous.restrict", () => {
  // CR 107.3.b.1: the declared permission is a numeric cap increase. The merged
  // continuous.restrict primitive registers it with mode "limit" and amount 1.
  const base = world().unit("bandle-tree", { types: ["battlefield"], zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("bandle-tree") });
  const run = runInstruction(
    restrict,
    {
      mode: literal("limit"),
      restriction: literal(ability.effect.restriction),
      amount: literal(ability.effect.amount),
      appliesTo: literal({ object: "self" })
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.continuousEffects.map((entry) => entry.duration), [{ type: "permanent" }]);
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const found = restrictions(registry, "facedown-zone-maximum-occupancy");
  assert.equal(found.length, 1);
  assert.equal(found[0].cap, true);
  assert.equal(found[0].amount, 1);
});

test.todo(
  "ogn-278-298 Bandle Tree: bind the static CardProgram restriction to the layer pipeline (RIFT-257) and enforce " +
    "the raised Facedown Zone maximum in the Hide action (CR 422.1/422.2.a, 811.1.b; the Hide cost/zone work is " +
    "RIFT-261 cost.hidden)"
);

test.todo(
  "ogn-278-298 Bandle Tree: hiding an extra card must grant no discount and must not let cards " +
    "without Hidden be hidden (RIFT-40 triage of the same printing)"
);
