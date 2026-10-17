import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/banner-of-conquest.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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

test("rad-002-167 Banner of Conquest: the judgeReason names the current gaps", () => {
  // cards/README.md section 2: a judge-required program must name the missing
  // op/keyword/rule and the dependency, not just say "unimplemented".
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /playLocations/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /applyKeyword/);
  // The grant must not be approximated as an arithmetic Might bonus.
  assert.match(program.judgeReason, /807\.1\.c/);
  assert.doesNotMatch(program.judgeReason, /RIFT-349/);
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
  "rad-002-167 Banner of Conquest: the merged Deploy expansion (830.1.b) still needs the " +
    "continuous.location consumer in Finalize placement and the cleanup recall exemption."
);

test("rad-002-167 Banner of Conquest: the merged static binder registers the Assault grant and the here anchor", async () => {
  // RIFT-349 的 createEngineStaticBinder 是生产静态绑定路径：卡面的
  // continuous.grant-keyword 会写进 ability 图层，filter 的 controller:self 与
  // sameLocationAs:self 都解析成绝对过滤器（layers/engine.ts applyAbility 用它授予关键词）。
  const f = fixture({
    cards: [
      { id: "banner", cardId: CANONICAL, types: ["gear"], keywords: [{ id: "Deploy" }], might: null },
      { id: "ally", types: ["unit"], might: 2 }
    ]
  });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("banner"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = f.kernel.getObject("banner");
  // The engine-backed binder is what createProgramBinding().attachLifecycle
  // installs (RIFT-349); the default noopStaticBinder writes no layer entry.
  const { createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/statics.js");
  const bound = createEngineStaticBinder(f.engine).bindStatic(grant, source);
  assert.equal(f.engine.layers.registry.entries.size, 1);
  const [registered] = f.engine.layers.registry.list();
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Assault");
  assert.equal(registered.effect.filter.controller, "A");
  assert.deepEqual(registered.effect.filter.location, { type: "battlefield", id: "battlefield-1" });
  bound.unbind();
  assert.equal(f.engine.layers.registry.entries.size, 0);
});

/**
 * The reference kernel's keyword def credentials are asserted alongside the
 * program so a future Deploy KeywordDef cannot silently change this card's
 * declared shape.
 */
test("rad-002-167 Banner of Conquest: the merged Deploy KeywordDef expands the 830.1.b rewrites", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  const deploy = keywordDefinitionsById.get("Deploy");
  assert.notEqual(deploy, undefined);
  assert.equal(deploy.keyword, "Deploy");
  const expansions = deploy.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansions[0].effect.kind, "continuous.location");
  assert.equal(expansions[1].trigger.at, "hold");
  assert.equal(expansions[1].trigger.filter.player, "opponent");
  assert.equal(expansions[1].body[0].op, "effect.kill");
});
