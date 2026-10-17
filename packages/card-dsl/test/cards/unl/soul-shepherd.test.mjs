// Scenario execution evidence: ../templates/static-644.test.mjs (one parameterized row per card).
// This card stays judge-required (frozen controller after take-control); the template row asserts
// the supported positive path for the controller's token units.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-shepherd.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c";
const SOURCE_TEXT = "Your token units have +1 :rb_might:.";

const [ability] = program.abilities;
const { effect } = ability;

test("unl-077-219 Soul Shepherd: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("unl-077-219 Soul Shepherd: identity, ruleset, judge-required status, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /take-control/);
  assert.match(program.judgeReason, /current|当前/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-077-219 Soul Shepherd: a static arithmetic Might aura scoped to your token units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  // 740.1.a: "your" scopes the controller; type "token" is the merged layers
  // vocabulary for token membership (ObjectSnapshot.isToken).
  assert.deepEqual(effect.filter, {
    zone: "board",
    type: "token",
    controller: "controller"
  });
});

test("unl-077-219 Soul Shepherd regression: production lifecycle pins the first controller after take-control", () => {
  // Use the exact current IR through the production lifecycle path, with only
  // the status lifted so ProgramRegistry will bind this judge-required card.
  // The observed result is the shared binding gap recorded in judgeReason:
  // controller: "controller" is resolved once when the source enters Board.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [
      { id: "soul-shepherd", cardId: CANONICAL, types: ["unit"], energy: 5, might: 3, owner: "A", controller: "A" },
      { id: "ally-token", types: ["unit"], isToken: true, might: 1, owner: "A", controller: "A" },
      { id: "stolen-token", types: ["unit"], isToken: true, might: 1, owner: "B", controller: "B" },
      { id: "vanilla", types: ["unit"], isToken: false, might: 1, owner: "A", controller: "A" },
      { id: "enemy-token", types: ["unit"], isToken: true, might: 1, owner: "B", controller: "B" }
    ]
  });
  const lifecycle = binding.attachLifecycle(f.engine);
  const board = id => f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref(id),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  try {
    board("ally-token");
    board("stolen-token");
    board("vanilla");
    board("enemy-token");
    board("soul-shepherd");
    f.engine.layers.setObjects(f.kernel.objects);
    assert.deepEqual(
      ["ally-token", "stolen-token"].map(id => f.engine.layers.evaluate(f.kernel.ref(id)).might),
      [2, 1]
    );

    const transfer = f.engine.commit({ type: "take-control", object: f.kernel.ref("soul-shepherd"), player: "B" });
    assert.equal(transfer.status, "done");
    f.engine.layers.setObjects(f.kernel.objects);
    // Correct CR 479.4 behavior would be [1, 2]. The current production
    // lifecycle remains [2, 1], so this regression stays judge-required until
    // the shared static binding path re-evaluates relative controllers.
    assert.deepEqual(
      ["ally-token", "stolen-token"].map(id => f.engine.layers.evaluate(f.kernel.ref(id)).might),
      [2, 1]
    );
  } finally {
    lifecycle.detach();
  }
});
