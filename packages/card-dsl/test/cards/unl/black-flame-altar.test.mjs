import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/black-flame-altar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import grant from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56";
const SOURCE_TEXT =
  "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)";

const [ability] = program.abilities;

test("unl-208-219 Black Flame Altar: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-208-219 Black Flame Altar: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-208-219 Black Flame Altar: one static ability-layer keyword grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3: granting a keyword changes the abilities of the object in the
  // ability layer of the contract §3.4 order (copy → trait → ability →
  // arithmetic).
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.layer, "ability");
  // 814.1.b.3: printed [Shield] without a value is Shield 1; the expansion
  // (defender-gated +1 Might) lives in keywords/Shield.ts, not here.
  assert.deepEqual(ability.effect.keywords, [{ id: "shield", value: 1 }]);

  // 053.3/199.1: "here" is this Battlefield; 816.3: "with [Temporary]" is a
  // keyword-characteristic gate. Static binding translates the location anchor;
  // keyword filtering and value-based LocationRef matching remain incomplete.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self",
    keywords: ["Temporary"]
  });
});

test("Black Flame Altar: the real grant instruction registers Shield 1 in the ability layer", () => {
  // Only the grant is executable here. The printed static gate and subsequent
  // Shield expansion remain distinct unresolved parts of the card.
  const kernel = world()
    .unit("temporary-unit", { keywords: [{ id: "Temporary" }], might: 3 })
    .unit("other-unit", { might: 3 })
    .build();
  const run = runInstruction(grant, {
    target: "grant-recipient", keywords: { kind: "constant", value: ability.effect.keywords }
  }, { world: kernel, targets: { "grant-recipient": [kernel.ref("temporary-unit")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(kernel.ref("temporary-unit")).keywords.map(keyword => [keyword.id, keyword.value]), [
    ["Temporary", undefined], ["shield", 1]
  ]);
  assert.deepEqual(layers.evaluate(kernel.ref("other-unit")).keywords, []);
});

test("unl-208-219 Black Flame Altar: the Temporary KeywordDef is merged and keeps this card's gate meaningful", () => {
  // CR 816.1/816.3: RIFT-265 merged effects/keywords/Temporary.ts, so
  // "with [Temporary]" is now a real registry characteristic; what is missing is
  // the filter predicate and the dynamically granted keyword expansion.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  assert.equal(temporary.valued, false);
  assert.equal(temporary.stacking, "single");
  const [expanded] = temporary.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "beginning-start");
});

test.todo("black-flame-altar: bind the Temporary filter and match source-relative LocationRef by value (CR 053.3/816.3; RIFT-359)");

test.todo("black-flame-altar: expand dynamically granted Shield and bind its defender designation to combatRole (CR 814.1.c/814.1.d; RIFT-359)");
