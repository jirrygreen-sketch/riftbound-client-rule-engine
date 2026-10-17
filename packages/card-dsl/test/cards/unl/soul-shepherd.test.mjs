import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-shepherd.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
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

test("unl-077-219 Soul Shepherd: identity, ruleset, executable status, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
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

test("unl-077-219 Soul Shepherd golden: the production static binder gives +1 Might to your token units only", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [
      { id: "soul-shepherd", cardId: CANONICAL, types: ["unit"], energy: 5, might: 3, owner: "A", controller: "A" },
      { id: "ally-token", types: ["unit"], isToken: true, might: 1, owner: "A", controller: "A" },
      { id: "vanilla", types: ["unit"], isToken: false, might: 1, owner: "A", controller: "A" },
      { id: "enemy-token", types: ["unit"], isToken: true, might: 1, owner: "B", controller: "B" }
    ]
  });
  const board = id => f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref(id),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  board("ally-token");
  board("vanilla");
  board("enemy-token");
  board("soul-shepherd");
  const source = f.kernel.getObject("soul-shepherd");
  const staticAbility = binding.inspect(source).abilities.find(entry => entry.kind === "static");
  const handle = createEngineStaticBinder(f.engine).bindStatic(staticAbility, source);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally-token")).might, 2);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("vanilla")).might, 1);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("enemy-token")).might, 1);
  handle.unbind();
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally-token")).might, 1);
});
