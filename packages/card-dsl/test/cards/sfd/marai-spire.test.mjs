// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/marai-spire.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/programs/helpers.mjs";

const [ability] = program.abilities;

test("sfd-211-221 Marai Spire: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /Repeat/);
  assert.match(program.judgeReason, /repeat-additional-cost/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /programs\/statics\.ts/);
  assert.equal(
    program.sourceText,
    "While you control this battlefield, friendly [Repeat] costs cost :rb_energy_1: less."
  );
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-211-221 Marai Spire: static Repeat-cost discount scoped to friendly Repeat sources", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.appliesTo, "repeat-additional-cost");
  assert.deepEqual(ability.effect.filter, {
    keyword: "Repeat",
    controller: "self",
    zone: "board"
  });
  // "While you control this battlefield" (190.6.a / 190.6.d) is kept explicit.
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

test("sfd-211-221 Marai Spire: the merged static binder refuses this ability", () => {
  // The production binder is the only CardProgram -> layers path for statics.
  // It rejects appliesTo "repeat-additional-cost" before layerFor could even
  // report that cost.modify has no mapping.
  const f = fixture({ cards: [{ id: "spire", cardId: program.canonicalCardId, types: ["battlefield"] }] });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("spire")),
    error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /repeat-additional-cost/);
      return true;
    }
  );
  // Two further blockers are also owned by the merged binder: the printed
  // `keyword: "Repeat"` filter field is unknown to staticFilter, and removing
  // it leaves layerFor without any cost.modify mapping. Each is asserted
  // separately so the reason names only live gaps.
  // (a) With the unsupported appliesTo dropped, the printed keyword filter
  // reaches staticFilter and is refused there.
  const { appliesTo: _appliesTo, ...withoutAppliesTo } = ability.effect;
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic({ ...ability, effect: withoutAppliesTo }, f.kernel.getObject("spire")),
    error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Unsupported static filter field keyword/);
      return true;
    }
  );
  // (b) With both obstacles removed, layerFor still has no cost.modify mapping.
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(
      { ...ability, effect: { ...ability.effect, appliesTo: "self", filter: { controller: "self", zone: "board" } } },
      f.kernel.getObject("spire")
    ),
    error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /no layer mapping/);
      return true;
    }
  );
});

// The discount is not executable: no production consumer binds a static
// cost.modify into Finalize and Repeat's repeat.cost has no collector.
test.todo(
  "sfd-211-221 Marai Spire: apply the -1 energy discount to friendly Repeat additional costs at Finalize (static cost.modify -> cost plan consumer; 356.4/356.4.f/356.6)"
);
test.todo(
  "sfd-211-221 Marai Spire: Repeat repeat.cost collection at Finalize so the discount has a target cost to modify (keywords/Repeat.ts)"
);
