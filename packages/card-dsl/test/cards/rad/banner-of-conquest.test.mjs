import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/banner-of-conquest.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "Friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)";

const [deploy, grant] = program.abilities;

test("rad-002-167 Banner of Conquest: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("rad-002-167 Banner of Conquest: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-002-167 Banner of Conquest: the judgeReason names the actual merged gaps", () => {
  // cards/README.md section 2: a judge-required program must name the missing
  // op/keyword/rule and the dependency, not just say "unimplemented".
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /addContinuous/);
  assert.match(program.judgeReason, /RIFT-91/);
  // The grant must not be approximated as an arithmetic Might bonus.
  assert.match(program.judgeReason, /807\.1\.c/);
});

test("rad-002-167 Banner of Conquest: the printed [Deploy] is declared as a keyword ability", () => {
  // 830.1 / 830.1.a: Deploy is a Passive and Triggered Ability keyword on Gear;
  // the card declares it and the registry expands it (contract 3.7).
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });
  assert.equal(deploy.value, undefined);
});

test("rad-002-167 Banner of Conquest: 'Friendly units here have [Assault]' is an ability-layer grant", () => {
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 807.1.c grants Assault while attacking; with X omitted it is 1
  // (807.1.b.3) — exactly what the printed reminder states.
  assert.equal(grant.effect.keyword, "Assault");
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  // "Friendly units here": the controller's own Board units anchored to the
  // source Battlefield (053.3 / contract 3.6 sameLocationAs).
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "self",
    sameLocationAs: "self"
  });
  assert.equal(grant.condition, undefined);
  // A static ability carries no body and no chain flow of its own (contract 3.5).
  assert.ok(!("body" in grant));
  assert.ok(!("trigger" in grant));
  assert.ok(!("cost" in grant));
});

test("rad-002-167 Banner of Conquest: the grant names the unmerged Assault expansion, not a Might change", () => {
  // Guard the red line: the card must not bake Assault 1 into +1 Might (the
  // bonus applies only while the unit is an attacker, 807.1.c/807.1.d.1).
  assert.notEqual(grant.effect.kind, "continuous.might");
  assert.equal(grant.effect.mode, undefined);
  assert.equal(grant.effect.amount, undefined);
});

test.todo(
  "rad-002-167 Banner of Conquest: expanding [Deploy] into its four 830.1.b rewrites needs a " +
    "Deploy KeywordDef (effects/keywords/<keyword>.ts; kw-deploy, RIFT-91 continuous.location / " +
    "continuous.restrict consumers)."
);

test.todo(
  "rad-002-167 Banner of Conquest: registering the continuous Assault grant for friendly units " +
    "at the source battlefield needs a CardProgram -> layers registration path that calls " +
    "ctx.addContinuous (no merged instruction does; RIFT-91 + RIFT-120 follow-up)."
);

/**
 * The reference kernel's keyword def credentials are asserted alongside the
 * program so a future Deploy KeywordDef cannot silently change this card's
 * declared shape.
 */
test("rad-002-167 Banner of Conquest: no merged Deploy KeywordDef exists yet (the declared gap)", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  assert.equal(keywordDefinitionsById.get("Deploy"), undefined);
  assert.equal(keywordDefinitionsById.get("deploy"), undefined);
});
