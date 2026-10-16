import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gemhand-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { validateCardProgram as validateExpansion } from "../../../dist/index.js";

const CANONICAL_ID =
  "card.hash-ab13903af22d097efdc5e4e666b4055e6ef532fd5138f05aef5bd99a8ae78a8c";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "[Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)";

const [hunt, level] = program.abilities;

test("unl-094-219 Gemhand Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-094-219 Gemhand Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /823/);
  assert.match(program.judgeReason, /Level/);
  assert.match(program.judgeReason, /824/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-094-219 Gemhand Hunter: [Hunt] omits its value and [Level 6] carries the threshold", () => {
  assert.equal(program.abilities.length, 2);
  // 823.1.c.2: an omitted Hunt value is Hunt 1, so the keyword declaration
  // carries no `value` (README section 5).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
  assert.equal(hunt.value, undefined);
  // 824.1.a: the printed "[Level 6][>]" carries the XP threshold.
  assert.deepEqual(level, { kind: "keyword", keyword: "level", value: 6 });
});

test("unl-094-219 Gemhand Hunter: any registered Hunt/Level definitions expand this card's declarations", () => {
  // These keyword files are owned by the keyword workstreams (RIFT-265 / RIFT-268)
  // and may land after this shard; the declaration shape is asserted above and
  // the expansion is only checked once a definition is registered.
  const huntDefinition = keywordDefinitionsById.get("Hunt");
  if (huntDefinition !== undefined) {
    assert.equal(huntDefinition.valued, true);
    assert.equal(huntDefinition.stacking, "sum");
    // 823.1.c.1: "on conquer or hold, my controller gains X XP" through
    // effect.xp, one trigger per timing point.
    const huntExpansion = huntDefinition.expand({
      value: hunt.value,
      host: { canonicalCardId: CANONICAL_ID }
    });
    assert.deepEqual(
      huntExpansion.map(entry => entry.trigger.at),
      ["conquer", "hold"]
    );
    for (const entry of huntExpansion) {
      assert.equal(entry.kind, "triggered");
      assert.equal(entry.body[0].op, "effect.xp");
      // 823.1.c.2: omitted value means gain 1 XP.
      assert.deepEqual(entry.body[0].args.amount, { kind: "constant", value: 1 });
    }
    const validated = validateExpansion({
      canonicalCardId: CANONICAL_ID,
      rulesetVersion: EFFECT_IR_V2_RULESET,
      status: "executable",
      abilities: huntExpansion,
      sourceText: SOURCE_TEXT
    });
    assert.deepEqual(validated.issues, []);
    assert.equal(validated.ok, true);
  }

  const levelDefinition = keywordDefinitionsById.get("Level");
  if (levelDefinition !== undefined) {
    assert.equal(levelDefinition.valued, true);
    assert.equal(levelDefinition.stacking, "separate");
    // 824.1.b.1 / 824.1.c: the expansion publishes the controller-XP >= 6
    // predicate that makes the dependent ability ("I have +1 [M]") active.
    const levelExpansion = levelDefinition.expand({
      value: level.value,
      host: { canonicalCardId: CANONICAL_ID }
    });
    assert.equal(levelExpansion.length, 1);
    const [predicate] = levelExpansion;
    assert.equal(predicate.kind, "static");
    assert.equal(predicate.effect.kind, "condition.predicate");
    assert.equal(predicate.effect.query, "controller-xp");
    assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 6 });
    const validated = validateExpansion({
      canonicalCardId: CANONICAL_ID,
      rulesetVersion: EFFECT_IR_V2_RULESET,
      status: "executable",
      abilities: levelExpansion,
      sourceText: SOURCE_TEXT
    });
    assert.deepEqual(validated.issues, []);
    assert.equal(validated.ok, true);
  }
});

test.todo(
  "unl-094-219 Gemhand Hunter: fire the Hunt triggers from the real conquer/hold events and gain the XP " +
    "(CR 823.1.c.1) — scoring emits only triggerScore/triggerMethod flags and there is no keyword→trigger " +
    "registration (RIFT-120)"
);
test.todo(
  "unl-094-219 Gemhand Hunter: activate the dependent ability when the controller has 6+ XP (CR 824.1.c / " +
    "824.1.d) — the merged Condition cannot read player XP and no binder attaches the [Level 6] text"
);
test.todo(
  "unl-094-219 Gemhand Hunter: apply 'I have +1 :rb_might:' through the continuous.might arithmetic layer " +
    "(CR 824.1.b.1 / 143.2.a) — RIFT-91"
);
