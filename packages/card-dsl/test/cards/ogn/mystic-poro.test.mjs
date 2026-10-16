import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mysticPoro from "../../../dist/cards/ogn/mystic-poro.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL =
  "card.hash-85fa951465a6a8b081cd52e0a9b48fd7e3d80cca31309f23efcf0cdf0f302c0e";

test("ogn-171-298 Mystic Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(mysticPoro);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-171-298 Mystic Poro: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(mysticPoro.canonicalCardId, CANONICAL);
  assert.equal(mysticPoro.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mysticPoro.rulesetVersion, "core-1.5");
  assert.equal(mysticPoro.status, "judge-required");
  // judgeReason must name the missing engine pieces and the dependent tasks
  // (README section 2: no bare "needs support").
  assert.match(mysticPoro.judgeReason, /Vision/);
  assert.match(mysticPoro.judgeReason, /RIFT-83/);
  assert.match(mysticPoro.judgeReason, /RIFT-64/);
  assert.equal(
    mysticPoro.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)"
  );
});

test("ogn-171-298 Mystic Poro: the only ability is the Vision keyword declaration", () => {
  assert.equal(mysticPoro.abilities.length, 1);
  // A non-valued keyword omits `value` (README section 5; CR 817 carries no number).
  assert.deepEqual(mysticPoro.abilities, [{ kind: "keyword", keyword: "vision" }]);
});

test("ogn-171-298 Mystic Poro: declared keyword resolves to the merged Vision definition (RIFT-83)", () => {
  const [declaration] = mysticPoro.abilities;
  const definition = keywordDefinitionsById.get("Vision");
  assert.ok(definition, "keywords/Vision.ts must be registered for this declaration");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // The expansion of THIS card's declaration must be valid EffectIR v2.
  const expansion = definition.expand({
    value: declaration.value,
    host: { canonicalCardId: CANONICAL }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: mysticPoro.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  // CR 817.1.c: the trigger is the permanent entering the Board.
  const [ability] = expansion;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-enters-board");
  assert.equal(ability.optional, false);
});

test.todo(
  "Mystic Poro: Predict as a real ability — look at the top card (CR 437.1) and optionally recycle it " +
    "(CR 817.2.a) — is blocked because effect.inspect negates in top scope without an ordered picks source " +
    "(契约 3.6 zoneSlice 未被 inspect 消费；RIFT-64) and no kernel path expands card keyword abilities " +
    "into an object-enters-board trigger on the chain (契约 3.5)"
);

test.todo(
  "Mystic Poro: CR 817.2 stacking — two Vision instances trigger separately and each may recycle independently " +
    "(keywords/Vision.ts declares stacking \"separate\"；执行依赖关键词→触发接线)"
);
