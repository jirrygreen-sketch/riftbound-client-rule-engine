import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/covert-informant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

test("covert-informant: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-a7852cd3cb51ac726ccf3fd549d64c739122b2160a5f283dd604718dda7c5bb6"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] When I move, draw 1."
  );
});

test("covert-informant: judgeReason names the current Empower cost and gate gaps", () => {
  // The stale "no Empower/Empowered expansion" claim is gone: RIFT-593 merged the
  // KeywordDef and the empowered status predicate.
  assert.equal(keywordDefinitionsById.has("Empower"), true);
  assert.match(program.judgeReason, /827\.1\.c/);
  assert.match(program.judgeReason, /3\.8\.3/);
  assert.match(program.judgeReason, /Unsupported cost kind empower/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.ok(!/缺 Empower\/Empowered 的关键词展开/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("covert-informant: drawing from an empty deck reports the actual zero count", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["covert-informant.draw.drawn"], 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test("covert-informant: the declared self-scoped trigger filter translates to the source object id", () => {
  // programs/filters.ts 是生产触发器绑定用的翻译层：嵌套 EventPattern 的 source: "self"
  // 会翻成「该来源对象」的 objectId 过滤，而不是被当成未知字段拒绝。
  const ability = program.abilities[1];
  assert.deepEqual(
    translateTriggerFilter(ability.trigger.filter, "covert-informant", ability.trigger.at),
    { event: "object-moved", object: { objectId: "covert-informant" } }
  );
});

test("covert-informant: Empower 3 is declared with the printed cost recorded, not executed", () => {
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "empower", value: 3 });
  // The printed :rb_energy_3: cannot reach the expansion (judgeReason 1); the
  // numeric value keeps the printed symbol count reviewable without pretending
  // to be the CostSpec that 827.1.c demands.
});

test("covert-informant: the move trigger is a mandatory object-moved trigger scoped to self", () => {
  const ability = program.abilities[1];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("covert-informant: the body is one unlinked effect.draw of exactly 1", () => {
  const ability = program.abilities[1];
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "covert-informant.draw");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("covert-informant: the body really draws 1 through the chain adapter", () => {
  const ability = program.abilities[1];
  const kernel = world().deck(["top", "next"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["covert-informant.draw.drawn"], 1);
});


test("covert-informant: the review records the current blockers", () => {
  assert.match(program.judgeReason, /827\.1\.c/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /442\.1\.a/);
});

test.todo(
  "covert-informant: 827.1.c/828.1.b.1: the printed Empower cost has no channel from KeywordAbility into " +
    "expand (contract 3.8.3) and no empower payment kind in the cost pipeline; the dependent ability's " +
    "Empowered gate also has no trigger/static binding path"
);
