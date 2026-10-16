import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/black-flame-altar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-208-219 Black Flame Altar: one static ability-layer keyword grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 476/477: granting a keyword changes what the objects are, which is the
  // ability layer of the contract §3.4 order (copy → trait → ability →
  // arithmetic).
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.layer, "ability");
  // 814.1.b.3: printed [Shield] without a value is Shield 1; the expansion
  // (defender-gated +1 Might) lives in keywords/Shield.ts, not here.
  assert.deepEqual(ability.effect.keywords, [{ id: "shield", value: 1 }]);

  // 053.3/199.1: "here" is this Battlefield; 816.3: "with [Temporary]" is a
  // keyword-characteristic gate. Neither anchor/predicate is implemented by
  // the merged layer filter, which is exactly the judged gap.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self",
    keywords: ["Temporary"]
  });
});

test.todo(
  "unl-208-219 Black Flame Altar: register the static ability as a ContinuousEffectSpec and implement " +
    "the 053.3 sameLocationAs anchor plus the [Temporary] keyword predicate in the layer filter " +
    "(RIFT-91 follow-up; the merged layers engine applies ability-layer keyword grants but no card " +
    "program reaches it)"
);

test.todo(
  "unl-208-219 Black Flame Altar: consume the Shield expansion (keywords/Shield.ts, 814.1.c: +1 Might " +
    "while the unit is a defender) so the granted keyword really reaches the arithmetic layer " +
    "(RIFT-91)"
);

test.todo(
  "unl-208-219 Black Flame Altar: add a Temporary KeywordDef so 'has [Temporary]' is a registry " +
    "characteristic the matcher can read (CR 816.3; keyword batch RIFT-83/84)"
);
