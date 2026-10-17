// RIFT-667 single-card golden: validation, identity and the key IR structure of
// Marai Spire. The whole-card execution evidence (its own scenario through the
// generic card harness plus the measured outcome of binding its own static ability
// with the production binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the binder rejects the appliesTo anchor and the
// printed keyword filter, cost.modify has no layer mapping, and repeat.cost is
// never collected at Finalize. Nothing here approximates the printed discount.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/marai-spire.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/programs/helpers.mjs";

const CANONICAL = "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd";
const SOURCE_TEXT = "While you control this battlefield, friendly [Repeat] costs cost :rb_energy_1: less.";
const [ability] = program.abilities;

test("sfd-211-221 Marai Spire: program validates, is registered and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-211-221 Marai Spire: static Repeat-cost discount scoped to friendly Repeat sources", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.4 / 356.4.b: "cost [1] less" is a discount; 820.1.c names the affected
  // additional cost.
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.appliesTo, "repeat-additional-cost");
  assert.deepEqual(ability.effect.filter, { keyword: "Repeat", controller: "self", zone: "board" });
  // 190.6.a / 190.6.d: "While you control this battlefield" is kept explicit.
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "objects",
      filter: { object: "self", controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("sfd-211-221 Marai Spire: the merged static binder refuses this ability in three measured steps", () => {
  // programs/statics.ts is the only CardProgram -> layers path for statics.
  const f = fixture({ cards: [{ id: "spire", cardId: program.canonicalCardId, types: ["battlefield"] }] });
  const host = f.kernel.getObject("spire");
  // (a) The authored appliesTo anchor is rejected outright.
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(ability, host),
    error => error.code === "judge-required" && /repeat-additional-cost/.test(error.message)
  );
  // (b) With the anchor dropped, the printed keyword filter is refused.
  const { appliesTo: _appliesTo, ...withoutAnchor } = ability.effect;
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic({ ...ability, effect: withoutAnchor }, host),
    error => error.code === "judge-required" && /Unsupported static filter field keyword/.test(error.message)
  );
  // (c) With both obstacles removed, layerFor still has no cost.modify mapping.
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(
      { ...ability, effect: { ...ability.effect, appliesTo: "self", filter: { controller: "self", zone: "board" } } },
      host
    ),
    error => error.code === "judge-required" && /no layer mapping/.test(error.message)
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test.todo(
  "sfd-211-221 Marai Spire: apply the -1 Energy discount to friendly Repeat additional costs at Finalize " +
    "(CR 190.6.a / 190.6.d / 356.4 / 356.4.f / 356.6) - needs a static cost.modify consumer"
);
test.todo(
  "sfd-211-221 Marai Spire: collect Repeat repeat.cost at Finalize so there is a cost to modify " +
    "(CR 820.1.c) - Repeat's KeywordDef expansion has no consumer"
);
