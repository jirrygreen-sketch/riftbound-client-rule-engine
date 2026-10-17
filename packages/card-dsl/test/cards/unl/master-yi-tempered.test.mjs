import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/master-yi-tempered.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay :rb_rune_rainbow: to choose me with a spell or ability and I can move from battlefield to battlefield.)";

const [hunt, deflectGrant, gankingGrant] = program.abilities;

test("unl-113-219 Master Yi, Tempered: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-113-219 Master Yi, Tempered: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /Ganking/);
  // The merged keyword definitions are named as such; the remaining gaps are
  // the trigger spelling/object payload, the XP predicate and the target-tax
  // consumer.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /PlayerSnapshot\.xp/);
});

test("unl-113-219 Master Yi, Tempered: [Hunt 2] carries its printed Hunt Value", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3: X is the Hunt Value; this printing prints 2.
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
});

test("unl-113-219 Master Yi, Tempered: [Level 6][>] gates both grants on 6 or more XP", () => {
  for (const ability of [deflectGrant, gankingGrant]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.deepEqual(ability.condition.right, { kind: "constant", value: 6 });
    // 824.1.c / 824.1.c.1 / 824.1.d: the gate is the controller's XP and must
    // re-evaluate as it changes; the shape is retained, not evaluated.
    assert.equal(ability.condition.left.kind, "count");
    assert.equal(ability.condition.left.subject, "controller-xp");
    assert.deepEqual(ability.condition.left.filter, { player: "controller" });
  }
});

test("unl-113-219 Master Yi, Tempered: Deflect is granted with the presumed value 1 (809.1.b.3)", () => {
  assert.equal(deflectGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(deflectGrant.effect.keyword, "Deflect");
  assert.deepEqual(deflectGrant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(deflectGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: Ganking is granted to the host", () => {
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.value, undefined);
  assert.deepEqual(gankingGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: the merged keyword registry now provides Hunt and Level", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  // RIFT-265 and RIFT-268 merged these definitions, so the card's remaining
  // gaps are the subscription spelling/object payload and the unevaluated XP
  // predicate, not the missing KeywordDefs.
  assert.equal(keywordDefinitionsById.has("Hunt"), true);
  assert.equal(keywordDefinitionsById.has("Level"), true);
  assert.equal(keywordDefinitionsById.has("Deflect"), true);
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
});

test("unl-113-219 Master Yi, Tempered: Hunt 2 expands to the conquer/hold XP triggers (823.1.c.1)", async () => {
  const { default: hunt } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  const expansion = hunt.expand({ value: hunt.value ?? program.abilities[0].value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.length, 2);
  assert.deepEqual(expansion.map(ability => ability.trigger.at), ["conquer", "hold"]);
  assert.deepEqual(expansion.map(ability => ability.body[0].op), ["effect.xp", "effect.xp"]);
  // 823.2: the printed Hunt Value 2 flows through the keyword's own expansion,
  // so the card does not restate the XP gain.
  assert.deepEqual(expansion.map(ability => ability.body[0].args.amount), [
    { kind: "constant", value: 2 },
    { kind: "constant", value: 2 }
  ]);
});

test("unl-113-219 Master Yi, Tempered: the Level expansion publishes the 6+ XP predicate for the layers pipeline", async () => {
  const { default: level } = await import("../../../../engine-core/dist/effects/keywords/Level.js");
  const [predicate] = level.expand({ value: 6, host: { canonicalCardId: CANONICAL_ID } });
  // 824.1.a / 824.1.b.1: [Level 6][>] publishes the threshold predicate that
  // makes the dependent ability text Active while the controller has 6+ XP.
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 6 });
  assert.equal(predicate.effect.operator, "gte");
  assert.equal(predicate.effect.controller, "controller");
  assert.equal(predicate.effect.link, "active");
});

test("unl-113-219 Master Yi, Tempered: the card's own grants are registered as static declarations", () => {
  // The two static abilities are the card's [Level 6][>] grants. They are
  // authored per contract 3.7; installing them into layers is the recorded gap.
  assert.deepEqual(program.abilities.filter(ability => ability.kind === "static").map(ability => [
    ability.effect.kind,
    ability.effect.keyword,
    ability.condition.right.value
  ]), [
    ["continuous.grant-keyword", "Deflect", 6],
    ["continuous.grant-keyword", "Ganking", 6]
  ]);
});

test("unl-113-219 Master Yi, Tempered: the Deflect expansion is a target tax the merged target plan can bill", async () => {
  // 809.1.c / 809.1.d: the granted Deflect is a mandatory additional Power cost
  // for each time an opponent chooses this unit. The KeywordDef exists and the
  // target plan charges the tax it declares, but nothing registers the card's
  // Level-gated grant (see judgeReason).
  const { default: deflectDefinition } = await import(
    "../../../../engine-core/dist/effects/keywords/Deflect.js"
  );
  const [expansion] = deflectDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect Value is presumed 1.
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "unl-113-219 Master Yi, Tempered: subscribe Hunt's conquer/hold expansion to the emitted conquered/held events and bind the conquering unit object (CR 823.1.c.1/823.2; current event spellings and score payload do not match)"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: evaluate the merged Level predicate against controller XP and deactivate the dependent grants as XP changes (CR 824.1.c.1/824.1.d; condition.predicate and PlayerSnapshot.xp are not consumed)"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: derive Deflect's target tax from the active granted keyword and let the movement workflow consume Ganking's layered permission (CR 809.1.c/810.1.c; target-tax and movement consumers remain open)"
);
