import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/petricite-monument.js";

const CARD_ID = "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378";
const SOURCE_TEXT =
  "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
  "Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell or ability.)";

test("sfd-104-221 Petricite Monument: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-104-221 Petricite Monument: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-104-221 Petricite Monument: Temporary keyword plus a friendly-unit Deflect grant", () => {
  assert.equal(program.abilities.length, 2);

  // 816.1: the printed [Temporary] is declared as a keyword ability; its
  // expansion (the 816.1.b beginning-start kill) belongs to the keyword registry.
  const [temporary, grant] = program.abilities;
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });

  // "Friendly units have [Deflect]" — an ongoing grant to units you control.
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "deflect");
  // 809.1.b.3: omitted X is 1.
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  assert.equal(grant.condition, undefined);
});

test.todo(
  "sfd-104-221 Petricite Monument: [Temporary] (CR 816.1.b: at the start of the controller's Beginning Phase, before scoring, kill this) " +
    "needs a Temporary KeywordDef plus a beginning-start delayed-trigger registration path."
);
test.todo(
  "sfd-104-221 Petricite Monument: \"Friendly units have [Deflect]\" needs the continuous.grant-keyword producer/consumer (contract 3.7, RIFT-91) " +
    "and the target.tax reader for the granted keyword (CR 809.1.c, RIFT-90)."
);
